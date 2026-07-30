// Free harness for the burned-in Marathi key point. Renders the overlay PNGs
// and burns them onto stub clips, so the whole caption path — Devanagari
// shaping, panel geometry, timing windows — is tunable without one paid image,
// clip or TTS call.
//
//   pnpm --filter @dgipr/poster-renderer video:preview:captions [--vertical] [--720p]
//
// Writes out/caption-overlay-{n}.png (the transparent overlays, to check
// against a dark AND a light backdrop) and out/video-captions-preview.mp4.
//
// `--720p` renders the stub CLIPS at 720p while the overlays stay at their
// 1080p reference size, which is the Kling-at-720p case. Without the scale2ref
// step in assembleSilentVideo the panel lands below the bottom edge and the
// caption vanishes — silently, which is why the check below is an assertion
// rather than an instruction to go and look.
//
// WHAT TO CHECK, in order of what actually breaks:
//   1. Conjuncts. कर्जमुक्ती / विद्यार्थ्यांच्या / ऱ्या must be one shaped cluster
//      each — matras sitting ON their consonants, never floating beside them.
//      This is the whole reason the text is Chromium-typeset instead of painted
//      by the image model.
//   2. Each caption appears ONLY in its own scene's window, and disappears.
//   3. The panel is legible over both the dark and the light stub clip.

import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import sharp from 'sharp';
import {
  assembleSilentVideo,
  resolveFfmpeg,
  type SceneOverlay,
} from '../src/video/assemble.js';
import {
  CAPTION_FRAME_SIZE,
  renderCaptionOverlay,
  type CaptionAspect,
} from '../src/video/caption-overlay.js';

const execFileAsync = promisify(execFile);

const here = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(here, '..', 'out');

// Loaded with the hard conjuncts and with both digit scripts, because those are
// what a wrong font or a missing shaper mangles first.
const KEY_POINTS = [
  '२ लाखांपर्यंत कर्जमुक्ती',
  'अर्जाची मुदत: ३१ ऑगस्ट २०२६',
  '४ महापालिका रुग्णालयांत मोफत सेवा',
];

const SCENE_SECONDS = 4;

// `slot` (not the colour) names the temp file: two scenes legitimately share a
// colour here, and a shared filename makes concurrent renders fight over it.
async function makeStubClip(
  slot: number,
  color: string,
  seconds: number,
  width: number,
  height: number,
): Promise<Buffer> {
  const path = join(OUT_DIR, `stub-${slot}.mp4`);
  await execFileAsync(resolveFfmpeg(), [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    `color=c=${color}:s=${width}x${height}:d=${seconds}`,
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

// Proof that the caption actually survived onto the footage. The stub clip
// under scene 1 is a flat light grey, so ANY dark pixel in the lower third can
// only be the panel — and if the overlay was composited past the bottom edge
// (the un-scaled 1080p-on-720p case) the frame comes back uniformly grey.
async function assertCaptionVisible(
  video: Buffer,
  atSeconds: number,
): Promise<void> {
  const videoPath = join(OUT_DIR, 'assert-src.mp4');
  const framePath = join(OUT_DIR, 'assert-frame.png');
  await writeFile(videoPath, video);
  try {
    await execFileAsync(resolveFfmpeg(), [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-ss',
      String(atSeconds),
      '-i',
      videoPath,
      '-frames:v',
      '1',
      framePath,
    ]);
    const image = sharp(framePath);
    const meta = await image.metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    const top = Math.floor(height * 0.6);
    const { data, info } = await image
      .extract({ left: 0, top, width, height: height - top })
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    let dark = 0;
    for (const value of data) if (value < 100) dark++;
    const ratio = dark / (info.width * info.height);
    if (ratio < 0.01) {
      throw new Error(
        `No caption panel found in the lower third of the ${width}x${height} ` +
          `frame at ${atSeconds}s (only ${(ratio * 100).toFixed(2)}% dark ` +
          'pixels). The overlay was composited off-frame — check the ' +
          'scale2ref step in assembleSilentVideo.',
      );
    }
    console.log(
      `OK: caption panel is on the ${width}x${height} frame at ${atSeconds}s ` +
        `(${(ratio * 100).toFixed(1)}% of the lower third).`,
    );
  } finally {
    await rm(videoPath, { force: true });
    await rm(framePath, { force: true });
  }
}

async function main(): Promise<void> {
  const aspect: CaptionAspect = process.argv.includes('--vertical')
    ? '9:16'
    : '16:9';
  const reference = CAPTION_FRAME_SIZE[aspect];
  // The overlays are ALWAYS rendered at the reference size; only the footage
  // changes, which is exactly the asymmetry a clip provider introduces.
  const scale = process.argv.includes('--720p') ? 720 / 1080 : 1;
  const width = Math.round(reference.width * scale);
  const height = Math.round(reference.height * scale);
  if (scale !== 1) {
    console.log(
      `Footage ${width}x${height}, overlays ${reference.width}x${reference.height} ` +
        '— the 720p provider case.',
    );
  }
  await mkdir(OUT_DIR, { recursive: true });

  console.log(`Rendering ${KEY_POINTS.length} ${aspect} caption overlays…`);
  const overlays: SceneOverlay[] = [];
  for (const [index, keyPoint] of KEY_POINTS.entries()) {
    const png = await renderCaptionOverlay(keyPoint, aspect);
    if (!png)
      throw new Error(`renderCaptionOverlay returned null for "${keyPoint}"`);
    const pngPath = join(OUT_DIR, `caption-overlay-${index + 1}.png`);
    await writeFile(pngPath, png);
    console.log(`  ${pngPath} (${png.length} bytes) — "${keyPoint}"`);
    overlays.push({
      png,
      startSeconds: index * SCENE_SECONDS,
      endSeconds: (index + 1) * SCENE_SECONDS,
    });
  }

  // An empty key point must produce no overlay at all — that is how an officer
  // turns the caption off for one scene, so it is worth asserting rather than
  // eyeballing.
  if ((await renderCaptionOverlay('   ', aspect)) !== null) {
    throw new Error('An empty key point must render no overlay.');
  }
  console.log('OK: an empty key point renders no overlay.');

  // Light, dark, light — the panel has to hold on all three. Hex rather than
  // ffmpeg's colour names: `gray80` is a CSS name, not one lavfi knows.
  console.log('Synthesizing stub clips…');
  const clips = await Promise.all([
    makeStubClip(1, '0xCCCCCC', SCENE_SECONDS, width, height),
    makeStubClip(2, '0x141414', SCENE_SECONDS, width, height),
    makeStubClip(3, '0xCCCCCC', SCENE_SECONDS, width, height),
  ]);

  console.log('Stitching with the captions burned in…');
  const video = await assembleSilentVideo(clips, overlays);
  const outPath = join(OUT_DIR, 'video-captions-preview.mp4');
  await writeFile(outPath, video);
  console.log(`Wrote ${outPath} (${video.length} bytes).`);

  // Mid-scene-1, over the light stub — the frame where a lost overlay is
  // provable rather than merely visible.
  await assertCaptionVisible(video, SCENE_SECONDS / 2);

  console.log(
    `Open it: expect ~${KEY_POINTS.length * SCENE_SECONDS + 2.2}s, one caption per ` +
      `${SCENE_SECONDS}s band, then the DGIPR outro; correct Devanagari conjuncts, silent.`,
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
