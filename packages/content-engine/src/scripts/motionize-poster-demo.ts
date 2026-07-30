// Standalone DGIPR poster-motion demo.
//
// Safe by default: without --execute this prints the exact Kling prompt and
// request settings, then exits without reading KLING_API_KEY or calling Kling.
//
// Review only:
//   pnpm --filter @dgipr/content-engine exec tsx \
//     src/scripts/motionize-poster-demo.ts "C:\path\to\poster.png"
//
// Paid render:
//   pnpm --filter @dgipr/content-engine exec tsx --env-file=../../.env \
//     src/scripts/motionize-poster-demo.ts "C:\path\to\poster.png" --execute

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { resolveFfmpeg } from '@dgipr/poster-renderer';
import sharp from 'sharp';
import {
  generateKlingClip,
  klingModel,
  klingResolution,
  type KlingAspectRatio,
  type KlingResolution,
} from '../video/kling-client.js';

const execFileAsync = promisify(execFile);

export const POSTER_MOTION_PROMPT = [
  'Create a clearly animated 5-second image-to-video shot from this Marathi voter-information poster. Use one locked camera shot. Motion must begin within the first second and be plainly visible; do not return a static or almost-static image.',
  '',
  'LOCK ALL OFFICIAL GRAPHICS:',
  'Keep the crop, headline panel, all Marathi text and numerals, dates, information cards, icons, government emblem, QR code, footer, background, lines, and decorations fixed at exact source coordinates.',
  'Every glyph, logo, icon, QR module, colour, edge, and spacing remains identical and sharp. Treat all graphics as one still overlay: never redraw, translate, morph, blur, crop, flicker, or animate them. Keep the QR code scannable. Add no text, logo, watermark, person, animal, or object.',
  '',
  'ANIMATE ONLY THE EXISTING FOUR PEOPLE:',
  'The only people are inside the upper-right photographic region, approximately x=52%-99% and y=10%-52% of the full canvas. Confine human motion to that box. Preserve each identity, face, skin tone, hair, clothing, anatomy, and hands. Never add, remove, duplicate, swap, or deform anyone.',
  'Show one clear, warm shared reaction to the tablet. The older man and woman visibly lean a little closer. The standing young man leans forward and his grin broadens. The seated man tilts the tablet slightly toward them and smiles more. Their heads and shoulders move naturally by a small but unmistakable amount, as if sharing a quiet laugh.',
  'Keep all eyes on the tablet. Allow natural cheek, eye, and clothing movement, but no speech, exaggerated open mouths, changed teeth, waving, or large gestures. Hands retain correct anatomy and contact with the tablet or table. The tablet may tilt slightly but its screen gains no new content. Keep the clipboard, papers, pen, table, and chairs still.',
  '',
  'MOTION PERFORMANCE:',
  'Start from the exact supplied pose, then move continuously toward the closer, happier group reaction. Prioritize visible human motion over complete stillness. Make it friendly, restrained, realistic, synchronized, and suitable for an official Instagram post.',
  '',
  'CAMERA AND IMAGE LOCK:',
  'No pan, zoom, shake, crop change, parallax, focus pull, background motion, warping, lighting change, colour shift, glow, or new shadows. Preserve the clean public-information-poster look.',
].join('\n');

type Options = {
  imagePath: string;
  execute: boolean;
  durationSeconds: number;
  resolution: KlingResolution;
  model?: string;
  mp4Path: string;
  gifPath: string;
  gifWidth: number;
  gifFps: number;
};

function positiveInteger(raw: string, flag: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${flag} must be a positive whole number; got "${raw}".`);
  }
  return value;
}

function optionValue(args: string[], name: string): string | undefined {
  const prefix = `${name}=`;
  const match = args.find((arg) => arg.startsWith(prefix));
  return match?.slice(prefix.length);
}

function parseOptions(args: string[]): Options {
  const positional = args.filter((arg) => !arg.startsWith('--'));
  if (positional.length !== 1) {
    throw new Error(
      [
        'Usage:',
        '  tsx src/scripts/motionize-poster-demo.ts <poster.png> [--execute]',
        '      [--duration=5] [--resolution=720p|1080p]',
        '      [--model=kling-3.0] [--gif-width=720] [--gif-fps=12]',
        '      [--mp4=output.mp4] [--gif=output.gif]',
      ].join('\n'),
    );
  }

  const knownFlags = new Set([
    '--execute',
    '--duration',
    '--resolution',
    '--model',
    '--gif-width',
    '--gif-fps',
    '--mp4',
    '--gif',
  ]);
  for (const arg of args.filter((value) => value.startsWith('--'))) {
    const name = arg.split('=', 1)[0] ?? arg;
    if (!knownFlags.has(name)) {
      throw new Error(`Unknown option "${arg}".`);
    }
    if (name !== '--execute' && !arg.includes('=')) {
      throw new Error(`Option "${name}" needs a value, for example ${name}=5.`);
    }
  }

  const imagePath = resolve(positional[0]!);
  const stem = basename(imagePath, extname(imagePath));
  const outputDir = dirname(imagePath);
  const durationRaw = optionValue(args, '--duration') ?? '5';
  const durationSeconds = positiveInteger(durationRaw, '--duration');
  if (durationSeconds < 3 || durationSeconds > 15) {
    throw new Error(
      `--duration must be between 3 and 15 seconds; got ${durationSeconds}.`,
    );
  }

  const resolutionRaw = optionValue(args, '--resolution') ?? '720p';
  if (resolutionRaw !== '720p' && resolutionRaw !== '1080p') {
    throw new Error(
      `--resolution must be 720p or 1080p; got "${resolutionRaw}".`,
    );
  }
  const model = optionValue(args, '--model');

  return {
    imagePath,
    execute: args.includes('--execute'),
    durationSeconds,
    resolution: resolutionRaw,
    ...(model ? { model } : {}),
    mp4Path: resolve(
      optionValue(args, '--mp4') ?? join(outputDir, `${stem}-motion.mp4`),
    ),
    gifPath: resolve(
      optionValue(args, '--gif') ?? join(outputDir, `${stem}-motion.gif`),
    ),
    gifWidth: positiveInteger(
      optionValue(args, '--gif-width') ?? '720',
      '--gif-width',
    ),
    gifFps: positiveInteger(
      optionValue(args, '--gif-fps') ?? '12',
      '--gif-fps',
    ),
  };
}

async function posterInfo(
  image: Buffer,
): Promise<{ width: number; height: number; aspectRatio: KlingAspectRatio }> {
  const metadata = await sharp(image).metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (width === 0 || height === 0) {
    throw new Error('Could not read the poster dimensions.');
  }
  return {
    width,
    height,
    // Kling follows the actual input dimensions. This field is only the
    // existing client's orientation cross-check.
    aspectRatio: width >= height ? '16:9' : '9:16',
  };
}

function printReview(
  options: Options,
  dimensions: { width: number; height: number },
  prompt: string,
): void {
  const baseUrl = (
    process.env.KLING_BASE_URL ?? 'https://api-singapore.klingai.com'
  ).replace(/\/+$/, '');

  console.log('EXACT KLING PROMPT');
  console.log('==================');
  console.log(prompt);
  console.log('');
  console.log('REQUEST PREVIEW');
  console.log('===============');
  console.log(
    JSON.stringify(
      {
        willCallApi: options.execute,
        endpoint: `${baseUrl}/image-to-video/${klingModel()}`,
        input: options.imagePath,
        inputDimensions: `${dimensions.width}x${dimensions.height}`,
        firstFrame: 'the supplied poster',
        lastFrame: 'not supplied, so Kling has room to create visible motion',
        settings: {
          klingSourceDuration: options.durationSeconds,
          finalBoomerangDuration: options.durationSeconds,
          resolution: klingResolution('fast'),
          audio: 'off',
          multi_shot: false,
          localLoop:
            'first half of the Kling clip followed by its FFmpeg reversal',
        },
        outputs: {
          mp4: options.mp4Path,
          gif: options.gifPath,
          gifWidth: options.gifWidth,
          gifFps: options.gifFps,
        },
      },
      null,
      2,
    ),
  );
}

async function convertMp4ToBoomerang(
  sourcePath: string,
  outputPath: string,
  durationSeconds: number,
): Promise<void> {
  const forwardSeconds = durationSeconds / 2;
  const filter = [
    `[0:v]trim=start=0:duration=${forwardSeconds},setpts=PTS-STARTPTS,split[forward][reverse_source]`,
    '[reverse_source]reverse,setpts=PTS-STARTPTS[backward]',
    '[forward][backward]concat=n=2:v=1:a=0,format=yuv420p[video]',
  ].join(';');

  await execFileAsync(resolveFfmpeg(), [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    sourcePath,
    '-filter_complex',
    filter,
    '-map',
    '[video]',
    '-an',
    '-c:v',
    'libx264',
    '-crf',
    '18',
    '-preset',
    'medium',
    '-movflags',
    '+faststart',
    outputPath,
  ]);
}

async function convertMp4ToGif(
  mp4Path: string,
  gifPath: string,
  width: number,
  fps: number,
): Promise<void> {
  const filter = [
    `fps=${fps},scale=${width}:-1:flags=lanczos,split[gif_source][palette_source]`,
    '[palette_source]palettegen=max_colors=192:stats_mode=diff[palette]',
    '[gif_source][palette]paletteuse=dither=sierra2_4a:diff_mode=rectangle',
  ].join(';');

  await execFileAsync(resolveFfmpeg(), [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    mp4Path,
    '-filter_complex',
    filter,
    '-loop',
    '0',
    gifPath,
  ]);
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  if (options.model) process.env.KLING_MODEL = options.model;
  process.env.KLING_RESOLUTION = options.resolution;

  const image = await readFile(options.imagePath);
  const info = await posterInfo(image);
  const prompt =
    options.durationSeconds === 5
      ? POSTER_MOTION_PROMPT
      : POSTER_MOTION_PROMPT.replace(
          '5-second',
          `${options.durationSeconds}-second`,
        );
  printReview(options, info, prompt);

  if (!options.execute) {
    console.log('');
    console.log(
      'DRY RUN ONLY — no Kling API call was made. Add --execute only after approving the prompt.',
    );
    return;
  }

  console.log('');
  console.log('Submitting one paid Kling render…');
  const clip = await generateKlingClip({
    prompt,
    imagePng: image,
    aspectRatio: info.aspectRatio,
    durationSeconds: options.durationSeconds,
    tier: 'fast',
    onProgress: (elapsedMs) => {
      console.log(`Still rendering (${Math.round(elapsedMs / 1000)}s)…`);
    },
  });

  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), 'dgipr-poster-motion-'),
  );
  try {
    const sourcePath = join(temporaryDirectory, 'kling-source.mp4');
    await writeFile(sourcePath, clip);
    await convertMp4ToBoomerang(
      sourcePath,
      options.mp4Path,
      options.durationSeconds,
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
  console.log(`Wrote ${options.mp4Path}`);
  await convertMp4ToGif(
    options.mp4Path,
    options.gifPath,
    options.gifWidth,
    options.gifFps,
  );
  console.log(`Wrote ${options.gifPath}`);
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
