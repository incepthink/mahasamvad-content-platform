// Marathi speech-to-text via ElevenLabs Scribe — the second implementation
// behind stt-provider.ts, beside Sarvam's batch STT. Same contract:
// one AudioTranscription per input, in input order.
//
// Four things worth knowing before touching this file:
//
// - THERE IS NO BATCH JOB HERE. Sarvam takes up to 20 files in ONE job
//   (create → upload → start → poll → download); ElevenLabs is a single
//   synchronous multipart POST per recording. So this file runs the files
//   itself, at a small concurrency (ELEVENLABS_STT_CONCURRENCY, default 2) —
//   a 6-recording intake is therefore slower than Sarvam's single job, not
//   more expensive. Concurrency is kept low on purpose: these are whole
//   meeting recordings and the account's parallel-request limit is a plan
//   property we would rather not discover mid-intake.
//
// - A PER-FILE FAILURE IS A RESULT, NOT A THROW. Every recording is wrapped,
//   so one bad file comes back as { error } and the others still deliver —
//   which is the invariant both callers (the DLO intake job and the
//   /transcribe job) are built on. This function throws only for a missing
//   API key, i.e. before any file has been attempted.
//
// - THE LANGUAGE IS PINNED TO MARATHI (`mar`, ISO-639-3 — Scribe's code set is
//   NOT the `mr-IN` BCP-47 tag Sarvam takes). Left to auto-detect, a Marathi
//   recording with English loanwords in it can come back transliterated into
//   Latin or detected as Hindi, and Devanagari makes that invisible at a
//   glance. ELEVENLABS_STT_LANGUAGE overrides it for a non-Marathi recording.
//
// - THE BILLED DURATION IS MEASURED, NOT GUESSED. Scribe returns word-level
//   timestamps; the last word's `end` is the audio's spoken length and is what
//   recordSttCost meters. No word timestamps (a silent recording, or a future
//   model that omits them) simply records nothing rather than inventing a
//   duration — under-reporting beats a fabricated cost line.
//
// - IT CAN TRANSCRIBE A URL WITHOUT DOWNLOADING IT — but by default nothing asks
//   it to any more. Scribe's `source_url` accepts "hosted video or audio files,
//   YouTube video URLs, TikTok video URLs, and other video hosting services" and
//   fetches the media on ElevenLabs' side; it travels as one more multipart field
//   in place of `file`, everything else about the request being identical. That is
//   what kept a video downloader out of this repo until 2026-08-19, when the
//   YouTube half of it began failing for every video with `Failed to download the
//   file from the provided URL (upstream status 400)` — YouTube's answer to THEM.
//   stt-provider.ts now resolves a link to bytes with yt-dlp before dispatching
//   (YOUTUBE_AUDIO_SOURCE, see youtube-audio.ts), so this branch is reached only
//   under the `provider` rollback. It is still the ONLY provider here that can
//   serve a URL at all — Sarvam's batch API uploads bytes — which is why
//   stt-provider.ts refuses URL inputs on the Sarvam path by name in that mode.
//   Hosted media URLs that are not YouTube still work here, verified.

import { pathToFileURL } from 'node:url';
import { audioMimeForFileName } from '@dgipr/schemas';
import { recordSttCost } from '../cost/cost-meter.js';
import {
  isAudioUrlInput,
  type AudioInput,
  type AudioTranscription,
} from './audio-input.js';

const DEFAULT_BASE_URL = 'https://api.elevenlabs.io';

// Scribe v1 is the transcription flagship. Env-overridable because the model
// ids churn (the veo-client doctrine).
const DEFAULT_MODEL = 'scribe_v1';

// ISO-639-3, not the BCP-47 `mr-IN` the Sarvam client sends.
const DEFAULT_LANGUAGE = 'mar';

const DEFAULT_CONCURRENCY = 2;

// A whole meeting recording can take minutes to transcribe; this is the ceiling
// on ONE file, not on the intake.
const REQUEST_TIMEOUT_MS = Number.parseInt(
  process.env.ELEVENLABS_STT_TIMEOUT_MS ?? `${20 * 60_000}`,
  10,
);
const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 1_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readEnv(name: string): string | undefined {
  const raw = process.env[name];
  return raw !== undefined && raw.trim() !== '' ? raw.trim() : undefined;
}

export function elevenLabsSttBaseUrl(): string {
  return (readEnv('ELEVENLABS_BASE_URL') ?? DEFAULT_BASE_URL).replace(
    /\/+$/,
    '',
  );
}

export function elevenLabsSttModel(): string {
  return readEnv('ELEVENLABS_STT_MODEL') ?? DEFAULT_MODEL;
}

export function elevenLabsSttLanguage(): string {
  return readEnv('ELEVENLABS_STT_LANGUAGE') ?? DEFAULT_LANGUAGE;
}

function elevenLabsSttConcurrency(): number {
  const raw = readEnv('ELEVENLABS_STT_CONCURRENCY');
  const value = raw === undefined ? Number.NaN : Number(raw);
  if (!Number.isFinite(value) || value < 1) return DEFAULT_CONCURRENCY;
  return Math.floor(value);
}

// Thrown before any file is attempted, so the caller marks the whole batch
// failed rather than reporting N identical per-file errors.
function elevenLabsSttApiKey(): string {
  const key = readEnv('ELEVENLABS_API_KEY');
  if (!key) {
    throw new Error(
      'Missing required environment variable ELEVENLABS_API_KEY. ' +
        'Copy .env.example to .env and fill it in.',
    );
  }
  return key;
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

// Marks a failure the retry loop must NOT re-attempt. Needed because the loop's
// catch is what receives a throw from inside its own try: without the name, a
// 400 (a permanent property of the request) would be retried twice for nothing,
// and a timeout would triple an already-long wait an officer is sitting through.
const PERMANENT = 'ElevenLabsSttPermanentError';

function permanent(message: string): Error {
  const error = new Error(message);
  error.name = PERMANENT;
  return error;
}

// Scribe's response. Only `text` is required by us; `words` carries the
// timestamps the cost meter measures the audio's length from.
type ScribeResponse = Readonly<{
  text?: unknown;
  language_code?: unknown;
  words?: unknown;
}>;

// The spoken length of the recording, from the last word's end timestamp.
// Returns 0 when the model returned no usable timestamps — see the header note.
export function spokenSecondsOf(payload: ScribeResponse): number {
  if (!Array.isArray(payload.words)) return 0;
  let end = 0;
  for (const word of payload.words) {
    if (typeof word !== 'object' || word === null) continue;
    const value = (word as { end?: unknown }).end;
    if (typeof value === 'number' && Number.isFinite(value) && value > end) {
      end = value;
    }
  }
  return end;
}

async function transcribeOne(file: AudioInput): Promise<string> {
  const url = `${elevenLabsSttBaseUrl()}/v1/speech-to-text`;
  // A URL source carries no bytes at all — that is the whole point of it. Everything below
  // is shared; only which field names the audio differs.
  const contentType = audioMimeForFileName(file.name) ?? 'audio/mpeg';
  // Copied out of the Buffer ONCE, outside the retry loop: a Node Buffer may be a view
  // into a pooled (possibly shared) ArrayBuffer, which is not a BlobPart, and re-copying
  // a whole recording per attempt would be wasteful.
  const bytes = isAudioUrlInput(file) ? null : new Uint8Array(file.data);

  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // The form is rebuilt per attempt: a FormData carrying a Blob is consumed
    // by the fetch that sends it and cannot be replayed.
    const form = new FormData();
    if (isAudioUrlInput(file)) {
      // ElevenLabs fetches this itself. `source_url` supersedes the deprecated
      // `cloud_storage_url`, and unlike it accepts a YouTube link rather than only
      // presigned cloud-storage URLs.
      form.append('source_url', file.sourceUrl);
    } else {
      form.append('file', new Blob([bytes!], { type: contentType }), file.name);
    }
    form.append('model_id', elevenLabsSttModel());
    form.append('language_code', elevenLabsSttLanguage());
    // Diarization is off deliberately: the output shape must stay byte-identical
    // to the Sarvam path, which every downstream step (review cards, assembly,
    // the transcript cache) consumes as plain text.
    form.append('diarize', 'false');
    form.append('tag_audio_events', 'false');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'xi-api-key': elevenLabsSttApiKey() },
        body: form,
        signal: controller.signal,
      });
      if (response.ok) {
        const payload = (await response.json()) as ScribeResponse;
        const seconds = spokenSecondsOf(payload);
        if (seconds > 0) recordSttCost(seconds);
        return typeof payload.text === 'string' ? payload.text : '';
      }
      const detail = await response.text();
      if (!isRetryableStatus(response.status) || attempt === MAX_ATTEMPTS) {
        throw permanent(
          `ElevenLabs STT failed (${response.status}): ${detail.slice(0, 500)}`,
        );
      }
      lastError = new Error(
        `ElevenLabs STT ${response.status}: ${detail.slice(0, 200)}`,
      );
      console.warn(
        `[elevenlabs-stt] ${response.status} on ${file.name}, ` +
          `attempt ${attempt}/${MAX_ATTEMPTS}; retrying.`,
      );
    } catch (error) {
      if (error instanceof Error && error.name === PERMANENT) throw error;
      // A timed-out request is permanent for this file too: retrying buys
      // another full REQUEST_TIMEOUT_MS wait on a recording that already failed
      // to finish once.
      if (error instanceof Error && error.name === 'AbortError') {
        throw permanent(
          `ElevenLabs STT timed out after ${Math.round(REQUEST_TIMEOUT_MS / 1000)}s ` +
            `on ${file.name}.`,
        );
      }
      if (attempt === MAX_ATTEMPTS) throw error;
      lastError = error instanceof Error ? error : new Error(String(error));
      console.warn(
        `[elevenlabs-stt] request error on ${file.name}, ` +
          `attempt ${attempt}/${MAX_ATTEMPTS}: ${lastError.message}`,
      );
    } finally {
      clearTimeout(timer);
    }
    await sleep(BASE_BACKOFF_MS * attempt);
  }
  throw lastError ?? new Error('ElevenLabs STT failed.');
}

// Transcribe every recording, at a small concurrency, preserving input order.
// A per-file failure becomes { error }; throws only on a missing API key.
export async function transcribeAudioFilesViaElevenLabs(
  files: readonly AudioInput[],
): Promise<AudioTranscription[]> {
  if (files.length === 0) return [];
  elevenLabsSttApiKey(); // fail before spending anything if the key is absent

  const results = new Array<AudioTranscription>(files.length);
  const limit = Math.min(elevenLabsSttConcurrency(), files.length);
  let next = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next++;
      if (index >= files.length) return;
      const file = files[index]!;
      try {
        const text = (await transcribeOne(file)).trim();
        results[index] = text
          ? { text }
          : { error: 'ElevenLabs transcription came back empty.' };
      } catch (error) {
        results[index] = {
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  };

  await Promise.all(Array.from({ length: limit }, () => worker()));

  const failed = results.filter((result) => 'error' in result).length;
  console.log(
    `[elevenlabs-stt] ${files.length - failed} succeeded, ${failed} failed ` +
      `(${elevenLabsSttModel()}, ${elevenLabsSttLanguage()}).`,
  );
  return results;
}

// CLI harness: transcribes local recordings OR media URLs and prints the text.
// A YouTube link is the cheapest way to prove the source_url path end to end.
//   tsx --env-file=../../.env src/intake/elevenlabs-stt.ts <file.mp3|https://youtu.be/ID> …
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const paths = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
  void (async () => {
    if (paths.length === 0) {
      console.error(
        'Usage: tsx --env-file=../../.env src/intake/elevenlabs-stt.ts ' +
          '<file.mp3|https://youtu.be/ID> [more…]',
      );
      process.exit(1);
    }
    const { readFile } = await import('node:fs/promises');
    const { basename } = await import('node:path');
    const files: AudioInput[] = await Promise.all(
      paths.map(async (path) =>
        /^https?:\/\//i.test(path)
          ? { name: path, sourceUrl: path }
          : { name: basename(path), data: await readFile(path) },
      ),
    );
    console.log(
      `Transcribing ${files.length} file(s) with ${elevenLabsSttModel()} / ` +
        `${elevenLabsSttLanguage()}…`,
    );
    const results = await transcribeAudioFilesViaElevenLabs(files);
    results.forEach((result, index) => {
      console.log(`\n--- ${files[index]!.name} ---`);
      console.log('text' in result ? result.text : `FAILED: ${result.error}`);
    });
  })().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
