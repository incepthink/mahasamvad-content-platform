// Marathi text-to-speech for the explainer-video narration, via the Sarvam
// bulbul TTS model (client.textToSpeech.convert). Unlike the multi-step intake
// jobs (batch STT / document digitization), one convert call returns the audio
// directly — a base64-encoded WAV per input text — so this is a thin transport:
// one call, decode, return the bytes.
//
// The video runner supplies the complete joined narration in one call so scene
// cuts do not reset the voice or insert silence. A longer script is
// ~990 characters, below bulbul:v3's 2500-char / bulbul:v2's 1500-char limit.
// This file only synthesizes; the caller measures the returned WAV and can
// coherently shorten the whole script before trying again.
//
// This is the video's ONLY audio. Veo renders silent (generateAudio:false in
// veo-client.ts), so nothing here competes with a model-generated track.
//
// Model + voice are env-overridable because the preview voices/model ids churn
// and the "right" Marathi voice is a taste call best made without a redeploy.

import { pathToFileURL } from 'node:url';
import type { SarvamAI } from 'sarvamai';
import { createSarvamClient } from '../intake/sarvam-client.js';
import { recordTtsCost } from '../cost/cost-meter.js';

// Defaults chosen for Marathi narration; override per deployment via .env.
// bulbul:v3 is the latest model (better prosody, 30+ voices). If the account
// lacks v3 access, set SARVAM_TTS_MODEL=bulbul:v2 + a v2 speaker (e.g. anushka).
// `shubh` is v3's own default voice — a measured, authoritative read that suits
// an official government explainer.
const DEFAULT_TTS_MODEL = 'bulbul:v3';
const DEFAULT_TTS_SPEAKER = 'shubh';

// 44.1 kHz because that is exactly what muxNarration's aformat filter resamples
// every segment to: asking Sarvam for it removes an upsample that could only
// ever invent detail, never restore it. v3 goes to 48 kHz over REST if wanted.
const DEFAULT_TTS_SAMPLE_RATE = 44_100;

// Sarvam's default is 0.6; lower is steadier. Official narration wants
// consistency across eight scenes far more than it wants expressiveness, and
// higher values are documented to introduce artifacts.
const DEFAULT_TTS_TEMPERATURE = 0.5;

export function ttsModel(): string {
  const model = process.env.SARVAM_TTS_MODEL;
  return model && model.trim() !== '' ? model.trim() : DEFAULT_TTS_MODEL;
}

export function ttsSpeaker(): string {
  const speaker = process.env.SARVAM_TTS_SPEAKER;
  return speaker && speaker.trim() !== ''
    ? speaker.trim()
    : DEFAULT_TTS_SPEAKER;
}

function readNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

// bulbul:v3 only. pitch / loudness / enable_preprocessing are v2-only per the
// SDK's own docs and are deliberately never sent.
function isV3(): boolean {
  return ttsModel().startsWith('bulbul:v3');
}

export type NarrationOptions = Readonly<{
  // Override the env/default speaker for this call.
  speaker?: string;
  // Sarvam pace (bulbul:v3 0.5–2.0). Default 1.0; the fit-to-window step handles
  // length, so leaving this at natural pace gives the best-sounding baseline.
  pace?: number;
}>;

// Synthesize one Marathi narration passage. Returns WAV bytes and records the
// character count against the ambient cost meter (no-op outside a cost scope).
export async function synthesizeMarathiNarration(
  text: string,
  options?: NarrationOptions,
): Promise<Buffer> {
  const trimmed = text.trim();
  if (trimmed === '') {
    throw new Error('synthesizeMarathiNarration got empty text.');
  }
  const client = createSarvamClient();
  const sampleRate = readNumber(
    'SARVAM_TTS_SAMPLE_RATE',
    DEFAULT_TTS_SAMPLE_RATE,
  );
  const response = await client.textToSpeech.convert({
    text: trimmed,
    target_language_code: 'mr-IN',
    // Cast the env-configured model/voice: the SDK types them as closed enums,
    // but the whole point of the env override is to allow a newer voice/model id
    // without a redeploy, so the string is passed through as-is.
    model: ttsModel() as SarvamAI.TextToSpeechModel,
    speaker: (options?.speaker ?? ttsSpeaker()) as SarvamAI.TextToSpeechSpeaker,
    speech_sample_rate: sampleRate,
    ...(isV3()
      ? {
          temperature: readNumber(
            'SARVAM_TTS_TEMPERATURE',
            DEFAULT_TTS_TEMPERATURE,
          ),
        }
      : {}),
    ...(options?.pace !== undefined ? { pace: options.pace } : {}),
  });

  const base64 = response.audios?.[0];
  if (!base64) {
    throw new Error('Sarvam TTS returned no audio for the narration.');
  }
  recordTtsCost(trimmed.length);
  return Buffer.from(base64, 'base64');
}

// CLI harness: tsx --env-file=../../.env src/video/sarvam-tts.ts "<मराठी मजकूर>"
// Writes narration-test.wav next to the cwd so the voice can be auditioned
// without the API/web (tiny Sarvam spend).
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const text = process.argv.slice(2).join(' ').trim();
  if (!text) {
    console.error(
      'Usage: tsx --env-file=../../.env src/video/sarvam-tts.ts "<मराठी मजकूर>"',
    );
    process.exit(1);
  }
  void (async () => {
    const { writeFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    console.log(`Synthesizing with ${ttsModel()} / ${ttsSpeaker()}…`);
    const wav = await synthesizeMarathiNarration(text);
    const outPath = join(process.cwd(), 'narration-test.wav');
    await writeFile(outPath, wav);
    console.log(`Wrote ${outPath} (${wav.length} bytes).`);
  })().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
