// Assertions for the in-browser video → audio extraction. Free — no API, no model, no browser.
//
//   cd packages/content-engine
//   npx tsx --tsconfig ../../apps/web/tsconfig.check.json ../../apps/web/lib/extractRecordingAudio.check.ts
//
// Run from packages/content-engine because it has tsx AND ffmpeg-static, which builds the
// fixtures (a test pattern + a sine tone). The COPY path needs no WebCodecs, so it runs under
// Node exactly as it runs in a browser; Node has no AudioEncoder, which is what lets the
// re-encode path be checked for its honest `unsupported` answer rather than faked.

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  extractRecordingAudio,
  recordingNameFromVideo,
  RecordingExtractionError,
} from './extractRecordingAudio';

let failures = 0;
let checks = 0;

function check(label: string, ok: boolean, detail?: string): void {
  checks += 1;
  if (ok) {
    console.log(`ok    ${label}`);
    return;
  }
  failures += 1;
  console.error(`FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
}

// ---------- the naming helper ----------

check(
  'stem kept, extension swapped',
  recordingNameFromVideo('meeting.mp4', '.m4a') === 'meeting.m4a',
);
check(
  'dots inside the stem survive',
  recordingNameFromVideo('press.meet.2026.09.24.MOV', '.m4a') ===
    'press.meet.2026.09.24.m4a',
);
check(
  'an audio suffix before the video one is not doubled',
  recordingNameFromVideo('baithak.m4a.mp4', '.m4a') === 'baithak.m4a',
);
check(
  'Devanagari names untouched',
  recordingNameFromVideo('बैठक १.mkv', '.webm') === 'बैठक १.webm',
);
check(
  'a name that is only an extension gets a fallback stem',
  recordingNameFromVideo('.mp4', '.m4a') === 'ध्वनिमुद्रण.m4a',
);
check(
  'no extension at all',
  recordingNameFromVideo('WhatsApp Video', '.m4a') === 'WhatsApp Video.m4a',
);
check(
  'trailing dots and spaces trimmed',
  recordingNameFromVideo('clip. .mp4', '.m4a') === 'clip.m4a',
);
check(
  'deterministic — re-picking the same video yields the same name',
  recordingNameFromVideo('a.mp4', '.m4a') ===
    recordingNameFromVideo('a.mp4', '.m4a'),
);

// ---------- fixtures ----------

const requireHere = createRequire(join(process.cwd(), 'package.json'));
const ffmpeg =
  process.env.FFMPEG_PATH || (requireHere('ffmpeg-static') as string);
const dir = mkdtempSync(join(tmpdir(), 'dgipr-extract-'));

const VIDEO = ['-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=25:duration=4'];
const TONE = ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=4'];

function make(name: string, args: string[]): string {
  const path = join(dir, name);
  execFileSync(ffmpeg, ['-y', '-loglevel', 'error', ...args, path]);
  return path;
}

function asFile(path: string, name: string): File {
  return new File([readFileSync(path)], name);
}

// `ffmpeg -i` prints the streams on stderr and exits non-zero (no output named) — which is the
// probe: ffprobe is not in ffmpeg-static.
function streamsOf(bytes: ArrayBuffer, extension: string): string {
  const path = join(dir, `probe${extension}`);
  writeFileSync(path, Buffer.from(bytes));
  const run = spawnSync(ffmpeg, ['-hide_banner', '-i', path], {
    encoding: 'utf8',
  });
  return run.stderr;
}

function durationFrom(stderr: string): number | null {
  const match = /Duration: (\d+):(\d+):([\d.]+)/.exec(stderr);
  if (!match) return null;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

async function expectError(
  label: string,
  run: () => Promise<unknown>,
  code: RecordingExtractionError['code'],
): Promise<void> {
  try {
    await run();
    check(label, false, 'resolved instead of throwing');
  } catch (error) {
    check(
      label,
      error instanceof RecordingExtractionError && error.code === code,
      String(error),
    );
  }
}

async function main(): Promise<void> {
  try {
    // Noise on the picture so the video costs what a real one does; a bare test pattern
    // compresses to less than its own audio and would make the size assertion meaningless.
    const aacMp4 = make('aac.mp4', [
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=640x480:rate=25:duration=4,noise=alls=40:allf=t',
      ...TONE,
      '-c:v',
      'libx264',
      '-crf',
      '18',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-shortest',
    ]);
    const aacMov = make('aac.mov', [
      ...VIDEO,
      ...TONE,
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-shortest',
    ]);
    const opusMkv = make('opus.mkv', [
      ...VIDEO,
      ...TONE,
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'libopus',
      '-shortest',
    ]);
    const pcmMov = make('pcm.mov', [
      ...VIDEO,
      ...TONE,
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'pcm_s16le',
      '-shortest',
    ]);
    const silentMp4 = make('silent.mp4', [
      ...VIDEO,
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
    ]);
    const audioWebm = make('voice.webm', [...TONE, '-c:a', 'libopus']);

    // AAC in MP4 — the phone-camera case, and the one that matters.
    const sourceBytes = readFileSync(aacMp4).byteLength;
    let lastProgress = -1;
    const fromMp4 = await extractRecordingAudio(asFile(aacMp4, 'बैठक.mp4'), {
      onProgress: (fraction) => {
        lastProgress = fraction;
      },
    });
    const mp4Streams = streamsOf(await fromMp4.file.arrayBuffer(), '.m4a');
    check('AAC MP4 → copy', fromMp4.method === 'copy', fromMp4.method);
    check(
      'AAC MP4 → .m4a',
      fromMp4.file.name === 'बैठक.m4a',
      fromMp4.file.name,
    );
    check('AAC MP4 → audio/mp4', fromMp4.file.type === 'audio/mp4');
    check(
      'AAC MP4 output has an audio stream',
      /Stream #0:\d+.*Audio: aac/.test(mp4Streams),
      mp4Streams,
    );
    check(
      'AAC MP4 output has NO video stream',
      !/Video:/.test(mp4Streams),
      mp4Streams,
    );
    const outDuration = durationFrom(mp4Streams);
    check(
      'AAC MP4 duration within 0.1 s of 4 s',
      outDuration !== null && Math.abs(outDuration - 4) <= 0.1,
      String(outDuration),
    );
    check(
      'AAC MP4 output is much smaller than the video',
      fromMp4.file.size < sourceBytes / 2,
      `${fromMp4.file.size} of ${sourceBytes}`,
    );
    check(
      'progress reached the end',
      lastProgress >= 0.99,
      String(lastProgress),
    );
    check(
      'duration reported',
      fromMp4.durationSeconds !== null &&
        Math.abs(fromMp4.durationSeconds - 4) <= 0.1,
      String(fromMp4.durationSeconds),
    );

    // AAC in MOV — the iPhone case.
    const fromMov = await extractRecordingAudio(asFile(aacMov, 'IMG_0042.MOV'));
    const movStreams = streamsOf(await fromMov.file.arrayBuffer(), '.m4a');
    check(
      'AAC MOV → copy .m4a',
      fromMov.method === 'copy' && fromMov.file.name === 'IMG_0042.m4a',
    );
    check(
      'AAC MOV output has NO video stream',
      !/Video:/.test(movStreams),
      movStreams,
    );

    // Opus in MKV — copied into WebM, never into MP4.
    const fromMkv = await extractRecordingAudio(asFile(opusMkv, 'screen.mkv'));
    const mkvStreams = streamsOf(await fromMkv.file.arrayBuffer(), '.webm');
    check('Opus MKV → copy', fromMkv.method === 'copy', fromMkv.method);
    check(
      'Opus MKV → .webm audio/webm',
      fromMkv.file.name === 'screen.webm' && fromMkv.file.type === 'audio/webm',
    );
    check(
      'Opus MKV output has NO video stream',
      !/Video:/.test(mkvStreams),
      mkvStreams,
    );
    check(
      'Opus MKV output is Opus',
      /Audio: opus/.test(mkvStreams),
      mkvStreams,
    );

    // An audio-only WebM is handed back untouched.
    const webmFile = asFile(audioWebm, 'voice.webm');
    const fromWebm = await extractRecordingAudio(webmFile);
    check(
      'audio-only WebM → passthrough, same File',
      fromWebm.method === 'passthrough' && fromWebm.file === webmFile,
    );

    // No audio at all.
    await expectError(
      'video-only MP4 → no-audio',
      () => extractRecordingAudio(asFile(silentMp4, 'silent.mp4')),
      'no-audio',
    );

    // Not media.
    await expectError(
      'garbage bytes → unreadable',
      () =>
        extractRecordingAudio(
          new File([new Uint8Array(4096).fill(7)], 'broken.mp4'),
        ),
      'unreadable',
    );

    // PCM in MOV cannot be copied into MP4 by this path, and Node has no Opus encoder — the
    // honest answer here is `unsupported` (a browser takes the re-encode instead).
    await expectError(
      'PCM MOV in Node (no WebCodecs) → unsupported',
      () => extractRecordingAudio(asFile(pcmMov, 'camera.mov')),
      'unsupported',
    );

    // An oversized copy falls through to the re-encode — here, to `unsupported`, which proves
    // the threshold is consulted without needing a 200 MB fixture.
    await expectError(
      'copy over the size ceiling → re-encode path (unsupported in Node)',
      () =>
        extractRecordingAudio(asFile(aacMp4, 'big.mp4'), { copyMaxBytes: 10 }),
      'unsupported',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  console.log(`\n${checks - failures}/${checks} checks passed`);
  if (failures > 0) process.exit(1);
}

void main();
