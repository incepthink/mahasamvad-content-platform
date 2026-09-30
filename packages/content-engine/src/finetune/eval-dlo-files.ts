// The FILE mode of the /dlo distillation eval: real documents in, the production path out.
//
// The held-out capture set measures the adapter on TEXT, because every held-out row carries
// only transcribed sources. Production does not look like that any more: /dlo is written by
// the gemma adapter reading image TILES of a scan, under the current prompt plus the learned
// editorial rules. So this mode takes the files themselves — `test-assets/pdfs/*` and
// `test-assets/images/*` by default — and runs every arm on exactly what an officer's upload
// produces:
//
//   teacher          GPT (ARTICLE_MODEL) reading the real files through the Responses API,
//                    under the SAME current prompt. The style judge's reference.
//   tuned@<adapter>  generateArticleFromSources(promptMode 'dlo') — the production call, so
//                    prepareGemmaSources' tiling, GEMMA_MAX_SOFT_TOKENS and the adapter lane
//                    are the production ones. One arm per --adapters entry (the v1/v2 A/B).
//   think@<adapter>  the same with GEMMA_ENABLE_THINKING on, as a SEPARATE arm: the adapter
//                    was trained with an empty thought channel, so thinking is out of
//                    distribution and must be measured, never assumed.
//   base             the stock model on the same messages (lane 'default'), for context.
//
// Grading reuses the harness's graders — the 1-5 style judge against the teacher,
// `findUnsupportedClaims`, the numeral-precision gate — and adds the two checks the
// Press_Note_General comparison showed were missing: whether the source's SIGNATORY is named,
// and how many times the article repeats its appeal. Named fixed cases (FILE_CASES) carry
// hand-verified assertions; `६क`, the signatory and the deadline-in-the-lead for the press
// note were read off the scan itself.
//
// THE GROUNDING SOURCE. A scan has no text, and the unsupported-claim and numeral gates need
// one. It is the intake OCR (OCR_PROVIDER, the same read an officer's review step would get),
// banked per file, and a hand-corrected `<file>.truth.txt` beside the asset overrides it. An
// OCR misread falls on every arm equally; the fixed cases are the absolute checks.
//
// Invoked through the main harness:
//   pnpm --filter @dgipr/content-engine finetune:eval -- --files                  # plan, free
//   pnpm --filter @dgipr/content-engine finetune:eval -- --files --run            # spends
//   ... --files --run --only=Press_Note_General.pdf --arms=teacher,tuned,think
//   ... --files --run --adapters=dgipr-dlo-v1,dgipr-dlo-v2                         # Step D A/B
//
// On this dev machine every OpenAI call needs NODE_OPTIONS=--use-system-ca (Kaspersky).

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createServiceRoleClient,
  listActiveEditorialPreferences,
} from '@dgipr/database';
import {
  MAX_INJECTED_PREFERENCES,
  intakeFileMimeForFileName,
} from '@dgipr/schemas';
import {
  createCostAccumulator,
  runInCostScope,
  totalCostUsd,
  type CostAccumulator,
} from '../cost/cost-meter.js';
import {
  DLO_ARTICLE_PROMPT_VERSION,
  buildDloArticleMessages,
} from '../generation/dlo-article-prompt.js';
import { generateArticleFromSources } from '../generation/generate-article-from-sources.js';
import { splitContent } from '../generation/generate-article.js';
import {
  gemmaDloModel,
  gemmaMaxSoftTokens,
  gemmaModel,
  isGemmaConfigured,
  listGemmaModels,
  respondWithSourcesViaGemma,
  type SourceDocument,
  type SourceDocumentKind,
} from '../generation/gemma-sources.js';
import {
  ARTICLE_BODY_MAX_TOKENS,
  ARTICLE_MODEL,
  CHAT_MODEL,
} from '../generation/openai-chat.js';
import { respondWithSources } from '../generation/responses-with-sources.js';
import { findUnsupportedClaims } from '../generation/verify-coverage.js';
import { extractDocument } from '../intake/document.js';
import { extractImageTextViaProvider } from '../intake/ocr-provider.js';
import {
  deleteSourceFile,
  uploadSourceFile,
  type SourceFileRef,
} from '../intake/openai-source-files.js';
import {
  gradeStyle,
  normalizeNumerals,
  toLatinDigits,
  ungroundedNumerals,
} from './eval-dlo-distillation.js';

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_ASSETS_DIR = resolve(HERE, '../../../../test-assets');
const DEFAULT_OUT_DIR = resolve(HERE, '../../data/finetune/distill/eval-files');

export const FILE_EVAL_FORMAT_VERSION = 'dlo-files-eval-v1';

// ---------------------------------------------------------------------------------------
// Pure core — exercised by `--check` with no network and no spend.
// ---------------------------------------------------------------------------------------

export type FileArmKind = 'teacher' | 'base' | 'tuned' | 'think';

export type FileArm = Readonly<{
  /** Stable, filesystem-safe label: teacher, base, tuned@dgipr-dlo-v1, think@dgipr-dlo-v1. */
  key: string;
  kind: FileArmKind;
  /** The adapter a tuned/think arm addresses. */
  adapter?: string;
}>;

/**
 * Expands `--arms` × `--adapters` into concrete arms. `tuned` and `think` take one arm per
 * adapter, which is what makes a v1/v2 A/B a single run on one endpoint.
 */
export function expandFileArms(
  arms: readonly string[],
  adapters: readonly string[],
): FileArm[] {
  const out: FileArm[] = [];
  for (const raw of arms) {
    const kind = raw.trim().toLowerCase();
    if (kind === 'teacher' || kind === 'base') {
      out.push({ key: kind, kind });
      continue;
    }
    if (kind !== 'tuned' && kind !== 'think') {
      throw new Error(
        `Unknown file-mode arm "${raw}". Supported: teacher, tuned, think, base.`,
      );
    }
    if (adapters.length === 0) {
      throw new Error(`The "${kind}" arm needs at least one adapter name.`);
    }
    for (const adapter of adapters) {
      if (!/^[A-Za-z0-9._-]+$/u.test(adapter)) {
        throw new Error(
          `Adapter name "${adapter}" is not a served model name.`,
        );
      }
      out.push({ key: `${kind}@${adapter}`, kind, adapter });
    }
  }
  return out;
}

/** The file kinds a /dlo upload can carry as a document. */
export function fileKindOf(name: string): SourceDocumentKind | null {
  switch (extname(name).toLowerCase()) {
    case '.pdf':
      return 'pdf';
    case '.jpg':
    case '.jpeg':
    case '.png':
    case '.webp':
      return 'image';
    case '.docx':
      return 'docx';
    case '.txt':
      return 'txt';
    default:
      return null;
  }
}

/**
 * Script-normalised text for token checks: Latin digits, and a hyphen between a digit and a
 * following Devanagari consonant removed, so `६क`, `६-क` and `6क` are one token. Deliberately
 * NOT spaces: `परिशिष्ट ६ करिता` must not read as `६क`.
 */
export function compactForMatch(text: string): string {
  return toLatinDigits(text).replace(/(\d)[-‐‑–](?=[क-ह])/gu, '$1');
}

export function containsToken(text: string, token: string): boolean {
  return compactForMatch(text).includes(compactForMatch(token));
}

/** Heading lines (`#`, `##`, `###`) and body paragraphs, in order. */
export function articleParts(article: string): {
  headings: string[];
  paragraphs: string[];
} {
  const headings: string[] = [];
  const paragraphs: string[] = [];
  for (const block of article.split(/\n\s*\n/u)) {
    const lines = block
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const body: string[] = [];
    for (const line of lines) {
      if (/^#{1,6}\s/u.test(line)) headings.push(line);
      else if (/^0{3,}$|^०{3,}$/u.test(line)) continue;
      else body.push(line);
    }
    if (body.length > 0) paragraphs.push(body.join(' '));
  }
  return { headings, paragraphs };
}

/** The first body paragraph — the lead, after any headline stack. */
export function leadParagraph(article: string): string {
  return articleParts(article).paragraphs[0] ?? '';
}

/** Sentences of the body, split on the Marathi and Latin terminators. */
export function sentencesOf(article: string): string[] {
  return articleParts(article)
    .paragraphs.join(' ')
    .split(/(?<=[.।?!])\s+/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

const APPEAL_WORDS = /आवाहन/u;

/** Sentences that make an appeal. The Press_Note failure stated one appeal three times. */
export function appealCount(article: string): number {
  return sentencesOf(article).filter((sentence) => APPEAL_WORDS.test(sentence))
    .length;
}

function wordSet(sentence: string): Set<string> {
  return new Set(
    normalizeNumerals(sentence)
      .replace(/[.,;:!?।"'“”‘’()]/gu, ' ')
      .split(/\s+/u)
      .filter((word) => word.length > 1),
  );
}

/**
 * Pairs of body sentences that say the same thing — word-set Jaccard ≥ `threshold` over
 * sentences of at least six words. A restated appeal or deadline is what this catches; the
 * floor keeps two short formula sentences (`असे त्यांनी सांगितले.`) from counting.
 */
export function repeatedSentencePairs(
  article: string,
  threshold = 0.6,
): number {
  const sets = sentencesOf(article)
    .map(wordSet)
    .filter((set) => set.size >= 6);
  let pairs = 0;
  for (let i = 0; i < sets.length; i += 1) {
    for (let j = i + 1; j < sets.length; j += 1) {
      const a = sets[i]!;
      const b = sets[j]!;
      let shared = 0;
      for (const word of a) if (b.has(word)) shared += 1;
      const union = a.size + b.size - shared;
      if (union > 0 && shared / union >= threshold) pairs += 1;
    }
  }
  return pairs;
}

/**
 * The signatory of a Marathi official letter or press note, from its text.
 *
 * The convention is a name alone in parentheses on its own line — `(कृष्णकुमार पाटील)` — in the
 * closing part of the document, above the designation. Two to four Devanagari words, nothing
 * else on the line. Heuristic by construction; a fixed case overrides it.
 */
export function detectSignatories(source: string): string[] {
  const lines = source
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const found = new Set<string>();
  const start = Math.floor(lines.length * 0.5);
  for (const line of lines.slice(start)) {
    const match = /^[(（]\s*((?:[ऀ-ॿ]+\.?\s*){2,4}?)\s*[)）]\.?$/u.exec(line);
    if (!match) continue;
    const name = match[1]!.replace(/\s+/gu, ' ').trim();
    const words = name.split(' ');
    if (words.length >= 2 && words.length <= 4) found.add(name);
  }
  return [...found];
}

/** Heading lines that attribute a statement to a person — `### *…* – पदनाम नाव*`. */
export function attributionHeadings(article: string): string[] {
  return articleParts(article).headings.filter((line) =>
    /\s[–—-]\s*[ऀ-ॿ]/u.test(line.replace(/^#+\s*/u, '')),
  );
}

/** Hand-verified expectations for a named asset. */
export type FileCase = Readonly<{
  /** Tokens the article must carry (script- and hyphen-normalised). */
  mustContain?: readonly string[];
  /** Names that must appear (the signatory, on a signed note). */
  signatories?: readonly string[];
  /** Tokens that must appear in the lead paragraph. */
  leadMustContain?: readonly string[];
  /** At most this many appeal sentences. */
  maxAppeals?: number;
  /** A GR / notification: no statement may be attributed to anyone in a heading. */
  noSpeaker?: boolean;
}>;

/**
 * The fixed cases. Press_Note_General.pdf was read off the scan: परिशिष्ट ६क, signed
 * (कृष्णकुमार पाटील) शिक्षण संचालक, deadline दि. ३१ ऑगस्ट २०२६.
 */
export const FILE_CASES: Readonly<Record<string, FileCase>> = {
  'Press_Note_General.pdf': {
    mustContain: ['६क', '३१ ऑगस्ट २०२६'],
    signatories: ['कृष्णकुमार पाटील'],
    leadMustContain: ['३१ ऑगस्ट'],
    maxAppeals: 1,
  },
};

/** A GR or government resolution by file name: no speaker may be invented. */
const GR_NAME = /(?:^|_)GR(?:_|\.)|Govt_Resolution/u;

export function caseFor(fileName: string): FileCase {
  const fixed = FILE_CASES[fileName];
  if (fixed) return fixed;
  return GR_NAME.test(fileName) ? { noSpeaker: true } : {};
}

export type CaseCheck = Readonly<{ label: string; ok: boolean }>;

export type StructuralResult = Readonly<{
  signatories: Readonly<{
    expected: readonly string[];
    named: readonly string[];
  }>;
  appeals: number;
  repeatedPairs: number;
  attributionHeadings: readonly string[];
  caseChecks: readonly CaseCheck[];
}>;

/** Every deterministic check for one article. Free, so never banked — always recomputed. */
export function structuralChecks(
  article: string,
  fileName: string,
  groundingSource: string,
): StructuralResult {
  const fileCase = caseFor(fileName);
  const expected = fileCase.signatories ?? detectSignatories(groundingSource);
  const named = expected.filter((name) => containsToken(article, name));
  const appeals = appealCount(article);
  const attributions = attributionHeadings(article);
  const caseChecks: CaseCheck[] = [];
  for (const token of fileCase.mustContain ?? []) {
    caseChecks.push({
      label: `contains ${token}`,
      ok: containsToken(article, token),
    });
  }
  for (const name of fileCase.signatories ?? []) {
    caseChecks.push({
      label: `names ${name}`,
      ok: containsToken(article, name),
    });
  }
  const lead = leadParagraph(article);
  for (const token of fileCase.leadMustContain ?? []) {
    caseChecks.push({
      label: `lead carries ${token}`,
      ok: containsToken(lead, token),
    });
  }
  if (fileCase.maxAppeals !== undefined) {
    caseChecks.push({
      label: `at most ${fileCase.maxAppeals} appeal(s) (found ${appeals})`,
      ok: appeals <= fileCase.maxAppeals,
    });
  }
  if (fileCase.noSpeaker) {
    caseChecks.push({
      label: `no invented speaker (${attributions.length} attributed heading(s))`,
      ok: attributions.length === 0,
    });
  }
  return {
    signatories: { expected, named },
    appeals,
    repeatedPairs: repeatedSentencePairs(article),
    attributionHeadings: attributions,
    caseChecks,
  };
}

// ---------------------------------------------------------------------------------------
// Results, summary and diagnosis
// ---------------------------------------------------------------------------------------

export type FileArmResult = Readonly<{
  arm: string;
  model: string;
  article: string;
  styleScore: number;
  styleByConstruction: boolean;
  unsupportedClaims: readonly string[];
  numerals: Readonly<{
    checked: readonly string[];
    ungrounded: readonly string[];
  }>;
  structure: StructuralResult;
  error?: string;
}>;

export type FileItemResult = Readonly<{
  file: string;
  kind: SourceDocumentKind;
  groundingOrigin: 'truth' | 'ocr' | 'none';
  arms: Record<string, FileArmResult>;
}>;

export type FileArmSummary = Readonly<{
  arm: string;
  n: number;
  meanStyle: number;
  meanUnsupported: number;
  ungroundedRate: number;
  signatoryCases: number;
  signatoryNamed: number;
  meanAppeals: number;
  repeatedPairs: number;
  caseChecks: number;
  caseChecksPassed: number;
}>;

export function summarizeFileArm(
  results: readonly FileItemResult[],
  arm: string,
): FileArmSummary | null {
  const rows = results
    .map((item) => item.arms[arm])
    .filter((row): row is FileArmResult => Boolean(row) && !row!.error);
  if (rows.length === 0) return null;
  const sum = (pick: (row: FileArmResult) => number): number =>
    rows.reduce((total, row) => total + pick(row), 0);
  const checked = sum((row) => row.numerals.checked.length);
  const ungrounded = sum((row) => row.numerals.ungrounded.length);
  const signed = rows.filter(
    (row) => row.structure.signatories.expected.length > 0,
  );
  return {
    arm,
    n: rows.length,
    meanStyle: sum((row) => row.styleScore) / rows.length,
    meanUnsupported: sum((row) => row.unsupportedClaims.length) / rows.length,
    ungroundedRate: checked === 0 ? 0 : ungrounded / checked,
    signatoryCases: signed.length,
    signatoryNamed: signed.filter(
      (row) => row.structure.signatories.named.length > 0,
    ).length,
    meanAppeals: sum((row) => row.structure.appeals) / rows.length,
    repeatedPairs: sum((row) => row.structure.repeatedPairs),
    caseChecks: sum((row) => row.structure.caseChecks.length),
    caseChecksPassed: sum(
      (row) => row.structure.caseChecks.filter((c) => c.ok).length,
    ),
  };
}

/**
 * The plan's escalation ladder for the file mode, cheapest lever first: a failed figure or
 * token is the vision budget (Step B), an unnamed signatory or repeated appeal the prompt
 * (Step C) and then the training data (Step D), a style gap the training data.
 */
export function diagnoseFiles(
  summaries: readonly FileArmSummary[],
  teacher: FileArmSummary | null,
): string[] {
  const out: string[] = [];
  for (const summary of summaries) {
    if (summary.arm === 'teacher') continue;
    const lines: string[] = [];
    if (summary.caseChecksPassed < summary.caseChecks) {
      lines.push(
        `${summary.caseChecks - summary.caseChecksPassed} fixed-case assertion(s) fail. A ` +
          'misread figure or token (६क → ६) is the vision budget: set GEMMA_MAX_SOFT_TOKENS=1120 ' +
          '(Step B) before touching the prompt or the adapter.',
      );
    }
    if (summary.signatoryNamed < summary.signatoryCases) {
      lines.push(
        `the signatory is unnamed on ${summary.signatoryCases - summary.signatoryNamed}/` +
          `${summary.signatoryCases} signed source(s). The v6 prompt attributes a signed note to ` +
          'its official; if the adapter still ignores it, it was trained on v2 prompts and needs ' +
          'the Step D re-distillation.',
      );
    }
    if (summary.repeatedPairs > 0 || summary.meanAppeals > 1) {
      lines.push(
        `repetition: ${summary.repeatedPairs} near-duplicate sentence pair(s), ` +
          `${summary.meanAppeals.toFixed(2)} appeal sentence(s) per article.`,
      );
    }
    if (teacher && teacher.ungroundedRate < summary.ungroundedRate) {
      lines.push(
        `ungrounded numerals ${(summary.ungroundedRate * 100).toFixed(1)}% vs the teacher's ` +
          `${(teacher.ungroundedRate * 100).toFixed(1)}%.`,
      );
    }
    const gap = 5 - summary.meanStyle;
    if (gap >= 1) {
      lines.push(
        `style gap to the teacher is ${gap.toFixed(2)} points: the adapter's training data does ` +
          'not match what production sends (Step D).',
      );
    }
    out.push(
      lines.length === 0
        ? `${summary.arm}: no gap the deterministic checks can see.`
        : `${summary.arm}: ${lines.join(' ')}`,
    );
  }
  return out;
}

// ---------------------------------------------------------------------------------------
// Paid layer
// ---------------------------------------------------------------------------------------

export type FileEvalOptions = Readonly<{
  run: boolean;
  refresh: boolean;
  arms: readonly string[];
  adapters: readonly string[];
  only?: string | undefined;
  limit?: number | undefined;
  assetsDir?: string | undefined;
  outDir?: string | undefined;
  /** 'db' reads the active learned rules as production would; 'none' sends none. */
  prefs: 'db' | 'none';
  teacherEffort: 'low' | 'medium' | 'high';
  category: 'news' | 'scheme';
}>;

type Asset = Readonly<{ name: string; path: string; kind: SourceDocumentKind }>;

async function listAssets(dir: string): Promise<Asset[]> {
  const assets: Asset[] = [];
  for (const sub of ['pdfs', 'images', '.']) {
    let entries: string[];
    try {
      entries = await readdir(resolve(dir, sub));
    } catch {
      continue;
    }
    for (const entry of entries.sort()) {
      const kind = fileKindOf(entry);
      if (!kind || entry.endsWith('.truth.txt')) continue;
      assets.push({ name: entry, path: resolve(dir, sub, entry), kind });
    }
  }
  return assets;
}

function safeName(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]/gu, '_');
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

/** Runs `fn` with env overrides, restoring them after — the arms run strictly in sequence. */
async function withEnv<T>(
  overrides: Readonly<Record<string, string>>,
  fn: () => Promise<T>,
): Promise<T> {
  const saved = Object.fromEntries(
    Object.keys(overrides).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, overrides);
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

/** The grounding text: a hand-corrected truth file wins; else the banked intake OCR. */
async function groundingFor(
  asset: Asset,
  data: Buffer,
  ocrDir: string,
  run: boolean,
): Promise<{ text: string; origin: FileItemResult['groundingOrigin'] }> {
  const truthPath = asset.path.replace(/\.[^.]+$/u, '.truth.txt');
  try {
    return { text: await readFile(truthPath, 'utf8'), origin: 'truth' };
  } catch {
    // no truth file
  }
  const banked = resolve(ocrDir, `${safeName(asset.name)}.txt`);
  try {
    return { text: await readFile(banked, 'utf8'), origin: 'ocr' };
  } catch {
    // not read yet
  }
  if (!run) return { text: '', origin: 'none' };
  const text =
    asset.kind === 'image'
      ? await extractImageTextViaProvider(asset.name, data)
      : (await extractDocument(asset.name, data)).pages
          .map((page) => page.text)
          .join('\n\n');
  await writeFile(banked, text, 'utf8');
  return { text, origin: 'ocr' };
}

async function generateArm(
  arm: FileArm,
  asset: Asset,
  document: SourceDocument,
  preferences: readonly string[],
  options: FileEvalOptions,
): Promise<{ model: string; article: string }> {
  const messages = buildDloArticleMessages({
    sourceInformation: '',
    attachedSourceFiles: true,
    editorialPreferences: preferences,
  });

  if (arm.kind === 'teacher') {
    let ref: SourceFileRef | null = null;
    try {
      const fileId = await uploadSourceFile(
        document.data,
        asset.name,
        intakeFileMimeForFileName(asset.name),
      );
      ref = {
        fileId,
        kind: asset.kind === 'image' ? 'image' : 'document',
        name: asset.name,
      };
      const raw = await respondWithSources({
        label: `eval-files teacher ${asset.name}`,
        messages,
        files: [ref],
        model: ARTICLE_MODEL,
        maxOutputTokens: ARTICLE_BODY_MAX_TOKENS,
        reasoningEffort: options.teacherEffort,
      });
      return {
        model: ARTICLE_MODEL,
        article: splitContent(raw.trim()).article,
      };
    } finally {
      if (ref) await deleteSourceFile(ref.fileId);
    }
  }

  if (arm.kind === 'base') {
    const raw = await respondWithSourcesViaGemma({
      label: `eval-files base ${asset.name}`,
      messages,
      documents: [document],
      maxOutputTokens: ARTICLE_BODY_MAX_TOKENS,
      lane: 'default',
    });
    return { model: gemmaModel(), article: splitContent(raw.trim()).article };
  }

  // tuned / think: the production call, with the arm's adapter and thinking setting.
  return withEnv(
    {
      ARTICLE_PROVIDER: 'gemma',
      GEMMA_DLO_MODEL: arm.adapter!,
      GEMMA_ENABLE_THINKING: arm.kind === 'think' ? 'true' : 'false',
    },
    async () => {
      const result = await generateArticleFromSources('', {
        promptMode: 'dlo',
        category: options.category,
        documents: [document],
        editorialPreferences: preferences,
      });
      return { model: arm.adapter!, article: result.article };
    },
  );
}

export async function runFileEval(options: FileEvalOptions): Promise<void> {
  const assetsDir = options.assetsDir
    ? resolve(options.assetsDir)
    : DEFAULT_ASSETS_DIR;
  const outDir = options.outDir ? resolve(options.outDir) : DEFAULT_OUT_DIR;
  const arms = expandFileArms(options.arms, options.adapters);

  let assets = await listAssets(assetsDir);
  if (options.only) {
    const wanted = new Set(options.only.split(',').map((name) => name.trim()));
    assets = assets.filter((asset) => wanted.has(asset.name));
  }
  if (options.limit && options.limit > 0)
    assets = assets.slice(0, options.limit);

  console.log('=== /dlo file-mode evaluation (production path) ===');
  console.log(`assets       ${assetsDir} (${assets.length} file(s))`);
  console.log(`arms         ${arms.map((arm) => arm.key).join(', ')}`);
  console.log(
    `prompt       ${DLO_ARTICLE_PROMPT_VERSION}, category ${options.category}`,
  );
  console.log(`teacher      ${ARTICLE_MODEL} effort=${options.teacherEffort}`);
  console.log(`judge        ${CHAT_MODEL}`);
  console.log(`soft tokens  ${gemmaMaxSoftTokens() ?? 'server default (280)'}`);
  for (const asset of assets) {
    const fileCase = caseFor(asset.name);
    console.log(
      `  ${asset.kind.padEnd(5)} ${asset.name}${
        Object.keys(fileCase).length > 0
          ? `  [case: ${Object.keys(fileCase).join(', ')}]`
          : ''
      }`,
    );
  }

  const gemmaArms = arms.filter((arm) => arm.kind !== 'teacher');
  if (gemmaArms.length > 0) {
    if (!isGemmaConfigured()) {
      throw new Error('GEMMA_BASE_URL is not set; the gemma arms cannot run.');
    }
    for (const arm of gemmaArms) {
      if (arm.adapter && arm.adapter === gemmaModel()) {
        throw new Error(`Arm ${arm.key} names the base model, not an adapter.`);
      }
    }
    try {
      // A serverless endpoint scaled to zero can hold /models for minutes while a worker
      // boots. Plan mode must stay quick, so it gives up after 20 s; --run waits.
      const served = options.run
        ? await listGemmaModels()
        : await Promise.race([
            listGemmaModels(),
            new Promise<never>((_, reject) =>
              setTimeout(
                () => reject(new Error('no answer in 20 s (endpoint cold?)')),
                20_000,
              ).unref(),
            ),
          ]);
      console.log(`serves       ${served.join(', ') || '(none)'}`);
      for (const arm of gemmaArms) {
        const model = arm.adapter ?? gemmaModel();
        if (!served.includes(model)) {
          const message = `The endpoint does not serve "${model}" (arm ${arm.key}).`;
          if (options.run) throw new Error(message);
          console.warn(`[warn] ${message}`);
        }
      }
    } catch (error) {
      if (options.run) throw error;
      console.warn(
        `[warn] could not list served models: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  let preferences: string[] = [];
  if (options.prefs === 'db') {
    // Production injects the active learned rules; an eval without them measures a prompt no
    // officer's run receives. So a failed read is fatal here, never a silent "none".
    try {
      const rows = await listActiveEditorialPreferences(
        createServiceRoleClient(),
        options.category,
        MAX_INJECTED_PREFERENCES,
      );
      preferences = rows.map((row) => row.rule);
      console.log(
        `learned rules ${preferences.length} (active, scope ${options.category})`,
      );
      for (const rule of preferences) console.log(`  - ${rule}`);
    } catch (error) {
      throw new Error(
        `Could not read the active learned editorial rules (${
          error instanceof Error ? error.message : String(error)
        }). Open the DB tunnel, or pass --prefs=none to measure without them.`,
      );
    }
  } else {
    console.log('learned rules none (--prefs=none)');
  }

  if (!options.run) {
    console.log('');
    console.log(
      'PLAN ONLY — nothing was read, generated or graded. Re-run with --run.\n' +
        `Spend per file: one OCR read (grounding, banked), ${
          arms.filter((arm) => arm.kind === 'teacher').length
        } teacher call(s) on ${ARTICLE_MODEL}, ${gemmaArms.length} gemma generation(s) ` +
        '(GPU seconds), and one judge + one findUnsupportedClaims call per generated article.',
    );
    return;
  }

  const prefsKey = options.prefs === 'db' ? `p${preferences.length}` : 'p0';
  const soft = `s${gemmaMaxSoftTokens() ?? 'd'}`;
  const genDir = resolve(outDir, 'generations');
  const gradeDir = resolve(outDir, 'grades');
  const ocrDir = resolve(outDir, 'ocr');
  for (const dir of [genDir, gradeDir, ocrDir])
    await mkdir(dir, { recursive: true });

  const accumulator: CostAccumulator = createCostAccumulator();
  const results: FileItemResult[] = [];
  // The teacher is judged against itself by construction, so it goes first and every other
  // arm is graded against its article.
  const ordered = [
    ...arms.filter((arm) => arm.kind === 'teacher'),
    ...arms.filter((arm) => arm.kind !== 'teacher'),
  ];

  for (const [index, asset] of assets.entries()) {
    console.log(`\n[${index + 1}/${assets.length}] ${asset.name}`);
    const data = await readFile(asset.path);
    const document: SourceDocument = {
      name: asset.name,
      kind: asset.kind,
      data,
    };
    const grounding = await runInCostScope(accumulator, () =>
      groundingFor(asset, data, ocrDir, true),
    );
    console.log(
      `  grounding  ${grounding.origin}, ${grounding.text.length} chars`,
    );

    // A generation depends on the prompt version, the learned rules and — on gemma arms —
    // the vision budget, so all three are in its bank key. A stale article is never reused
    // under a new prompt.
    const bankStem = (arm: FileArm): string =>
      `${safeName(asset.name)}--${arm.key.replace(/@/gu, '_')}--${DLO_ARTICLE_PROMPT_VERSION}-${prefsKey}${
        arm.kind === 'teacher' ? `-${options.teacherEffort}` : `-${soft}`
      }`;

    const armResults: Record<string, FileArmResult> = {};
    let reference = '';
    for (const arm of ordered) {
      const stem = bankStem(arm);
      const genFile = resolve(genDir, `${stem}.json`);
      const gradeFile = resolve(gradeDir, `${stem}.json`);
      try {
        let generated = options.refresh
          ? null
          : await readJson<{ model: string; article: string }>(genFile);
        if (generated) {
          console.log(`  [${arm.key}] reusing the banked generation`);
        } else {
          const started = Date.now();
          generated = await runInCostScope(accumulator, () =>
            generateArm(arm, asset, document, preferences, options),
          );
          await writeFile(
            genFile,
            `${JSON.stringify({ ...generated, generatedAt: new Date().toISOString() }, null, 2)}\n`,
            'utf8',
          );
          console.log(
            `  [${arm.key}] generated ${generated.article.length} chars in ${(
              (Date.now() - started) /
              1000
            ).toFixed(1)}s`,
          );
        }
        if (arm.kind === 'teacher') reference = generated.article;

        const isTeacher = arm.kind === 'teacher';
        const banked = options.refresh
          ? null
          : await readJson<
              Pick<FileArmResult, 'styleScore' | 'unsupportedClaims'>
            >(gradeFile);
        let paid = banked;
        if (!paid) {
          const [styleScore, unsupportedClaims] = await runInCostScope(
            accumulator,
            () =>
              Promise.all([
                isTeacher || !reference
                  ? Promise.resolve(isTeacher ? 5 : 0)
                  : gradeStyle(reference, generated!.article),
                grounding.text
                  ? findUnsupportedClaims(generated!.article, grounding.text)
                  : Promise.resolve([] as string[]),
              ]),
          );
          paid = { styleScore, unsupportedClaims };
          await writeFile(
            gradeFile,
            `${JSON.stringify(paid, null, 2)}\n`,
            'utf8',
          );
        }
        const result: FileArmResult = {
          arm: arm.key,
          model: generated.model,
          article: generated.article,
          styleScore: paid.styleScore,
          styleByConstruction: isTeacher,
          unsupportedClaims: paid.unsupportedClaims,
          // Free and deterministic, so recomputed every time rather than read from the bank.
          numerals: grounding.text
            ? ungroundedNumerals(generated.article, grounding.text)
            : { checked: [], ungrounded: [] },
          structure: structuralChecks(
            generated.article,
            asset.name,
            grounding.text,
          ),
        };
        armResults[arm.key] = result;
        const failedCases = result.structure.caseChecks.filter((c) => !c.ok);
        console.log(
          `  [${arm.key}] style ${result.styleScore}/5${isTeacher ? ' (reference)' : ''}, ` +
            `${result.unsupportedClaims.length} unsupported, ` +
            `${result.numerals.ungrounded.length}/${result.numerals.checked.length} ungrounded, ` +
            `signatory ${result.structure.signatories.named.length}/${result.structure.signatories.expected.length}, ` +
            `appeals ${result.structure.appeals}, repeats ${result.structure.repeatedPairs}` +
            (failedCases.length > 0
              ? `\n      FAIL: ${failedCases.map((c) => c.label).join('; ')}`
              : result.structure.caseChecks.length > 0
                ? `  (case: all ${result.structure.caseChecks.length} pass)`
                : ''),
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`  [${arm.key}] FAILED — ${message}`);
        armResults[arm.key] = {
          arm: arm.key,
          model: arm.adapter ?? arm.kind,
          article: '',
          styleScore: 0,
          styleByConstruction: false,
          unsupportedClaims: [],
          numerals: { checked: [], ungrounded: [] },
          structure: structuralChecks('', asset.name, ''),
          error: message,
        };
      }
    }
    results.push({
      file: asset.name,
      kind: asset.kind,
      groundingOrigin: grounding.origin,
      arms: armResults,
    });
    console.log(
      `  running OpenAI spend: $${totalCostUsd(accumulator).toFixed(4)}`,
    );
  }

  const summaries = ordered
    .map((arm) => summarizeFileArm(results, arm.key))
    .filter((summary): summary is FileArmSummary => summary !== null);
  const teacher =
    summaries.find((summary) => summary.arm === 'teacher') ?? null;

  console.log(
    '\n=== summary (style vs teacher = 5; lower unsupported/ungrounded is better) ===',
  );
  for (const s of summaries) {
    console.log(
      `  ${s.arm.padEnd(26)} n=${s.n}  style ${s.meanStyle.toFixed(2)}  ` +
        `unsupported ${s.meanUnsupported.toFixed(2)}  ungrounded ${(s.ungroundedRate * 100).toFixed(1)}%  ` +
        `signatory ${s.signatoryNamed}/${s.signatoryCases}  appeals ${s.meanAppeals.toFixed(2)}  ` +
        `repeats ${s.repeatedPairs}  cases ${s.caseChecksPassed}/${s.caseChecks}`,
    );
  }
  const diagnosis = diagnoseFiles(summaries, teacher);
  console.log('');
  for (const line of diagnosis) console.log(`  ${line}`);

  const reportPath = resolve(
    outDir,
    `eval-report-files-${prefsKey}-${soft}.json`,
  );
  await writeFile(
    reportPath,
    `${JSON.stringify(
      {
        formatVersion: FILE_EVAL_FORMAT_VERSION,
        evaluatedAt: new Date().toISOString(),
        promptVersion: DLO_ARTICLE_PROMPT_VERSION,
        learnedRules: preferences,
        softTokens: gemmaMaxSoftTokens(),
        arms: ordered.map((arm) => arm.key),
        models: {
          teacher: ARTICLE_MODEL,
          base: gemmaModel(),
          dlo: safeDloModel(),
          judge: CHAT_MODEL,
        },
        openAiCostUsd: Number(totalCostUsd(accumulator).toFixed(4)),
        summaries,
        diagnosis,
        results,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  console.log(`\nreport  ${reportPath}`);
  console.log(
    `spend   $${totalCostUsd(accumulator).toFixed(4)} on OpenAI + OCR`,
  );
}

function safeDloModel(): string | null {
  try {
    return gemmaDloModel();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------
// Free offline assertions, called from the main harness's --check.
// ---------------------------------------------------------------------------------------

export function fileModeChecks(): Array<[string, boolean]> {
  const checks: Array<[string, boolean]> = [];
  const check = (label: string, ok: boolean): void => {
    checks.push([label, ok]);
  };

  const arms = expandFileArms(
    ['teacher', 'tuned', 'think'],
    ['dgipr-dlo-v1', 'dgipr-dlo-v2'],
  );
  check(
    'files: tuned and think expand per adapter',
    arms.map((arm) => arm.key).join(',') ===
      'teacher,tuned@dgipr-dlo-v1,tuned@dgipr-dlo-v2,think@dgipr-dlo-v1,think@dgipr-dlo-v2',
  );
  let refused = false;
  try {
    expandFileArms(['judge'], ['x']);
  } catch {
    refused = true;
  }
  check('files: an unknown arm is refused', refused);

  check(
    'files: pdf and jpeg kinds',
    fileKindOf('a.PDF') === 'pdf' && fileKindOf('b.jpeg') === 'image',
  );
  check('files: an mp3 is not a document', fileKindOf('c.mp3') === null);

  check('files: ६क matches ६-क', containsToken('परिशिष्ट ६-क मधील', '६क'));
  check('files: ६क matches 6क', containsToken('परिशिष्ट 6क मधील', '६क'));
  check(
    'files: a bare ६ is not ६क',
    !containsToken('परिशिष्ट-६ मधील नमुना', '६क'),
  );
  check(
    'files: a space never joins a digit to a word',
    !containsToken('परिशिष्ट ६ करिता', '६क'),
  );

  const signed = [
    'प्रेस नोट',
    'कृपया प्रस्ताव सादर करावेत, असे आवाहन करण्यात येत आहे.',
    '',
    '(कृष्णकुमार पाटील)',
    'शिक्षण संचालक',
    'शिक्षण संचालनालय (योजना)',
  ].join('\n');
  check(
    'files: the parenthesised signature line is detected',
    detectSignatories(signed).join('|') === 'कृष्णकुमार पाटील',
  );
  check(
    'files: a parenthesised department is not a signatory',
    !detectSignatories(signed).includes('योजना'),
  );

  const good = [
    '### *प्रस्ताव ३१ ऑगस्ट २०२६ पर्यंत सादर करा – शिक्षण संचालक कृष्णकुमार पाटील*',
    '## *अनुकंपा नियुक्तीची प्रकरणे तातडीने निकाली काढा*',
    '',
    'पात्र लाभार्थ्यांनी दि. ३१ ऑगस्ट २०२६ पर्यंत परिशिष्ट ६-क मधील नमुन्यात प्रस्ताव सादर करावेत, असे आवाहन शिक्षण संचालक (योजना) कृष्णकुमार पाटील यांनी केले आहे.',
    '',
    'शासनाने सुधारित धोरण निश्चित केले आहे.',
    '',
    '०००००',
  ].join('\n');
  const goodResult = structuralChecks(good, 'Press_Note_General.pdf', '');
  check(
    'files: the fixed press-note case passes a good article',
    goodResult.caseChecks.length === 5 &&
      goodResult.caseChecks.every((c) => c.ok),
  );
  check(
    'files: the lead is the first body paragraph',
    leadParagraph(good).startsWith('पात्र'),
  );
  check(
    'files: the terminator is not a paragraph',
    !articleParts(good).paragraphs.includes('०००००'),
  );

  const bad = [
    '## *अनुकंपा नियुक्ती योजना*',
    '',
    'शासनाने धोरण ठरवले आहे.',
    '',
    'परिशिष्ट-६ मधील नमुन्यात प्रस्ताव सादर करावेत, असे आवाहन करण्यात आले आहे.',
    '',
    'दि. ३१ ऑगस्ट २०२६ पर्यंत कार्यवाही पूर्ण करावी, असे आवाहन करण्यात आले आहे.',
    '',
    'सर्व संबंधितांनी प्रस्ताव तातडीने सादर करावेत, असे आवाहन करण्यात येत आहे.',
  ].join('\n');
  const badResult = structuralChecks(bad, 'Press_Note_General.pdf', '');
  const failedLabels = badResult.caseChecks
    .filter((c) => !c.ok)
    .map((c) => c.label);
  check(
    'files: the Gemma failure shape fails ६क, the name, the lead and the appeal count',
    failedLabels.some((l) => l.includes('६क')) &&
      failedLabels.some((l) => l.includes('कृष्णकुमार')) &&
      failedLabels.some((l) => l.startsWith('lead carries')) &&
      failedLabels.some((l) => l.startsWith('at most 1 appeal')),
  );
  check('files: three appeal sentences are counted', badResult.appeals === 3);

  check(
    'files: a restated sentence is a repeated pair',
    repeatedSentencePairs(
      'सर्व पात्र लाभार्थ्यांनी आवश्यक कागदपत्रांसह परिपूर्ण प्रस्ताव तातडीने सादर करावेत. मध्ये काही. ' +
        'सर्व पात्र लाभार्थ्यांनी आवश्यक कागदपत्रांसह परिपूर्ण प्रस्ताव लवकर सादर करावेत.',
    ) === 1,
  );
  check(
    'files: short formula sentences never count',
    repeatedSentencePairs('असे त्यांनी सांगितले. असे त्यांनी सांगितले.') === 0,
  );

  check(
    'files: a GR by name expects no speaker',
    caseFor('Rani_Durgavati_Scheme_GR_07_Aug.pdf').noSpeaker === true,
  );
  check(
    'files: a press note by name does not',
    caseFor('Press_Note_Jalna_15_Sept.pdf').noSpeaker !== true,
  );
  const gr = structuralChecks(
    '### *योजना हेच ध्येय – आदिवासी विकास मंत्री*\n## *नवी योजना*\n\nशासनाने योजना जाहीर केली आहे.',
    'Urban_Challenge_Fund_GR_22_July.pdf',
    '',
  );
  check(
    'files: an attributed heading on a GR is an invented speaker',
    gr.caseChecks.some(
      (c) => c.label.startsWith('no invented speaker') && !c.ok,
    ),
  );

  const summary = summarizeFileArm(
    [
      {
        file: 'x.pdf',
        kind: 'pdf',
        groundingOrigin: 'ocr',
        arms: {
          teacher: {
            arm: 'teacher',
            model: 't',
            article: good,
            styleScore: 5,
            styleByConstruction: true,
            unsupportedClaims: [],
            numerals: { checked: ['31', '2026'], ungrounded: [] },
            structure: goodResult,
          },
        },
      },
    ],
    'teacher',
  );
  check(
    'files: a summary counts signatory and case passes',
    summary !== null &&
      summary.signatoryNamed === 1 &&
      summary.caseChecksPassed === 5,
  );
  check(
    'files: the diagnosis names the vision budget for a failed token',
    diagnoseFiles(
      [
        {
          arm: 'tuned@dgipr-dlo-v1',
          n: 1,
          meanStyle: 3,
          meanUnsupported: 0,
          ungroundedRate: 0,
          signatoryCases: 1,
          signatoryNamed: 0,
          meanAppeals: 3,
          repeatedPairs: 1,
          caseChecks: 5,
          caseChecksPassed: 1,
        },
      ],
      null,
    )[0]!.includes('GEMMA_MAX_SOFT_TOKENS=1120'),
  );
  check(
    'files: the default assets dir is the repo test-assets',
    basename(DEFAULT_ASSETS_DIR) === 'test-assets',
  );
  return checks;
}
