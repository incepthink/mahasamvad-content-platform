// Normalise a picture an officer uploaded into bytes the rest of the pipeline
// can hand to an image model without thinking about it.
//
// It lives here because this package owns sharp — every other pixel operation in
// the repo (chrome overlays, cropToAspect, the footer extension) is here, and
// apps/api deliberately has no image dependency of its own.
//
// Three things it does, each for a reason that has already bitten this codebase
// somewhere else:
//
//  - PNG OUT, ALWAYS. The video frame clients send a reference image inline with
//    a hardcoded `image/png` mime type (generateGeminiImage's inlinePng), so a
//    JPEG stored as-is would be declared as something it is not. Converting at
//    upload time means exactly one representation is ever in Storage.
//  - EXIF AUTO-ROTATE. A phone held upright writes a landscape image plus a
//    "rotate me" tag; a reader that ignores the tag sees the subject on its side
//    and the model faithfully reproduces it that way. `sharp().rotate()` with no
//    argument applies it, and sharp drops metadata on output so it cannot then be
//    applied twice. Same finding as intake/image-ocr.ts.
//  - A LONG-EDGE BOUND. The reference travels to the frame model as base64 in the
//    request body; an unbounded 12-megapixel photograph is tens of megabytes of
//    request for no gain in what the model can see.
//
// Unlike the OCR normaliser this is NOT best-effort: its caller is an upload
// route with the officer standing in front of it, so an unreadable file must be
// refused there and then rather than stored and failed hours later inside a paid
// storyboard job.

import sharp from 'sharp';

// Bounds the inline request body without costing the model detail it can use —
// the frames this reference informs are themselves rendered near this size.
const REFERENCE_LONG_EDGE = 2048;

export class UnreadableImageError extends Error {
  constructor(cause: unknown) {
    super(
      `Could not read the uploaded image: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
    this.name = 'UnreadableImageError';
  }
}

// Returns PNG bytes, upright, with the long edge capped. Throws
// UnreadableImageError when the bytes are not an image sharp can decode.
export async function normalizeReferenceImage(data: Buffer): Promise<Buffer> {
  try {
    const image = sharp(data).rotate();
    const { width, height } = await image.metadata();
    if (!width || !height) throw new Error('unreadable image dimensions');
    const longEdge = Math.max(width, height);
    const resized =
      longEdge > REFERENCE_LONG_EDGE
        ? image.resize({
            width: Math.round(width * (REFERENCE_LONG_EDGE / longEdge)),
            height: Math.round(height * (REFERENCE_LONG_EDGE / longEdge)),
            fit: 'inside',
          })
        : image;
    return await resized.png().toBuffer();
  } catch (error) {
    throw new UnreadableImageError(error);
  }
}
