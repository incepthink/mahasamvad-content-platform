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
//
// layoutSummary is injected verbatim into the image-EDIT prompt ("STRUCTURE OF THE MASTER
// YOU ARE EDITING: ..." in build-poster-prompt.ts, and the article-poster workflow's Build
// Prompt node). The header emblem band and footer contact/social strip are stamped in code
// afterwards (overlayTwitterChrome / overlayArticleChrome) and the paint prompt tells the
// model to leave those zones blank — so the analysis must NOT describe them, or the summary
// would push the model to repaint the very chrome we stamp. It profiles only the content
// region a designer actually fills.

import {
  ReferenceLayoutSpecSchema,
  type ReferenceLayoutSpec,
} from '@dgipr/schemas';
import { chatCompleteVision, VISION_MODEL } from '../generation/openai-chat.js';

export type { ReferenceLayoutSpec };

// The vision model that reads a master's layout + subject. Env-configurable so the model
// can be changed without a code edit — but it MUST be vision-capable (it is handed an
// image). Defaults to the shared VISION_MODEL (gpt-5.6-terra), which keeps Marathi in
// Devanagari where gpt-4o-mini leaked Latin; this pass runs once per master and is cached
// forever, so its cost is negligible. Its own OPENAI_ANALYZE_MODEL override survives
// because this is the one call that MUST be vision-capable — it is worth being able to
// pin separately from OPENAI_VISION_MODEL. Fall back to gpt-4o (also vision-capable) if a
// gpt-5.6 model ever rejects image input.
const ANALYZE_MODEL = process.env.OPENAI_ANALYZE_MODEL ?? VISION_MODEL;

// hasPhotoZone is the field that decides whether a poster may contain photography
// at all, so the boundary is drawn explicitly rather than left to the model's taste.
// The false-positive we actually care about is a faded backdrop wash (common in DGIPR
// advisories — e.g. a ghosted highway behind the text cards) being mistaken for a
// photo zone, which would re-authorize the model to paint a subject over it.
const ANALYSIS_PROMPT = [
  'You are analysing a MASTER TEMPLATE for an official government (DGIPR Maharashtra) poster.',
  "A master template is reused: its text is placeholder copy from a previous post, but its STRUCTURE is fixed. Describe the structure accurately; NEVER reproduce the placeholder words, names, numbers or dates.",
  '',
  "IGNORE THE BRAND CHROME. The government emblem / महाराष्ट्र शासन title band across the TOP, and the department footer band with contact details and social-media handle icons across the BOTTOM, are fixed branding stamped onto every poster later by software. They are NOT part of this template's design. Do not analyse them, do not count them, and do not mention them anywhere in your answer. Describe ONLY the CONTENT region between them — the part a designer fills with this post's message.",
  '',
  'Respond with STRICT JSON only, no commentary, with exactly these keys:',
  '',
  '"hasPhotoZone" (boolean): true ONLY if the CONTENT region devotes a distinct area to a photograph, portrait, or pictorial illustration of a subject — people, a building, a vehicle, an event — that a designer would swap out for each new post.',
  'It is FALSE for a content region made only of text, headings, cards, panels, icons and colour bands.',
  'The following are NOT photo zones, and must NOT make hasPhotoZone true:',
  '  - a faded, ghosted, low-opacity or watermarked photo used as a background wash BEHIND the text (very common; still counts as text-only),',
  '  - the government emblem, any logo, or the social-media handle icons (already excluded as chrome),',
  '  - small circular icons, pictograms, glyphs or symbols sitting inside bullets, cards or list rows,',
  '  - decorative shapes, ribbons, borders or colour blocks.',
  'When genuinely torn between a faint background wash and a real photo zone, answer false.',
  '',
  '"bulletSlots" (integer 0-12): how many repeating CONTENT slots the body has — content cards, bullet rows, numbered points, timeline entries or stat callouts. Count the repeating slots, not words. Use 0 if the body is not a repeating list.',
  '',
  '"layoutSummary" (string): 1-3 English sentences profiling the CONTENT region only, so a later step can tell this template apart from other masters. Read the visible text to identify the section TYPES the template supports, then cover, in order: the headline treatment (its size, placement, and whether it sits on a solid colour panel); which content sections exist — e.g. a subheadline, a date field, a time / venue callout, N stat callouts, N bullet rows, a quotation with attribution, a timeline, a call-to-action; the photograph zone if one exists and where it sits; and the dominant colour theme. Describe section TYPES and styling only — never the placeholder wording, and never the emblem, logo, title band or footer.',
  '',
  '"contentSummary" (string): 1-2 short sentences naming what this specific poster is ABOUT — its scheme, subject, announcement or event — so a person can recognise it in a library at a glance. UNLIKE layoutSummary, here you SHOULD read the placeholder text and name the actual topic (e.g. the scheme name, the department, the announcement). Write it in the poster\'s own language (Marathi in Devanagari if the text is Marathi). Do NOT transcribe the full text; do NOT describe layout or colours here; ignore the emblem/title band/footer.',
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
    model: ANALYZE_MODEL,
    responseFormat: 'json_object',
    // Reading a dense Devanagari poster and deciding hasPhotoZone (a faded background
    // wash vs a real photo zone) is a careful judgement, and a wrong verdict silently
    // authorises an invented hero photograph. Cached forever per master, so deliberating
    // costs nothing ongoing. maxTokens is the ANSWER budget only — reasoning gets its own
    // headroom in openai-chat.ts, so the old manual 600 -> 1200 padding is gone.
    reasoningEffort: 'medium',
    maxTokens: 1000,
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
