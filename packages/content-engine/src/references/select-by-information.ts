// CAPACITY-FIRST reference selection for social (twitter/facebook) posters.
//
// SUPERSEDES the subject-first design this file carried between 2026-07-28 and 2026-07-31,
// which made the reference's own TOPIC the deciding factor ("a note about mosquitoes must land
// on the dengue master even if a different template would arrange its points more neatly").
// That was built on an assumption which turned out to be false in practice: that the officer
// supplies an ARTICLE and the pipeline decides what belongs on the poster. It does not. What
// the officer types IS the poster's content — every line of it is meant to appear.
//
// Once that is true, topic matching is actively harmful. A note about mosquitoes carrying SEVEN
// points was being routed to the three-slot dengue poster, and four of the officer's points were
// then dropped to fit — the reference's capacity was shrinking the content. The relationship has
// to run the other way: the content's SIZE decides which references are even eligible.
//
//   the information → how many items it contains → the references that can SHOW that many
//   → the one whose arrangement presents this shape best
//
// So the order is now:
//
//   STAGE 1 (capacity, a HARD GATE): a reference with fewer content slots than the information
//     has items is EXCLUDED, not scored down. The TIGHTEST capacity that fits wins; an oversized
//     two-section master is not harmless, because its unused text zones make the image model
//     repeat the note or invent headings to fill them.
//   STAGE 2 (text-role compatibility, another HARD GATE in strict-source social mode): within
//     that capacity band, prefer the references that demand the fewest headline, subheadline,
//     section-label, CTA and other auxiliary text slots not explicitly present in the note.
//   STAGE 3 (presentation): among what survives, which arrangement suits this shape of
//     information — a photograph zone or not, a quotation with a speaker, a date/venue, figures.
//
// SUBJECT IS NO LONGER A CRITERION AT ALL, and `contentSummary` is deliberately not shown to the
// ranker. Making the poster FEEL like an alert (or a scheme launch, or a celebration) is the
// image prompt's job, not the librarian's: the reference contributes structure, and
// build-poster-prompt.ts tells the model to make the design read as the right kind of poster.
// That is the same division the onbrand prompt already draws for colour ("the reference image
// controls STRUCTURE ONLY, not colour") — this extends it to subject and mood.
//
// THE GATE IS ENFORCED IN CODE, NOT BY THE PROMPT. The model is told the rule and normally
// obeys it, but its answer is then checked: a pick that cannot hold the items is replaced with
// the tightest eligible reference. Same doctrine as lock-scheme-names.ts and the video
// fact_index guard — an instruction steers, a deterministic post-filter guarantees.
//
// WHEN NOTHING FITS (9 items, biggest master has 6) the render still happens: the
// highest-capacity reference is chosen and the shortfall is REPORTED — to the image prompt, so
// it is told to extend the item pattern rather than drop anything, and to the officer, so they
// can split the note into two posters. Never a silent truncation, which is what this whole
// change exists to end.
//
// In strict-source social mode the item COUNT is lexical and deterministic: one officer-written
// bullet/numbered line or sentence is one display unit. The model still ranks presentation, but
// cannot reinterpret seven source sentences as ten or twelve semantic facts. The legacy/shared
// mode keeps its model count for backward compatibility.
//
// Colour is additionally stripped from the descriptions on a 'fresh' render, where the palette
// is assigned separately and the master contributes structure only.
//
// RECENCY IS A TIE-BREAK, NEVER A FILTER. Recently-used masters are handed to the model as a
// lowest-priority preference between EQUALLY capable candidates; the pool it ranks over is
// always complete. They still filter the SEEDED FALLBACK pick, where no reasoning is happening
// and across-run variety is free.
//
// Ranking is a QUALITY step over a pool that is already correct: an un-analysed library, a bad
// model read or a failed call all fall back to the seeded hash pick, so a render never depends
// on it succeeding.

import { pathToFileURL } from 'node:url';
import {
  publicUrl,
  type ReferenceImageRow,
  type SupabaseClient,
} from '@dgipr/database';
import { chatComplete } from '../generation/openai-chat.js';
import { POSTER_COPY_MODEL } from '../generation/classify-poster-type.js';
import { stripColourMentions } from '../generation/strip-colour-words.js';
import {
  analyzeAndPersist,
  hashString,
  type SelectedMaster,
} from './select-master.js';

// One reference as the ranker sees it. `id` is opaque to the model (it answers with an index);
// the capacity plus the structural description are what it reasons over.
//
// NOTE the absence of `contentSummary`: the reference's own subject is not a selection
// criterion any more, so it is not shown. See the module header.
export type InformationCandidate = Readonly<{
  id: string;
  // The type this reference belongs to, named so the model can see that the library offers
  // genuinely different formats — NOT so it classifies the information into one first.
  typeLabel: string;
  layoutSummary: string;
  hasPhotoZone: boolean;
  bulletSlots: number;
  // Derived deterministically from the cached English layoutSummary. Existing reference rows
  // therefore become strict-source compatible immediately; no migration or paid re-analysis is
  // needed. A headline is tracked separately because an officer may explicitly provide one.
  headlineSlots: number;
  // Subheadlines, section labels, CTAs, contact/QR blocks, slogans and similar text roles which
  // are NOT part of bulletSlots. These are the slots that caused the observed extra copy.
  auxiliaryTextSlots: number;
}>;

export type InformationShape = Readonly<{
  // Exact source units, never an LLM interpretation. A bullet/numbered line is one unit; prose
  // is counted sentence-by-sentence, preserving the way an officer grouped facts in the input.
  itemCount: number;
  // True only for a short standalone first line that is visibly separated from the body.
  hasExplicitHeadline: boolean;
}>;

export type InformationRanking = Readonly<{
  // The chosen candidate's id (mapped back from the model's index). This is the model's
  // PREFERENCE; selectReferenceByInformation enforces the capacity gate over it.
  id: string;
  // How many distinct items the supplied information contains — the number the gate is
  // computed from, and the number the poster must end up showing.
  itemCount: number;
  // A short Marathi (Devanagari) working title for the post. This is the run's
  // `referenceTitle`, previously produced by the classifier this step replaced.
  title: string;
  // One short English sentence on why it fits (log/debug only).
  reason: string;
}>;

// Reported when NO reference in the library can hold every item, so the officer can be told and
// the image prompt can be instructed to extend the pattern instead of dropping content.
export type SlotShortfall = Readonly<{
  // Items the information contains.
  needed: number;
  // Content slots the chosen (highest-capacity) reference actually has.
  available: number;
}>;

export type SelectedByInformation = Readonly<{
  master: SelectedMaster;
  // Null when the pick fell back to the seeded hash (no ranking happened, so no title).
  title: string | null;
  // Strict-source mode computes this even if ranking fails; legacy mode leaves it null then.
  itemCount: number | null;
  // Null when the chosen reference can hold everything (the normal case).
  shortfall: SlotShortfall | null;
}>;

// The information is the whole input to this decision, so it is sent generously rather than
// summarised — but a 60,000-char note would dominate the prompt for no gain. Bounded, not
// sampled.
const NOTE_MAX_CHARS = 6000;

// Below this the capacity gate means nothing: a single-message poster is not a list, and a
// third of the library legitimately reports `bulletSlots: 0` ("the body is not a repeating
// list" — quote posters, one-statement posters). Gating those out for a one-item note would
// exclude exactly the references built for it.
const MIN_GATED_ITEMS = 2;

// A miscount cannot be allowed to empty the library through the gate. Nothing in the catalog
// exceeds 12 slots, so a count far above that is a bad read, not a big poster.
const MAX_ITEM_COUNT = 24;

const LIST_ITEM_PREFIX = /^\s*(?:[-*•▪◦–—]|\(?[0-9०-९]+[.)])\s+/u;
const SENTENCE_UNIT = /[^.!?।]+(?:[.!?।]+|$)/gu;

// The layout analyser deliberately writes summaries in a small, stable English vocabulary.
// Reading those cached summaries here makes the fix work for every existing master immediately,
// instead of adding jsonb fields which would remain absent until the whole library was re-read.
const AUXILIARY_TEXT_ROLE = new RegExp(
  [
    'subheadline',
    'subtitle',
    'tagline',
    'kicker',
    'section(?:-tab)?(?:\\s+|-)(?:heading|header|label|title)',
    'programme(?:-label|\\s+label)',
    'scheme\\s+ribbon',
    'call-to-action',
    'contact(?:-information)?(?:\\s+block|\\s+line|\\s+callout)?',
    'QR(?:-code)?',
    'website',
    'registration',
    'attribution',
    'quotation',
    'slogan',
    'introductory\\s+line',
    'supporting\\s+(?:line|statement)',
    'closing\\s+(?:line|invitation)',
    'reminder\\s+callout',
    'announcement\\s+(?:strip|banner|line)',
    '(?:stat|statistic|figure)\\s+callout',
    'date-style\\s+banner',
    'availability\\s+callout',
    'app-promotion',
    '(?:location-)?caption\\s+line',
    'helpline\\s+callout',
  ].join('|'),
  'giu',
);

function sentenceCount(text: string): number {
  return (text.match(SENTENCE_UNIT) ?? []).filter(
    (part) => part.trim().length > 0,
  ).length;
}

// Describe only structure which the officer actually supplied. This is intentionally lexical,
// not semantic: splitting one sentence into several inferred "facts" is exactly how the old
// model count changed seven source sentences into a template needing extra copy.
export function analyzeInformationShape(note: string): InformationShape {
  const trimmed = note.trim();
  if (!trimmed) return { itemCount: 0, hasExplicitHeadline: false };

  const blocks = trimmed
    .split(/\r?\n\s*\r?\n/u)
    .map((block) => block.trim())
    .filter(Boolean);
  const lines = trimmed
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);

  const firstBlock = blocks[0] ?? '';
  const firstLine = lines[0] ?? '';
  const laterLinesAreList = lines
    .slice(1)
    .some((line) => LIST_ITEM_PREFIX.test(line));
  const shortStandaloneFirstBlock =
    blocks.length > 1 &&
    !firstBlock.includes('\n') &&
    firstBlock.length <= 120 &&
    !/[.!?।]$/u.test(firstBlock);
  const listIntroduction =
    lines.length > 1 &&
    firstLine.length <= 160 &&
    !LIST_ITEM_PREFIX.test(firstLine) &&
    laterLinesAreList &&
    /[:：]$/u.test(firstLine);
  const hasExplicitHeadline = shortStandaloneFirstBlock || listIntroduction;

  let skippedHeadline = false;
  let itemCount = 0;
  for (const line of lines) {
    if (hasExplicitHeadline && !skippedHeadline && line === firstLine) {
      skippedHeadline = true;
      continue;
    }
    itemCount += LIST_ITEM_PREFIX.test(line) ? 1 : sentenceCount(line);
  }

  return {
    itemCount: Math.min(MAX_ITEM_COUNT, Math.max(1, itemCount)),
    hasExplicitHeadline,
  };
}

export function referenceTextRoles(layoutSummary: string): Readonly<{
  headlineSlots: number;
  auxiliaryTextSlots: number;
}> {
  const headlineSlots = (layoutSummary.match(/\bheadline\b/giu) ?? []).length;
  const auxiliaryTextSlots = (layoutSummary.match(AUXILIARY_TEXT_ROLE) ?? [])
    .length;
  return { headlineSlots, auxiliaryTextSlots };
}

function buildSystemPrompt(
  candidates: readonly InformationCandidate[],
  ignoreColour: boolean,
  // Indices of candidates the last few posts already used. Lowest-priority preference only.
  recentIndices: readonly number[],
  strictSourceShape?: InformationShape | undefined,
): string {
  const lines = candidates.map((c, i) => {
    // CAPACITY LEADS THE LINE. It is the primary key of the decision, so it must not sit in a
    // trailing clause the model can skim past.
    const slots =
      c.bulletSlots > 0
        ? `shows up to ${c.bulletSlots} item(s)`
        : 'not an item list (a single-message or quotation layout)';
    const photo = c.hasPhotoZone
      ? 'has a photograph area'
      : 'text-only (no photograph area)';
    // On a from-scratch run the master's colours are irrelevant AND misleading: the palette is
    // assigned separately, and the DGIPR library is overwhelmingly saffron/maroon/cream, so a
    // colour-carrying description is a live channel for the house look to re-enter a poster
    // meant to be in a different family.
    const layout = ignoreColour
      ? stripColourMentions(c.layoutSummary)
      : c.layoutSummary;
    const textDemand =
      `${c.headlineSlots} headline slot(s), ` +
      `${c.auxiliaryTextSlots} other auxiliary text slot(s)`;
    return [
      `- index ${i} [group: ${c.typeLabel}]`,
      `  CAPACITY: ${slots}`,
      `  TEXT DEMAND: ${textDemand}`,
      `  STRUCTURE: ${photo}. ${layout}`,
    ].join('\n');
  });

  const variety =
    recentIndices.length > 0
      ? [
          '',
          'VARIETY (lowest priority, applies only after the structural stages above):',
          `- Recent posts already used: ${recentIndices.map((i) => `index ${i}`).join(', ')}.`,
          '- Between references that hold the information EQUALLY well, prefer one that is not in that list.',
          '- NEVER reject a reference that fits the item count better in order to satisfy this.',
        ]
      : [];

  const strictStructure = strictSourceShape
    ? [
        '',
        'STRICT SOURCE-SHAPE RESULT (computed deterministically from the officer’s formatting; do not reinterpret it):',
        `- The body contains exactly ${strictSourceShape.itemCount} display item(s). Report item_count as exactly ${strictSourceShape.itemCount}.`,
        strictSourceShape.hasExplicitHeadline
          ? '- The officer supplied one explicit standalone headline.'
          : '- The officer supplied NO explicit standalone headline, kicker, section label, summary, CTA or other auxiliary poster copy.',
        '- TEXT DEMAND is structural capacity the template expects beyond its repeating body items. Prefer the LOWEST unsupported text demand inside the tightest capacity band, or the image model will have to invent or duplicate text to fill the template.',
        '- Never prefer an oversized or higher-text-demand reference merely because its composition is attractive.',
      ]
    : [];

  return [
    'You are a designer for DGIPR Maharashtra (Directorate General of Information & Public Relations).',
    "You are given the exact information an officer wants shown on a poster, and the department's library of poster reference templates.",
    'Choose the ONE reference that can DISPLAY THIS INFORMATION BEST.',
    '',
    'THE INFORMATION IS THE POSTER. Everything the officer wrote is meant to appear on it. Your choice must not force any of it to be left out.',
    '',
    'STAGE 0 — COUNT.',
    '- Count the distinct items of information: the separate points, instructions, measures, facts or list entries the officer wants shown.',
    '- Count what is there. Do not merge two points into one, do not split one point into two, and do not judge whether a point is important enough to keep — that is not your decision.',
    '- A heading, a title line or an introductory sentence that frames the rest is NOT one of the items; the points under it are.',
    '- Report this number as "item_count".',
    '',
    'STAGE 1 — CAPACITY (a hard rule, not a preference).',
    '- A reference whose CAPACITY is smaller than item_count CANNOT be chosen. It has nowhere to put the remaining points, and they would be dropped.',
    '- Choose only from references whose capacity is item_count or more.',
    '- Prefer the SMALLEST capacity that still fits, so the poster is not mostly empty slots.',
    '- If item_count is 1 or 0, capacity does not apply — any reference may be chosen.',
    ...strictStructure,
    '',
    'STAGE 2 — PRESENTATION (chooses only among structurally compatible references).',
    '- Pick the arrangement that suits THIS SHAPE of information: whether it is a set of parallel points, a quotation with a named speaker, a sequence of dates, figures or amounts, an instruction list, or a single announcement.',
    '- A reference with a photograph area suits information about an event, place, people or a built thing; a text-only reference suits an advisory, a rule list or a plain statement. Judge this from the information, not as a rule.',
    '',
    'IF NO REFERENCE IS BIG ENOUGH:',
    '- Choose the one with the LARGEST capacity, and still report the true item_count. Never reduce item_count to make a reference fit.',
    '',
    'NEVER choose a reference because its existing placeholder content is about the same topic as this information. The topic of the reference is irrelevant — its placeholder text will be replaced entirely, and the design will be restyled to suit this information. Choosing a same-topic reference that cannot hold every point is a serious error.',
    'NEVER choose on tone, mood or colour, and never because a reference is visually attractive.',
    ...variety,
    '',
    'Also return a short Marathi (Devanagari) working title for the post, taken from the information. Never invent a name, figure or date that is not in it.',
    '',
    'Respond with STRICT JSON only: {"item_count": <integer>, "index": <one of the candidate indices>, "title": "<short Marathi title>", "reason": "<one short English sentence: the item count and why this reference holds it>"}.',
    '',
    'Reference templates:',
    ...lines,
  ].join('\n');
}

function parseJson(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start !== -1 && end > start) {
      return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
    }
    throw new Error(
      `Reference ranker did not return JSON: ${raw.slice(0, 400)}`,
    );
  }
}

// Count the information's items and rank every candidate against it. Returns the model's
// preference, or null when ranking could not produce a usable answer (the caller then falls back
// to the seeded hash pick). Never throws for a model slip — a bad read must not sink a render.
//
// The capacity gate is NOT applied here: this returns what the model chose, and
// selectReferenceByInformation enforces the rule over it. Keeping the two apart is what makes
// the enforcement testable without a model call.
export async function rankReferenceByInformation(
  note: string,
  candidates: readonly InformationCandidate[],
  options: Readonly<{
    ignoreColour?: boolean | undefined;
    // Master ids the last few runs used. A PREFERENCE handed to the model, never a filter —
    // see the recency note in the module header.
    recentIds?: readonly string[] | undefined;
    // Social creative only: the deterministic source shape which the model may use but never
    // override. The code applies the same rule after the response.
    strictSourceShape?: InformationShape | undefined;
  }> = {},
): Promise<InformationRanking | null> {
  const trimmed = note.trim();
  if (trimmed.length === 0 || candidates.length === 0) return null;

  const indices = candidates.map((_, i) => i);
  const recent = new Set(options.recentIds ?? []);
  const recentIndices = indices.filter((i) =>
    recent.has((candidates[i] as InformationCandidate).id),
  );
  try {
    const raw = await chatComplete(
      [
        {
          role: 'system',
          content: buildSystemPrompt(
            candidates,
            options.ignoreColour === true,
            recentIndices,
            options.strictSourceShape,
          ),
        },
        {
          role: 'user',
          content: `Information to show on the poster:\n${trimmed.slice(0, NOTE_MAX_CHARS)}`,
        },
      ],
      {
        // This is the DECISIVE routing call on the social path — it replaces the classifier,
        // and the reference it picks determines the poster's whole information structure. It
        // therefore inherits the classifier's authoring tier and deliberation rather than the
        // utility tier rank-master.ts uses for a tie-break inside an already-filtered band.
        // maxTokens is the ANSWER budget; reasoning gets its own headroom in openai-chat.ts.
        model: POSTER_COPY_MODEL,
        reasoningEffort: 'medium',
        maxTokens: 400,
        jsonSchema: {
          name: 'reference_selection',
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              item_count: { type: 'integer' },
              index: { type: 'integer', enum: indices },
              title: { type: 'string' },
              reason: { type: 'string' },
            },
            required: ['item_count', 'index', 'title', 'reason'],
          },
        },
      },
    );
    const parsed = parseJson(raw);
    const index = Number(parsed.index);
    if (!Number.isInteger(index) || index < 0 || index >= candidates.length) {
      return null;
    }
    const rawCount = Number(parsed.item_count);
    // A miscount must degrade to "no gate", never to an empty pool: 0 disables the gate below.
    const itemCount =
      Number.isFinite(rawCount) && rawCount > 0
        ? Math.min(MAX_ITEM_COUNT, Math.round(rawCount))
        : 0;
    return {
      id: (candidates[index] as InformationCandidate).id,
      itemCount,
      title: typeof parsed.title === 'string' ? parsed.title : '',
      reason: typeof parsed.reason === 'string' ? parsed.reason : '',
    };
  } catch (error) {
    console.warn(
      '[select-by-information] ranking failed (falling back to seeded pick):',
      error,
    );
    return null;
  }
}

// Enforce the capacity gate over the model's preference. Pure and synchronous, so the rule that
// actually protects the officer's content is testable for free.
//
// Returns the id to use plus, when the library simply cannot hold the information, the
// shortfall to report. `preferredId` is honoured whenever it is eligible — the model chose it
// on presentation fit, which this function has no way to judge.
export function enforceCapacity<T extends { id: string; bulletSlots: number }>(
  candidates: readonly T[],
  preferredId: string,
  itemCount: number,
  // Tie-break seed, so an otherwise-equal correction is reproducible across a retry.
  seed: string,
): { id: string; shortfall: SlotShortfall | null; corrected: boolean } {
  const preferred = candidates.find((c) => c.id === preferredId);
  if (!preferred || itemCount < MIN_GATED_ITEMS) {
    return { id: preferredId, shortfall: null, corrected: false };
  }
  if (preferred.bulletSlots >= itemCount) {
    return { id: preferredId, shortfall: null, corrected: false };
  }

  // The model picked something that cannot hold the content. Take the TIGHTEST reference that
  // can — the smallest capacity at or above the count, so the poster is not mostly empty slots.
  const eligible = candidates.filter((c) => c.bulletSlots >= itemCount);
  if (eligible.length > 0) {
    const tightest = Math.min(...eligible.map((c) => c.bulletSlots));
    const band = eligible.filter((c) => c.bulletSlots === tightest);
    const chosen = band[hashString(seed) % band.length] as T;
    return { id: chosen.id, shortfall: null, corrected: true };
  }

  // Nothing in the library is big enough. Take the largest and report the gap: the image prompt
  // is told to extend the item pattern rather than drop anything, and the officer is warned.
  const largest = Math.max(...candidates.map((c) => c.bulletSlots));
  const band = candidates.filter((c) => c.bulletSlots === largest);
  const chosen = band[hashString(seed) % band.length] as T;
  return {
    id: chosen.id,
    shortfall: { needed: itemCount, available: largest },
    corrected: chosen.id !== preferredId,
  };
}

type StrictStructureCandidate = Readonly<{
  id: string;
  bulletSlots: number;
  headlineSlots: number;
  auxiliaryTextSlots: number;
}>;

function unsupportedTextDemand(
  candidate: StrictStructureCandidate,
  shape: InformationShape,
): number {
  const supportedHeadlines = shape.hasExplicitHeadline ? 1 : 0;
  return (
    Math.max(0, candidate.headlineSlots - supportedHeadlines) +
    candidate.auxiliaryTextSlots
  );
}

// Strict-source social selection. Unlike enforceCapacity, this does not merely reject a master
// that is too small: it also rejects an unnecessarily LARGE master and one whose extra text
// roles are unsupported. Both create empty semantic slots which the image model fills by
// inventing a heading or repeating facts. The model's preference survives only inside the
// deterministic best-fit band.
export function enforceSourceStructure<T extends StrictStructureCandidate>(
  candidates: readonly T[],
  preferredId: string,
  shape: InformationShape,
  seed: string,
): { id: string; shortfall: SlotShortfall | null; corrected: boolean } {
  if (candidates.length === 0) {
    return { id: preferredId, shortfall: null, corrected: false };
  }
  if (shape.itemCount <= 0) {
    const preferred = candidates.find(
      (candidate) => candidate.id === preferredId,
    );
    const chosen =
      preferred ?? (candidates[hashString(seed) % candidates.length] as T);
    return {
      id: chosen.id,
      shortfall: null,
      corrected: chosen.id !== preferredId,
    };
  }

  // bulletSlots=0 means a single-message/quotation layout, not zero usable content. It is a
  // valid tight fit for one source unit, but never for a multi-item note.
  const capacityOf = (candidate: T) => Math.max(1, candidate.bulletSlots);
  const largeEnough = candidates.filter(
    (candidate) => capacityOf(candidate) >= shape.itemCount,
  );
  const capacityBand =
    largeEnough.length > 0
      ? (() => {
          const tightest = Math.min(...largeEnough.map(capacityOf));
          return largeEnough.filter(
            (candidate) => capacityOf(candidate) === tightest,
          );
        })()
      : (() => {
          const largest = Math.max(...candidates.map(capacityOf));
          return candidates.filter(
            (candidate) => capacityOf(candidate) === largest,
          );
        })();

  const leastTextDemand = Math.min(
    ...capacityBand.map((candidate) => unsupportedTextDemand(candidate, shape)),
  );
  const bestBand = capacityBand.filter(
    (candidate) => unsupportedTextDemand(candidate, shape) === leastTextDemand,
  );
  const preferred = bestBand.find((candidate) => candidate.id === preferredId);
  const chosen =
    preferred ?? (bestBand[hashString(seed) % bestBand.length] as T);
  const largestAvailable = Math.max(...candidates.map(capacityOf));
  const shortfall =
    largeEnough.length === 0
      ? { needed: shape.itemCount, available: largestAvailable }
      : null;

  return {
    id: chosen.id,
    shortfall,
    corrected: chosen.id !== preferredId,
  };
}

// A candidate the ranker can reason over: it must already carry vision-derived summaries (a
// null-spec master has nothing to match on, so it is invisible to selection — which is why one
// un-analysed master is warmed per run below, filling the library over time).
function candidateFor(
  image: ReferenceImageRow,
  typeLabelFor: (image: ReferenceImageRow) => string,
): InformationCandidate | null {
  const spec = image.layoutSpec;
  if (!spec) return null;
  if (!spec.layoutSummary && !spec.contentSummary) return null;
  const textRoles = referenceTextRoles(spec.layoutSummary);
  return {
    id: image.id,
    typeLabel: typeLabelFor(image),
    layoutSummary: spec.layoutSummary,
    hasPhotoZone: spec.hasPhotoZone,
    bulletSlots: spec.bulletSlots,
    ...textRoles,
  };
}

// Choose ONE reference for this information from a pool spanning every enabled type of the brand.
//
// At most ONE vision analysis is spent per call, exactly as select-master.ts does it: the picked
// master is analysed if it has no spec (so the prompt gets real structure); otherwise one other
// un-analysed image is warmed opportunistically, so an un-described library becomes rankable over
// successive runs instead of needing a bulk backfill first.
export async function selectReferenceByInformation(
  client: SupabaseClient,
  images: readonly ReferenceImageRow[],
  // Names the type each image belongs to, for the candidate lines.
  typeLabelFor: (image: ReferenceImageRow) => string,
  // Seed for the deterministic fallback pick (the generation id) — a retry re-renders the same
  // template rather than rolling a new one.
  seed: string,
  note: string,
  // Master ids used by the last few runs of this brand (across-run variety). Best-effort,
  // in-process on the caller's side. NOT a filter on the ranked pool — it reaches the model as a
  // lowest-priority tie-break between equally capable references, and only narrows the SEEDED
  // fallback pick. See the recency note in the module header for why.
  avoidIds?: readonly string[],
  options: Readonly<{
    ignoreColour?: boolean | undefined;
    // Social creative's "the input IS the poster" contract. Kept opt-in because this selector is
    // also reused by YouTube thumbnails, whose short marketing-message shape is different.
    strictSourceText?: boolean | undefined;
  }> = {},
): Promise<SelectedByInformation> {
  if (images.length === 0) {
    throw new Error(
      'selectReferenceByInformation called with no enabled images.',
    );
  }

  // Deterministic ordering (newest first) so the seeded fallback and the candidate indices are
  // stable across calls. THE RANKED POOL IS ALWAYS THE WHOLE LIBRARY — recency must not remove a
  // master before capacity has been considered, or the one reference big enough for this note
  // disappears exactly when it is used twice running.
  const pool = [...images].sort((a, b) =>
    a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0,
  );
  const reasonPrefix = `${options.strictSourceText ? 'source-structure-first' : 'capacity-first'} (pool=${pool.length})`;

  // The seeded fallback keeps the old spread behaviour: no reasoning happens on that path, so
  // across-run variety is free there and costs nothing correct.
  let fallbackPool = pool;
  let fallbackNote = 'seeded';
  if (avoidIds && avoidIds.length > 0) {
    const avoid = new Set(avoidIds);
    const spread = pool.filter((image) => !avoid.has(image.id));
    if (spread.length > 0 && spread.length < pool.length) {
      fallbackPool = spread;
      fallbackNote = `seeded +spread(-${avoid.size})`;
    }
  }

  let picked = fallbackPool[
    hashString(seed) % fallbackPool.length
  ] as ReferenceImageRow;
  let pickMethod = fallbackNote;
  let title: string | null = null;
  let itemCount: number | null = null;
  let shortfall: SlotShortfall | null = null;
  let rankingApplied = false;

  const candidates = pool
    .map((image) => candidateFor(image, typeLabelFor))
    .filter((c): c is InformationCandidate => c !== null);
  const strictShape = options.strictSourceText
    ? analyzeInformationShape(note)
    : null;

  // Establish a structurally safe fallback BEFORE the model call. Ranking is best-effort, so a
  // timeout or malformed answer must not restore the old random-template behaviour and make the
  // exact same note depend on whether the model happened to answer.
  if (strictShape && candidates.length > 0) {
    const fallbackCandidate =
      candidates.find((candidate) => candidate.id === picked.id) ??
      (candidates[
        hashString(seed) % candidates.length
      ] as InformationCandidate);
    const fallbackVerdict = enforceSourceStructure(
      candidates,
      fallbackCandidate.id,
      strictShape,
      seed,
    );
    const match = pool.find((image) => image.id === fallbackVerdict.id);
    if (match) {
      picked = match;
      itemCount = strictShape.itemCount;
      shortfall = fallbackVerdict.shortfall;
      pickMethod = `${fallbackNote} + strict-source fallback (items=${strictShape.itemCount})`;
    }
  }

  // With fewer than two described references there is nothing to compare, so the model call
  // would only be a rubber stamp on a pool of one.
  if (candidates.length >= 2) {
    const ranked = await rankReferenceByInformation(note, candidates, {
      ignoreColour: options.ignoreColour,
      recentIds: avoidIds,
      strictSourceShape: strictShape ?? undefined,
    });
    if (ranked) {
      // The model's answer is a preference; this is the rule.
      const verdict = strictShape
        ? enforceSourceStructure(candidates, ranked.id, strictShape, seed)
        : enforceCapacity(candidates, ranked.id, ranked.itemCount, seed);
      const match = pool.find((img) => img.id === verdict.id);
      if (match) {
        rankingApplied = true;
        picked = match;
        const effectiveItemCount = strictShape?.itemCount ?? ranked.itemCount;
        itemCount = effectiveItemCount > 0 ? effectiveItemCount : null;
        shortfall = verdict.shortfall;
        const fixed = verdict.corrected
          ? strictShape
            ? ' [source-structure-corrected]'
            : ' [capacity-corrected]'
          : '';
        const gap = shortfall
          ? ` [SHORTFALL — ${shortfall.needed} items, largest reference shows ${shortfall.available}]`
          : '';
        pickMethod = `information-ranked${fixed}${gap} (items=${effectiveItemCount}; ${ranked.reason})`;
        title = ranked.title.trim() === '' ? null : ranked.title.trim();
        if (verdict.corrected) {
          console.warn(
            strictShape
              ? '[select-by-information] the ranked reference did not match the exact source ' +
                  `structure (${strictShape.itemCount} item(s), headline=${strictShape.hasExplicitHeadline}); ` +
                  `corrected to ${picked.storagePath}.`
              : '[select-by-information] the ranked reference could not hold ' +
                  `${ranked.itemCount} item(s); corrected to ${picked.storagePath}.`,
          );
        }
        if (shortfall) {
          console.warn(
            `[select-by-information] NO reference can show ${shortfall.needed} items ` +
              `(largest shows ${shortfall.available}); rendering into ${picked.storagePath} ` +
              'with an instruction to extend its item pattern. Consider adding a larger master.',
          );
        }
      }
    }
  }

  // A failed/skipped rank can still leave the deterministic fallback in a shortfall. Report it
  // once here as well; the ranked branch reports the same condition above.
  if (strictShape && shortfall && !rankingApplied) {
    console.warn(
      `[select-by-information] NO structurally described reference can show ${shortfall.needed} items ` +
        `(largest shows ${shortfall.available}); rendering into ${picked.storagePath} ` +
        'with an instruction to extend its item pattern. Consider adding a larger master.',
    );
  }

  let layoutSpec = picked.layoutSpec;
  let analysisSpent = false;
  if (!layoutSpec) {
    layoutSpec = await analyzeAndPersist(client, picked);
    analysisSpent = true;
  }
  if (!analysisSpent) {
    const stale = pool.find((img) => img.id !== picked.id && !img.layoutSpec);
    if (stale) await analyzeAndPersist(client, stale);
  }

  return {
    master: {
      id: picked.id,
      url: publicUrl(client, picked.storagePath),
      layoutSpec,
      reason: `${reasonPrefix} → ${pickMethod} → ${picked.storagePath}`,
    },
    title,
    itemCount,
    shortfall,
  };
}

// --- CLI harness -----------------------------------------------------------
//   tsx src/references/select-by-information.ts            (free — the capacity gate only)
//   tsx --env-file=../../.env src/references/select-by-information.ts --live   (cents)
//
// The FREE half asserts enforceCapacity, which is the rule that actually protects the officer's
// content: the model may prefer whatever it likes, but a reference that cannot show every item
// must never survive. The LIVE half asserts the model's own behaviour on the case this rewrite
// exists for — a mosquito note with seven points must NOT land on the three-slot dengue master.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const makeCandidate = (
    input: Omit<InformationCandidate, 'headlineSlots' | 'auxiliaryTextSlots'>,
  ): InformationCandidate => ({
    ...input,
    ...referenceTextRoles(input.layoutSummary),
  });
  const CANDIDATES: InformationCandidate[] = [
    makeCandidate({
      id: 'alert-storm',
      typeLabel: 'सूचना / इशारा',
      hasPhotoZone: true,
      bulletSlots: 5,
      layoutSummary:
        'A large stacked headline over a full-bleed sky image, a warning strip, and five advisory cards below.',
    }),
    makeCandidate({
      id: 'quote-leader',
      typeLabel: 'वक्तव्य',
      hasPhotoZone: true,
      bulletSlots: 0,
      layoutSummary:
        'A single large quotation block with an attribution line and a portrait at the lower right; no repeating list.',
    }),
    makeCandidate({
      id: 'health-stats',
      typeLabel: 'माहिती',
      hasPhotoZone: true,
      bulletSlots: 4,
      layoutSummary:
        'A headline on a panel, four stat callouts with figures and short labels, a facility photo zone on the right, and a footer call-to-action.',
    }),
    makeCandidate({
      // The old design's winner: the mosquito note's TOPIC match, and far too small for it.
      id: 'dengue-mosquito',
      typeLabel: 'Information about insects, reptiles, animals, etc',
      hasPhotoZone: true,
      bulletSlots: 3,
      layoutSummary:
        'A large stylised headline across the upper content area, a circular illustration of the insect, and three short explanatory callouts joined by arrows.',
    }),
    makeCandidate({
      // The correct winner for a seven-point note: big enough, and the tightest such fit.
      id: 'points-seven',
      typeLabel: 'माहिती',
      hasPhotoZone: true,
      bulletSlots: 7,
      layoutSummary:
        'A headline band above seven numbered rows, each a short line of text with a small leading icon, over a plain ground.',
    }),
    makeCandidate({
      id: 'points-twelve',
      typeLabel: 'माहिती',
      hasPhotoZone: false,
      bulletSlots: 12,
      layoutSummary:
        'A dense two-column checklist of twelve compact rows under a narrow heading strip; text-only.',
    }),
  ];

  const failures: string[] = [];
  const check = (ok: boolean, label: string, got: unknown) => {
    console.log(
      `${ok ? 'PASS' : 'FAIL'}  ${label}\n      ${JSON.stringify(got)}`,
    );
    if (!ok) failures.push(label);
  };

  // --- free: the capacity gate ---------------------------------------------
  const tooSmall = enforceCapacity(CANDIDATES, 'dengue-mosquito', 7, 'seed-a');
  check(
    tooSmall.id === 'points-seven' && tooSmall.corrected && !tooSmall.shortfall,
    'a topic-matched but too-small pick is corrected to the tightest reference that fits',
    tooSmall,
  );

  const fits = enforceCapacity(CANDIDATES, 'points-twelve', 7, 'seed-a');
  check(
    fits.id === 'points-twelve' && !fits.corrected,
    'an eligible pick is honoured even when a tighter one exists (presentation is the model’s call)',
    fits,
  );

  const short = enforceCapacity(CANDIDATES, 'dengue-mosquito', 20, 'seed-a');
  check(
    short.id === 'points-twelve' &&
      short.shortfall?.needed === 20 &&
      short.shortfall.available === 12,
    'when nothing is big enough the largest is used and the shortfall is reported',
    short,
  );

  const ungated = enforceCapacity(CANDIDATES, 'quote-leader', 1, 'seed-a');
  check(
    ungated.id === 'quote-leader' && !ungated.corrected,
    'a single-item note is not gated, so a 0-slot quotation layout stays selectable',
    ungated,
  );

  const uncounted = enforceCapacity(CANDIDATES, 'dengue-mosquito', 0, 'seed-a');
  check(
    uncounted.id === 'dengue-mosquito' && !uncounted.corrected,
    'a failed count disables the gate rather than emptying the pool',
    uncounted,
  );

  const exact = enforceCapacity(CANDIDATES, 'health-stats', 4, 'seed-a');
  check(
    exact.id === 'health-stats' && !exact.corrected,
    'a reference with exactly enough slots is eligible (>=, not >)',
    exact,
  );

  const deterministic =
    enforceCapacity(CANDIDATES, 'dengue-mosquito', 7, 'seed-b').id ===
    enforceCapacity(CANDIDATES, 'dengue-mosquito', 7, 'seed-b').id;
  check(
    deterministic,
    'the correction is deterministic for one seed',
    deterministic,
  );

  // --- free: strict source-shape gate --------------------------------------
  // The exact note from generations d547… and 3d068…. It has seven sentences and NO explicit
  // headline. An LLM used to split those sentences into a variable number of semantic facts,
  // which made the same note select materially different templates.
  const DEVELOPMENT_NOTE = [
    'स्थानिक स्वराज्य संस्थांमधील विकासकामांच्या दर्जावर, अचूकतेवर आणि वेळेत पूर्णत्वावर आता कृत्रिम बुद्धिमत्ता व जिओ-टॅगिंगच्या माध्यमातून प्रभावी नजर ठेवली जाणार आहे.',
    'कृत्रिम बुद्धिमत्ता व जीआयएस मॅपिंगच्या सहाय्याने कामांची गुणवत्ता आणि अचूकता तपासून लेखापरीक्षण अधिक पारदर्शक केले जाईल. जिओ-टॅगिंगमुळे प्रत्यक्ष कामांच्या प्रगतीवर ऑनलाइन देखरेख शक्य होईल.',
    'या प्रक्रियेत सरकारी अधिकारी, नागरिक, तांत्रिक तज्ज्ञ आणि लोकप्रतिनिधी यांचा सहभाग राहील. स्थापन समिती १ महिन्याच्या आत शासनाला अहवाल सादर करेल.',
    'सामाजिक लेखापरीक्षणातून विकासकामांचा नागरिकांना होणारा प्रत्यक्ष लाभ व समाजावरील परिणाम अभ्यासला जाईल. सुरू असलेली आणि प्रस्तावित कामे गुणवत्तापूर्वक व मुदतीत पूर्ण व्हावीत, यासाठी ठोस उपाययोजना करण्यात येतील.',
  ].join('\n\n');
  const developmentShape = analyzeInformationShape(DEVELOPMENT_NOTE);
  check(
    developmentShape.itemCount === 7 && !developmentShape.hasExplicitHeadline,
    'the observed prose input has one stable seven-item shape and no invented headline slot',
    developmentShape,
  );

  const STRICT_CANDIDATES = [
    makeCandidate({
      id: 'source-seven',
      typeLabel: 'माहिती',
      hasPhotoZone: true,
      bulletSlots: 7,
      layoutSummary:
        'A single headline sits above three advisory cards on the left and four quick-action rows along the bottom, with an illustration on the right.',
    }),
    makeCandidate({
      id: 'labelled-seven',
      typeLabel: 'माहिती',
      hasPhotoZone: true,
      bulletSlots: 7,
      layoutSummary:
        'A headline below a small label and explanatory subheadline, with three cards on the left and four rows on the right, followed by a QR-code registration call-to-action and contact line.',
    }),
    makeCandidate({
      id: 'duplicate-twelve',
      typeLabel: 'माहिती',
      hasPhotoZone: true,
      bulletSlots: 12,
      layoutSummary:
        'A headline above two titled section headings and two lists, followed by a summary call-to-action.',
    }),
  ];
  const strictCorrection = enforceSourceStructure(
    STRICT_CANDIDATES,
    'duplicate-twelve',
    developmentShape,
    'development-note',
  );
  check(
    strictCorrection.id === 'source-seven' && strictCorrection.corrected,
    'an oversized two-section preference is corrected to the exact seven-slot low-text master',
    strictCorrection,
  );
  const riskyExactCorrection = enforceSourceStructure(
    STRICT_CANDIDATES,
    'labelled-seven',
    developmentShape,
    'development-note',
  );
  check(
    riskyExactCorrection.id === 'source-seven' &&
      riskyExactCorrection.corrected,
    'equal capacity cannot beat a template that needs less unsupported auxiliary text',
    riskyExactCorrection,
  );

  const LIST_NOTE = [
    'नागरिकांसाठी महत्त्वाच्या सूचना:',
    '१. पहिली सूचना.',
    '२. दुसरी सूचना.',
    '३. तिसरी सूचना.',
  ].join('\n');
  const listShape = analyzeInformationShape(LIST_NOTE);
  check(
    listShape.itemCount === 3 && listShape.hasExplicitHeadline,
    'an explicit list heading is recognised without being counted as a body item',
    listShape,
  );

  // --- live: the model's own counting + choosing ----------------------------
  const live = process.argv.includes('--live');
  const MOSQUITO_NOTE = [
    'डेंग्यू प्रतिबंधासाठी नागरिकांनी पुढील उपाययोजना कराव्यात:',
    '१. घराभोवती साचलेले स्वच्छ पाणी आठवड्यातून एकदा रिकामे करावे.',
    '२. पाण्याच्या टाक्या व भांडी घट्ट झाकून ठेवावीत.',
    '३. कुलर व फ्रिजच्या ट्रेमधील पाणी नियमित बदलावे.',
    '४. घराभोवतीचे टायर, नारळाच्या करवंट्या व भंगार हटवावे.',
    '५. दिवसा झोपताना मच्छरदाणीचा वापर करावा.',
    '६. ताप आल्यास तात्काळ जवळच्या शासकीय रुग्णालयात तपासणी करावी.',
    '७. स्वतःच्या मनाने औषध घेऊ नये.',
  ].join('\n');

  void (async () => {
    if (live) {
      const ranked = await rankReferenceByInformation(
        MOSQUITO_NOTE,
        CANDIDATES,
      );
      check(
        ranked !== null && ranked.itemCount === 7,
        'the model counts the officer’s seven points',
        ranked,
      );
      check(
        ranked !== null && ranked.id !== 'dengue-mosquito',
        'topic no longer beats capacity (the 3-slot dengue master is NOT chosen)',
        ranked?.id,
      );
      check(
        ranked !== null &&
          (CANDIDATES.find((c) => c.id === ranked.id)?.bulletSlots ?? 0) >= 7,
        'the model’s own pick already satisfies the capacity rule',
        ranked?.id,
      );
    } else {
      console.log(
        '\n(skipping live model checks — pass --live with --env-file to run them)',
      );
    }

    if (failures.length > 0) {
      console.error(`\n${failures.length} check(s) failed.`);
      process.exitCode = 1;
    } else {
      console.log('\nAll checks passed.');
    }
  })().catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  });
}
