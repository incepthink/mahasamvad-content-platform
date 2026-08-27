// Getting a photograph ready to be read, for whichever OCR backend is about to read it.
//
// Shared by image-ocr.ts (OpenAI) and sarvam-image.ts (Sarvam Document AI) because exactly
// one of the two steps here is a preference and the other is a correctness fix, and both
// backends need the correctness one:
//
//   EXIF ORIENTATION is the one that would otherwise look like a model failure. A phone held
//   upright writes a LANDSCAPE image plus a "rotate me" tag, and a reader that ignores the
//   tag sees the page on its side. `sharp().rotate()` with no argument applies it — and sharp
//   drops metadata on output, so it cannot then be applied twice.
//
//   THE SIZE BOUND is per-backend, and is NOT an accuracy fix — a 3000 px render of the
//   calibration page and a 1000 px one read equally well, and made the same digit mistakes.
//   It is here to bound the request body and to make what the backend receives the same shape
//   whatever camera the officer used. The two callers pass different numbers because they are
//   answering different questions; see each one.

import { extname } from 'node:path';
import sharp from 'sharp';

// What a backend can be handed. Kept in step with IMAGE_MIME_BY_EXTENSION in @dgipr/schemas,
// which is what the web picker offers and the API stores under — this is the last of the
// three and exists so a file that reached the job cannot fail with an opaque API error.
const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

export function imageOcrMimeForFileName(fileName: string): string | null {
  return MIME_BY_EXTENSION[extname(fileName).toLowerCase()] ?? null;
}

export type PreparedImage = Readonly<{ data: Buffer; mimeType: string }>;

export type ImageOcrBounds = Readonly<{
  // Never exceed this on the longer side.
  longEdge: number;
  // Then never exceed this on the SHORTER side. OpenAI's own second step; a document OCR
  // backend that reads the pixels itself must not be given this, or small Devanagari print
  // is thrown away before it is ever looked at.
  shortEdge?: number;
}>;

// Rotate, bound, re-encode. NEVER FAILS A SOURCE: the backends can read the original bytes,
// so the worst case is the unnormalised behaviour rather than a lost photograph.
export async function normaliseImageForOcr(
  name: string,
  data: Buffer,
  bounds: ImageOcrBounds,
): Promise<PreparedImage> {
  try {
    const image = sharp(data).rotate();
    const { width, height } = await image.metadata();
    if (!width || !height) throw new Error('unreadable image dimensions');

    // In order, and never an enlargement — upscaling a small scan invents no detail and only
    // makes the request bigger.
    const firstScale = Math.min(1, bounds.longEdge / Math.max(width, height));
    const scale = bounds.shortEdge
      ? firstScale *
        Math.min(1, bounds.shortEdge / (Math.min(width, height) * firstScale))
      : firstScale;

    const resized =
      scale < 1
        ? image.resize({
            width: Math.round(width * scale),
            height: Math.round(height * scale),
            fit: 'inside',
          })
        : image;
    // JPEG rather than the original container: a photograph is a photograph, and q92 is what
    // the video path already sends frames at. It also bounds the body, which for a raw
    // 12-megapixel PNG would be tens of megabytes.
    return {
      data: await resized.jpeg({ quality: 92 }).toBuffer(),
      mimeType: 'image/jpeg',
    };
  } catch (error) {
    console.warn(
      `[image-prep] ${name}: could not normalise, sending as-is:`,
      error,
    );
    return { data, mimeType: imageOcrMimeForFileName(name) ?? 'image/jpeg' };
  }
}
