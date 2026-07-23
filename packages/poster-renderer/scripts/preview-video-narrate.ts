// Free harness for muxNarration: builds a silent 2-scene video (8s + 8s) with
// assembleSilentVideo, synthesizes two stub narration WAVs with ffmpeg's sine
// generator at LENGTHS THAT DON'T MATCH the windows (10s → sped to 8s, 5s →
// padded to 8s), muxes them, and writes out/video-narrate-preview.mp4. Proves
// the fit-to-window + concat + mux path with no Sarvam/Veo spend.
//
//   pnpm --filter @dgipr/poster-renderer video:preview:narrate
//
// Expect: ~16s, colour bands red→blue, WITH a continuous tone track (pitch A),
// each scene's tone exactly filling its 8s window.

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

  console.log('Building a silent 2-scene video (8s + 8s)…');
  const silent = await assembleSilentVideo([
    await makeStubClip('red', 8),
    await makeStubClip('blue', 8),
  ]);

  console.log('Synthesizing narration stubs (10s and 5s)…');
  const longWav = await makeStubWav(440, 10);
  const shortWav = await makeStubWav(660, 5);
  console.log(
    `  parsed durations: ${wavDurationSeconds(longWav).toFixed(2)}s, ` +
      `${wavDurationSeconds(shortWav).toFixed(2)}s (expect ~10, ~5)`,
  );

  console.log('Muxing narration onto the video…');
  const narrated = await muxNarration(silent, [
    { wav: longWav, durationSeconds: 8 },
    { wav: shortWav, durationSeconds: 8 },
  ]);
  const outPath = join(OUT_DIR, 'video-narrate-preview.mp4');
  await writeFile(outPath, narrated);

  console.log(`Wrote ${outPath} (${narrated.length} bytes).`);
  console.log(
    'Open it in a browser: expect ~16s, red→blue, WITH audio (tone A then E).',
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
