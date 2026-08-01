// Marathi text-to-speech for the explainer-video narration via ElevenLabs —
// the second implementation behind narration-provider.ts, beside Sarvam bulbul.
//
// Four things worth knowing before touching this file:
//
// - IT ASKS FOR RAW PCM AND WRITES THE WAV HEADER ITSELF. Everything downstream
//   of the TTS call speaks WAV: wavDurationSeconds parses RIFF chunks to MEASURE
//   the narration (which is what the clip windows are derived from), the runner
//   uploads it as audio/wav, and muxNarration feeds it to ffmpeg. ElevenLabs
//   never returns a RIFF container — its options are mp3, µ-law and headerless
//   PCM — so requesting `pcm_<rate>` and prepending a 44-byte header is what
//   keeps the whole pipeline byte-identical to the Sarvam path. Decoding an MP3
//   would need ffmpeg here and would make the measured duration approximate.
//
// - THE SAMPLE RATE IS LEARNED, NOT DECLARED (the veo-client doctrine).
//   `pcm_44100` is gated to paid tiers; a lower-tier key gets a 4xx naming
//   output_format. Rather than making every deployment discover that through a
//   failed render, the first rejection falls back down a ladder and is cached
//   for the process. 44.1 kHz is preferred because muxNarration resamples to
//   exactly that, so asking for it removes an upsample that can only invent
//   detail.
//
// - SPEED IS MODEL-DEPENDENT AND MATTERS HERE. eleven_v3 exposes no speed
//   control, and measured against this pipeline's Marathi it reads much slower
//   than bulbul (~11 chars/s vs 16.5) — a 641-char script that fits a 45 s video
//   on Sarvam runs ~58 s on v3, which the ready-script path REFUSES rather than
//   silently truncating. eleven_multilingual_v2 does take `speed` (0.7–1.2), so
//   that is the model to configure when a fixed window has to be hit.
//   ELEVENLABS_SPEED is sent only when set, because v3 rejects it.
//
// - VOICE SETTINGS ARE ALL OPT-IN. An omitted field means "use the voice's own
//   saved setting", which is a better default than any number this file could
//   invent, and v3 additionally constrains stability to 0.0 / 0.5 / 1.0.

import { pathToFileURL } from 'node:url';
import { recordTtsCost } from '../cost/cost-meter.js';

const DEFAULT_BASE_URL = 'https://api.elevenlabs.io';

// v3 is the expressive flagship. Switch to eleven_multilingual_v2 when the
// narration has to be fitted to a fixed window (see the speed note above).
const DEFAULT_MODEL = 'eleven_v3';

// Preferred first, then the tier-gated ladder. 44100 needs a paid plan.
const SAMPLE_RATE_LADDER = [44_100, 24_000, 22_050, 16_000] as const;

const REQUEST_TIMEOUT_MS = 300_000;
const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 1_000;

// Which rate this process has proved the key can actually buy. Learned on the
// first rejection so one deployment pays for the discovery once.
let learnedSampleRate: number | null = null;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readEnv(name: string): string | undefined {
  const raw = process.env[name];
  return raw !== undefined && raw.trim() !== '' ? raw.trim() : undefined;
}

function readNumberEnv(name: string): number | undefined {
  const raw = readEnv(name);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

export function elevenLabsBaseUrl(): string {
  return (readEnv('ELEVENLABS_BASE_URL') ?? DEFAULT_BASE_URL).replace(
    /\/+$/,
    '',
  );
}

export function elevenLabsApiKey(): string {
  const key = readEnv('ELEVENLABS_API_KEY');
  if (!key) {
    throw new Error(
      'Missing required environment variable ELEVENLABS_API_KEY. ' +
        'Copy .env.example to .env and fill it in.',
    );
  }
  return key;
}

export function elevenLabsModel(): string {
  return readEnv('ELEVENLABS_MODEL') ?? DEFAULT_MODEL;
}

// The voice is the narration's identity, so there is no invented default: a
// wrong-but-plausible voice id would render a whole video in the wrong voice.
export function elevenLabsVoiceId(): string {
  const voice = readEnv('ELEVENLABS_VOICE_ID');
  if (!voice) {
    throw new Error(
      'Missing required environment variable ELEVENLABS_VOICE_ID ' +
        '(the ElevenLabs voice to narrate with).',
    );
  }
  return voice;
}

// Requested rate, honouring an explicit pin, then whatever this process has
// already learned the key can buy.
function preferredSampleRate(): number {
  const pinned = readNumberEnv('ELEVENLABS_SAMPLE_RATE');
  if (pinned !== undefined) return pinned;
  return learnedSampleRate ?? SAMPLE_RATE_LADDER[0];
}

function nextSampleRate(current: number): number | null {
  const index = SAMPLE_RATE_LADDER.indexOf(
    current as (typeof SAMPLE_RATE_LADDER)[number],
  );
  if (index < 0 || index + 1 >= SAMPLE_RATE_LADDER.length) return null;
  return SAMPLE_RATE_LADDER[index + 1]!;
}

// ElevenLabs PCM is 16-bit little-endian mono at the requested rate. Wrap it in
// the minimal canonical RIFF/WAVE header the rest of the pipeline parses.
export function pcmToWav(
  pcm: Buffer,
  sampleRate: number,
  channels = 1,
  bitsPerSample = 16,
): Buffer {
  const blockAlign = (channels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16); // PCM fmt chunk size
  header.writeUInt16LE(1, 20); // audio format: PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

// Omitted fields keep the voice's own saved settings — a better default than
// anything invented here. `speed` is v2-only; v3 rejects it, so it is opt-in.
function voiceSettings(): Record<string, number | boolean> | undefined {
  const settings: Record<string, number | boolean> = {};
  const stability = readNumberEnv('ELEVENLABS_STABILITY');
  const similarity = readNumberEnv('ELEVENLABS_SIMILARITY_BOOST');
  const style = readNumberEnv('ELEVENLABS_STYLE');
  const speed = readNumberEnv('ELEVENLABS_SPEED');
  const boost = readEnv('ELEVENLABS_SPEAKER_BOOST');
  if (stability !== undefined) settings['stability'] = stability;
  if (similarity !== undefined) settings['similarity_boost'] = similarity;
  if (style !== undefined) settings['style'] = style;
  if (speed !== undefined) settings['speed'] = speed;
  if (boost !== undefined) settings['use_speaker_boost'] = boost === 'true';
  return Object.keys(settings).length > 0 ? settings : undefined;
}

export type ElevenLabsNarrationOptions = Readonly<{
  // Override the env voice for this call (the seam's `speaker`).
  voiceId?: string | undefined;
}>;

function isOutputFormatRejection(status: number, body: string): boolean {
  if (status !== 400 && status !== 401 && status !== 403 && status !== 422) {
    return false;
  }
  const lower = body.toLowerCase();
  return (
    lower.includes('output_format') ||
    lower.includes('sample rate') ||
    lower.includes('pcm')
  );
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

async function requestPcm(
  text: string,
  voiceId: string,
  sampleRate: number,
): Promise<Buffer> {
  const url =
    `${elevenLabsBaseUrl()}/v1/text-to-speech/${encodeURIComponent(voiceId)}` +
    `?output_format=pcm_${sampleRate}`;
  const settings = voiceSettings();
  const language = readEnv('ELEVENLABS_LANGUAGE_CODE');
  const body = {
    text,
    model_id: elevenLabsModel(),
    ...(settings ? { voice_settings: settings } : {}),
    ...(language ? { language_code: language } : {}),
  };

  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'xi-api-key': elevenLabsApiKey(),
          'content-type': 'application/json',
          accept: 'audio/pcm',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (response.ok) {
        return Buffer.from(await response.arrayBuffer());
      }
      const detail = await response.text();
      // Surfaced to the ladder in synthesize(), never retried here: a rejected
      // output format is a permanent property of the key's plan.
      if (isOutputFormatRejection(response.status, detail)) {
        const error = new Error(
          `ElevenLabs rejected output_format=pcm_${sampleRate}: ${detail.slice(0, 300)}`,
        );
        error.name = 'ElevenLabsOutputFormatError';
        throw error;
      }
      if (!isRetryableStatus(response.status) || attempt === MAX_ATTEMPTS) {
        throw new Error(
          `ElevenLabs TTS failed (${response.status}): ${detail.slice(0, 500)}`,
        );
      }
      lastError = new Error(
        `ElevenLabs TTS ${response.status}: ${detail.slice(0, 200)}`,
      );
      console.warn(
        `[elevenlabs] ${response.status} on attempt ${attempt}/${MAX_ATTEMPTS}; retrying.`,
      );
    } catch (error) {
      if (
        error instanceof Error &&
        error.name === 'ElevenLabsOutputFormatError'
      )
        throw error;
      if (attempt === MAX_ATTEMPTS) throw error;
      lastError = error instanceof Error ? error : new Error(String(error));
      console.warn(
        `[elevenlabs] request error on attempt ${attempt}/${MAX_ATTEMPTS}: ${lastError.message}`,
      );
    } finally {
      clearTimeout(timer);
    }
    await sleep(BASE_BACKOFF_MS * attempt);
  }
  throw lastError ?? new Error('ElevenLabs TTS failed.');
}

// Synthesize one Marathi narration passage. Returns WAV bytes (PCM wrapped in a
// RIFF header) so every downstream consumer is unchanged from the Sarvam path.
export async function synthesizeElevenLabsNarration(
  text: string,
  options?: ElevenLabsNarrationOptions,
): Promise<Buffer> {
  const trimmed = text.trim();
  if (trimmed === '') {
    throw new Error('synthesizeElevenLabsNarration got empty text.');
  }
  const voiceId = options?.voiceId ?? elevenLabsVoiceId();

  let rate = preferredSampleRate();
  for (;;) {
    try {
      const pcm = await requestPcm(trimmed, voiceId, rate);
      if (pcm.length === 0) {
        throw new Error('ElevenLabs TTS returned no audio for the narration.');
      }
      learnedSampleRate = rate;
      recordTtsCost(trimmed.length);
      return pcmToWav(pcm, rate);
    } catch (error) {
      const fallback =
        error instanceof Error && error.name === 'ElevenLabsOutputFormatError'
          ? nextSampleRate(rate)
          : null;
      if (fallback === null) throw error;
      console.warn(
        `[elevenlabs] pcm_${rate} unavailable on this plan; falling back to pcm_${fallback}.`,
      );
      rate = fallback;
    }
  }
}

// CLI harness: writes narration-elevenlabs.wav next to the cwd and prints the
// measured duration, which is the number that decides whether a script fits.
//   tsx --env-file=../../.env src/video/elevenlabs-tts.ts "<मराठी मजकूर>"
//   tsx --env-file=../../.env src/video/elevenlabs-tts.ts --file=script.txt
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const args = process.argv.slice(2);
  void (async () => {
    const { writeFile, readFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const fileArg = args.find((arg) => arg.startsWith('--file='));
    const text = fileArg
      ? (await readFile(fileArg.slice('--file='.length), 'utf8')).trim()
      : args
          .filter((arg) => !arg.startsWith('--'))
          .join(' ')
          .trim();
    if (!text) {
      console.error(
        'Usage: tsx --env-file=../../.env src/video/elevenlabs-tts.ts "<मराठी मजकूर>" | --file=script.txt',
      );
      process.exit(1);
    }
    console.log(
      `Synthesizing ${text.length} chars with ${elevenLabsModel()} / voice ${elevenLabsVoiceId()}…`,
    );
    const wav = await synthesizeElevenLabsNarration(text);
    const { wavDurationSeconds } = await import('@dgipr/poster-renderer');
    const seconds = wavDurationSeconds(wav);
    const outPath = join(process.cwd(), 'narration-elevenlabs.wav');
    await writeFile(outPath, wav);
    console.log(
      `Wrote ${outPath} (${wav.length} bytes, ${seconds.toFixed(2)}s, ` +
        `${(text.length / seconds).toFixed(1)} chars/s).`,
    );
  })().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
