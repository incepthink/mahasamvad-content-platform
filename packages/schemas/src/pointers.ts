// "Pointers": the read-only key-point summary /dlo shows the officer after intake. The
// assembled note is summarised into ONE flat, ordered list of Marathi bullets — what you
// would get by asking "give me the important points from this" — and the officer reads it.
//
// It does NOT steer generation. The article is written from the complete reviewed source
// text, exactly as it was before this feature existed. There is no selection, no exclusion
// and no 5W1H grouping: a long PDF holding many separate articles reads far better as one
// list in source order than as six artificial buckets, and the checkboxes implied a curation
// decision nobody was actually making.
//
// `POST /api/pointers` is synchronous and ad-hoc (the /proofread shape) — nothing is stored,
// so a failed extraction costs the officer nothing but the summary.

import { z } from 'zod';
import { DloCategorySchema } from './dlo.js';

// Keep each pointer-extraction request below the model transport's practical token-rate
// budget. Shared by the browser (so it can reveal completed chunks progressively) and by the
// engine (so non-web callers cannot accidentally recreate one oversized request).
export const POINTERS_REQUEST_CHUNK_CHARS = 18_000;

function splitOversizedPointerBlock(block: string, maxChars: number): string[] {
  const pieces: string[] = [];
  let remaining = block.trim();
  const earliestPreferredBreak = Math.floor(maxChars * 0.6);

  while (remaining.length > maxChars) {
    const window = remaining.slice(0, maxChars + 1);
    const candidates = [
      window.lastIndexOf('\n'),
      window.lastIndexOf('\u0964'),
      window.lastIndexOf('. '),
      window.lastIndexOf(' '),
    ];
    const preferred = candidates.find(
      (position) => position >= earliestPreferredBreak,
    );
    let cut = preferred === undefined ? maxChars : preferred + 1;
    // Do not strand a tail too short for PointersRequestSchema. Moving a few characters to
    // the tail keeps both requests valid while preserving the exact source order.
    if (remaining.length - cut > 0 && remaining.length - cut < 20) {
      cut = remaining.length - 20;
    }
    const piece = remaining.slice(0, cut).trim();
    if (piece.length > 0) pieces.push(piece);
    remaining = remaining.slice(cut).trim();
  }

  if (remaining.length > 0) pieces.push(remaining);
  return pieces;
}

// Paragraph-aware packing with an unconditional fallback for a single giant pasted/OCR
// paragraph. Every non-empty output is at most maxChars and source order is preserved.
export function splitPointerInput(
  text: string,
  maxChars = POINTERS_REQUEST_CHUNK_CHARS,
): string[] {
  if (!Number.isFinite(maxChars) || maxChars < 20) {
    throw new Error('Pointer chunk size must be at least 20 characters.');
  }

  const blocks = text
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0);
  const packed: string[] = [];
  let buffer: string[] = [];
  let bufferChars = 0;
  const flush = (): void => {
    if (buffer.length === 0) return;
    packed.push(buffer.join('\n\n'));
    buffer = [];
    bufferChars = 0;
  };

  for (const block of blocks) {
    const separatorChars = buffer.length > 0 ? 2 : 0;
    if (
      buffer.length > 0 &&
      bufferChars + separatorChars + block.length > maxChars
    ) {
      flush();
    }
    buffer.push(block);
    bufferChars += separatorChars + block.length;
  }
  flush();

  return (packed.length > 0 ? packed : [text.trim()])
    .flatMap((block) => splitOversizedPointerBlock(block, maxChars))
    .filter((block) => block.length > 0);
}

// The extraction result: one ordered list, source order preserved. The count adapts to the
// source — a single press note yields a handful, a 20-page multi-article PDF naturally
// yields many more — so 120 is an anti-runaway guard on a malformed reply, NOT a target and
// NOT a quota the extractor is told to fill.
export const PointersResultSchema = z.object({
  points: z.array(z.string().trim().min(1).max(500)).max(120),
});
export type PointersResult = z.infer<typeof PointersResultSchema>;

// The extraction request. `text` is the current assembled note — uncapped, like the DLO
// generation note it is taken from, since this call is the officer's only view of what a
// long source says and truncating it would silently hide the tail. Long input is already
// chunked (POINTERS_REQUEST_CHUNK_CHARS), so length costs proportionally more model calls
// rather than failing. `category` steers the extractor's tone the way the article voice
// does. `heading` is context only — it must never narrow which topics get covered.
export const PointersRequestSchema = z.object({
  text: z.string().trim().min(20),
  category: DloCategorySchema,
  heading: z.string().trim().max(200).optional(),
});
export type PointersRequest = z.infer<typeof PointersRequestSchema>;

// ---------------------------------------------------------------------------------------
// Legacy officer-approved fact contract — STORED GENERATIONS ONLY. Do not delete.
//
// When Pointers was a 5W1H checkbox list, the officer's ticks were persisted on the
// generation as `selected_facts` / `statements` (migration 0034) and `excluded_facts`
// (0030), and became that article's completeness contract. /dlo no longer sends any of
// them, but every one of those rows is still live: `runner.ts` re-reads the row on EVERY
// run, so a retry or an article-feedback round on any pre-change generation still walks
// the full inventory path.
//
// Readers: apps/api/src/jobs/runner.ts (`selectedFactsOf`/`statementsOf`),
// generate-article.ts (`fiveWOneHFromPointers`, the coverage swap), generate-article-simple.ts,
// revise-article.ts, verify-coverage.ts (`findMissingApprovedFacts`), category-prompt.ts,
// simple-article-prompt.ts, editorial-brief.ts.
// ---------------------------------------------------------------------------------------

// The 5W1H dimensions a stored fact can carry. Keys are stable/machine. No longer produced
// by extraction — kept because SelectedFactSchema below parses them off stored rows.
export const POINTER_DIMENSIONS = [
  'who',
  'what',
  'when',
  'where',
  'why',
  'how',
] as const;
export const PointerDimensionSchema = z.enum(POINTER_DIMENSIONS);
export type PointerDimension = z.infer<typeof PointerDimensionSchema>;

// One pointer the officer kept for the article. Keeping its dimension beside the text lets
// the generation pipeline build the 5W1H scaffold deterministically instead of paying for a
// second model to rediscover the grouping (see `fiveWOneHFromPointers`).
export const SelectedFactSchema = z.object({
  dimension: PointerDimensionSchema,
  text: z.string().trim().min(1).max(500),
});
export type SelectedFact = z.infer<typeof SelectedFactSchema>;
export const SelectedFactsSchema = z.array(SelectedFactSchema).max(60);

// A statement the note explicitly attributes to a named speaker, kept separate from the
// bullets so the speaker/claim relationship could not be lost during summarisation. Empty
// designation/venue means the source did not state one; downstream prompts may never infer
// either field.
export const AttributedStatementSchema = z.object({
  speaker: z.string().trim().min(1).max(200),
  designation: z.string().trim().max(200),
  venue: z.string().trim().max(300),
  claim: z.string().trim().min(1).max(1000),
});
export type AttributedStatement = z.infer<typeof AttributedStatementSchema>;
export const AttributedStatementsSchema = z
  .array(AttributedStatementSchema)
  .max(12);
