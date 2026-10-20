// Exact-text red-box edits: a red mark whose text must read an EXACT string («हा मजकूर असा
// हवा») — a misprinted digit («९» for «१»), a broken jodakshar — is fixed on its own crop,
// not by repainting the whole poster.
//
// Per mark: crop the marked box with padding, enlarge it to ~1M pixels, typeset the target
// string in Mukta with Chromium (the spelling picture), and send the two to the image model
// with a short single-purpose prompt. The edited crop is laid back with a feathered edge
// confined to the padding. Everything outside the crop stays pixel-identical, so no other text
// on the poster can be re-spelled by accident, and the glyph the model draws is large.
//
// The marks are edited IN PARALLEL (one image call each, all smaller than a poster edit) and
// laid back in order. Used by the poster feedback job (runner.ts) and the carousel slide
// feedback job (carousel.ts), all lanes.

import {
  buildExactTextPrompt,
  recordImageCost,
  type ImageKind,
  type ImageQuality,
} from '@dgipr/content-engine';
import {
  compositeCropPatch,
  editImage,
  extractCrop,
  imageSize,
  planExactTextCrop,
  renderSpellingReference,
  type CropPlan,
} from '@dgipr/poster-renderer';
import type { FeedbackRegion } from '@dgipr/schemas';

export type ExactTextMark = Readonly<{
  region: FeedbackRegion;
  exactText: string;
  note?: string | undefined;
}>;

type Frame = Readonly<{ width: number; height: number }>;

/**
 * The officer drew `region` on the FINISHED poster (`frame`). The canvas edited here may be the
 * un-branded copy instead, which shares the finished poster's top-left origin and width but can
 * be shorter (the social footer strip is appended below the artwork). Returns the region in the
 * canvas's own 0..1 terms, or null when the mark lies entirely off it (on the appended footer).
 */
function regionOnCanvas(
  region: FeedbackRegion,
  frame: Frame,
  canvas: Frame,
): FeedbackRegion | null {
  const scale = canvas.width / frame.width;
  const top = region.y * frame.height * scale;
  const bottom = Math.min(
    (region.y + region.height) * frame.height * scale,
    canvas.height,
  );
  if (bottom - top < 2) return null;
  return {
    x: region.x,
    width: region.width,
    y: top / canvas.height,
    height: (bottom - top) / canvas.height,
  };
}

/**
 * Apply every exact-text mark to `canvas` and return the corrected image. `frame` is the size
 * of the finished poster the marks were drawn on (pass the canvas's own size when the canvas IS
 * the finished poster). `kind`/`quality` attribute the image cost per crop.
 */
export async function applyExactTextEdits(
  canvas: Buffer,
  frame: Frame | null,
  marks: readonly ExactTextMark[],
  cost: Readonly<{ kind: ImageKind; quality: ImageQuality }>,
): Promise<Buffer> {
  if (marks.length === 0) return canvas;
  const size = await imageSize(canvas);
  const planned = marks
    .map((mark) => {
      const region = regionOnCanvas(mark.region, frame ?? size, size);
      return region
        ? { mark, plan: planExactTextCrop(size.width, size.height, region) }
        : null;
    })
    .filter((p): p is { mark: ExactTextMark; plan: CropPlan } => p !== null);

  const patches = await Promise.all(
    planned.map(async ({ mark, plan }) => {
      const [crop, spelling] = await Promise.all([
        extractCrop(canvas, plan),
        renderSpellingReference(mark.exactText),
      ]);
      const { rect, inner } = plan;
      const prompt = buildExactTextPrompt({
        exactText: mark.exactText,
        note: mark.note,
        target: {
          x: (inner.left - rect.left) / rect.width,
          y: (inner.top - rect.top) / rect.height,
          width: inner.width / rect.width,
          height: inner.height / rect.height,
        },
      });
      // The crop first — it is the image being edited — and the spelling picture as context.
      // High input fidelity keeps the crop's own type, colour and background unchanged.
      const edited = await editImage([crop, spelling], prompt, {
        size: `${plan.editWidth}x${plan.editHeight}`,
        inputFidelity: 'high',
      });
      recordImageCost(cost.kind, cost.quality);
      return { plan, edited };
    }),
  );

  let out = canvas;
  for (const { plan, edited } of patches) {
    out = await compositeCropPatch(out, edited, plan);
  }
  return out;
}
