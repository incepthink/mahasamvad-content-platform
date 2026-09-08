// Dynamic Poster — a finished still poster the officer already has, motionised into a short
// looping clip (migration 0052).
//
// The lane is unusual on this platform in that ITS SOURCE IS AN IMAGE, not text. Everything
// else here starts from a note; here the note box is replaced by an upload, and the officer's
// typed words are DIRECTION for the motion rather than content to be printed.
//
// Two model calls, in this order:
//   1. gpt-5.6-sol reads the uploaded poster and writes the motion prompt (see
//      motion-prompt.ts in @dgipr/content-engine — the prompt itself lives there, with every
//      other model decision).
//   2. gemini-omni takes that prompt plus the poster and returns the clip.
//
// This file holds only what BOTH sides need: the upload limits (so the picker can refuse an
// oversized file before the upload starts, the AUDIO_FILE_ACCEPT precedent), the storage
// prefix that makes a submitted path checkable, and the wire shapes.

import { z } from 'zod';

// Where an uploaded source poster lives in the PUBLIC posters bucket. Exported because it is
// a SECURITY boundary, not a formatting detail: the create request names a storage path, and
// the route accepts one only under this prefix — the /chat imageUrl guard and /video's
// `projects/{id}/references/` check, for the same reason. A browser must never be able to
// point a paid render at an arbitrary object.
export const MOTION_SOURCE_PREFIX = 'dynamic-posters/sources/';

export function isMotionSourcePath(path: string): boolean {
  return (
    path.startsWith(MOTION_SOURCE_PREFIX) &&
    path.length > MOTION_SOURCE_PREFIX.length &&
    // No traversal and no nesting: the route mints these names itself, so anything with a
    // second segment or a dot-segment in it did not come from us.
    !path.slice(MOTION_SOURCE_PREFIX.length).includes('/') &&
    !path.includes('..')
  );
}

// A poster, not a photograph: 1280x1600 at PNG is ~2 MB, and a print-resolution export a few
// times that. Generous enough for anything the department actually designs, bounded because
// the file is normalised in memory on the API box.
export const MOTION_SOURCE_MAX_MB = 20;
export const MOTION_SOURCE_MAX_BYTES = MOTION_SOURCE_MAX_MB * 1024 * 1024;

// What the picker offers and what the route accepts. Extension-driven on the server (a
// browser's reported type is not trusted) and stated here once so the two cannot disagree.
export const MOTION_SOURCE_EXTENSIONS: readonly string[] = [
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
];
export const MOTION_SOURCE_ACCEPT = `${MOTION_SOURCE_EXTENSIONS.join(',')},image/png,image/jpeg,image/webp`;

// The officer's direction, at creation and on every follow-up. Short by design: this is an
// instruction about motion ("make the flag wave, keep the tiger still"), not a brief.
export const MOTION_DIRECTION_MAX_CHARS = 2_000;

// THE SHAPE OF THE CLIP, CHOSEN BY THE OFFICER.
//
// It replaces the exact pixel resolution the motion prompt used to carry: a video model asked
// for `1237x1600` does not deliver it, so the prompt's most emphatic requirement was the one
// thing the render could not honour.
//
// 'source' — THE POSTER'S OWN RATIO — IS THE DEFAULT, and that is the fix for the lane's first
// reported defect. The control originally offered 9:16 and 16:9 only, and a DGIPR social poster
// is deliberately 4:5 (the platform renders them at 1280x1600 precisely so they fill a 1080x1350
// portrait frame). Asking for 4:5 artwork inside a 9:16 frame while also demanding "the full
// poster, nothing cut off" is a contradiction — only 0.5625/0.8 = 70% of the poster's width fits
// — and the render resolved it the only way it could, by cutting ~15% off each side. So the
// honest default is the shape the poster was designed in, and the two fixed frames stay for a
// department publishing into a reel or a landscape post.
//
// A ratio the poster does not already have is NOT left to the prompt to honour: the source is
// padded into that exact frame before it is sent (fitImageToAspect, @dgipr/poster-renderer), so
// there is no side left for the model to crop. Instruct, then guarantee — the house rule.
export const MOTION_ASPECTS = ['source', '9:16', '16:9'] as const;
export const MotionAspectSchema = z.enum(MOTION_ASPECTS);
export type MotionAspect = z.infer<typeof MotionAspectSchema>;

// The poster's own shape. Also what a row carrying no stored aspect falls back to — which now
// includes every Dynamic Poster made before this default changed. That IS the intended repair:
// those rows were rendered at 9:16 and cropped, so a follow-up on one should reframe it, not
// faithfully reproduce the defect.
export const DEFAULT_MOTION_ASPECT: MotionAspect = 'source';

// The numeric width/height ratio a chosen aspect asks for. 'source' has none of its own — it
// means "whatever the uploaded poster is" — so the caller supplies the measured size and gets
// it straight back.
export function motionAspectRatio(
  aspect: MotionAspect,
  sourceWidth: number,
  sourceHeight: number,
): number {
  if (aspect === '9:16') return 9 / 16;
  if (aspect === '16:9') return 16 / 9;
  return sourceWidth / sourceHeight;
}

// How a pixel size is NAMED in the motion prompt. The video model is told a ratio rather than a
// resolution, so 1280x1600 has to arrive as "4:5".
//
// Exact reduction first, which is what gives a poster designed to a standard frame its familiar
// name. An arbitrary export (1237x1600 — a hand-cropped scan) reduces to nothing useful, so it
// falls back to the closest ratio with a denominator of at most 16: a small approximation in a
// sentence, next to an input image that is already exactly the right shape.
function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

export function aspectRatioLabel(width: number, height: number): string {
  if (!(width > 0) || !(height > 0)) return '1:1';
  const w = Math.round(width);
  const h = Math.round(height);
  const divisor = gcd(w, h);
  const rw = w / divisor;
  const rh = h / divisor;
  if (Math.max(rw, rh) <= 32) return `${rw}:${rh}`;

  const ratio = w / h;
  let best = { w: 1, h: 1, error: Number.POSITIVE_INFINITY };
  for (let q = 1; q <= 16; q += 1) {
    const p = Math.max(1, Math.round(q * ratio));
    const error = Math.abs(p / q - ratio) / ratio;
    if (error < best.error) best = { w: p, h: q, error };
  }
  return `${best.w}:${best.h}`;
}

// POST /api/generations/motion-image — one uploaded poster, normalised and stored.
//
// It returns a PATH as well as a URL because the path is what the create request carries: a
// public URL is a string anyone can type, while a path is checked against MOTION_SOURCE_PREFIX
// above. `width`/`height` are the officer's own upright pixel dimensions, echoed back so the
// picker can show them — the API measures them again from the stored object at render time
// rather than trusting these back.
export const MotionSourceResponseSchema = z.object({
  path: z.string(),
  url: z.string(),
  name: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
export type MotionSourceResponse = z.infer<typeof MotionSourceResponseSchema>;

// One stored render. Every render writes a new immutable versioned object (public buckets are
// CDN-cached, paths are never reused), so a follow-up that comes back worse never destroys the
// clip the officer already has. Ordered oldest→newest; the last entry is the current one.
export const MotionVersionSchema = z.object({
  videoUrl: z.string(),
  gifUrl: z.string().nullable(),
  createdAt: z.string(),
  // What was asked for to produce THIS version — the officer's follow-up instruction, or null
  // on the first render, which was nobody's edit. Makes the version strip read as a history of
  // requests rather than a row of numbers (the ArticleVersion rule).
  direction: z.string().nullable(),
});
export type MotionVersion = z.infer<typeof MotionVersionSchema>;

// POST /api/generations/:id/motion/feedback — the AI प्रॉम्प्ट box beside the finished clip.
// Continues the SAME Gemini interaction, so "make the background darker" edits the video on
// screen rather than starting again from the poster.
export const MotionFeedbackRequestSchema = z.object({
  feedback: z.string().trim().min(1).max(MOTION_DIRECTION_MAX_CHARS),
});
export type MotionFeedbackRequest = z.infer<typeof MotionFeedbackRequestSchema>;

// THE HAND TRIM — POST /api/generations/:id/motion/crop.
//
// A finished clip, cut down to a rectangle the officer drew over it. Unlike everything else on
// this lane it is a LOCAL operation: ffmpeg on the API box, no model call, nothing billed — so
// it can be repeated as often as they like, and each attempt still writes its own version so
// the clip they already have survives a trim they turn out not to want.
//
// The rectangle is stated as FRACTIONS of the clip's own width and height, because the officer
// draws it over a `<video>` the browser has scaled to fit the card and its displayed size has
// nothing to do with the real frame. Same 0..1 convention FeedbackRegionSchema uses on a
// poster, and deliberately its own shape rather than an import of it: that one is a pointing
// gesture whose minimum is a few pixels, and this one is a cut whose minimum has to be big
// enough to still be a video.
//
// One thing this does NOT do, and the UI says so: it does not follow the clip into the Gemini
// conversation. The chain point still names the model's own last video, so a later AI follow-up
// comes back at full frame and has to be trimmed again.

// The smallest share of a side a trim may keep. Generous enough for a genuine strip — a ticker
// along the foot of a poster — while refusing the accidental flick of a drag that would
// otherwise cost a job to produce a few unusable pixels.
export const MOTION_CROP_MIN_SIDE = 0.05;

// At or above this on BOTH axes the rectangle is the whole clip, and re-encoding it would cost
// a generation of quality to produce the picture the officer is already looking at.
export const MOTION_CROP_MAX_KEPT = 0.995;

export const MotionCropSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().min(MOTION_CROP_MIN_SIDE).max(1),
    height: z.number().min(MOTION_CROP_MIN_SIDE).max(1),
  })
  .superRefine((rect, ctx) => {
    // Small epsilon on both edges: a box dragged to the very edge of a scaled video lands on
    // 1.0000001 as often as on 1, and refusing that would refuse the most ordinary gesture
    // there is. FeedbackRegionSchema makes the same allowance for the same reason.
    if (rect.x + rect.width > 1.0001) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'The selection runs past the right edge of the clip.',
        path: ['width'],
      });
    }
    if (rect.y + rect.height > 1.0001) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'The selection runs past the bottom edge of the clip.',
        path: ['height'],
      });
    }
  });
export type MotionCrop = z.infer<typeof MotionCropSchema>;

/** True when the rectangle keeps effectively the whole clip, so trimming it would do nothing. */
export function isWholeClipCrop(rect: MotionCrop): boolean {
  return (
    rect.width >= MOTION_CROP_MAX_KEPT && rect.height >= MOTION_CROP_MAX_KEPT
  );
}

export const MotionCropRequestSchema = z.object({
  crop: MotionCropSchema,
});
export type MotionCropRequest = z.infer<typeof MotionCropRequestSchema>;
