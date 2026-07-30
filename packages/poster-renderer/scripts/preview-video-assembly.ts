// Free harness for the video assembly path: synthesizes three stub clips with
// ffmpeg's testsrc + sine generators (colored bars WITH audio, so the -an strip
// is actually exercised), stitches them with assembleSilentVideo, and writes
// out/video-assembly-preview.mp4 to eyeball in a browser (should be 3 branded
// scenes followed by the fixed DGIPR outro, silent, plays in Chrome AND Safari).
//
//   pnpm --filter @dgipr/poster-renderer video:preview:assemble

import { execFile } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  assembleSilentVideo,
  overlayVideoLogo,
  resolveFfmpeg,
} from '../src/video/assemble.js';

const execFileAsync = promisify(execFile);

const here = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(here, '..', 'out');

async function makeStubClip(
  color: string,
  seconds: number,
  size = '1280x720',
): Promise<Buffer> {
  const path = join(OUT_DIR, `stub-${color}.mp4`);
  await execFileAsync(resolveFfmpeg(), [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    `color=c=${color}:s=${size}:d=${seconds}`,
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=440:duration=${seconds}`,
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-shortest',
    path,
  ]);
  const clip = await readFile(path);
  await rm(path, { force: true });
  return clip;
}

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  console.log('Synthesizing 3 stub clips (with audio)…');
  const clips = await Promise.all([
    makeStubClip('red', 2),
    makeStubClip('green', 2, '1920x1080'),
    makeStubClip('blue', 2),
  ]);
  clips[0] = await overlayVideoLogo(clips[0]!, {
    aspectRatio: '16:9',
    expectedDurationSeconds: 2,
  });

  console.log('Stitching…');
  const video = await assembleSilentVideo(clips, [], {
    aspectRatio: '16:9',
    expectedClipDurations: [2, 2, 2],
  });
  const outPath = join(OUT_DIR, 'video-assembly-preview.mp4');
  await writeFile(outPath, video);

  // ffprobe-free sanity: report size; duration/audio are checked by eye (and the
  // stitched file must show ~8.2s, three color bands + outro, NO audio track).
  console.log(`Wrote ${outPath} (${video.length} bytes).`);
  console.log(
    'Open it in a browser: expect ~8.2s, red→green→blue→DGIPR outro, ' +
      'a top-right logo on the generated scenes, and silence.',
  );
  const oneFrame = await makeStubClip('black', 0.04);
  await assert.rejects(
    () =>
      assembleSilentVideo([oneFrame], [], {
        expectedClipDurations: [2],
      }),
    /failed validation/,
  );
  console.log('OK: a one-frame MP4 cannot pass as a completed 2s video.');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
