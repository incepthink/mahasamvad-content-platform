// Read a master template's layout off its pixels.
//
// Why this exists: the n8n social-post workflow used to tell the image model, on
// every single render, that the master "carries a sample photo/illustration in the
// image zone" and to "erase the existing photo/illustration, then paint a NEW scene".
// Handed a text-only advisory master, the model dutifully invented a hero photograph
// that the template never had. The type's prose description ("only text, no images")
// could not fix that — it never reached the image prompt, and prose is not a signal a
// workflow can branch on anyway.
//
// So the structural facts come from the master itself: one vision pass at upload,
// cached on the reference_images row (migration 0016), shipped to n8n in the catalog.

import {
  ReferenceLayoutSpecSchema,
  type ReferenceLayoutSpec,
} from '@dgipr/schemas';
import { chatCompleteVision } from '../generation/openai-chat.js';

export type { ReferenceLayoutSpec };

// hasPhotoZone is the field that decides whether a poster may contain photography
// at all, so the boundary is drawn explicitly rather than left to the model's taste.
// The false-positive we actually care about is a faded backdrop wash (common in DGIPR
// advisories — e.g. a ghosted highway behind the text cards) being mistaken for a
// photo zone, which would re-authorize the model to paint a subject over it.
const ANALYSIS_PROMPT = [
  'You are analysing a MASTER TEMPLATE for an official government (DGIPR Maharashtra) poster.',
  'A master template is reused: its text is placeholder copy from a previous post, but its STRUCTURE is fixed and must be described accurately.',
  'Respond with STRICT JSON only, no commentary, with exactly these keys:',
  '',
  '"hasPhotoZone" (boolean): true ONLY if the poster devotes a distinct region to a photograph, portrait, or pictorial illustration of a subject — people, a building, a vehicle, an event — that a designer would swap out for each new post.',
  'It is FALSE for a poster made only of text, headings, cards, panels, icons and colour bands.',
  'The following are NOT photo zones, and must NOT make hasPhotoZone true:',
  '  - a faded, ghosted, low-opacity or watermarked photo used as a background wash BEHIND the text (very common; still counts as text-only),',
  '  - the Government of Maharashtra emblem, any logo, or the social-media handle icons in the footer,',
  '  - small circular icons, pictograms, glyphs or symbols sitting inside bullets, cards or list rows,',
  '  - decorative shapes, ribbons, borders or colour blocks.',
  'When genuinely torn between a faint background wash and a real photo zone, answer false.',
  '',
  '"bulletSlots" (integer 0-12): how many repeating body slots the layout has — content cards, bullet rows, numbered points, timeline entries or stat callouts. Count the repeating slots, not words. Use 0 if the body is not a repeating list.',
  '',
  '"layoutSummary" (string): 1-3 English sentences describing the template zone by zone, top to bottom (header band, headline area, body slots, any photo zone, footer). Describe STRUCTURE and styling, never the placeholder wording.',
].join('\n');

// The reply is free-form JSON (json_object, not a strict json_schema), so nudge the
// two fields the model is loose about into range before validating. bulletSlots in
// particular comes back as a string often enough to matter, and a count above the
// schema's ceiling is a miscount worth clamping rather than a reason to fail the
// whole analysis — hasPhotoZone, the field that actually gates imagery, is not
// coerced: anything but a real boolean is a bad read and must throw.
function normalize(parsed: Record<string, unknown>): unknown {
  const slots = Number(parsed.bulletSlots);
  return {
    ...parsed,
    bulletSlots: Number.isFinite(slots)
      ? Math.min(12, Math.max(0, Math.round(slots)))
      : 0,
  };
}

export async function analyzeReferenceTemplate(
  png: Buffer,
): Promise<ReferenceLayoutSpec> {
  const dataUrl = `data:image/png;base64,${png.toString('base64')}`;
  const raw = await chatCompleteVision(ANALYSIS_PROMPT, dataUrl, {
    responseFormat: 'json_object',
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Template analysis returned invalid JSON: ${(error as Error).message} | raw: ${raw.slice(0, 300)}`,
    );
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(
      `Template analysis returned a non-object: ${raw.slice(0, 300)}`,
    );
  }

  return ReferenceLayoutSpecSchema.parse(
    normalize(parsed as Record<string, unknown>),
  );
}
