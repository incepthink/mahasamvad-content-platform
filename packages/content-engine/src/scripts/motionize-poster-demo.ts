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

// Kept under Kling's 2500-char RECOMMENDED budget on purpose: fitClipPrompt
// returns a prompt of that length untouched, whereas an over-cap prompt with
// none of the /video pipeline's field prefixes gets trimmed by shedding whole
// lines FROM THE END — which would silently delete the card and camera blocks.
export const POSTER_MOTION_PROMPT = [
  'Animate this government tiger-conservation poster into a clearly moving 5-second image-to-video shot. Motion must start within the first half second and stay visible throughout; never return a static image.',
  '',
  'TEXT LOCK — outranks every motion instruction below. Treat all typography, panels and branding as one frozen overlay pinned at exact source pixels: the "GOVERNMENT\'S NEW / INITIATIVE FOR / TIGER CONSERVATION" headline, the gold "11 MoUs SIGNED" banner, the "TIGER POPULATION" card with 2014 / 190 / NOW / 444 / NEXT ESTIMATE / 600+, every bullet line, and the whole footer band. Every letter, numeral, glyph, colour and edge stays identical and sharp: never redraw, retype, reflow, warp, blur, crop, flicker or move them. Add no new text, number, logo, watermark, person or object.',
  '',
  'ICON LOCK — equally absolute. Every icon is flat vector artwork and is FROZEN: the four dark circular icons down the left (globe, house-and-tree, AI chip, hand-and-plant), the gold paw prints, the gold arrow between 190 and 444, the top-right Government of Maharashtra emblem card, and every social icon in the footer. Never animate, rotate, pulse, glow, shimmer, recolour, redraw, restyle or make any of them photographic or three-dimensional. They keep their exact shape, weight, colour and position for the whole clip.',
  '',
  'TIGER — ONE SLOW STEP FORWARD (main motion). The tiger stands at x=72%-100%, y=30%-96%. It takes a single unhurried stride toward the camera: the front paws lift and plant, the shoulders roll, the tail sways, the ears flick and the fur stirs. Keep it in its own right-hand column — it must not drift left past x=70%, must not grow more than a few percent larger, must never overlap any card, bullet line, icon or the footer, and must not walk out of frame. Its stripes, face markings and proportions stay exactly as drawn.',
  '',
  'FOREST ON THE RIGHT (x=48%-100%, y=0%-95%): bring the woodland behind the tiger alive. The hanging leaves at the top right flutter in a light breeze, the canopy sways slowly, sunlight dapples through the trees and faint haze drifts upward. The drawn bird silhouettes glide slowly along the treeline. Keep this greenery pale and firmly in the background — it may never darken, spread left, or reduce the contrast of any text or icon.',
  '',
  'CAMERA LOCK: no pan, zoom, shake, rotation, crop change, warping or colour shift. The cream background, gold banner, white cards, the pale trees behind the left-hand text and the footer band all stay completely still.',
].join('\n');

type Options = {
  imagePath: string;
  promptPath?: string;
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
        '      [--prompt-file=brief.txt] [--duration=5]',
        '      [--resolution=720p|1080p]',
        '      [--model=kling-3.0] [--gif-width=720] [--gif-fps=12]',
        '      [--mp4=output.mp4] [--gif=output.gif]',
      ].join('\n'),
    );
  }

  const knownFlags = new Set([
    '--execute',
    '--prompt-file',
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
  const promptFile = optionValue(args, '--prompt-file');

  return {
    imagePath,
    ...(promptFile ? { promptPath: resolve(promptFile) } : {}),
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
        promptSource: options.promptPath ?? 'built-in POSTER_MOTION_PROMPT',
        promptChars: prompt.length,
        inputDimensions: `${dimensions.width}x${dimensions.height}`,
        firstFrame: 'the supplied poster',
        lastFrame: 'not supplied, so Kling has room to create visible motion',
        settings: {
          durationSeconds: options.durationSeconds,
          resolution: klingResolution('fast'),
          audio: 'off',
          multi_shot: false,
          playback: 'forward once — no reversal, no boomerang, no loop pass',
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
  // A custom brief is per-poster: the built-in prompt names the regions of one
  // specific poster (the TIGER CONSERVATION artwork), so any other artwork
  // needs its own --prompt-file.
  const basePrompt = options.promptPath
    ? (await readFile(options.promptPath, 'utf8')).trim()
    : POSTER_MOTION_PROMPT;
  if (basePrompt.length === 0) {
    throw new Error(`The prompt file ${options.promptPath} is empty.`);
  }
  const prompt =
    options.durationSeconds === 5
      ? basePrompt
      : basePrompt.replace('5-second', `${options.durationSeconds}-second`);
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

  // Kling's clip is written through unchanged: it plays forward once, start to
  // finish. Do not reintroduce a reverse/boomerang pass here.
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
