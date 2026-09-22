// Phase 5 of the Gemma distillation plan: the three-arm measurement on the held-out set.
//
//   base    — today's behaviour, the stock endpoint model            (lane 'default')
//   tuned   — the fine-tuned LoRA adapter named by GEMMA_DLO_MODEL   (lane 'dlo')
//   teacher — the captured target, i.e. the ceiling the student was distilled toward
//
// It reuses the graders that already exist rather than inventing metrics: eval-model.ts's
// Marathi 1-5 style judge, and `findUnsupportedClaims` as a read-only faithfulness counter —
// the pairing compare-article-modes.ts uses. The third gate is deterministic and is the one
// piece of new measurement, for a reason stated at `ungroundedNumerals` below.
//
// THE GOVERNING RULE, inherited from the capture: the prompt an arm answers is the prompt
// production sends. On the text path that is literally the captured user turn, byte for byte.
// On the image path it is rebuilt by `buildDloArticleUserPrompt` — never edited by hand — so
// the two paths differ in exactly one thing, which is the thing being measured.
//
// Free, no network, no spend:
//   npx tsx src/finetune/eval-dlo-distillation.ts --check
//
// Plan only (reads the dataset, probes the endpoint's model list, spends nothing):
//   pnpm --filter @dgipr/content-engine finetune:eval
//
// Measure (spends):
//   pnpm --filter @dgipr/content-engine finetune:eval -- --run --arms=base,teacher
//   pnpm --filter @dgipr/content-engine finetune:eval -- --run   # once the adapter is served
//
// On this dev machine every OpenAI call needs NODE_OPTIONS=--use-system-ca; Kaspersky
// re-signs api.openai.com and without it the judge dies as `TypeError: fetch failed`.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import {
  DLO_UPLOADS_BUCKET,
  createServiceRoleClient,
  downloadFile,
  getDloIntake,
  type SupabaseClient,
} from '@dgipr/database';
import {
  createCostAccumulator,
  runInCostScope,
  totalCostUsd,
  type CostAccumulator,
} from '../cost/cost-meter.js';
import type { DesignationPair } from '../generation/category-prompt.js';
import {
  DLO_SOURCE_FILES_MARKER,
  buildDloArticleUserPrompt,
} from '../generation/dlo-article-prompt.js';
import { splitContent } from '../generation/generate-article.js';
import {
  gemmaBaseUrl,
  gemmaDloModel,
  gemmaModel,
  gemmaModelFor,
  isGemmaConfigured,
  listGemmaModels,
  respondWithSourcesViaGemma,
  type GemmaLane,
  type SourceDocument,
  type SourceDocumentKind,
} from '../generation/gemma-sources.js';
import {
  ARTICLE_BODY_MAX_TOKENS,
  CHAT_MODEL,
  chatComplete,
  type ChatMessage,
} from '../generation/openai-chat.js';
import { findUnsupportedClaims } from '../generation/verify-coverage.js';
import { keyPointIsGrounded } from '../video/video-key-point.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DATA_DIR = resolve(HERE, '../../data/finetune/distill');

export const EVAL_FORMAT_VERSION = 'dlo-distill-eval-v1';

/** The three arms. `teacher` is read off the captured pair and never regenerated. */
export const ARM_NAMES = ['base', 'tuned', 'teacher'] as const;
export type ArmName = (typeof ARM_NAMES)[number];

/** Which delivery of the source an arm is being measured on. */
export type EvalPath = 'text' | 'image';

// ---------------------------------------------------------------------------------------
// Pure core. Everything down to the "paid layer" banner is exercised by `--check` with no
// database, no network and no spend — these are the functions that decide WHAT is measured,
// and a mistake in any of them produces a report that looks fine and says nothing true.
// ---------------------------------------------------------------------------------------

/**
 * The headings `buildDloArticleUserPrompt` emits, in the order it emits them.
 *
 * Splitting on them is how the grader gets the SOURCE INFORMATION alone. That matters more
 * than it looks: `findUnsupportedClaims` treats its second argument as the ONLY authoritative
 * fact source, so handing it the whole user turn would let the officer's own OFFICER REQUEST
 * text count as support for a claim — which is exactly the hallucination the gate exists to
 * catch. The designations are parsed back out for the same reason in reverse: without the
 * allow-block, every officer-approved पदनाम is counted as an unsupported claim, because an
 * approved designation is by definition absent from the note.
 */
// LEARNED EDITORIAL PREFERENCES is listed unconditionally even though it is only ever
// EMITTED under EDITORIAL_PREFERENCE_PLACEMENT=user (the default puts those rules in the
// system message, where this grader never looks). Listing it costs nothing when it is absent
// — the split only matches headings that actually occur — and omitting it would be a silent
// defect under that placement: an unlisted heading is folded into the section above it, so
// the standing rules would be read as part of REVIEWED NAMES AND DESIGNATIONS and, through
// it, counted as authoritative fact support for whatever the article then claims.
export const DLO_PROMPT_HEADINGS = [
  '### SOURCE INFORMATION',
  '### MAHASAMVAD STYLE REFERENCES',
  '### REVIEWED NAMES AND DESIGNATIONS',
  '### LEARNED EDITORIAL PREFERENCES',
  '### HEADLINE / ANGLE',
  '### OFFICER REQUEST',
] as const;

export type DloPromptSections = Readonly<{
  sourceInformation: string;
  styleReferences: string;
  designations: readonly DesignationPair[];
  heading: string;
  officerInstructions: string;
  /** False when the turn did not parse as this builder's output; the caller must not grade it. */
  ok: boolean;
  warnings: readonly string[];
}>;

/**
 * Split a captured user turn back into the fields it was built from.
 *
 * A heading only counts when it is the first line or is preceded by a blank one — the builder
 * always emits `'', '### X', '', body` — and when it comes later in the canonical order than
 * the previous one. Both guards exist because OCR'd Marathi source text can contain anything,
 * including a line that reads `### OFFICER REQUEST`, and a mis-split would silently move half
 * the source out of the grader's view.
 */
export function splitDloPrompt(userTurn: string): DloPromptSections {
  const lines = userTurn.split('\n');
  const buckets = new Map<string, string[]>();
  const warnings: string[] = [];
  let current: string | null = null;
  let lastIndex = -1;

  for (const [lineNo, line] of lines.entries()) {
    const trimmed = line.trim();
    const headingIndex = DLO_PROMPT_HEADINGS.indexOf(
      trimmed as (typeof DLO_PROMPT_HEADINGS)[number],
    );
    const framed = lineNo === 0 || (lines[lineNo - 1] ?? '').trim() === '';
    if (headingIndex !== -1 && headingIndex > lastIndex && framed) {
      lastIndex = headingIndex;
      current = trimmed;
      buckets.set(current, []);
      continue;
    }
    if (current === null) {
      if (trimmed.length > 0) warnings.push('text before the first heading');
      continue;
    }
    buckets.get(current)!.push(line);
  }

  const read = (heading: (typeof DLO_PROMPT_HEADINGS)[number]): string =>
    (buckets.get(heading) ?? []).join('\n').trim();

  const sourceInformation = read('### SOURCE INFORMATION');
  const designationLines = read('### REVIEWED NAMES AND DESIGNATIONS')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- '));
  const designations: DesignationPair[] = [];
  for (const line of designationLines) {
    const body = line.slice(2);
    const at = body.indexOf(' — ');
    if (at === -1) {
      warnings.push(`unparsed designation row: ${line}`);
      continue;
    }
    designations.push({
      name: body.slice(0, at).trim(),
      designation: body.slice(at + 3).trim(),
    });
  }

  if (sourceInformation.length === 0) {
    warnings.push('no SOURCE INFORMATION section');
  }

  return {
    sourceInformation,
    styleReferences: read('### MAHASAMVAD STYLE REFERENCES'),
    designations,
    heading: read('### HEADLINE / ANGLE'),
    officerInstructions: read('### OFFICER REQUEST'),
    ok: sourceInformation.length > 0 && warnings.length === 0,
    warnings,
  };
}

/** The `=== स्रोत: NAME ===` header `combineIntakeSources` writes above each document. */
const SOURCE_HEADER = /^=== स्रोत: (.+?) ===$/;

/**
 * Remove named documents' text from an assembled source, for the image path.
 *
 * On the /dlo text lane a document was OCR'd at intake and its characters were folded into
 * `generations.note` under that header. Attaching the same document as pixels WITHOUT taking
 * its text out would feed the source twice — neither the production path nor a control, and
 * the resulting article would look better than the image path really is.
 */
export function stripDocumentSections(
  source: string,
  names: readonly string[],
): { text: string; removed: string[]; kept: string[] } {
  const wanted = new Set(names);
  const lines = source.split('\n');
  const out: string[] = [];
  const removed: string[] = [];
  const kept: string[] = [];
  let dropping = false;

  for (const line of lines) {
    const match = SOURCE_HEADER.exec(line.trim());
    if (match) {
      const name = match[1]!.trim();
      dropping = wanted.has(name);
      (dropping ? removed : kept).push(name);
      if (dropping) continue;
    }
    if (!dropping) out.push(line);
  }

  return {
    text: out
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
    removed,
    kept,
  };
}

/**
 * Which intake file kinds are documents a vision model can be handed.
 *
 * The same mapping `apps/api/src/jobs/source-files.ts` makes on the gemma lane, restated here
 * because content-engine cannot import the API. `audio` and `youtube` are NOT documents: they
 * were transcribed at intake and their text is already in the source. Coercing an unknown kind
 * to `'pdf'` — which is what a `?? 'pdf'` fallback does — hands an .m4a to the PDF rasteriser,
 * whose failure `prepareGemmaSources` swallows into a warning, so the row runs the TEXT path
 * while the report calls it the image path. That is the one way this harness could lie.
 */
export function sourceDocumentKindOf(kind: string): SourceDocumentKind | null {
  switch (kind) {
    case 'pdf':
    case 'image':
    case 'docx':
    case 'txt':
      return kind;
    default:
      return null;
  }
}

const DEVANAGARI_ZERO = 0x0966;

export function toLatinDigits(text: string): string {
  return text.replace(
    /[०-९]/g,
    (digit) => `${digit.codePointAt(0)! - DEVANAGARI_ZERO}`,
  );
}

/** One script, and no digit-group separators, so ५००,००० and 500000 are the same number. */
export function normalizeNumerals(text: string): string {
  return toLatinDigits(text).replace(/(?<=\d),(?=\d)/g, '');
}

/**
 * An enumeration marker at the head of a line is not a factual claim.
 *
 * Measured on a real base-model answer, which appended English meta-commentary as a numbered
 * list and so "stated" the numbers 1-5 that its source did not contain. Writing a numbered
 * list in a DGIPR press article IS a defect, but it is a STYLE defect and the style judge
 * already scores it; letting it through here would make gate 3 report a fabricated figure
 * where there is none. Capped at two digits, so a year or an amount at a line start is never
 * mistaken for a marker.
 *
 * Applied to the ARTICLE only. Removing anything from the SOURCE could only manufacture
 * false positives, which is the one direction this check must never fail in.
 */
export function stripListMarkers(text: string): string {
  return text.replace(
    /^[ \t]*(?:[#>]+[ \t]*)?(?:[-*•][ \t]*)?\(?([०-९0-9]{1,2})\)?[.)][ \t]+/gm,
    '',
  );
}

export function numeralTokens(text: string): string[] {
  return normalizeNumerals(text).match(/\d+(?:\.\d+)*/g) ?? [];
}

/**
 * Every distinct number the article states that does not occur in the source.
 *
 * PRECISION, NOT RECALL, and the direction is the whole design. Requiring every source figure
 * to reappear in the article would penalise editorial selection, which this product treats as
 * a feature — "completeness is tiered, not total". The failure class the plan names is the
 * opposite one: `५०० कोटी` coming back as `४०० कोटी`, a number the article asserts and the
 * source does not contain.
 *
 * It exists BESIDE `findUnsupportedClaims` rather than inside it because that checker is an
 * LLM reading two Devanagari numerals and deciding whether they match, which is precisely the
 * comparison a language model is worst at. This one is arithmetic.
 *
 * The substring test is deliberately the lenient one `keyPointIsGrounded` already uses (`2` is
 * grounded by a source containing `2025`): a gate that cries wolf is worse than one that
 * misses, and `--check` asserts the two agree on integer-only text.
 */
export function ungroundedNumerals(
  article: string,
  source: string,
): { checked: string[]; ungrounded: string[] } {
  const haystack = normalizeNumerals(source);
  const seen = new Set<string>();
  const checked: string[] = [];
  const ungrounded: string[] = [];
  for (const token of numeralTokens(stripListMarkers(article))) {
    if (seen.has(token)) continue;
    seen.add(token);
    checked.push(token);
    if (!haystack.includes(token)) ungrounded.push(token);
  }
  return { checked, ungrounded };
}

/** The judge answers with one digit; Devanagari or Latin. Unreadable ⇒ the neutral 3. */
export function parseStyleScore(reply: string): number {
  const match = reply.match(/[1-5१-५]/);
  if (!match) return 3;
  const character = match[0]!;
  const devanagari = '१२३४५'.indexOf(character);
  return devanagari === -1 ? Number(character) : devanagari + 1;
}

// ---------------------------------------------------------------------------------------
// Results and gates
// ---------------------------------------------------------------------------------------

export type ArmResult = Readonly<{
  arm: ArmName;
  model: string;
  article: string;
  /** 5 for the teacher, which IS the judge's reference — see `styleByConstruction`. */
  styleScore: number;
  styleByConstruction: boolean;
  unsupportedClaims: readonly string[];
  numerals: Readonly<{
    checked: readonly string[];
    ungrounded: readonly string[];
  }>;
  error?: string;
}>;

export type ItemResult = Readonly<{
  id: string;
  dloIntakeId: string;
  category: string;
  lane: string;
  path: EvalPath;
  skipped?: string;
  attachedDocuments?: readonly string[];
  arms: Partial<Record<ArmName, ArmResult>>;
}>;

export type ArmSummary = Readonly<{
  n: number;
  meanStyle: number;
  meanUnsupported: number;
  numeralsChecked: number;
  numeralsUngrounded: number;
  ungroundedRate: number;
}>;

export type GateVerdict = Readonly<{
  comparable: number;
  base?: ArmSummary;
  tuned?: ArmSummary;
  teacher?: ArmSummary;
  styleWins: number;
  styleLosses: number;
  styleTies: number;
  styleGate: boolean;
  styleVerdict: 'improved' | 'tied' | 'regressed' | 'unmeasured';
  faithfulnessGate: boolean;
  numeralGate: boolean;
  allPassed: boolean;
  underpowered: boolean;
  lines: readonly string[];
}>;

function summarizeArm(
  results: readonly ItemResult[],
  arm: ArmName,
): ArmSummary | undefined {
  const rows = results
    .map((item) => item.arms[arm])
    .filter((row): row is ArmResult => Boolean(row) && !row!.error);
  if (rows.length === 0) return undefined;
  const checked = rows.reduce(
    (sum, row) => sum + row.numerals.checked.length,
    0,
  );
  const ungrounded = rows.reduce(
    (sum, row) => sum + row.numerals.ungrounded.length,
    0,
  );
  return {
    n: rows.length,
    meanStyle: rows.reduce((sum, row) => sum + row.styleScore, 0) / rows.length,
    meanUnsupported:
      rows.reduce((sum, row) => sum + row.unsupportedClaims.length, 0) /
      rows.length,
    numeralsChecked: checked,
    numeralsUngrounded: ungrounded,
    ungroundedRate: checked === 0 ? 0 : ungrounded / checked,
  };
}

/**
 * The plan's three gates, decided only on items where BOTH base and tuned produced an article.
 *
 * All three are RELATIVE, including the numeral one, and that is a calibration finding rather
 * than a softening: measured on the nine held-out targets, the TEACHER itself states 4 numbers
 * its own source does not contain (a year it supplied, a percentage it refined). An absolute
 * "zero ungrounded numerals" bar is one the ceiling does not clear, so it would say nothing
 * about the adapter. What a bad adapter would do is make the rate WORSE than the base's, and
 * that is what is gated.
 */
export function evaluateGates(results: readonly ItemResult[]): GateVerdict {
  const paired = results.filter(
    (item) =>
      item.arms.base &&
      !item.arms.base.error &&
      item.arms.tuned &&
      !item.arms.tuned.error,
  );

  const base = summarizeArm(results, 'base');
  const tuned = summarizeArm(results, 'tuned');
  const teacher = summarizeArm(results, 'teacher');

  let styleWins = 0;
  let styleLosses = 0;
  let styleTies = 0;
  for (const item of paired) {
    const a = item.arms.base!.styleScore;
    const b = item.arms.tuned!.styleScore;
    if (b > a) styleWins += 1;
    else if (b < a) styleLosses += 1;
    else styleTies += 1;
  }

  const lines: string[] = [];
  const fmt = (value: number, digits = 2): string => value.toFixed(digits);

  if (paired.length === 0 || !base || !tuned) {
    lines.push(
      'Not comparable: the gates need BOTH a base and a tuned article for at least one ' +
        'held-out item. Run with --arms=base,tuned once the adapter is served.',
    );
    return {
      comparable: 0,
      ...(base ? { base } : {}),
      ...(tuned ? { tuned } : {}),
      ...(teacher ? { teacher } : {}),
      styleWins,
      styleLosses,
      styleTies,
      styleGate: false,
      styleVerdict: 'unmeasured',
      faithfulnessGate: false,
      numeralGate: false,
      allPassed: false,
      underpowered: true,
      lines,
    };
  }

  const styleGate = tuned.meanStyle >= base.meanStyle;
  const styleVerdict: GateVerdict['styleVerdict'] =
    tuned.meanStyle > base.meanStyle
      ? 'improved'
      : tuned.meanStyle === base.meanStyle
        ? 'tied'
        : 'regressed';
  const faithfulnessGate = tuned.meanUnsupported <= base.meanUnsupported;
  const numeralGate = tuned.ungroundedRate <= base.ungroundedRate;
  const allPassed = styleGate && faithfulnessGate && numeralGate;
  const underpowered = paired.length < 5;

  lines.push(
    `Gate 1 style (1-5 vs the teacher, 5 = the teacher itself):  tuned ${fmt(
      tuned.meanStyle,
    )} vs base ${fmt(base.meanStyle)}  ->  ${styleGate ? 'PASS' : 'FAIL'} (${styleVerdict})`,
    `         gap to teacher: base ${fmt(5 - base.meanStyle)}  tuned ${fmt(
      5 - tuned.meanStyle,
    )}   per-item: ${styleWins} better / ${styleTies} same / ${styleLosses} worse`,
    `Gate 2 faithfulness (unsupported claims, fewer is better):  tuned ${fmt(
      tuned.meanUnsupported,
    )} vs base ${fmt(base.meanUnsupported)}  ->  ${
      faithfulnessGate ? 'PASS' : 'FAIL'
    }`,
    `Gate 3 numerals (stated but absent from the source):        tuned ${
      tuned.numeralsUngrounded
    }/${tuned.numeralsChecked} (${fmt(tuned.ungroundedRate * 100, 1)}%) vs base ${
      base.numeralsUngrounded
    }/${base.numeralsChecked} (${fmt(base.ungroundedRate * 100, 1)}%)  ->  ${
      numeralGate ? 'PASS' : 'FAIL'
    }`,
  );
  if (teacher) {
    lines.push(
      `         teacher reference: ${teacher.numeralsUngrounded}/${
        teacher.numeralsChecked
      } (${fmt(teacher.ungroundedRate * 100, 1)}%) ungrounded, ${fmt(
        teacher.meanUnsupported,
      )} unsupported claims`,
    );
  }
  if (underpowered) {
    lines.push(
      `         NOTE: only ${paired.length} comparable item(s). A 1-5 integer judge over so ` +
        'few items is a direction, not a measurement — read the per-item table.',
    );
  }

  return {
    comparable: paired.length,
    base,
    tuned,
    ...(teacher ? { teacher } : {}),
    styleWins,
    styleLosses,
    styleTies,
    styleGate,
    styleVerdict,
    faithfulnessGate,
    numeralGate,
    allPassed,
    underpowered,
    lines,
  };
}

// ---------------------------------------------------------------------------------------
// Paid layer: the judge and the arms.
// ---------------------------------------------------------------------------------------

/**
 * eval-model.ts's judge, re-worded for the DGIPR article rather than a Mahasamvad category.
 *
 * It is shown the two articles and NOT the source: it grades structure, tone, register and
 * length, never facts. Facts are gates 2 and 3's job, and letting one call decide both is how
 * a style score quietly becomes an accuracy score.
 */
export async function gradeStyle(
  reference: string,
  candidate: string,
): Promise<number> {
  const system = [
    'तुम्ही शासकीय बातमी/लेखाच्या मराठी संपादकीय शैलीचे कठोर परीक्षक आहात.',
    'खाली एक संदर्भ लेख आणि एक उमेदवार लेख आहे. उमेदवार लेख संदर्भ लेखाच्या संपादकीय',
    'शैलीशी — रचना, सूर, शासकीय शब्दकळा, परिच्छेद-मांडणी, शीर्षक/dateline पद्धत व लांबी —',
    'किती जुळतो ते १ ते ५ या स्केलवर ठरवा (५ = हुबेहूब तीच संपादकीय शैली, १ = पूर्ण वेगळी).',
    'तथ्ये बरोबर आहेत की नाहीत हे तपासू नका; फक्त शैली तपासा.',
    'उत्तरात फक्त एकच अंक (१-५) लिहा, दुसरे काहीही नको.',
  ].join('\n');
  const user = [
    '## संदर्भ लेख:',
    reference,
    '',
    '## उमेदवार लेख:',
    candidate,
    '',
    '## गुण (फक्त १-५ पैकी एक अंक):',
  ].join('\n');
  const reply = await chatComplete(
    [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    { maxTokens: 64, reasoningEffort: 'low' },
  );
  return parseStyleScore(reply);
}

type GradeInputs = Readonly<{
  reference: string;
  article: string;
  sections: DloPromptSections;
  /** The source the arm actually saw. On the image path the document text is not in it. */
  groundingSource: string;
  judge: boolean;
}>;

async function gradeArticle(
  inputs: GradeInputs,
): Promise<Omit<ArmResult, 'arm' | 'model'>> {
  const [styleScore, unsupportedClaims] = await Promise.all([
    inputs.judge
      ? gradeStyle(inputs.reference, inputs.article)
      : Promise.resolve(5),
    findUnsupportedClaims(
      inputs.article,
      inputs.sections.sourceInformation,
      inputs.sections.heading || undefined,
      inputs.sections.designations,
    ),
  ]);
  return {
    article: inputs.article,
    styleScore,
    styleByConstruction: !inputs.judge,
    unsupportedClaims,
    numerals: ungroundedNumerals(inputs.article, inputs.groundingSource),
  };
}

// ---------------------------------------------------------------------------------------
// Dataset loading
// ---------------------------------------------------------------------------------------

export type ManifestExample = Readonly<{
  id: string;
  split: string;
  group: string;
  dloIntakeId: string;
  lane: string;
  category: string;
  hasSourceFiles: boolean;
  tokens: number;
}>;

type LoadedItem = Readonly<{
  manifest: ManifestExample;
  messages: readonly ChatMessage[];
  sections: DloPromptSections;
  reference: string;
}>;

/**
 * Load each held-out example BY ID from its own pair file, not by position in eval.jsonl.
 *
 * `eval.jsonl` and the manifest's eval rows are written from the same array in the same order,
 * so a positional join happens to be correct today — and would keep looking correct after any
 * change to the dataset builder's sort, while grading every arm against a DIFFERENT example's
 * teacher article. There is no symptom for that: every score is a plausible number. So the
 * join is keyed, and eval.jsonl is then used only to CHECK the keyed load agrees with it.
 */
async function loadEvalItems(
  dataDir: string,
): Promise<{ items: LoadedItem[]; problems: string[] }> {
  const problems: string[] = [];
  const manifest = JSON.parse(
    await readFile(resolve(dataDir, 'split-manifest.json'), 'utf8'),
  ) as { formatVersion?: string; examples: ManifestExample[] };
  const evalRows = manifest.examples.filter((row) => row.split === 'eval');

  const items: LoadedItem[] = [];
  for (const row of evalRows) {
    const pairPath = resolve(dataDir, 'pairs', `${row.id.toLowerCase()}.jsonl`);
    let raw: string;
    try {
      raw = await readFile(pairPath, 'utf8');
    } catch {
      problems.push(`${row.id}: no pair file at ${pairPath}`);
      continue;
    }
    const pair = JSON.parse(raw.trim()) as { messages: ChatMessage[] };
    const user = pair.messages.find((message) => message.role === 'user');
    const assistant = pair.messages.find(
      (message) => message.role === 'assistant',
    );
    if (!user || !assistant) {
      problems.push(`${row.id}: pair is missing a user or assistant turn`);
      continue;
    }
    const sections = splitDloPrompt(user.content);
    if (!sections.ok) {
      problems.push(
        `${row.id}: prompt did not parse (${sections.warnings.join('; ')})`,
      );
      continue;
    }
    items.push({
      manifest: row,
      messages: pair.messages.filter((message) => message.role !== 'assistant'),
      sections,
      reference: assistant.content,
    });
  }

  // The cross-check the keyed load buys us: same count, same set of teacher articles.
  try {
    const written = (await readFile(resolve(dataDir, 'eval.jsonl'), 'utf8'))
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map(
        (line) =>
          (JSON.parse(line) as { messages: ChatMessage[] }).messages.find(
            (message) => message.role === 'assistant',
          )?.content ?? '',
      );
    const loaded = new Set(items.map((item) => item.reference));
    if (written.length !== evalRows.length) {
      problems.push(
        `eval.jsonl has ${written.length} lines but the manifest lists ${evalRows.length} eval rows`,
      );
    }
    for (const article of written) {
      if (!loaded.has(article)) {
        problems.push(
          'an article in eval.jsonl is not among the pair files loaded by id — ' +
            'the dataset and the pairs directory disagree',
        );
        break;
      }
    }
  } catch {
    problems.push('eval.jsonl could not be read for cross-checking');
  }

  return { items, problems };
}

// ---------------------------------------------------------------------------------------
// The image path
// ---------------------------------------------------------------------------------------

type ImagePlan =
  | Readonly<{
      ok: true;
      messages: ChatMessage[];
      documents: SourceDocument[];
      source: string;
      names: string[];
    }>
  | Readonly<{ ok: false; reason: string }>;

/**
 * Rebuild one item as the image-conditioned request production would send.
 *
 * Refuses in three cases rather than measuring something that is not the image path: the
 * intake carries no document-kind file at all (audio and YouTube were transcribed, and there
 * is nothing to show a vision model); the bytes cannot be read; or a document's text could not
 * be located in the source and removing it is therefore impossible, which would leave the
 * source fed twice.
 */
async function planImagePath(
  client: SupabaseClient,
  item: LoadedItem,
  download: boolean,
): Promise<ImagePlan> {
  const intake = await getDloIntake(client, item.manifest.dloIntakeId);
  if (!intake) return { ok: false, reason: 'intake row is gone' };

  const candidates = intake.files.filter(
    (file) =>
      sourceDocumentKindOf(file.kind) !== null &&
      file.status === 'done' &&
      Boolean(file.storagePath),
  );
  if (candidates.length === 0) {
    const kinds = [...new Set(intake.files.map((file) => file.kind))];
    return {
      ok: false,
      reason: `no document-kind source files (intake carries: ${kinds.join(', ') || 'nothing'})`,
    };
  }

  const stripped = stripDocumentSections(
    item.sections.sourceInformation,
    candidates.map((file) => file.name),
  );
  const missing = candidates
    .map((file) => file.name)
    .filter((name) => !stripped.removed.includes(name));
  if (missing.length > 0) {
    return {
      ok: false,
      reason:
        `the source carries no "=== स्रोत: ${missing[0]} ===" block, so its text cannot be ` +
        'removed; attaching the file as pixels would feed the same source twice',
    };
  }

  const documents: SourceDocument[] = [];
  for (const file of candidates) {
    const kind = sourceDocumentKindOf(file.kind)!;
    try {
      documents.push({
        name: file.name,
        kind,
        // Plan mode answers "can this row run the image path?" and must stay free, so the
        // bytes are fetched only when something is actually going to read them.
        data: download
          ? await downloadFile(client, DLO_UPLOADS_BUCKET, file.storagePath!)
          : Buffer.alloc(0),
      });
    } catch (error) {
      return {
        ok: false,
        reason: `could not read ${file.name} from storage: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }

  const user = buildDloArticleUserPrompt({
    sourceInformation: stripped.text,
    attachedSourceFiles: true,
    designations: item.sections.designations,
    heading: item.sections.heading || null,
    officerInstructions: item.sections.officerInstructions || null,
  });
  const system = item.messages.find((message) => message.role === 'system');

  return {
    ok: true,
    messages: [
      ...(system ? [system] : []),
      { role: 'user', content: user } as ChatMessage,
    ],
    documents,
    source: stripped.text,
    names: documents.map((document) => document.name),
  };
}

// ---------------------------------------------------------------------------------------
// Banking: a gemma generation is minutes of a rented GPU and a judge call is real money, so
// neither is ever paid for twice. The capture's `wx` discipline, one level down.
// ---------------------------------------------------------------------------------------

function bankKey(path: EvalPath, arm: ArmName, id: string): string {
  return `${path}-${arm}-${id.toLowerCase()}`;
}

async function readBanked<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------

const USAGE = `
Phase 5 — three-arm evaluation of the distilled /dlo adapter.

  --run                 actually generate and grade. Without it this only plans (free).
  --arms=a,b,c          base,tuned,teacher   (default: all three)
  --path=text|image     which delivery of the source to measure (default: text)
  --limit=N             first N held-out items
  --only=<id>           one example id
  --refresh             ignore banked generations and grades and pay again
  --data=<dir>          dataset directory (default: data/finetune/distill)
  --out=<file>          report path (default: <data>/eval-report-<path>.json)
  --check, --self-test  offline assertions, no network, no spend
  -h, --help
`.trim();

async function main(argv: readonly string[]): Promise<void> {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      run: { type: 'boolean' },
      arms: { type: 'string' },
      path: { type: 'string' },
      limit: { type: 'string' },
      only: { type: 'string' },
      refresh: { type: 'boolean' },
      data: { type: 'string' },
      out: { type: 'string' },
      check: { type: 'boolean' },
      'self-test': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });

  if (values.help) {
    console.log(USAGE);
    return;
  }
  if (values.check || values['self-test']) {
    runCheck();
    return;
  }

  const dataDir = values.data ? resolve(values.data) : DEFAULT_DATA_DIR;
  const path: EvalPath = values.path === 'image' ? 'image' : 'text';
  if (values.path && values.path !== 'text' && values.path !== 'image') {
    throw new Error(`--path must be "text" or "image", not "${values.path}".`);
  }
  const arms = (values.arms ?? ARM_NAMES.join(','))
    .split(',')
    .map((name) => name.trim().toLowerCase())
    .filter((name) => name.length > 0);
  for (const arm of arms) {
    if (!ARM_NAMES.includes(arm as ArmName)) {
      throw new Error(
        `Unknown arm "${arm}". Supported: ${ARM_NAMES.join(', ')}.`,
      );
    }
  }
  const selected = new Set(arms as ArmName[]);

  console.log('=== Phase 5 — distilled /dlo adapter, three-arm evaluation ===');
  console.log(`dataset      ${dataDir}`);
  console.log(`source path  ${path}`);
  console.log(`arms         ${[...selected].join(', ')}`);
  console.log(`judge model  ${CHAT_MODEL}`);

  // The silent failure this refuses: GEMMA_DLO_MODEL unset falls back to the base, so a
  // "tuned" arm would quietly be a second base run and the report would show a perfect tie
  // that reads as "the adapter changed nothing".
  if (selected.has('tuned')) {
    if (gemmaDloModel() === gemmaModel()) {
      throw new Error(
        'GEMMA_DLO_MODEL is unset, so the "tuned" arm would address the BASE model and the ' +
          'report would compare the base with itself. Set it to the adapter the endpoint ' +
          'serves, or run with --arms=base,teacher.',
      );
    }
  }
  const needsGemma = selected.has('base') || selected.has('tuned');
  if (needsGemma && !isGemmaConfigured()) {
    throw new Error(
      'GEMMA_BASE_URL is not set; the base and tuned arms cannot run.',
    );
  }
  if (needsGemma) {
    console.log(`endpoint     ${gemmaBaseUrl()}`);
    console.log(`base model   ${gemmaModelFor('default')}`);
    if (selected.has('tuned')) {
      console.log(`tuned model  ${gemmaModelFor('dlo')}`);
    }
    try {
      const served = await listGemmaModels();
      console.log(`serves       ${served.join(', ') || '(none)'}`);
      for (const lane of ['default', 'dlo'] as const) {
        if (lane === 'dlo' && !selected.has('tuned')) continue;
        if (lane === 'default' && !selected.has('base')) continue;
        const model = gemmaModelFor(lane);
        if (!served.includes(model)) {
          throw new Error(
            `The endpoint does not serve "${model}". Start vLLM with ` +
              '--enable-lora --max-lora-rank 32 --lora-modules <name>=<path>, or drop that arm.',
          );
        }
      }
    } catch (error) {
      if (!values.run) {
        console.warn(
          `[warn] could not confirm the served models: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      } else {
        throw error;
      }
    }
  }

  const { items: allItems, problems } = await loadEvalItems(dataDir);
  for (const problem of problems) console.warn(`[dataset] ${problem}`);

  let items = allItems;
  if (values.only) {
    const wanted = values.only.toLowerCase();
    items = items.filter((item) => item.manifest.id.toLowerCase() === wanted);
  }
  if (values.limit) {
    const limit = Number.parseInt(values.limit, 10);
    if (Number.isFinite(limit) && limit > 0) items = items.slice(0, limit);
  }
  console.log(
    `held out     ${allItems.length} item(s), evaluating ${items.length}`,
  );

  const client: SupabaseClient | null =
    path === 'image' ? createServiceRoleClient() : null;

  // Plan the image path FIRST, so a run that cannot measure what it claims to measure says
  // so before anything is generated.
  const plans = new Map<string, ImagePlan>();
  if (path === 'image') {
    for (const item of items) {
      const plan = await planImagePath(client!, item, Boolean(values.run));
      plans.set(item.manifest.id, plan);
      console.log(
        `  ${item.manifest.id.slice(0, 8)}  ${
          plan.ok
            ? `image path ready (${plan.names.join(', ')})`
            : `SKIP — ${plan.reason}`
        }`,
      );
    }
    const runnable = [...plans.values()].filter((plan) => plan.ok).length;
    if (runnable === 0) {
      console.log('');
      console.log(
        'None of the held-out items can run the image path: every one of them carries only\n' +
          'transcribed sources (audio / YouTube), which are text by the time the article is\n' +
          'written. The image path needs a held-out row whose intake has a pdf/image/docx/txt\n' +
          'file. Capture some and rebuild — the split is stable, so it only ADDS examples:\n' +
          '  pnpm --filter @dgipr/content-engine finetune:capture -- --run --limit=N\n' +
          '  pnpm --filter @dgipr/content-engine finetune:dataset -- --eval-fraction-files 0.4',
      );
      return;
    }
  }

  if (!values.run) {
    console.log('');
    console.log(
      'PLAN ONLY — nothing was generated and nothing was graded. Re-run with --run.\n' +
        `Spend: ${
          selected.has('base') ? items.length : 0
        } base + ${selected.has('tuned') ? items.length : 0} tuned generation(s) on the ` +
        'rented endpoint (billed as GPU seconds, not tokens), plus one style-judge call and\n' +
        'one findUnsupportedClaims call per generated article on ' +
        `${CHAT_MODEL} (cents each). The teacher arm regenerates nothing.`,
    );
    return;
  }

  const bankDir = resolve(dataDir, 'eval-runs');
  await mkdir(resolve(bankDir, 'generations'), { recursive: true });
  await mkdir(resolve(bankDir, 'grades'), { recursive: true });

  const accumulator: CostAccumulator = createCostAccumulator();
  const results: ItemResult[] = [];

  for (const [index, item] of items.entries()) {
    const { manifest } = item;
    const head = `[${index + 1}/${items.length}] ${manifest.id.slice(0, 8)}`;
    const plan = plans.get(manifest.id);

    if (path === 'image' && plan && !plan.ok) {
      console.log(`${head}  skipped — ${plan.reason}`);
      results.push({
        id: manifest.id,
        dloIntakeId: manifest.dloIntakeId,
        category: manifest.category,
        lane: manifest.lane,
        path,
        skipped: plan.reason,
        arms: {},
      });
      continue;
    }

    const messages =
      path === 'image' && plan?.ok ? plan.messages : [...item.messages];
    const documents = path === 'image' && plan?.ok ? plan.documents : [];
    // ALWAYS the full captured source, including on the image path where the prompt no
    // longer carries the document's text. Gate 3 asks "does the source material say this
    // number", not "is it in the prompt": a figure the model read correctly off the scan is
    // faithful, and grading it against the stripped prompt would flag every one of them as
    // invented. The residual false positive — intake OCR misread a figure the model then
    // read right — is rare and falls on every arm equally, which a relative gate absorbs.
    const groundingSource = item.sections.sourceInformation;

    console.log(
      `${head}  ${manifest.category}/${manifest.lane}, ${manifest.tokens} tok, ` +
        `${documents.length} document(s)`,
    );

    const arms: Partial<Record<ArmName, ArmResult>> = {};

    for (const arm of ARM_NAMES) {
      if (!selected.has(arm)) continue;

      const key = bankKey(path, arm, manifest.id);
      const genFile = resolve(bankDir, 'generations', `${key}.json`);
      const gradeFile = resolve(bankDir, 'grades', `${key}.json`);

      if (!values.refresh) {
        const banked = await readBanked<ArmResult>(gradeFile);
        if (banked) {
          // The numerals are RECOMPUTED, never read back. They are free and deterministic,
          // so banking them would be the one way a change to the rule could leave a stale
          // number in a report that otherwise looks current — and the two paid metrics are
          // the only reason this cache exists.
          const result: ArmResult = {
            ...banked,
            numerals: ungroundedNumerals(banked.article, groundingSource),
          };
          arms[arm] = result;
          console.log(
            `  [${arm}] banked — style ${result.styleScore}/5, ` +
              `${result.unsupportedClaims.length} unsupported, ` +
              `${result.numerals.ungrounded.length}/${result.numerals.checked.length} ungrounded` +
              (result.numerals.ungrounded.length > 0
                ? `  [${result.numerals.ungrounded.join(' ')}]`
                : ''),
          );
          continue;
        }
      }

      const model =
        arm === 'teacher'
          ? 'gpt-5.6-sol (captured)'
          : gemmaModelFor(armLane(arm));

      try {
        let article: string;
        if (arm === 'teacher') {
          article = item.reference;
        } else {
          const banked = values.refresh
            ? null
            : await readBanked<{ text: string }>(genFile);
          if (banked) {
            article = banked.text;
            console.log(`  [${arm}] reusing the banked generation`);
          } else {
            const started = Date.now();
            const raw = await runInCostScope(accumulator, () =>
              respondWithSourcesViaGemma({
                label: `eval-${arm}-${manifest.id.slice(0, 8)}`,
                messages,
                documents,
                // The production ceiling. A hard 2048 here would throw on exactly the long
                // scheme articles this is meant to measure.
                maxOutputTokens: ARTICLE_BODY_MAX_TOKENS,
                lane: armLane(arm),
              }),
            );
            article = splitContent(raw.trim()).article;
            await writeFile(
              genFile,
              `${JSON.stringify({ model, text: article, generatedAt: new Date().toISOString() }, null, 2)}\n`,
              'utf8',
            );
            console.log(
              `  [${arm}] generated ${article.length} chars in ${(
                (Date.now() - started) /
                1000
              ).toFixed(1)}s`,
            );
          }
        }

        const graded = await runInCostScope(accumulator, () =>
          gradeArticle({
            reference: item.reference,
            article,
            sections: item.sections,
            groundingSource,
            // The teacher IS the judge's reference; grading it against itself would buy a
            // call to be told 5. Recorded as by-construction so the report cannot pretend
            // otherwise.
            judge: arm !== 'teacher',
          }),
        );
        const result: ArmResult = { arm, model, ...graded };
        arms[arm] = result;
        await writeFile(
          gradeFile,
          `${JSON.stringify(result, null, 2)}\n`,
          'utf8',
        );
        console.log(
          `  [${arm}] style ${result.styleScore}/5${
            result.styleByConstruction ? ' (by construction)' : ''
          }, ${result.unsupportedClaims.length} unsupported, ` +
            `${result.numerals.ungrounded.length}/${result.numerals.checked.length} ungrounded` +
            (result.numerals.ungrounded.length > 0
              ? `  [${result.numerals.ungrounded.join(' ')}]`
              : ''),
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`  [${arm}] FAILED — ${message}`);
        arms[arm] = {
          arm,
          model,
          article: '',
          styleScore: 0,
          styleByConstruction: false,
          unsupportedClaims: [],
          numerals: { checked: [], ungrounded: [] },
          error: message,
        };
      }
    }

    results.push({
      id: manifest.id,
      dloIntakeId: manifest.dloIntakeId,
      category: manifest.category,
      lane: manifest.lane,
      path,
      ...(documents.length > 0
        ? { attachedDocuments: documents.map((document) => document.name) }
        : {}),
      arms,
    });

    console.log(
      `  running OpenAI spend: $${totalCostUsd(accumulator).toFixed(4)}`,
    );
  }

  const verdict = evaluateGates(results);
  printReport(results, verdict, path);

  const outPath = values.out
    ? resolve(values.out)
    : resolve(dataDir, `eval-report-${path}.json`);
  await writeFile(
    outPath,
    `${JSON.stringify(
      {
        formatVersion: EVAL_FORMAT_VERSION,
        evaluatedAt: new Date().toISOString(),
        path,
        arms: [...selected],
        models: {
          base: gemmaModelFor('default'),
          tuned: selected.has('tuned') ? gemmaModelFor('dlo') : null,
          judge: CHAT_MODEL,
        },
        endpoint: needsGemma ? gemmaBaseUrl() : null,
        openAiCostUsd: Number(totalCostUsd(accumulator).toFixed(4)),
        verdict,
        diagnosis: diagnose(verdict, path),
        results,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  console.log('');
  console.log(`report  ${outPath}`);
  console.log(
    `spend   $${totalCostUsd(accumulator).toFixed(4)} on OpenAI (judge + claims)`,
  );
}

function armLane(arm: ArmName): GemmaLane {
  return arm === 'tuned' ? 'dlo' : 'default';
}

/**
 * What a failed gate means and what to change — the plan's own escalation ladder, printed
 * where the failure is rather than kept in a runbook nobody opens at 11pm.
 *
 * The ordering matters: a numeral regression UNDER a passing style gate is the specific
 * diagnosis the plan names (adapter bleed), and it is a different fix from a style failure.
 */
export function diagnose(verdict: GateVerdict, path: EvalPath): string[] {
  if (verdict.comparable === 0) {
    return [
      'Nothing to diagnose yet: the tuned arm did not produce an article on any held-out item.',
    ];
  }
  const out: string[] = [];
  if (verdict.allPassed) {
    out.push(
      'All three gates hold. Before switching the lane on for real, run the rollback A/B ' +
        'once deliberately (SERVING.md): same prompt, same endpoint, GEMMA_DLO_MODEL set and ' +
        'unset, so the difference in the article is the adapter and nothing else.',
    );
    if (verdict.underpowered) {
      out.push(
        'Note the item count, though — this is a direction, not a result. Top up the capture ' +
          'and rebuild before treating it as a decision.',
      );
    }
    return out;
  }
  if (verdict.styleGate && !verdict.numeralGate) {
    out.push(
      path === 'image'
        ? 'Style holds but numerals regressed on the IMAGE path: that is adapter bleed into ' +
            'image-conditioned decoding. Lower the LoRA rank or the learning rate BEFORE ' +
            'reaching for multimodal training.'
        : 'Style holds but numerals regressed on the TEXT path, where the vision tower is not ' +
            'involved at all — so this is not bleed, it is the adapter itself writing numbers ' +
            'the source does not have. Lower the learning rate, and check the target policy: ' +
            'the targets are raw teacher output and must not have been post-processed.',
    );
  }
  if (!verdict.styleGate) {
    out.push(
      path === 'image'
        ? 'Style failed on the IMAGE path. Run the same command with --path=text as a ' +
            'control: if it passes there, the style DID distil and this is the train/serve ' +
            'mismatch the text-only decision risked — multimodal LoRA is the documented ' +
            'escalation. If it fails there too, the problem is the training run, not the path.'
        : 'Style failed on the TEXT path, which is where train and serve match exactly — so ' +
            'the distillation did not take. Check, in this order: the loss mask (Phase 3 prints ' +
            'the decoded label tokens — only the article may be unmasked), template agreement ' +
            'against the endpoint, and the optimiser-step count. Eighteen steps over 47 examples ' +
            'is thin; top up the capture rather than raising the epochs.',
    );
  }
  if (!verdict.faithfulnessGate) {
    out.push(
      'Faithfulness regressed: the adapter is asserting more than the source supports. That ' +
        'is what repeated passes over a small set buy — the model memorises the shape of a ' +
        'DGIPR article, including the facts of the ones it was trained on. Top up the capture ' +
        'before adding epochs.',
    );
  }
  return out;
}

function printReport(
  results: readonly ItemResult[],
  verdict: GateVerdict,
  path: EvalPath,
): void {
  console.log('');
  console.log('=== per item ===');
  const cell = (row: ArmResult | undefined): string => {
    if (!row) return '        -';
    if (row.error) return '    error';
    return `${row.styleScore}/5 ${String(row.unsupportedClaims.length).padStart(2)}c ${String(
      row.numerals.ungrounded.length,
    ).padStart(2)}/${String(row.numerals.checked.length).padEnd(2)}`;
  };
  console.log(
    '  id        cat   lane        base            tuned           teacher',
  );
  for (const item of results) {
    if (item.skipped) {
      console.log(`  ${item.id.slice(0, 8)}  skipped — ${item.skipped}`);
      continue;
    }
    console.log(
      `  ${item.id.slice(0, 8)}  ${item.category.padEnd(6)}${item.lane.padEnd(11)} ` +
        `${cell(item.arms.base).padEnd(15)} ${cell(item.arms.tuned).padEnd(15)} ${cell(
          item.arms.teacher,
        )}`,
    );
  }
  console.log('  (style/5, unsupported claims, ungrounded/total numerals)');
  console.log('');
  console.log(`=== gates (source path: ${path}) ===`);
  for (const line of verdict.lines) console.log(line);
  console.log('');
  console.log(
    verdict.comparable === 0
      ? 'VERDICT: not yet measurable.'
      : `VERDICT: ${verdict.allPassed ? 'ALL THREE GATES PASS' : 'GATES FAILED'}`,
  );
  const diagnosis = diagnose(verdict, path);
  if (verdict.comparable > 0) {
    console.log('');
    for (const line of diagnosis) console.log(`  ${line}`);
  }
}

// ---------------------------------------------------------------------------------------
// Free offline harness
// ---------------------------------------------------------------------------------------

function runCheck(): void {
  const checks: Array<[string, boolean]> = [];
  const check = (label: string, ok: boolean): void => {
    checks.push([label, ok]);
  };

  // --- prompt splitting -----------------------------------------------------------------
  const full = buildDloArticleUserPrompt({
    sourceInformation: 'मुंबई येथे ५०० कोटी रुपयांची योजना जाहीर.',
    designations: [{ name: 'देवेंद्र फडणवीस', designation: 'मुख्यमंत्री' }],
    heading: 'योजनेस मान्यता',
    officerInstructions: 'आकडेवारीवर भर द्या.',
  });
  const parsed = splitDloPrompt(full);
  check('splitDloPrompt parses a full prompt', parsed.ok);
  check(
    'source information is the source alone',
    parsed.sourceInformation === 'मुंबई येथे ५०० कोटी रुपयांची योजना जाहीर.',
  );
  check(
    'the officer request never lands in the source',
    !parsed.sourceInformation.includes('आकडेवारीवर भर द्या.'),
  );
  check('the heading round-trips', parsed.heading === 'योजनेस मान्यता');
  check(
    'the officer request round-trips',
    parsed.officerInstructions === 'आकडेवारीवर भर द्या.',
  );
  check(
    'designations round-trip as pairs',
    parsed.designations.length === 1 &&
      parsed.designations[0]!.name === 'देवेंद्र फडणवीस' &&
      parsed.designations[0]!.designation === 'मुख्यमंत्री',
  );

  const bare = splitDloPrompt(
    buildDloArticleUserPrompt({ sourceInformation: 'फक्त स्रोत.' }),
  );
  check(
    'a source-only prompt parses',
    bare.ok && bare.sourceInformation === 'फक्त स्रोत.',
  );
  check(
    'a source-only prompt has no designations',
    bare.designations.length === 0,
  );
  check('a source-only prompt has no heading', bare.heading === '');

  // A heading-looking line INSIDE the source must not split it: the builder always puts a
  // blank line before a real heading, and OCR'd Marathi can contain anything.
  const trap = splitDloPrompt(
    buildDloArticleUserPrompt({
      sourceInformation: 'पहिली ओळ\n### OFFICER REQUEST\nदुसरी ओळ',
      officerInstructions: 'खरी सूचना',
    }),
  );
  check(
    'an un-framed heading inside the source does not split it',
    trap.sourceInformation.includes('दुसरी ओळ'),
  );
  check(
    'the real officer request still wins',
    trap.officerInstructions === 'खरी सूचना',
  );
  check(
    'a prompt with no source section is refused',
    !splitDloPrompt('random text with no headings at all').ok,
  );

  // Learned editorial preferences (migration 0057), under the placement that puts them in
  // the user turn. An unlisted heading would be folded into REVIEWED NAMES AND DESIGNATIONS
  // above it — and a rule line read as fact support is exactly what this grader must not do.
  const previousPlacement = process.env.EDITORIAL_PREFERENCE_PLACEMENT;
  process.env.EDITORIAL_PREFERENCE_PLACEMENT = 'user';
  const withRules = splitDloPrompt(
    buildDloArticleUserPrompt({
      sourceInformation: 'मुंबई येथे ५०० कोटी रुपयांची योजना जाहीर.',
      designations: [{ name: 'देवेंद्र फडणवीस', designation: 'मुख्यमंत्री' }],
      editorialPreferences: ['शीर्षक १० शब्दांच्या आत ठेवा.'],
      heading: 'योजनेस मान्यता',
    }),
  );
  if (previousPlacement === undefined) {
    delete process.env.EDITORIAL_PREFERENCE_PLACEMENT;
  } else {
    process.env.EDITORIAL_PREFERENCE_PLACEMENT = previousPlacement;
  }
  check('a prompt carrying learned preferences parses', withRules.ok);
  check(
    'a learned preference never lands in the source',
    !withRules.sourceInformation.includes('शीर्षक १० शब्दांच्या'),
  );
  check(
    'a learned preference is not read as a designation row',
    withRules.designations.length === 1,
  );
  check(
    'the heading after the preferences still round-trips',
    withRules.heading === 'योजनेस मान्यता',
  );

  // --- document stripping ---------------------------------------------------------------
  const assembled = [
    'अधिकाऱ्याची टिपणी.',
    '',
    '=== स्रोत: GR.pdf ===',
    'शासन निर्णय क्रमांक १२३.',
    '',
    '=== स्रोत: भाषण.m4a ===',
    'भाषणाचा उतारा.',
  ].join('\n');
  const stripped = stripDocumentSections(assembled, ['GR.pdf']);
  check(
    'the named document block is removed',
    !stripped.text.includes('शासन निर्णय क्रमांक १२३.'),
  );
  check('an unnamed block is kept', stripped.text.includes('भाषणाचा उतारा.'));
  check(
    'the officer note is kept',
    stripped.text.includes('अधिकाऱ्याची टिपणी.'),
  );
  check('removed names are reported', stripped.removed.join() === 'GR.pdf');
  check('kept names are reported', stripped.kept.join() === 'भाषण.m4a');
  check(
    'a name that is not there strips nothing',
    stripDocumentSections(assembled, ['absent.pdf']).removed.length === 0,
  );

  // --- document kinds -------------------------------------------------------------------
  check('pdf is a document', sourceDocumentKindOf('pdf') === 'pdf');
  check('image is a document', sourceDocumentKindOf('image') === 'image');
  check('docx is a document', sourceDocumentKindOf('docx') === 'docx');
  check('txt is a document', sourceDocumentKindOf('txt') === 'txt');
  check('AUDIO IS NOT A DOCUMENT', sourceDocumentKindOf('audio') === null);
  check('YOUTUBE IS NOT A DOCUMENT', sourceDocumentKindOf('youtube') === null);
  check(
    'an unknown kind is not coerced',
    sourceDocumentKindOf('mystery') === null,
  );

  // --- numerals -------------------------------------------------------------------------
  const source = 'शासनाने ५०० कोटी रुपये मंजूर केले; मुदत ३१ ऑगस्ट २०२६.';
  check(
    'a faithful article has no ungrounded numeral',
    ungroundedNumerals('५०० कोटींची तरतूद, ३१ ऑगस्ट २०२६ पर्यंत.', source)
      .ungrounded.length === 0,
  );
  const misread = ungroundedNumerals('४०० कोटींची तरतूद.', source);
  check('a misread amount is caught', misread.ungrounded.join() === '400');
  check(
    'Latin digits in the article match Devanagari in the source',
    ungroundedNumerals('500 crore approved.', source).ungrounded.length === 0,
  );
  check(
    'Devanagari digits in the article match Latin in the source',
    ungroundedNumerals('५०० कोटी', 'Rs 500 crore approved').ungrounded
      .length === 0,
  );
  check(
    'omitting a source figure is NOT a failure',
    ungroundedNumerals('शासनाने निधी मंजूर केला.', source).ungrounded.length ===
      0,
  );
  check(
    'digit-group separators are normalised on both sides',
    ungroundedNumerals('२,४४,००० रोजगार', 'सुमारे 244000 रोजगार').ungrounded
      .length === 0,
  );
  check(
    'a decimal is one token, not two',
    numeralTokens('६.३ टक्के').join() === '6.3',
  );
  check(
    'an ungrounded decimal is reported whole',
    ungroundedNumerals('६.३ टक्के', 'सुमारे ६ टक्के').ungrounded.join() ===
      '6.3',
  );
  check(
    'each distinct numeral is reported once',
    ungroundedNumerals('४०० कोटी आणि आणखी ४०० कोटी', source).ungrounded
      .length === 1,
  );
  check(
    'text with no numbers is trivially grounded',
    ungroundedNumerals('कोणताही आकडा नाही.', source).checked.length === 0,
  );
  // The real base-model answer that motivated this: English meta-commentary appended as a
  // numbered list, whose markers were being reported as fabricated figures.
  check(
    'numbered-list markers are not counted as claims',
    ungroundedNumerals(
      '1.  **The Header:** press release style\n2.  **The Lead:** Mumbai',
      source,
    ).ungrounded.length === 0,
  );
  check(
    'Devanagari list markers are not counted either',
    ungroundedNumerals('१. पहिला मुद्दा\n२. दुसरा मुद्दा', source).ungrounded
      .length === 0,
  );
  check(
    'a markdown bullet with a number is still a marker',
    ungroundedNumerals('- 3) तिसरा मुद्दा', source).ungrounded.length === 0,
  );
  check(
    'a figure INSIDE a listed line is still checked',
    ungroundedNumerals('1. ४०० कोटींची तरतूद', source).ungrounded.join() ===
      '400',
  );
  check(
    'a four-digit year at a line start is never treated as a marker',
    ungroundedNumerals('2023. हे वर्ष', source).ungrounded.join() === '2023',
  );
  check(
    'a number mid-sentence is untouched by the marker strip',
    stripListMarkers('मुदत ३१. ऑगस्ट') === 'मुदत ३१. ऑगस्ट',
  );
  // Tied to the repo's existing guard rather than merely resembling it: on integer-only text
  // this must agree with the rule `/video` already burns its key points under.
  const agree = (article: string, note: string): boolean =>
    (ungroundedNumerals(article, note).ungrounded.length === 0) ===
    keyPointIsGrounded(article, note);
  check(
    'it agrees with keyPointIsGrounded on grounded integers',
    agree('५०० कोटी, ३१ ऑगस्ट २०२६', source),
  );
  check(
    'it agrees with keyPointIsGrounded on an ungrounded integer',
    agree('४०० कोटी', source),
  );
  check(
    'it agrees with keyPointIsGrounded on number-free text',
    agree('कोणताही आकडा नाही.', source),
  );

  // --- style score ----------------------------------------------------------------------
  check('a Latin 4 parses', parseStyleScore('Score: 4') === 4);
  check('a Devanagari ५ parses', parseStyleScore('गुण: ५') === 5);
  check('a Devanagari १ parses', parseStyleScore('१') === 1);
  check('a Devanagari ३ parses', parseStyleScore('३') === 3);
  check(
    'an unreadable reply falls back to 3',
    parseStyleScore('कळले नाही') === 3,
  );

  // --- gates ----------------------------------------------------------------------------
  const arm = (
    name: ArmName,
    style: number,
    claims: number,
    ungroundedCount: number,
    checkedCount: number,
  ): ArmResult => ({
    arm: name,
    model: 'test',
    article: 'x',
    styleScore: style,
    styleByConstruction: name === 'teacher',
    unsupportedClaims: Array.from({ length: claims }, (_, i) => `claim ${i}`),
    numerals: {
      checked: Array.from({ length: checkedCount }, (_, i) => `${i}`),
      ungrounded: Array.from({ length: ungroundedCount }, (_, i) => `${i}`),
    },
  });
  const item = (
    id: string,
    base: ArmResult,
    tuned: ArmResult,
    teacher?: ArmResult,
  ): ItemResult => ({
    id,
    dloIntakeId: 'i',
    category: 'news',
    lane: 'notes-only',
    path: 'text',
    arms: { base, tuned, ...(teacher ? { teacher } : {}) },
  });

  const good = evaluateGates([
    item('a', arm('base', 3, 2, 1, 10), arm('tuned', 4, 1, 0, 10)),
    item('b', arm('base', 3, 1, 1, 10), arm('tuned', 4, 1, 1, 10)),
  ]);
  check('all three gates pass on an improvement', good.allPassed);
  check(
    'an improvement is reported as improved',
    good.styleVerdict === 'improved',
  );
  check(
    'per-item wins are counted',
    good.styleWins === 2 && good.styleLosses === 0,
  );

  const styleDown = evaluateGates([
    item('a', arm('base', 4, 1, 0, 10), arm('tuned', 2, 1, 0, 10)),
  ]);
  check(
    'a style regression fails gate 1',
    !styleDown.styleGate && !styleDown.allPassed,
  );
  check('a style regression is named', styleDown.styleVerdict === 'regressed');

  const claimsUp = evaluateGates([
    item('a', arm('base', 3, 0, 0, 10), arm('tuned', 5, 3, 0, 10)),
  ]);
  check(
    'more unsupported claims fails gate 2 even with a better style',
    claimsUp.styleGate && !claimsUp.faithfulnessGate && !claimsUp.allPassed,
  );

  const digitsUp = evaluateGates([
    item('a', arm('base', 3, 0, 0, 10), arm('tuned', 5, 0, 4, 10)),
  ]);
  check(
    'a numeral regression fails gate 3',
    !digitsUp.numeralGate && !digitsUp.allPassed,
  );

  const tie = evaluateGates([
    item('a', arm('base', 4, 1, 1, 10), arm('tuned', 4, 1, 1, 10)),
  ]);
  check('an exact tie passes the literal gate', tie.styleGate && tie.allPassed);
  check(
    'but a tie is reported as a tie, not an improvement',
    tie.styleVerdict === 'tied',
  );

  const noTuned = evaluateGates([
    {
      id: 'a',
      dloIntakeId: 'i',
      category: 'news',
      lane: 'notes-only',
      path: 'text',
      arms: {
        base: arm('base', 4, 0, 0, 10),
        teacher: arm('teacher', 5, 0, 0, 10),
      },
    },
  ]);
  check(
    'with no tuned arm nothing passes and nothing is claimed',
    !noTuned.allPassed &&
      noTuned.comparable === 0 &&
      noTuned.styleVerdict === 'unmeasured',
  );

  const failedArm = evaluateGates([
    item('a', arm('base', 4, 0, 0, 10), {
      ...arm('tuned', 0, 0, 0, 0),
      error: 'boom',
    }),
  ]);
  check(
    'a failed generation is not scored as a zero',
    failedArm.comparable === 0,
  );

  check('few items are flagged as underpowered', good.underpowered);
  check(
    'the teacher summary is reported when present',
    Boolean(
      evaluateGates([
        item(
          'a',
          arm('base', 3, 1, 1, 10),
          arm('tuned', 4, 1, 0, 10),
          arm('teacher', 5, 0, 2, 20),
        ),
      ]).teacher,
    ),
  );

  // --- diagnosis ------------------------------------------------------------------------
  check(
    'a numeral regression on the image path is called bleed',
    diagnose(digitsUp, 'image').join(' ').includes('adapter bleed'),
  );
  check(
    'the same regression on the text path is NOT called bleed',
    !diagnose(digitsUp, 'text').join(' ').includes('adapter bleed'),
  );
  check(
    'a style failure on the image path points at the text control first',
    diagnose(styleDown, 'image').join(' ').includes('--path=text'),
  );
  check(
    'a style failure on the text path points at the training run',
    diagnose(styleDown, 'text').join(' ').includes('loss mask'),
  );
  check(
    'a faithfulness regression is diagnosed separately',
    diagnose(claimsUp, 'text').join(' ').includes('Faithfulness regressed'),
  );
  check(
    'a clean pass asks for the rollback A/B rather than declaring victory',
    diagnose(good, 'text').join(' ').includes('rollback A/B'),
  );
  check(
    'nothing is diagnosed when the tuned arm never ran',
    diagnose(noTuned, 'text').join(' ').includes('Nothing to diagnose'),
  );

  // --- the marker must never reach a text-path prompt ------------------------------------
  check(
    'the text path carries no transport marker',
    !full.includes(DLO_SOURCE_FILES_MARKER),
  );
  check(
    'the image path carries exactly one',
    buildDloArticleUserPrompt({
      sourceInformation: 'टिपणी',
      attachedSourceFiles: true,
    }).split(DLO_SOURCE_FILES_MARKER).length === 2,
  );

  let failed = 0;
  for (const [label, ok] of checks) {
    if (!ok) failed += 1;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
  }
  console.log('');
  console.log(`${checks.length - failed}/${checks.length} assertions passed.`);
  process.exitCode = failed > 0 ? 1 : 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
