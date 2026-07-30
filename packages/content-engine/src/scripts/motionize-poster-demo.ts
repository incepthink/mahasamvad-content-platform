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
import { readFile, writeFile } from 'node:fs/promises';
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
  'Create a cheerful seamless 5-second Instagram-Boomerang-style loop from this Marathi voter-information poster. Use one locked camera shot. The supplied poster must be the exact first and last frame.',
  '',
  'LOCK ALL OFFICIAL GRAPHICS:',
  'Keep the crop, headline panel, all Marathi text and numerals, dates, information cards, icons, government emblem, QR code, footer, background, lines, and decorations fixed at exact source coordinates.',
  'Every glyph, logo, icon, QR module, colour, edge, and spacing remains identical and sharp. Treat all graphics as one still overlay: never redraw, translate, morph, blur, crop, flicker, or animate them. Keep the QR code scannable. Add no text, logo, watermark, person, animal, or object.',
  '',
  'ANIMATE ONLY THE EXISTING FOUR PEOPLE:',
  'Confine motion to the photographed family at upper right. Preserve each identity, face, skin tone, hair, clothing, anatomy, hands, and position. Never add, remove, duplicate, swap, or deform anyone.',
  'They share one warm reaction to the tablet: heads and shoulders lean inward by only a few pixels, existing smiles gently broaden, eyes brighten, and shoulders lift slightly as if sharing a quiet laugh. No speech, open mouths, teeth changes, blinking, waving, or large gestures.',
  'Everyone keeps looking at the tablet. The seated man makes only a minute hand adjustment while holding it. Keep the tablet, clipboard, papers, pen, table, chairs, and clothing fixed; no floating, bending, sliding, or new screen content.',
  '',
  'BOOMERANG MOTION:',
  'Start at the source pose. Ease into the closer lean and brighter smiles, briefly reach the happy peak, then ease back along the same motion to the source pose. Make the reversal playful, subtle, synchronized, and seamless, with no pause, jump, or snap.',
  '',
  'CAMERA AND IMAGE LOCK:',
  'No pan, zoom, shake, crop change, parallax, focus pull, background motion, warping, lighting change, colour shift, glow, or new shadows. Preserve the clean public-information-poster look.',
  '',
  'SEAMLESS LOOP:',
  'At exactly 5 seconds, every face, smile, head, shoulder, hand, and pixel returns to its source position. First and final frames match exactly with no dissolve, duplicate feature, brightness pulse, or frozen endpoint.',
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
        lastFrame: 'the same supplied poster (for a seamless loop)',
        settings: {
          duration: options.durationSeconds,
          resolution: klingResolution('fast'),
          audio: 'off',
          multi_shot: false,
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
          'seamless 5-second',
          `seamless ${options.durationSeconds}-second`,
        ).replace(
          'at exactly 5 seconds',
          `at exactly ${options.durationSeconds} seconds`,
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
    // Identical endpoints encourage a seamless loop and restore the exact
    // source poster at the end of the model-generated motion.
    lastFramePng: image,
    aspectRatio: info.aspectRatio,
    durationSeconds: options.durationSeconds,
    tier: 'fast',
    onProgress: (elapsedMs) => {
      console.log(`Still rendering (${Math.round(elapsedMs / 1000)}s)…`);
    },
  });

  await writeFile(options.mp4Path, clip);
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
