// Free harness for muxNarration: builds a silent 2-scene video with
// assembleSilentVideo, synthesizes two stub narration WAVs with ffmpeg's sine
// generator at LENGTHS THAT DON'T MATCH the windows, muxes them, and writes
// out/video-narrate-preview.mp4. Proves the fit-to-window + concat + mux path
// with no Sarvam/clip-provider spend.
//
// The windows are deliberately DIFFERENT LENGTHS (5s + 12s) since clip
// durations became audio-derived: two equal windows would have hidden a mux
// that assumed one window size for the whole video. Both fit directions are
// exercised — the 6s tone must be sped into the 5s window (atempo), the 9s one
// padded inside the 12s window (apad).
//
//   pnpm --filter @dgipr/poster-renderer video:preview:narrate
//
// Expect: ~17s, colour bands red→blue with the red band SHORT and the blue one
// long, WITH a tone track, each scene's tone exactly filling its own window.

import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  assembleSilentVideo,
  muxNarration,
  resolveFfmpeg,
  wavDurationSeconds,
} from '../src/video/assemble.js';

const execFileAsync = promisify(execFile);

const here = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(here, '..', 'out');

async function makeStubClip(color: string, seconds: number): Promise<Buffer> {
  const path = join(OUT_DIR, `stub-${color}.mp4`);
  await execFileAsync(resolveFfmpeg(), [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    `color=c=${color}:s=1280x720:d=${seconds}`,
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    path,
  ]);
  const clip = await readFile(path);
  await rm(path, { force: true });
  return clip;
}

async function makeStubWav(
  frequency: number,
  seconds: number,
): Promise<Buffer> {
  const path = join(OUT_DIR, `tone-${frequency}-${seconds}.wav`);
  await execFileAsync(resolveFfmpeg(), [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=${frequency}:duration=${seconds}`,
    path,
  ]);
  const wav = await readFile(path);
  await rm(path, { force: true });
  return wav;
}

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });

  console.log(
    'Building a silent 2-scene video with UNEQUAL windows (5s + 12s)…',
  );
  const silent = await assembleSilentVideo([
    await makeStubClip('red', 5),
    await makeStubClip('blue', 12),
  ]);

  console.log('Synthesizing narration stubs (6s and 9s)…');
  const overWav = await makeStubWav(440, 6);
  const underWav = await makeStubWav(660, 9);
  console.log(
    `  parsed durations: ${wavDurationSeconds(overWav).toFixed(2)}s, ` +
      `${wavDurationSeconds(underWav).toFixed(2)}s (expect ~6, ~9)`,
  );

  console.log('Muxing narration onto the video…');
  // 6s into 5s exercises the atempo speed-up; 9s into 12s exercises apad.
  const narrated = await muxNarration(silent, [
    { wav: overWav, durationSeconds: 5 },
    { wav: underWav, durationSeconds: 12 },
  ]);
  const outPath = join(OUT_DIR, 'video-narrate-preview.mp4');
  await writeFile(outPath, narrated);

  console.log(`Wrote ${outPath} (${narrated.length} bytes).`);
  console.log(
    'Open it in a browser: expect ~19.2s, a SHORT red band then a long blue one, ' +
      'the DGIPR outro, and audio (tone A then E) inside the generated windows.',
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
