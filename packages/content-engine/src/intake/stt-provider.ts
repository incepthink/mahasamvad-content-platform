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
//
// A URL SOURCE IS RESOLVED TO BYTES HERE, BEFORE DISPATCH (YOUTUBE_AUDIO_SOURCE,
// default `download` — see youtube-audio.ts for why that had to change). This is
// the right seam for it rather than the ElevenLabs client: done here, Sarvam can
// serve a YouTube link too, and every provider added later gets it for free.
// Under YOUTUBE_AUDIO_SOURCE=provider nothing is downloaded and the old
// pass-the-link-along behaviour is byte-for-byte restored, which is also the only
// mode in which the Sarvam refusal below is still reachable.

import { pathToFileURL } from 'node:url';
import { transcribeAudioFiles } from './sarvam-stt.js';
import {
  isAudioUrlInput,
  type AudioFileInput,
  type AudioInput,
  type AudioTranscription,
} from './audio-input.js';
import { transcribeAudioFilesViaElevenLabs } from './elevenlabs-stt.js';
import { downloadUrlAudio, youTubeAudioSource } from './youtube-audio.js';

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

// Whether a pasted link can be transcribed at all, so a route or form can ask before
// offering the affordance rather than letting the officer discover it at the job.
//
// Two ways it can be true. With YOUTUBE_AUDIO_SOURCE=download (the default) the link is
// resolved to bytes here, so EVERY provider can serve one — including Sarvam, which could
// not before. Under `provider` it falls back to the original question: only ElevenLabs
// takes a `source_url`.
export function sttSupportsSourceUrl(): boolean {
  return youTubeAudioSource() === 'download' || sttProviderName() !== 'sarvam';
}

// Whether the configured provider can fetch a URL ITSELF, which is what lets a caller hand
// it a presigned storage URL instead of downloading the recording into this process first.
//
// ElevenLabs takes a `source_url`; Sarvam's batch API uploads bytes and has no equivalent,
// so a Sarvam deployment must keep downloading. Callers ask this rather than testing
// STT_PROVIDER themselves, so STT_PROVIDER=sarvam stays a working rollback.
export function sttProviderFetchesUrls(): boolean {
  return sttProviderName() !== 'sarvam';
}

// Dispatch to the configured backend. Everything reaching here has already been through
// the URL resolution above, so on the download path `files` is all bytes -- EXCEPT a
// providerFetches URL, which is deliberately passed through untouched.
async function transcribeViaProvider(
  provider: string,
  files: readonly AudioInput[],
): Promise<AudioTranscription[]> {
  switch (provider) {
    case 'sarvam': {
      const results = new Array<AudioTranscription>(files.length);
      const bytePositions: number[] = [];
      const byteInputs: AudioFileInput[] = [];
      for (const [index, file] of files.entries()) {
        if (isAudioUrlInput(file)) {
          // Only reachable under YOUTUBE_AUDIO_SOURCE=provider — see the header.
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
    default:
      return transcribeAudioFilesViaElevenLabs(files);
  }
}

// Transcribe every input. One entry per input, in input order.
//
// A link that cannot be turned into audio is a per-input FAILURE, not a throw — the same
// contract a corrupt file gets — because the intake's other recordings are perfectly
// transcribable and must still deliver. That is true of both ways it can fail: the
// download itself (yt-dlp missing, the video private, YouTube refusing this server), and
// a URL reaching the Sarvam path under YOUTUBE_AUDIO_SOURCE=provider, whose batch API
// uploads bytes and has none. Keeping both as per-input errors is what keeps
// STT_PROVIDER=sarvam a working rollback rather than a broken deployment.
export async function transcribeAudio(
  files: readonly AudioInput[],
): Promise<AudioTranscription[]> {
  const provider = sttProviderName();
  // Validated BEFORE anything is downloaded: a misconfigured deployment must fail free.
  if (!(SUPPORTED_PROVIDERS as readonly string[]).includes(provider)) {
    throw new Error(
      `Unknown STT_PROVIDER "${provider}". ` +
        `Supported: ${SUPPORTED_PROVIDERS.join(', ')}.`,
    );
  }

  const results = new Array<AudioTranscription>(files.length);
  const positions: number[] = [];
  const prepared: AudioInput[] = [];

  for (const [index, file] of files.entries()) {
    if (
      isAudioUrlInput(file) &&
      // A presigned storage URL is passed straight to the provider: resolving it here is
      // what this flag exists to prevent (yt-dlp cannot read it, and buffering it would
      // reintroduce the memory failure signing it removes).
      file.providerFetches !== true &&
      youTubeAudioSource() === 'download'
    ) {
      try {
        // Sequentially, deliberately: these are whole press conferences, and a handful
        // of parallel downloads is both a bandwidth spike and the shape of traffic
        // YouTube rate-limits. The transcription that follows is the slow part anyway.
        prepared.push(await downloadUrlAudio(file));
        positions.push(index);
      } catch (error) {
        results[index] = {
          error: `${file.name}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        };
      }
      continue;
    }
    positions.push(index);
    prepared.push(file);
  }

  if (prepared.length > 0) {
    const transcribed = await transcribeViaProvider(provider, prepared);
    transcribed.forEach((result, position) => {
      results[positions[position]!] = result;
    });
  }
  return results;
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
  const originalSource = process.env.YOUTUBE_AUDIO_SOURCE;

  delete process.env.STT_PROVIDER;
  check('unset defaults to elevenlabs', sttProviderName() === 'elevenlabs');
  check(
    'elevenlabs gate names ELEVENLABS_API_KEY',
    sttProviderApiKeyEnv() === 'ELEVENLABS_API_KEY',
  );

  check('elevenlabs can transcribe a source URL', sttSupportsSourceUrl());
  check('elevenlabs fetches URLs itself', sttProviderFetchesUrls());

  process.env.STT_PROVIDER = '  Sarvam  ';
  check('trimmed + lowercased', sttProviderName() === 'sarvam');
  check(
    'sarvam gate names SARVAM_API_KEY',
    sttProviderApiKeyEnv() === 'SARVAM_API_KEY',
  );
  // Which is what stops a Sarvam deployment being handed a presigned URL its batch API
  // cannot fetch — the runners keep downloading the bytes there.
  check('sarvam does not fetch URLs itself', !sttProviderFetchesUrls());
  // The default now resolves a link to bytes before dispatch, so a link is transcribable
  // on EVERY provider — including the one whose API cannot fetch one.
  delete process.env.YOUTUBE_AUDIO_SOURCE;
  check(
    'sarvam can transcribe a source URL once it is downloaded',
    sttSupportsSourceUrl(),
  );

  // Under the rollback the original question comes back: only ElevenLabs takes one.
  process.env.YOUTUBE_AUDIO_SOURCE = 'provider';
  check(
    'sarvam cannot transcribe a source URL under YOUTUBE_AUDIO_SOURCE=provider',
    !sttSupportsSourceUrl(),
  );

  // URL-only input on the sarvam path: every entry must come back as an error, IN ORDER,
  // and no Sarvam call may be made (there are no byte inputs to make one with) — so this
  // runs free, with no key and no network. Pinned to `provider` mode, which is the only
  // one that still reaches the refusal; in `download` mode this would spawn yt-dlp.
  let sarvamUrlResults: AudioTranscription[] = [];
  void transcribeAudio([
    { name: 'one', sourceUrl: 'https://www.youtube.com/watch?v=aaaaaaaaaaa' },
    { name: 'two', sourceUrl: 'https://www.youtube.com/watch?v=bbbbbbbbbbb' },
  ]).then((results) => {
    sarvamUrlResults = results;
  });

  // THE REGRESSION GUARD FOR PRESIGNED STORAGE URLS. In `download` mode (the default) an
  // ordinary URL input is resolved to bytes here with yt-dlp — which for a presigned S3 URL
  // would both fail and buffer the recording, defeating the entire point of signing it. A
  // providerFetches input must therefore bypass that loop and reach the provider untouched.
  // Asserted on the SARVAM path because its refusal is a deterministic Marathi string
  // produced with no key and no network: seeing it proves dispatch was reached. If the
  // bypass ever regresses, this instead spawns yt-dlp and the message will not match.
  delete process.env.YOUTUBE_AUDIO_SOURCE;
  process.env.STT_PROVIDER = 'sarvam';
  let presignedResults: AudioTranscription[] = [];
  void transcribeAudio([
    {
      name: 'meeting.mp3',
      sourceUrl:
        'https://s3.example.invalid/dlo-uploads/x.mp3?X-Amz-Signature=z',
      providerFetches: true,
    },
  ]).then((results) => {
    presignedResults = results;
  });

  // An unknown provider must be refused BEFORE any download is attempted, so the
  // misconfiguration costs nothing. Asserted in `download` mode with a URL input: if the
  // guard moved below the resolution loop, this would try to spawn yt-dlp.
  delete process.env.YOUTUBE_AUDIO_SOURCE;
  process.env.STT_PROVIDER = 'nope';
  let threwOnUrl = '';
  void transcribeAudio([
    { name: 'x', sourceUrl: 'https://www.youtube.com/watch?v=ccccccccccc' },
  ]).catch((error: unknown) => {
    threwOnUrl = error instanceof Error ? error.message : String(error);
  });

  let threw = '';
  void transcribeAudio([{ name: 'a.mp3', data: Buffer.from('x') }]).catch(
    (error: unknown) => {
      threw = error instanceof Error ? error.message : String(error);
    },
  );

  if (original === undefined) delete process.env.STT_PROVIDER;
  else process.env.STT_PROVIDER = original;
  if (originalSource === undefined) delete process.env.YOUTUBE_AUDIO_SOURCE;
  else process.env.YOUTUBE_AUDIO_SOURCE = originalSource;

  setTimeout(() => {
    check(
      'unknown provider names the supported list',
      threw.includes('elevenlabs, sarvam'),
    );
    check(
      'an unknown provider is refused before a link is downloaded',
      threwOnUrl.includes('elevenlabs, sarvam'),
    );
    check(
      'sarvam returns one entry per URL input, in order',
      sarvamUrlResults.length === 2 &&
        sarvamUrlResults.every((result) => 'error' in result),
    );
    check(
      'a presigned URL is handed to the provider, never to yt-dlp',
      presignedResults.length === 1 &&
        presignedResults.every(
          (result) => 'error' in result && result.error.includes('ElevenLabs'),
        ),
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
