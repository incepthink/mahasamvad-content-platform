// Cut a recording down to the window the officer selected, before it reaches the transcriber.
//
// WHY IT IS HERE AND NOT IN THE BROWSER. The obvious place to trim is the page — the officer
// is standing in front of it and the upload would then be smaller. It is not possible: a
// two-hour MP3 decoded to PCM is gigabytes of Float32Array, and the containers this product
// accepts (m4a/aac/ogg/opus/flac/webm as well as mp3) cannot be sliced by byte offset. So the
// selection travels as two numbers and the cut happens here.
//
// WHY IT NEVER LOADS THE RECORDING. The transcribe phase of both jobs hands the STT provider a
// PRESIGNED S3 URL and the audio travels S3 -> transcriber without entering this process — the
// arrangement that removed the ~480 MB spike which OOM-killed the container on meeting
// recordings (2026-08-30). A trim must not undo that, so ffmpeg is given the presigned URL as
// its INPUT (its https protocol seeks with Range requests) and writes the cut to a temp FILE.
// Peak memory is ffmpeg's own working set, whatever the recording's length; the caller streams
// the temp file back to storage and never holds it either.
//
// WHY `-c copy`. Re-encoding a ninety-minute window would be slow and lossy for no gain: the
// transcriber wants the same audio, just less of it. Stream copy cuts on frame boundaries,
// which for every container here is a few tens of milliseconds — far below what anyone can
// select on a slider. `-avoid_negative_ts make_zero` is what stops a copied stream keeping the
// source's original timestamps, which some providers read as a file that starts an hour in.
//
// Free harness: npx tsx src/intake/trim-audio.ts --check
// Live (writes a real cut beside the input): npx tsx src/intake/trim-audio.ts <file> 10 25

import { spawn } from 'node:child_process';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ffmpegLocation } from './youtube-audio.js';

export type AudioTrimWindow = Readonly<{
  startSeconds: number;
  endSeconds: number;
}>;

export type TrimmedAudio = Readonly<{
  // Where the cut landed. The caller reads or streams it, then calls `cleanup`.
  path: string;
  bytes: number;
  // Removes the temp directory. Always call it, including on the failure path — a job that
  // throws after a successful trim would otherwise leave a meeting recording on the box.
  cleanup: () => Promise<void>;
}>;

// How long ffmpeg may take. A stream copy is I/O bound — it reads only the selected window
// over the network — so this is generous rather than tight: the failure it exists to catch is
// a hung connection, not a slow cut.
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

export function trimTimeoutMs(): number {
  const raw = process.env.AUDIO_TRIM_TIMEOUT_MS;
  if (raw === undefined || raw.trim() === '') return DEFAULT_TIMEOUT_MS;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : DEFAULT_TIMEOUT_MS;
}

/**
 * The ffmpeg arguments for one cut. Split out from the spawn so the harness can assert the
 * order for free — `-ss` and `-to` BEFORE `-i` is what makes this seek instead of decoding the
 * whole file and discarding the first hour, and it is the one detail here that is silently
 * expensive to get wrong rather than visibly broken.
 */
export function buildTrimArgs(
  source: string,
  destination: string,
  window: AudioTrimWindow,
): string[] {
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    // Overwrite: the destination is a file we just made inside our own temp directory.
    '-y',
    // INPUT seeking. After `-i` these would still work but would decode everything before the
    // start point first, which on a two-hour recording is the whole cost the trim exists to
    // avoid.
    '-ss',
    window.startSeconds.toFixed(3),
    '-to',
    window.endSeconds.toFixed(3),
    '-i',
    source,
    // Audio only: a few of the accepted containers (m4a, webm) can carry cover art or a video
    // stream, and copying that into the cut gives the provider a file it may reject.
    '-map',
    '0:a:0',
    '-c',
    'copy',
    '-avoid_negative_ts',
    'make_zero',
    destination,
  ];
}

/**
 * The name the cut is written under.
 *
 * The EXTENSION is load-bearing and the base is not: `-c copy` writes whatever the source
 * stream already is, so the container must match or ffmpeg refuses ("could not find tag for
 * codec"), and downstream `audioMimeForFileName` resolves the multipart content type from it —
 * a wrong one has already cost this repo a real `invalid_audio: File is corrupted`.
 */
export function trimmedFileName(sourceName: string): string {
  const ext = extname(sourceName).toLowerCase();
  return `trimmed${ext === '' ? '.mp3' : ext}`;
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const binary = ffmpegLocation();
    if (binary === null) {
      reject(
        new Error(
          'ffmpeg सापडले नाही, त्यामुळे ध्वनिमुद्रणाचा निवडलेला भाग कापता आला नाही. ' +
            'API इमेजमध्ये ते स्थापित करा किंवा FFMPEG_PATH निश्चित करा.',
        ),
      );
      return;
    }
    const child = spawn(binary, args, {
      timeout: trimTimeoutMs(),
      killSignal: 'SIGKILL',
      windowsHide: true,
    });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      // Keep the tail: ffmpeg puts the reason last.
      if (stderr.length > 8_000) stderr = stderr.slice(-8_000);
    });
    // Drained rather than ignored — an unread pipe eventually blocks the child.
    child.stdout.resume();

    child.on('error', (error: NodeJS.ErrnoException) => {
      reject(
        error.code === 'ENOENT'
          ? new Error(`ffmpeg चालवता आले नाही (${binary}).`)
          : error,
      );
    });
    child.on('close', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      const detail = stderr.trim();
      reject(
        new Error(
          `ध्वनिमुद्रणाचा निवडलेला भाग कापता आला नाही (ffmpeg ${
            signal ?? `exit ${code}`
          })${detail === '' ? '' : `: ${detail}`}`,
        ),
      );
    });
  });
}

/**
 * Cut `source` — a local path OR an http(s) URL, which is the case that matters — down to
 * `window`, into a fresh temp directory.
 *
 * The caller owns the result and MUST call `cleanup()`.
 */
export async function trimAudio(
  source: string,
  sourceName: string,
  window: AudioTrimWindow,
): Promise<TrimmedAudio> {
  if (
    !Number.isFinite(window.startSeconds) ||
    !Number.isFinite(window.endSeconds) ||
    window.startSeconds < 0 ||
    window.endSeconds <= window.startSeconds
  ) {
    throw new Error(
      `ध्वनिमुद्रणासाठी दिलेला कालावधी चुकीचा आहे: ${window.startSeconds}–${window.endSeconds}`,
    );
  }

  const directory = await mkdtemp(join(tmpdir(), 'dgipr-audio-trim-'));
  const cleanup = async (): Promise<void> => {
    // Best-effort: a temp directory that outlives the process is untidy, and throwing here
    // would replace a successful transcription with a housekeeping failure.
    await rm(directory, { recursive: true, force: true }).catch(() => {});
  };

  try {
    const destination = join(directory, trimmedFileName(sourceName));
    await runFfmpeg(buildTrimArgs(source, destination, window));
    const info = await stat(destination);
    if (info.size === 0) {
      throw new Error(`निवडलेल्या कालावधीत ध्वनी आढळला नाही: ${sourceName}`);
    }
    return { path: destination, bytes: info.size, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

// ---------- harness ----------

if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url.replace(/\?.*$/, '')
) {
  const [, , first, start, end] = process.argv;

  if (first === undefined || first === '--check') {
    const checks: Array<[string, boolean]> = [];
    const check = (label: string, ok: boolean): void => {
      checks.push([label, ok]);
    };

    const args = buildTrimArgs('https://example.test/a.mp3', '/tmp/out.mp3', {
      startSeconds: 61.5,
      endSeconds: 125,
    });
    const at = (flag: string): number => args.indexOf(flag);

    // The property the whole design rests on: seek BEFORE the input, or ffmpeg decodes and
    // discards everything ahead of the start point.
    check('-ss comes before -i', at('-ss') < at('-i') && at('-ss') !== -1);
    check('-to comes before -i', at('-to') < at('-i') && at('-to') !== -1);
    check('the window is passed in seconds', args.includes('61.500'));
    check('the end is passed in seconds', args.includes('125.000'));
    check('the stream is copied, never re-encoded', args.includes('copy'));
    check(
      'only the first audio stream is taken',
      args[at('-map') + 1] === '0:a:0',
    );
    check(
      'copied timestamps are rebased to zero',
      args[at('-avoid_negative_ts') + 1] === 'make_zero',
    );
    check('the destination is last', args[args.length - 1] === '/tmp/out.mp3');

    // The container must survive, or `-c copy` has nothing legal to write into.
    check(
      'an m4a stays an m4a',
      trimmedFileName('baithak.m4a') === 'trimmed.m4a',
    );
    check(
      'an OPUS note stays .opus',
      trimmedFileName('WA0007.opus') === 'trimmed.opus',
    );
    check('case is normalised', trimmedFileName('REC.MP3') === 'trimmed.mp3');
    check(
      'a Devanagari name keeps its extension',
      trimmedFileName('बैठक.wav') === 'trimmed.wav',
    );
    check(
      'an extensionless name falls back',
      trimmedFileName('recording') === 'trimmed.mp3',
    );

    // A window that cannot be cut is refused before ffmpeg is spawned, so the officer gets
    // the reason rather than a decoder error.
    const rejects = async (window: AudioTrimWindow): Promise<boolean> => {
      try {
        await trimAudio('x.mp3', 'x.mp3', window);
        return false;
      } catch {
        return true;
      }
    };
    check(
      'a zero-length window is refused',
      await rejects({ startSeconds: 10, endSeconds: 10 }),
    );
    check(
      'a backwards window is refused',
      await rejects({ startSeconds: 30, endSeconds: 12 }),
    );
    check(
      'a negative start is refused',
      await rejects({ startSeconds: -5, endSeconds: 12 }),
    );
    check(
      'a non-finite end is refused',
      await rejects({ startSeconds: 0, endSeconds: Number.POSITIVE_INFINITY }),
    );

    check('ffmpeg is resolvable', ffmpegLocation() !== null);

    for (const [label, ok] of checks) {
      console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
    }
    const failed = checks.filter(([, ok]) => !ok).length;
    console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
    process.exit(failed === 0 ? 0 : 1);
  }

  const window = {
    startSeconds: Number(start ?? 0),
    endSeconds: Number(end ?? 10),
  };
  const result = await trimAudio(first, first, window);
  console.log(`cut ${window.startSeconds}s–${window.endSeconds}s`);
  console.log(`  ${result.path} (${result.bytes} bytes)`);
  await result.cleanup();
}
