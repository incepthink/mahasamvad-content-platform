// MP4 → GIF, for the Dynamic Poster lane.
//
// The clip is delivered as an MP4 (crisp, small, and what the provider returns), and the GIF
// exists for the places a video file will not go — a WhatsApp forward, a slide, an email. It
// is a SECOND artifact rather than a replacement: a GIF of a poster is 256 colours and several
// times the bytes, and re-encoding the officer's only copy that way would be a downgrade.
//
// Two things in the filter graph earn their place, both from the demo script this lane grew out
// of (scripts/motionize-poster-demo.ts):
//
//  - A PER-CLIP PALETTE (`palettegen` + `paletteuse`) rather than the default web palette. A
//    DGIPR poster is large flat areas of one saffron and one maroon with Devanagari set over
//    them; quantised against a generic palette those flats band visibly and the text edges
//    crawl. `stats_mode=diff` weights the palette toward the pixels that actually MOVE, which
//    is what keeps the still background — most of the frame here — true to the source.
//  - `dither=sierra2_4a`, which scatters the remaining error finely enough that Devanagari
//    conjuncts stay readable. The alternative (no dithering) posterises them.
//
// It lives in this package because this package owns ffmpeg (resolveFfmpeg, assemble.ts) and
// apps/api deliberately has no media dependency of its own.

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { resolveFfmpeg } from './assemble.js';

const execFileAsync = promisify(execFile);

const GIF_TIMEOUT_MS = 300_000;
const GIF_MAX_BUFFER = 16 * 1024 * 1024;

// Bounds on the output, not on the source. A GIF is uncompressed between frames, so its size
// grows with BOTH of these: a full-resolution 24fps poster clip is tens of megabytes and no
// messaging app will carry it. 720px on the long edge at 12fps keeps a 5-second clip in the
// low single-digit megabytes while the motion still reads as motion.
export const GIF_LONG_EDGE = 720;
export const GIF_FPS = 12;

export type MotionGifOptions = Readonly<{
  longEdge?: number;
  fps?: number;
}>;

// Returns GIF bytes for the supplied MP4. Throws on an ffmpeg failure — the CALLER decides
// whether that is fatal; in the Dynamic Poster job it is not, because the MP4 is the paid
// artifact and losing the convenience copy must never lose the render.
export async function mp4ToGif(
  mp4: Buffer,
  options: MotionGifOptions = {},
): Promise<Buffer> {
  const longEdge = options.longEdge ?? GIF_LONG_EDGE;
  const fps = options.fps ?? GIF_FPS;

  const dir = await mkdtemp(join(tmpdir(), 'dgipr-motion-gif-'));
  try {
    const inputPath = join(dir, 'clip.mp4');
    const outputPath = join(dir, 'clip.gif');
    await writeFile(inputPath, mp4);

    // scale=W:-1 only bounds the WIDTH, so a portrait poster (the common shape here) would
    // come out taller than the budget. `force_original_aspect_ratio=decrease` against a square
    // box bounds whichever edge is longer, and -2 keeps both dimensions even, which some
    // decoders still require.
    const filter = [
      `fps=${fps},scale=${longEdge}:${longEdge}:force_original_aspect_ratio=decrease:flags=lanczos,split[gif_source][palette_source]`,
      '[palette_source]palettegen=max_colors=192:stats_mode=diff[palette]',
      '[gif_source][palette]paletteuse=dither=sierra2_4a:diff_mode=rectangle',
    ].join(';');

    await execFileAsync(
      resolveFfmpeg(),
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-i',
        inputPath,
        '-filter_complex',
        filter,
        // 0 = loop for ever. The whole point of this lane is a poster that keeps moving.
        '-loop',
        '0',
        outputPath,
      ],
      { timeout: GIF_TIMEOUT_MS, maxBuffer: GIF_MAX_BUFFER },
    );

    const gif = await readFile(outputPath);
    if (gif.length === 0) {
      throw new Error('ffmpeg produced an empty GIF.');
    }
    return gif;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
