// Provider seam for speech-to-text, mirroring narration-provider.ts (TTS),
// clip-provider.ts (clips) and frame-provider.ts (frames). The two jobs that
// transcribe recordings — /transcribe (transcription-runner.ts) and /dlo
// (dlo-runner.ts) — ask for "the text of these recordings" and this module
// dispatches to the configured backend; STT_PROVIDER trades them in an .env
// edit.
//
// Deliberately thin, like its three siblings: per-provider quirks live inside
// each client (Sarvam's batch job with its presigned upload/poll/download
// dance, ElevenLabs' per-file multipart POSTs and its own concurrency), and
// neither widens this type.
//
// The contract every provider must honour is ONE AudioTranscription PER INPUT,
// IN INPUT ORDER, with a per-file failure returned as { error } rather than
// thrown — both callers map results back onto their file entries positionally
// and rely on one bad recording never sinking the rest of the intake. A throw
// means a job-level failure (missing key, auth, network) and marks every
// recording failed.
//
// The DEFAULT IS ELEVENLABS: its Marathi output is materially better on this
// product's meeting recordings. STT_PROVIDER=sarvam is the one-line rollback.
//
// KNOWN AND DELIBERATE: the transcript cache (audio_transcript_cache, 0031) is
// keyed on the AUDIO BYTES ALONE, so it cannot tell a Sarvam transcript from an
// ElevenLabs one — under TRANSCRIPT_CACHE_MODE=read a recording first
// transcribed by the other provider is served from the cache. Reads are off by
// default, which is what keeps this dormant; see transcript-cache-mode.ts.

import { pathToFileURL } from 'node:url';
import { transcribeAudioFiles } from './sarvam-stt.js';
import {
  isAudioUrlInput,
  type AudioFileInput,
  type AudioInput,
  type AudioTranscription,
} from './audio-input.js';
import { transcribeAudioFilesViaElevenLabs } from './elevenlabs-stt.js';

const SUPPORTED_PROVIDERS = ['elevenlabs', 'sarvam'] as const;

export function sttProviderName(): string {
  const raw = process.env.STT_PROVIDER;
  return raw && raw.trim() !== '' ? raw.trim().toLowerCase() : 'elevenlabs';
}

// Which env var a caller must find for the configured provider, so a route or
// job can name the RIGHT key rather than hardcoding SARVAM_API_KEY (the
// clipProviderApiKeyEnv precedent — an ElevenLabs deployment may legitimately
// hold no Sarvam key at all).
export function sttProviderApiKeyEnv(): string {
  switch (sttProviderName()) {
    case 'sarvam':
      return 'SARVAM_API_KEY';
    default:
      return 'ELEVENLABS_API_KEY';
  }
}

export function sttKeyPresent(): boolean {
  const key = process.env[sttProviderApiKeyEnv()];
  return typeof key === 'string' && key.trim() !== '';
}

// Whether the configured provider can transcribe a URL it has to fetch itself (a YouTube
// link). Only ElevenLabs can — Scribe's `source_url` — so a route or form can ask before
// offering the affordance rather than letting the officer discover it at the job.
export function sttSupportsSourceUrl(): boolean {
  return sttProviderName() !== 'sarvam';
}

// Transcribe every input. One entry per input, in input order.
//
// A URL input on the Sarvam path is a per-input FAILURE, not a throw: Sarvam's batch API
// uploads bytes and there are none, but the intake's uploaded recordings are perfectly
// transcribable and must still deliver. That is the same contract a corrupt file gets, and
// it keeps STT_PROVIDER=sarvam a working rollback rather than a broken deployment.
export async function transcribeAudio(
  files: readonly AudioInput[],
): Promise<AudioTranscription[]> {
  const provider = sttProviderName();
  switch (provider) {
    case 'sarvam': {
      const results = new Array<AudioTranscription>(files.length);
      const bytePositions: number[] = [];
      const byteInputs: AudioFileInput[] = [];
      for (const [index, file] of files.entries()) {
        if (isAudioUrlInput(file)) {
          results[index] = {
            error:
              'यूट्युब लिंकवरून मजकूर काढण्यासाठी ElevenLabs आवश्यक आहे. ' +
              'सध्या Sarvam वापरले जात आहे, त्यामुळे ही लिंक वगळण्यात आली.',
          };
        } else {
          bytePositions.push(index);
          byteInputs.push(file);
        }
      }
      if (byteInputs.length > 0) {
        const transcribed = await transcribeAudioFiles(byteInputs);
        transcribed.forEach((result, position) => {
          results[bytePositions[position]!] = result;
        });
      }
      return results;
    }
    case 'elevenlabs':
      return transcribeAudioFilesViaElevenLabs(files);
    default:
      throw new Error(
        `Unknown STT_PROVIDER "${provider}". ` +
          `Supported: ${SUPPORTED_PROVIDERS.join(', ')}.`,
      );
  }
}

// Free harness: asserts dispatch and which key each provider's gate names.
//   tsx src/intake/stt-provider.ts
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const checks: Array<[string, boolean]> = [];
  const check = (label: string, ok: boolean): void => {
    checks.push([label, ok]);
  };
  const original = process.env.STT_PROVIDER;

  delete process.env.STT_PROVIDER;
  check('unset defaults to elevenlabs', sttProviderName() === 'elevenlabs');
  check(
    'elevenlabs gate names ELEVENLABS_API_KEY',
    sttProviderApiKeyEnv() === 'ELEVENLABS_API_KEY',
  );

  check('elevenlabs can transcribe a source URL', sttSupportsSourceUrl());

  process.env.STT_PROVIDER = '  Sarvam  ';
  check('trimmed + lowercased', sttProviderName() === 'sarvam');
  check(
    'sarvam gate names SARVAM_API_KEY',
    sttProviderApiKeyEnv() === 'SARVAM_API_KEY',
  );
  check('sarvam cannot transcribe a source URL', !sttSupportsSourceUrl());

  // URL-only input on the sarvam path: every entry must come back as an error, IN ORDER,
  // and no Sarvam call may be made (there are no byte inputs to make one with) — so this
  // runs free, with no key and no network.
  let sarvamUrlResults: AudioTranscription[] = [];
  void transcribeAudio([
    { name: 'one', sourceUrl: 'https://www.youtube.com/watch?v=aaaaaaaaaaa' },
    { name: 'two', sourceUrl: 'https://www.youtube.com/watch?v=bbbbbbbbbbb' },
  ]).then((results) => {
    sarvamUrlResults = results;
  });

  process.env.STT_PROVIDER = 'nope';
  let threw = '';
  void transcribeAudio([{ name: 'a.mp3', data: Buffer.from('x') }]).catch(
    (error: unknown) => {
      threw = error instanceof Error ? error.message : String(error);
    },
  );

  if (original === undefined) delete process.env.STT_PROVIDER;
  else process.env.STT_PROVIDER = original;

  setTimeout(() => {
    check(
      'unknown provider names the supported list',
      threw.includes('elevenlabs, sarvam'),
    );
    check(
      'sarvam returns one entry per URL input, in order',
      sarvamUrlResults.length === 2 &&
        sarvamUrlResults.every((result) => 'error' in result),
    );
    check(
      'the sarvam refusal names ElevenLabs',
      sarvamUrlResults.every(
        (result) => 'error' in result && result.error.includes('ElevenLabs'),
      ),
    );
    let failed = 0;
    for (const [label, ok] of checks) {
      console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
      if (!ok) failed++;
    }
    console.log(`\n${checks.length - failed}/${checks.length} passed.`);
    process.exitCode = failed > 0 ? 1 : 0;
  }, 0);
}
