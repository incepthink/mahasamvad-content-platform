// Phase 2 of the Gemma distillation plan: assemble the captured pairs into a dataset.
//
// Phase 1 writes one `<generation-id>.jsonl` + `<generation-id>.review.json` per row. This
// turns that directory into `train.jsonl` / `eval.jsonl` in TRL conversational format, a
// `split-manifest.json` Phase 5 can re-fetch source files from, and a `dataset-report.json`
// carrying the one number Phase 3 cannot proceed without: the token-length distribution
// measured with the REAL Gemma tokenizer.
//
// It reads local files and, optionally, the tokenizer. It never reads the database, never
// calls the teacher and never writes anything under `pairs/` — the expensive artifacts are
// Phase 1's and are treated as read-only here. Rebuilding is free, so unlike the capture this
// harness overwrites its own outputs rather than refusing.
//
// THE SPLIT IS BY GROUP, NEVER BY GENERATION UUID. A thread's re-runs and a row's feedback
// rounds are the same officer source seen several times; splitting on the UUID puts one copy
// in train and its near-twin in eval, and the eval score then measures memorisation. The
// sidecar's `groupKey` (intake id, else thread root, else the id) is the unit, and it is what
// Phase 1 already de-duplicated the capture on.
//
// THE SPLIT IS A HASH, NOT A SHUFFLE, and that is the property worth protecting. The capture
// is incremental — pairs arrive in batches over days — and a shuffle-then-slice split
// reassigns every example each time the pool grows, so an example that was in eval last week
// silently becomes training data this week and the held-out set stops being held out. A hash
// of the group key is stable: adding pairs adds them to whichever side they always belonged
// to and moves nothing.
//
// IT IS STRATIFIED ON WHETHER THE ROW STILL HAS ITS SOURCE FILES. Phase 5's whole point is to
// run held-out examples back through the REAL image path, which needs a row whose intake
// carries files in the bucket. A notes-only row cannot serve that measurement at all, and the
// text lane is roughly two-thirds notes-only — so an unstratified hash split can leave the
// eval set with nothing to measure on. Thresholding inside each stratum keeps the file-carrying
// rows proportionally represented on both sides while staying exactly as stable.
//
// WHY EXACT-DUPLICATE PROMPTS MERGE THEIR GROUPS. Two intakes can hold the same press note —
// re-uploaded, or submitted twice by different officers. Their group keys differ, so the hash
// would happily put one in train and the other in eval, which is the leak the group split
// exists to prevent, arriving by a second route. Identical user prompts are unioned into one
// group before the split, so they cannot be separated.

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import {
  gemmaBaseUrl,
  gemmaModel,
  isGemmaConfigured,
} from '../generation/gemma-sources.js';
import {
  DGIPR_EDITORIAL_SYSTEM_PROMPT,
  DLO_SOURCE_FILES_MARKER,
} from '../generation/dlo-article-prompt.js';
import { FACT_CHECK_DELIMITER } from '../generation/generate-article.js';
import { CAPTURE_FORMAT_VERSION } from './capture-dlo-distillation.js';
import {
  tokenizeMessages,
  tokenizeUrlCandidates,
} from './probe-gemma-chat-template.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PAIRS_DIR = resolve(HERE, '../../data/finetune/distill/pairs');
const DEFAULT_OUT_DIR = resolve(HERE, '../../data/finetune/distill');
/** Where Phase 0.4 left the chat-template facts Phase 3 needs beside these numbers. */
const TEMPLATE_PROBE = resolve(
  HERE,
  '../../data/finetune/distill/chat-template-probe.json',
);

export const DATASET_FORMAT_VERSION = 'dlo-distill-dataset-v1';

/**
 * The system message every pair must OPEN WITH, taken from `buildDloArticleMessages` itself.
 *
 * Asserted rather than assumed: a dataset whose system turn drifts between examples teaches
 * the adapter that the instruction is decorative.
 *
 * TWO THINGS ABOUT THIS CONSTANT. It used to be the literal
 * `'Write a DGIPR Maharashtra style article.'`, which commit c97bbbb replaced with the
 * five-rule editorial prompt — so this file, capture-dlo-distillation.ts and
 * export-dlo-generation.test.ts had all been asserting a string production no longer sends.
 * It is now imported, so the same replacement can never leave it stale again.
 *
 * And the check below is STARTS-WITH rather than equality, because under
 * EDITORIAL_PREFERENCE_PLACEMENT=system a run legitimately appends a
 * `6. LEARNED EDITORIAL PREFERENCES` section after the five base rules (migration 0057).
 * The base rules are what must be uniform across the dataset; what a particular run had
 * learned by the day it was captured is not, and refusing those pairs would throw away every
 * article written once the department started learning.
 */
export const EXPECTED_SYSTEM_MESSAGE = DGIPR_EDITORIAL_SYSTEM_PROMPT;

export const DEFAULT_EVAL_FRACTION = 0.1;

/**
 * The `max_seq_length` values worth choosing between.
 *
 * Attention cost is quadratic in the window and the activation memory that decides whether the
 * run fits on one 80 GB card is linear in it, so this is a real knob rather than a formality.
 * Powers of two because every kernel in the stack is happier with them.
 */
export const SEQ_LENGTH_BUCKETS: readonly number[] = [
  1024, 2048, 4096, 8192, 16384, 32768,
];

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export type PairRole = 'system' | 'user' | 'assistant';

export type PairMessage = Readonly<{ role: PairRole; content: string }>;

export type CapturedPair = Readonly<{ messages: readonly PairMessage[] }>;

/** Only the sidecar fields this phase reads; the file carries a good deal more. */
export type SidecarSummary = Readonly<{
  formatVersion: string;
  generationId: string;
  groupKey: string;
  dloIntakeId: string | null;
  rowCreatedAt: string | null;
  capturedAt: string | null;
  category: string | null;
  lane: string;
  teacherModel: string;
  teacherPromptVersion: string;
  teacherReasoningEffort: string | null;
  studentPromptVersion: string;
  intakeFileCount: number;
  hasArticleRevision: boolean;
  styleReferencesPassed: number;
}>;

export type LoadedExample = Readonly<{
  id: string;
  sidecar: SidecarSummary;
  messages: readonly PairMessage[];
  userChars: number;
  assistantChars: number;
}>;

export type Split = 'train' | 'eval';

export type PlacedExample = LoadedExample &
  Readonly<{
    /** After duplicate-prompt merging; this is what the split is computed from. */
    effectiveGroup: string;
    split: Split;
    tokens: number | null;
  }>;

// ---------------------------------------------------------------------------
// Pure core — everything here is exercised by `--check`, free and offline.
// ---------------------------------------------------------------------------

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * A stable number in [0, 1) for a key.
 *
 * 13 hex digits is 52 bits, the most a double holds exactly — so the value is reproducible on
 * every machine and in every language that can take a SHA-256, which matters because the
 * training script in Phase 3 is Python and may want to verify the split rather than trust it.
 */
export function hashUnit(key: string, salt: string): number {
  const digest = sha256Hex(`${salt}\u0000${key}`);
  return Number.parseInt(digest.slice(0, 13), 16) / 2 ** 52;
}

export function splitFor(
  groupKey: string,
  evalFraction: number,
  salt: string,
): Split {
  return hashUnit(groupKey, salt) < evalFraction ? 'eval' : 'train';
}

/**
 * Connected components over group keys, so a set of groups that share a prompt stays together.
 *
 * Union-find rather than a single pass because the relation is transitive: if A and B share a
 * prompt and B and C share a different one, all three are one example seen three times.
 */
export class GroupUnion {
  private readonly parent = new Map<string, string>();

  private find(key: string): string {
    const held = this.parent.get(key);
    if (held === undefined) {
      this.parent.set(key, key);
      return key;
    }
    if (held === key) return key;
    const root = this.find(held);
    this.parent.set(key, root);
    return root;
  }

  union(a: string, b: string): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA === rootB) return;
    // The lexicographically smaller root wins, so the canonical name of a component does not
    // depend on the order the files happened to be read in.
    const [keep, drop] = rootA < rootB ? [rootA, rootB] : [rootB, rootA];
    this.parent.set(drop, keep);
  }

  canonical(key: string): string {
    return this.find(key);
  }
}

/**
 * Merge the groups of examples whose USER prompt is byte-identical.
 *
 * The user prompt is the whole officer-supplied input — source, designations, heading,
 * request — so two examples sharing one are the same training example whatever their row ids
 * say. The assistant halves may still differ (the teacher is not deterministic), which is
 * exactly why they must not be split across train and eval.
 */
export function mergeDuplicatePrompts(
  examples: readonly LoadedExample[],
): Map<string, string> {
  const union = new GroupUnion();
  const byPrompt = new Map<string, string>();
  // Sorted so the union is built in a fixed order regardless of directory listing order.
  for (const example of [...examples].sort((a, b) =>
    a.id.localeCompare(b.id),
  )) {
    const group = example.sidecar.groupKey;
    union.union(group, group);
    const digest = sha256Hex(userContentOf(example.messages));
    const seen = byPrompt.get(digest);
    if (seen === undefined) {
      byPrompt.set(digest, group);
    } else {
      union.union(seen, group);
    }
  }
  const out = new Map<string, string>();
  for (const example of examples) {
    out.set(example.id, union.canonical(example.sidecar.groupKey));
  }
  return out;
}

export function userContentOf(messages: readonly PairMessage[]): string {
  return messages.find((message) => message.role === 'user')?.content ?? '';
}

export function assistantContentOf(messages: readonly PairMessage[]): string {
  return (
    messages.find((message) => message.role === 'assistant')?.content ?? ''
  );
}

/**
 * Everything that would make a pair unfit to train on, as a list of reasons.
 *
 * These are cheap and they are the last gate before bytes become an adapter. Every one of them
 * is a failure Phase 1 already guards against at capture time; re-checking here is what catches
 * a hand-edited file, a half-written one, or a pair captured by an older build of the harness.
 */
export function validatePair(pair: CapturedPair): string[] {
  const problems: string[] = [];
  const messages = pair.messages;
  if (!Array.isArray(messages) || messages.length !== 3) {
    problems.push(
      `expected exactly 3 turns, found ${Array.isArray(messages) ? messages.length : 'none'}`,
    );
    return problems;
  }
  const roles = messages.map((message) => message.role).join(',');
  if (roles !== 'system,user,assistant') {
    problems.push(
      `turn roles are "${roles}", expected "system,user,assistant"`,
    );
  }
  const [system, user, assistant] = messages;
  if (system && !system.content.startsWith(EXPECTED_SYSTEM_MESSAGE)) {
    problems.push(
      `system turn does not open with the builder's own editorial rules: ${JSON.stringify(system.content.slice(0, 60))}`,
    );
  }
  if (user && !user.content.includes('### SOURCE INFORMATION')) {
    problems.push('the user turn carries no SOURCE INFORMATION block');
  }
  if (user && user.content.includes('MAHASAMVAD STYLE REFERENCES')) {
    problems.push(
      'the user turn carries a style-reference block; the dataset must be uniform',
    );
  }
  if (assistant && assistant.content.trim().length === 0) {
    problems.push('the assistant turn is empty, so there is nothing to learn');
  }
  if (assistant && assistant.content.includes(FACT_CHECK_DELIMITER)) {
    problems.push(
      'the assistant turn carries a traceability appendix, which splitContent should have removed',
    );
  }
  for (const message of messages) {
    if (typeof message.content !== 'string') {
      problems.push(`the ${message.role} turn has no string content`);
      continue;
    }
    if (message.content.includes(DLO_SOURCE_FILES_MARKER)) {
      problems.push(`the ${message.role} turn carries the source-file marker`);
    } else if (message.content.includes('\u0000')) {
      problems.push(`the ${message.role} turn carries a NUL byte`);
    }
  }
  return problems;
}

/** Percentile over an ASCENDING array, nearest-rank. Empty input is null, never 0. */
export function percentile(
  ascending: readonly number[],
  p: number,
): number | null {
  if (ascending.length === 0) return null;
  const rank = Math.ceil((p / 100) * ascending.length);
  const index = Math.min(ascending.length - 1, Math.max(0, rank - 1));
  return ascending[index] ?? null;
}

export type SeqLengthRecommendation = Readonly<{
  maxSeqLength: number;
  truncated: number;
  longest: number;
  /** Whether even the largest bucket cannot hold the longest example. */
  overflowsEveryBucket: boolean;
  /**
   * What each candidate window would cost, so the choice is made against evidence.
   *
   * `truncated` is the count of examples that would lose their tail; `keptShare` is the
   * fraction that survive whole.
   */
  buckets: readonly Readonly<{
    maxSeqLength: number;
    truncated: number;
    keptShare: number;
  }>[];
}>;

/**
 * The smallest bucket that holds p95, reported with what every bucket would truncate.
 *
 * p95 rather than the max because one runaway intake should not set the window for every other
 * example — and on real data that is not hypothetical: the first 15 captured pairs measured
 * p50 1,393 tokens against a max of 17,335, one 60k-character multi-article intake, and taking
 * the max would have quadrupled the window for the sake of a single row. Attention is
 * quadratic, so that choice is paid on every step of every epoch.
 *
 * But the count is reported beside it, and the whole table with it, because a truncated
 * example does not fail — it silently loses its ending, and the ending is where a DGIPR
 * article does its closing attribution. Choosing to drop a handful of tails is reasonable;
 * doing it without knowing how many is not.
 */
export function recommendMaxSeqLength(
  lengths: readonly number[],
): SeqLengthRecommendation | null {
  if (lengths.length === 0) return null;
  const ascending = [...lengths].sort((a, b) => a - b);
  const p95 = percentile(ascending, 95) ?? 0;
  const longest = ascending[ascending.length - 1] ?? 0;
  const bucket =
    SEQ_LENGTH_BUCKETS.find((value) => value >= p95) ??
    SEQ_LENGTH_BUCKETS[SEQ_LENGTH_BUCKETS.length - 1]!;
  const truncatedAt = (window: number): number =>
    ascending.filter((value) => value > window).length;
  return {
    maxSeqLength: bucket,
    truncated: truncatedAt(bucket),
    longest,
    overflowsEveryBucket:
      longest > SEQ_LENGTH_BUCKETS[SEQ_LENGTH_BUCKETS.length - 1]!,
    buckets: SEQ_LENGTH_BUCKETS.map((window) => ({
      maxSeqLength: window,
      truncated: truncatedAt(window),
      keptShare:
        Math.round(
          ((ascending.length - truncatedAt(window)) / ascending.length) * 1000,
        ) / 1000,
    })),
  };
}

export function countBy<T>(
  items: readonly T[],
  key: (item: T) => string,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) {
    const k = key(item);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

/** A row still has its source files, so Phase 5 can put it back through the image path. */
export function hasSourceFiles(example: LoadedExample): boolean {
  return example.sidecar.intakeFileCount > 0;
}

/**
 * Assign every example a split, stratified on file-carrying-ness and thresholded by hash.
 *
 * The stratum is a property of the GROUP, not of the example, so every example in a group
 * lands on the same side even where one row of a thread attached files and another did not.
 */
export function assignSplits(
  examples: readonly LoadedExample[],
  groups: ReadonlyMap<string, string>,
  options: Readonly<{
    evalFraction: number;
    salt: string;
    /**
     * A separate, usually larger, fraction for the file-carrying stratum.
     *
     * Those rows are the only ones Phase 5 can put back through the REAL image path, and on
     * the recent pool they are scarce — the first 15 captured pairs held exactly one, which
     * a 10% threshold rounded to nothing. Oversampling them costs a little representativeness
     * in the style judge and buys the measurement the text-only decision actually rests on.
     * Defaults to `evalFraction`, so it changes nothing unless it is asked for.
     */
    evalFractionWithFiles?: number;
  }>,
): Map<string, Split> {
  const stratumOf = new Map<string, boolean>();
  for (const example of examples) {
    const group = groups.get(example.id) ?? example.sidecar.groupKey;
    stratumOf.set(
      group,
      (stratumOf.get(group) ?? false) || hasSourceFiles(example),
    );
  }
  const splitOfGroup = new Map<string, Split>();
  for (const [group, withFiles] of stratumOf) {
    // The salt differs per stratum so the two are thresholded independently; with one salt a
    // group's side would be fixed before it was known which stratum it belonged to, and the
    // stratification would buy nothing.
    const salt = `${options.salt}:${withFiles ? 'files' : 'notes'}`;
    const fraction = withFiles
      ? (options.evalFractionWithFiles ?? options.evalFraction)
      : options.evalFraction;
    splitOfGroup.set(group, splitFor(group, fraction, salt));
  }
  const out = new Map<string, Split>();
  for (const example of examples) {
    const group = groups.get(example.id) ?? example.sidecar.groupKey;
    out.set(example.id, splitOfGroup.get(group) ?? 'train');
  }
  return out;
}

/** One JSONL line, with a fixed key order so a rebuild is byte-identical. */
export function serializePair(messages: readonly PairMessage[]): string {
  return JSON.stringify({
    messages: messages.map((message) => ({
      role: message.role,
      content: message.content,
    })),
  });
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

export type LoadProblem = Readonly<{ id: string; reason: string }>;

function readSidecar(id: string, raw: unknown): SidecarSummary {
  const record =
    raw !== null && typeof raw === 'object'
      ? (raw as Record<string, unknown>)
      : {};
  const teacher = (record['teacher'] ?? {}) as Record<string, unknown>;
  const student = (record['studentPrompt'] ?? {}) as Record<string, unknown>;
  const provenance = (record['sourceProvenance'] ?? {}) as Record<
    string,
    unknown
  >;
  const style = (record['styleReferences'] ?? {}) as Record<string, unknown>;
  const str = (value: unknown, fallback: string): string =>
    typeof value === 'string' && value.length > 0 ? value : fallback;
  const nullableStr = (value: unknown): string | null =>
    typeof value === 'string' && value.length > 0 ? value : null;
  return {
    formatVersion: str(record['formatVersion'], '(unknown)'),
    generationId: str(record['generationId'], id),
    groupKey: str(record['groupKey'], id),
    dloIntakeId: nullableStr(record['dloIntakeId']),
    rowCreatedAt: nullableStr(record['rowCreatedAt']),
    capturedAt: nullableStr(record['capturedAt']),
    category: nullableStr(record['category']),
    lane: str(record['lane'], '(unknown)'),
    teacherModel: str(teacher['model'], '(unknown)'),
    teacherPromptVersion: str(teacher['promptVersion'], '(unknown)'),
    teacherReasoningEffort: nullableStr(teacher['reasoningEffort']),
    studentPromptVersion: str(student['promptVersion'], '(unknown)'),
    intakeFileCount:
      typeof provenance['intakeFileCount'] === 'number'
        ? provenance['intakeFileCount']
        : 0,
    hasArticleRevision: record['hasArticleRevision'] === true,
    styleReferencesPassed:
      typeof style['passed'] === 'number' ? style['passed'] : 0,
  };
}

export async function loadPairs(
  dir: string,
): Promise<{ examples: LoadedExample[]; problems: LoadProblem[] }> {
  const entries = await readdir(dir);
  const ids = entries
    .filter((name) => name.endsWith('.jsonl'))
    .map((name) => name.slice(0, -'.jsonl'.length))
    .sort((a, b) => a.localeCompare(b));
  const examples: LoadedExample[] = [];
  const problems: LoadProblem[] = [];

  for (const id of ids) {
    let pair: CapturedPair;
    try {
      const raw = await readFile(resolve(dir, `${id}.jsonl`), 'utf8');
      const lines = raw.split('\n').filter((line) => line.trim().length > 0);
      if (lines.length !== 1) {
        problems.push({
          id,
          reason: `the pair file holds ${lines.length} lines, expected exactly 1`,
        });
        continue;
      }
      pair = JSON.parse(lines[0]!) as CapturedPair;
    } catch (error) {
      problems.push({
        id,
        reason: `unreadable: ${error instanceof Error ? error.message : String(error)}`,
      });
      continue;
    }

    let sidecar: SidecarSummary;
    try {
      const raw = await readFile(resolve(dir, `${id}.review.json`), 'utf8');
      sidecar = readSidecar(id, JSON.parse(raw));
    } catch {
      // A pair with no sidecar is a half-written capture. It is excluded rather than
      // defaulted, because the sidecar is where the GROUP KEY lives and guessing one would
      // mean guessing which side of the split it belongs on.
      problems.push({
        id,
        reason: 'no readable sidecar, so its group is unknown — excluded',
      });
      continue;
    }

    const invalid = validatePair(pair);
    if (invalid.length > 0) {
      problems.push({ id, reason: invalid.join('; ') });
      continue;
    }
    if (sidecar.formatVersion !== CAPTURE_FORMAT_VERSION) {
      problems.push({
        id,
        reason: `sidecar format is "${sidecar.formatVersion}", expected "${CAPTURE_FORMAT_VERSION}"`,
      });
      continue;
    }

    examples.push({
      id,
      sidecar,
      messages: pair.messages,
      userChars: userContentOf(pair.messages).length,
      assistantChars: assistantContentOf(pair.messages).length,
    });
  }
  return { examples, problems };
}

// ---------------------------------------------------------------------------
// Tokenising — the one part that touches the network
// ---------------------------------------------------------------------------

/** One attempt per candidate is not enough — see `resolveTokenizeUrl`. */
const TOKENIZE_PROBE_ROUNDS = 3;
const TOKENIZE_RETRIES_PER_EXAMPLE = 2;

function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

function redactEndpoint(url: string): string {
  return url.replace(/\/v2\/[^/]+\//, '/v2/<endpoint>/');
}

/**
 * Find the `/tokenize` route, retrying each candidate before giving up on it.
 *
 * Measured on the live Runpod endpoint: `.../openai/tokenize` answers 200 in ~6s while
 * `.../openai/v1/tokenize` answers 500, so the candidate order matters and the WRONG one
 * fails fast while the RIGHT one is the slow one — a serverless worker under load can take
 * longer than the client timeout on the first call and answer immediately on the second.
 *
 * `tokenizeMessages` posts with `maxRetries: 0`, which is right for the Phase 0.4 probe (it
 * is comparing token ids and a retry would only blur what answered) and wrong here: one blip
 * against the working route discarded it, fell through to the route that cannot work, and
 * reported the endpoint as unreachable while curl got a 200 from it seconds later. So the
 * rounds are this function's own, and the whole candidate list is retried rather than each
 * candidate exhausted in turn — a transient failure and a permanently wrong path look
 * identical on the first attempt.
 */
async function resolveTokenizeUrl(): Promise<string> {
  const candidates = tokenizeUrlCandidates(gemmaBaseUrl());
  const failures: string[] = [];
  for (let round = 0; round < TOKENIZE_PROBE_ROUNDS; round += 1) {
    for (const candidate of candidates) {
      try {
        await tokenizeMessages(
          candidate,
          [{ role: 'user', content: 'probe' }],
          false,
        );
        return candidate;
      } catch (error) {
        failures.push(
          `round ${round + 1}  ${redactEndpoint(candidate)} — ` +
            (error instanceof Error ? error.message : String(error)).slice(
              0,
              140,
            ),
        );
      }
    }
    if (round < TOKENIZE_PROBE_ROUNDS - 1) await sleep(3000 * (round + 1));
  }
  throw new Error(
    `No /tokenize candidate answered in ${TOKENIZE_PROBE_ROUNDS} rounds:\n  ` +
      failures.join('\n  '),
  );
}

/**
 * Token length per example, measured by the serving tokenizer itself.
 *
 * `add_generation_prompt: false` is the training shape: a COMPLETED conversation, with no
 * trailing model turn to be continued. It is deliberately not the serving shape — Phase 0.4
 * recorded that vLLM appends a model turn plus its thought channel when it is asked to
 * continue one — and Phase 3's loss mask has to reconcile the two. These numbers size the
 * window; the probe artifact beside them says what the window has to contain.
 *
 * A PERSISTENTLY failing example is recorded as unmeasured rather than failing the run. The
 * measurement is a distribution over hundreds of examples, and throwing away every length
 * already collected because one of them blipped against a scale-to-zero endpoint would be a
 * poor trade — the report says how many were measured, so a thin sample is visible rather
 * than silent.
 */
export async function measureTokenLengths(
  examples: readonly LoadedExample[],
  options: Readonly<{
    onProgress?: (done: number, total: number) => void;
    onFailure?: (id: string, reason: string) => void;
  }>,
): Promise<{ url: string; tokens: Map<string, number> }> {
  const url = await resolveTokenizeUrl();
  const tokens = new Map<string, number>();
  for (const [index, example] of examples.entries()) {
    const turns = example.messages.map((message) => ({
      role: message.role,
      content: message.content,
    }));
    for (
      let attempt = 0;
      attempt <= TOKENIZE_RETRIES_PER_EXAMPLE;
      attempt += 1
    ) {
      try {
        const result = await tokenizeMessages(url, turns, false);
        tokens.set(example.id, result.count);
        break;
      } catch (error) {
        if (attempt === TOKENIZE_RETRIES_PER_EXAMPLE) {
          options.onFailure?.(
            example.id,
            error instanceof Error ? error.message : String(error),
          );
        } else {
          await sleep(2000 * (attempt + 1));
        }
      }
    }
    options.onProgress?.(index + 1, examples.length);
  }
  return { url, tokens };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const USAGE = [
  'Usage: pnpm finetune:dataset [--eval-fraction 0.1] [--no-tokenize]',
  '',
  'Phase 2 of the Gemma distillation plan: turn the captured pairs into train/eval JSONL',
  'plus the token-length report that sets max_seq_length in Phase 3.',
  '',
  'Reads only local files and, unless --no-tokenize, the serving tokenizer. Never reads the',
  'database and never calls the teacher. Outputs are derived, so they are overwritten.',
  '',
  '  --pairs <dir>          where the captured pairs live (default data/.../distill/pairs)',
  '  --out <dir>            where the dataset is written (default data/.../distill)',
  `  --eval-fraction F      held-out share of groups (default ${DEFAULT_EVAL_FRACTION})`,
  '  --eval-fraction-files F  held-out share of the rows that still have source files,',
  '                         which are the only ones Phase 5 can run the image path on',
  '  --salt S               hash salt; changing it RESHUFFLES the split (default dgipr-dlo-v1)',
  '  --no-tokenize          skip the tokenizer; the report then carries no token lengths',
  '  --allow-mixed-teacher  do not refuse a dataset written by more than one teacher',
  '  --dry-run              print the report and write nothing',
  '  --check                run the offline assertions and exit — free, no network',
].join('\n');

export async function main(args = process.argv.slice(2)): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      pairs: { type: 'string' },
      out: { type: 'string' },
      'eval-fraction': { type: 'string' },
      'eval-fraction-files': { type: 'string' },
      salt: { type: 'string' },
      'no-tokenize': { type: 'boolean' },
      'allow-mixed-teacher': { type: 'boolean' },
      'dry-run': { type: 'boolean' },
      check: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    console.log(USAGE);
    return;
  }
  if (values.check) {
    runChecks();
    return;
  }

  const invocationDir = process.env.INIT_CWD ?? process.cwd();
  const pairsDir = values.pairs
    ? resolve(invocationDir, values.pairs)
    : DEFAULT_PAIRS_DIR;
  const outDir = values.out
    ? resolve(invocationDir, values.out)
    : DEFAULT_OUT_DIR;
  const evalFraction = values['eval-fraction']
    ? Number.parseFloat(values['eval-fraction'])
    : DEFAULT_EVAL_FRACTION;
  if (!(evalFraction > 0 && evalFraction < 1)) {
    throw new Error(
      `--eval-fraction must be strictly between 0 and 1, got "${values['eval-fraction']}".`,
    );
  }
  const evalFractionWithFiles = values['eval-fraction-files']
    ? Number.parseFloat(values['eval-fraction-files'])
    : evalFraction;
  if (!(evalFractionWithFiles > 0 && evalFractionWithFiles < 1)) {
    throw new Error(
      `--eval-fraction-files must be strictly between 0 and 1, got "${values['eval-fraction-files']}".`,
    );
  }
  const salt = values.salt ?? 'dgipr-dlo-v1';

  const { examples, problems } = await loadPairs(pairsDir);
  console.log('=== pairs ===');
  console.log(`  directory:          ${pairsDir}`);
  console.log(`  usable pairs:       ${examples.length}`);
  console.log(`  excluded:           ${problems.length}`);
  for (const problem of problems.slice(0, 20)) {
    console.log(`    ${problem.id.slice(0, 8)}  ${problem.reason}`);
  }
  if (examples.length === 0) {
    throw new Error(
      'No usable pairs. Run `pnpm finetune:capture --run` first (Phase 1).',
    );
  }

  // --- uniformity, the property the whole distillation rests on ---
  const teachers = countBy(
    examples,
    (example) =>
      `${example.sidecar.teacherModel} @ ${example.sidecar.teacherPromptVersion}` +
      ` (effort=${example.sidecar.teacherReasoningEffort ?? '?'})`,
  );
  const teacherNames = Object.keys(teachers);
  if (teacherNames.length > 1 && !values['allow-mixed-teacher']) {
    throw new Error(
      'The captured pairs carry more than one teacher configuration, so the dataset would ' +
        'distil an average of two voices rather than one:\n  ' +
        teacherNames.map((name) => `${name}: ${teachers[name]}`).join('\n  ') +
        '\nRe-capture the odd ones out, or pass --allow-mixed-teacher if this is deliberate.',
    );
  }
  const withStyle = examples.filter(
    (example) => example.sidecar.styleReferencesPassed > 0,
  );

  // --- grouping and split ---
  const groups = mergeDuplicatePrompts(examples);
  const mergedAway = examples.filter(
    (example) => groups.get(example.id) !== example.sidecar.groupKey,
  );
  const splits = assignSplits(examples, groups, {
    evalFraction,
    salt,
    evalFractionWithFiles,
  });

  // --- token lengths ---
  let tokenUrl: string | null = null;
  let tokenOf = new Map<string, number>();
  if (!values['no-tokenize']) {
    if (!isGemmaConfigured()) {
      console.log('');
      console.log(
        '  GEMMA_BASE_URL is unset, so the tokenizer cannot be reached. Token lengths are',
      );
      console.log(
        '  SKIPPED — Phase 3 needs them, so re-run with the endpoint configured.',
      );
    } else {
      console.log('');
      console.log(`=== tokenizing (${gemmaModel()}) ===`);
      try {
        const unmeasured: string[] = [];
        const measured = await measureTokenLengths(examples, {
          onProgress: (done, total) => {
            if (done === total || done % 25 === 0) {
              process.stdout.write(`\r  ${done}/${total}`);
            }
          },
          onFailure: (id, reason) => {
            unmeasured.push(`${id.slice(0, 8)} — ${reason.slice(0, 100)}`);
          },
        });
        process.stdout.write('\n');
        if (unmeasured.length > 0) {
          console.log(
            `  ${unmeasured.length} example(s) could not be tokenized after retries:`,
          );
          for (const line of unmeasured.slice(0, 10))
            console.log(`    ${line}`);
        }
        tokenUrl = measured.url;
        tokenOf = measured.tokens;
      } catch (error) {
        process.stdout.write('\n');
        console.log(
          `  tokenizer unavailable: ${error instanceof Error ? error.message : String(error)}`,
        );
        console.log(
          '  Continuing WITHOUT token lengths. Do not choose max_seq_length from chars.',
        );
      }
    }
  }

  const placed: PlacedExample[] = examples.map((example) => ({
    ...example,
    effectiveGroup: groups.get(example.id) ?? example.sidecar.groupKey,
    split: splits.get(example.id) ?? 'train',
    tokens: tokenOf.get(example.id) ?? null,
  }));
  // Deterministic file order. The trainer shuffles; this is so a rebuild is byte-identical.
  placed.sort(
    (a, b) =>
      a.effectiveGroup.localeCompare(b.effectiveGroup) ||
      a.id.localeCompare(b.id),
  );

  const trainSet = placed.filter((example) => example.split === 'train');
  const evalSet = placed.filter((example) => example.split === 'eval');
  const groupsOf = (set: readonly PlacedExample[]): number =>
    new Set(set.map((example) => example.effectiveGroup)).size;
  const tokenLengths = placed
    .map((example) => example.tokens)
    .filter((value): value is number => value !== null);
  const recommendation = recommendMaxSeqLength(tokenLengths);
  const dates = placed
    .map((example) => example.sidecar.rowCreatedAt)
    .filter((value): value is string => value !== null)
    .sort((a, b) => a.localeCompare(b));

  const charLengths = placed
    .map((example) => example.userChars + example.assistantChars)
    .sort((a, b) => a - b);
  const charsPerToken =
    tokenLengths.length > 0
      ? placed
          .filter((example) => example.tokens !== null)
          .reduce(
            (sum, example) => sum + example.userChars + example.assistantChars,
            0,
          ) / tokenLengths.reduce((sum, value) => sum + value, 0)
      : null;

  const report = {
    formatVersion: DATASET_FORMAT_VERSION,
    builtAt: new Date().toISOString(),
    pairsDirectory: pairsDir,
    captureFormatVersion: CAPTURE_FORMAT_VERSION,
    split: {
      strategy:
        'sha256 of the effective group key, thresholded per stratum (with/without source files)',
      evalFraction,
      evalFractionWithFiles,
      salt,
      note: 'Stable under additions: capturing more pairs never moves an existing example.',
    },
    counts: {
      usablePairs: placed.length,
      excludedPairs: problems.length,
      groups: groupsOf(placed),
      train: { examples: trainSet.length, groups: groupsOf(trainSet) },
      eval: { examples: evalSet.length, groups: groupsOf(evalSet) },
      withSourceFiles: {
        total: placed.filter(hasSourceFiles).length,
        eval: evalSet.filter(hasSourceFiles).length,
      },
      duplicatePromptMerges: mergedAway.length,
      withArticleRevision: placed.filter(
        (example) => example.sidecar.hasArticleRevision,
      ).length,
    },
    teachers,
    lanes: countBy(placed, (example) => example.sidecar.lane),
    categories: countBy(
      placed,
      (example) => example.sidecar.category ?? '(none)',
    ),
    studentPromptVersions: countBy(
      placed,
      (example) => example.sidecar.studentPromptVersion,
    ),
    rowDateRange: {
      from: dates[0] ?? null,
      to: dates[dates.length - 1] ?? null,
      unknown: placed.length - dates.length,
    },
    chars: {
      p50: percentile(charLengths, 50),
      p95: percentile(charLengths, 95),
      max: percentile(charLengths, 100),
    },
    tokens: {
      measuredWith: tokenUrl ? gemmaModel() : null,
      tokenizeUrl: tokenUrl
        ? tokenUrl.replace(/\/v2\/[^/]+\//, '/v2/<endpoint>/')
        : null,
      addGenerationPrompt: false,
      measured: tokenLengths.length,
      p50: percentile(
        [...tokenLengths].sort((a, b) => a - b),
        50,
      ),
      p95: percentile(
        [...tokenLengths].sort((a, b) => a - b),
        95,
      ),
      max: percentile(
        [...tokenLengths].sort((a, b) => a - b),
        100,
      ),
      charsPerToken: charsPerToken ? Number(charsPerToken.toFixed(2)) : null,
      recommendation,
    },
    styleReferences: {
      examplesCarryingOne: withStyle.length,
      note: 'Phase 1 never retrieves exemplars, so this must be 0 for the dataset to be uniform.',
    },
    chatTemplate: await readTemplateProbe(),
  };

  const manifest = {
    formatVersion: DATASET_FORMAT_VERSION,
    builtAt: report.builtAt,
    note:
      'Phase 5 re-runs the eval examples through the REAL image path; dloIntakeId is how it ' +
      'finds their source files in the private bucket.',
    examples: placed.map((example) => ({
      id: example.id,
      split: example.split,
      group: example.effectiveGroup,
      capturedGroup: example.sidecar.groupKey,
      dloIntakeId: example.sidecar.dloIntakeId,
      lane: example.sidecar.lane,
      category: example.sidecar.category,
      rowCreatedAt: example.sidecar.rowCreatedAt,
      hasSourceFiles: hasSourceFiles(example),
      userChars: example.userChars,
      assistantChars: example.assistantChars,
      tokens: example.tokens,
    })),
  };

  printReport(report, { trainSet, evalSet, problems, mergedAway });

  if (values['dry-run']) {
    console.log('');
    console.log('DRY RUN — nothing was written.');
    return;
  }

  await mkdir(outDir, { recursive: true });
  const write = async (
    name: string,
    set: readonly PlacedExample[],
  ): Promise<void> => {
    const body = set
      .map((example) => serializePair(example.messages))
      .join('\n');
    await writeFile(
      resolve(outDir, name),
      set.length > 0 ? `${body}\n` : '',
      'utf8',
    );
  };
  await write('train.jsonl', trainSet);
  await write('eval.jsonl', evalSet);
  await writeFile(
    resolve(outDir, 'split-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );
  await writeFile(
    resolve(outDir, 'dataset-report.json'),
    `${JSON.stringify(report, null, 2)}\n`,
    'utf8',
  );

  console.log('');
  console.log('=== written ===');
  console.log(`  ${resolve(outDir, 'train.jsonl')}`);
  console.log(`  ${resolve(outDir, 'eval.jsonl')}`);
  console.log(`  ${resolve(outDir, 'split-manifest.json')}`);
  console.log(`  ${resolve(outDir, 'dataset-report.json')}`);
}

async function readTemplateProbe(): Promise<unknown> {
  try {
    const raw = JSON.parse(await readFile(TEMPLATE_PROBE, 'utf8')) as Record<
      string,
      unknown
    >;
    return {
      probedAt: raw['probedAt'] ?? null,
      model: raw['model'] ?? null,
      maxModelLen: raw['maxModelLen'] ?? null,
      systemRole: raw['systemRole'] ?? null,
      turnMarkers: raw['turnMarkers'] ?? null,
    };
  } catch {
    return null;
  }
}

function printReport(
  report: Record<string, unknown>,
  sets: Readonly<{
    trainSet: readonly PlacedExample[];
    evalSet: readonly PlacedExample[];
    problems: readonly LoadProblem[];
    mergedAway: readonly LoadedExample[];
  }>,
): void {
  const counts = report['counts'] as Record<string, never>;
  const tokens = report['tokens'] as Record<string, unknown>;
  const dates = report['rowDateRange'] as Record<string, string | null>;
  const train = counts['train'] as unknown as {
    examples: number;
    groups: number;
  };
  const evaluation = counts['eval'] as unknown as {
    examples: number;
    groups: number;
  };
  const withFiles = counts['withSourceFiles'] as unknown as {
    total: number;
    eval: number;
  };

  console.log('');
  console.log('=== dataset ===');
  console.log(
    `  examples:           ${counts['usablePairs']} in ${counts['groups']} independent groups`,
  );
  console.log(
    `  train:              ${train.examples} examples / ${train.groups} groups`,
  );
  console.log(
    `  eval:               ${evaluation.examples} examples / ${evaluation.groups} groups`,
  );
  console.log(
    `  with source files:  ${withFiles.total} total, ${withFiles.eval} of them held out`,
  );
  console.log(
    `  row dates:          ${dates['from']?.slice(0, 10) ?? '?'} .. ${dates['to']?.slice(0, 10) ?? '?'}`,
  );
  console.log(`  lanes:              ${JSON.stringify(report['lanes'])}`);
  console.log(`  teachers:           ${JSON.stringify(report['teachers'])}`);

  console.log('');
  console.log('=== length (what sets max_seq_length in Phase 3) ===');
  if (tokens['measured'] === 0 || tokens['measuredWith'] === null) {
    console.log(
      '  NO TOKEN LENGTHS MEASURED. Phase 3 must not pick max_seq_length from character',
    );
    console.log(
      "  counts. Gemma's 262k vocabulary reads Devanagari far more densely than OpenAI's",
    );
    console.log(
      '  — measured ~3.8 chars/token here against ~1.2-1.8 on o200k — so a ratio carried',
    );
    console.log(
      '  over from the cost meter would oversize the window several times over. Re-run',
    );
    console.log('  against the endpoint before training.');
    const chars = report['chars'] as Record<string, number | null>;
    console.log(
      `  chars p50/p95/max:  ${chars['p50']} / ${chars['p95']} / ${chars['max']}`,
    );
  } else {
    const rec = tokens['recommendation'] as SeqLengthRecommendation | null;
    console.log(
      `  tokens p50/p95/max: ${tokens['p50']} / ${tokens['p95']} / ${tokens['max']}` +
        `   (${tokens['measured']} measured, ~${tokens['charsPerToken']} chars/token)`,
    );
    if (rec) {
      console.log(
        `  max_seq_length:     ${rec.maxSeqLength}   (smallest bucket holding p95)`,
      );
      console.log(
        `  would truncate:     ${rec.truncated} example(s); longest is ${rec.longest} tokens`,
      );
      // The table, because p95 can be one outlier away from doubling the window and attention
      // is quadratic in it. A smaller window that drops three tails is often the better buy.
      console.log('');
      console.log('  window   truncates   keeps');
      for (const bucket of rec.buckets) {
        if (bucket.truncated === 0 && bucket.maxSeqLength > rec.maxSeqLength) {
          continue;
        }
        console.log(
          `  ${String(bucket.maxSeqLength).padStart(6)}   ${String(bucket.truncated).padStart(9)}   ` +
            `${(bucket.keptShare * 100).toFixed(1)}%` +
            (bucket.maxSeqLength === rec.maxSeqLength
              ? '   <- recommended'
              : ''),
        );
      }
      if (rec.overflowsEveryBucket) {
        console.log(
          '  WARNING: the longest example does not fit the largest bucket at all.',
        );
      }
    }
  }

  const warnings: string[] = [];
  if (evaluation.examples === 0) {
    warnings.push(
      'The eval set is EMPTY. With few groups the hash can legitimately put them all in ' +
        'train; capture more pairs rather than raising --eval-fraction, which would only ' +
        'move the same handful across.',
    );
  }
  if (withFiles.total > 0 && withFiles.eval === 0) {
    warnings.push(
      'No held-out example still has its source files, so Phase 5 cannot run the image ' +
        'path on the eval set — which is the measurement the text-only decision rests on.',
    );
  }
  if (sets.mergedAway.length > 0) {
    warnings.push(
      `${sets.mergedAway.length} example(s) shared a user prompt with another group and were ` +
        'merged into one group so they could not be split across train and eval.',
    );
  }
  const style = report['styleReferences'] as Record<string, number>;
  if ((style['examplesCarryingOne'] ?? 0) > 0) {
    warnings.push(
      `${style['examplesCarryingOne']} example(s) carry style exemplars; the dataset is not uniform.`,
    );
  }
  if (warnings.length > 0) {
    console.log('');
    console.log('=== warnings ===');
    for (const warning of warnings) console.log(`  - ${warning}`);
  }
}

// ---------------------------------------------------------------------------
// Offline assertions — `--check`. Free: no network, no database, no files.
//
// What they protect is the split. A dataset with a leak trains and evaluates cleanly, reports
// a good number and is wrong; nothing downstream of here can detect it.
// ---------------------------------------------------------------------------

export function runChecks(): void {
  const failures: string[] = [];
  const check = (ok: boolean, label: string): void => {
    if (!ok) failures.push(label);
  };

  const goodMessages: PairMessage[] = [
    { role: 'system', content: EXPECTED_SYSTEM_MESSAGE },
    {
      role: 'user',
      content: '### SOURCE INFORMATION\n\nमुंबई, दि. १३ : मजकूर',
    },
    { role: 'assistant', content: '### शीर्षक\n\nलेख' },
  ];

  // --- validatePair ---
  check(
    validatePair({ messages: goodMessages }).length === 0,
    'a valid pair was rejected',
  );
  check(
    validatePair({ messages: goodMessages.slice(0, 2) }).length > 0,
    'a two-turn pair was accepted',
  );
  check(
    validatePair({
      messages: [goodMessages[1]!, goodMessages[0]!, goodMessages[2]!],
    }).some((problem) => problem.includes('turn roles')),
    'a pair with swapped roles was accepted',
  );
  check(
    validatePair({
      messages: [
        { role: 'system', content: 'Write something.' },
        goodMessages[1]!,
        goodMessages[2]!,
      ],
    }).some((problem) => problem.includes('system turn')),
    'a drifted system message was accepted',
  );
  check(
    validatePair({
      messages: [
        goodMessages[0]!,
        {
          role: 'user',
          content: `### SOURCE INFORMATION${DLO_SOURCE_FILES_MARKER}`,
        },
        goodMessages[2]!,
      ],
    }).some((problem) => problem.includes('marker')),
    'a pair carrying the source-file marker was accepted',
  );
  check(
    validatePair({
      messages: [
        goodMessages[0]!,
        { role: 'user', content: '### SOURCE INFORMATION\u0000' },
        goodMessages[2]!,
      ],
    }).some((problem) => problem.includes('NUL')),
    'a pair carrying a bare NUL byte was accepted',
  );
  check(
    validatePair({
      messages: [
        goodMessages[0]!,
        {
          role: 'user',
          content: '### SOURCE INFORMATION\n### MAHASAMVAD STYLE REFERENCES\nx',
        },
        goodMessages[2]!,
      ],
    }).some((problem) => problem.includes('style-reference')),
    'a pair carrying a style-reference block was accepted',
  );
  check(
    validatePair({
      messages: [
        goodMessages[0]!,
        goodMessages[1]!,
        { role: 'assistant', content: '  ' },
      ],
    }).some((problem) => problem.includes('empty')),
    'a pair with an empty article was accepted',
  );
  check(
    validatePair({
      messages: [
        goodMessages[0]!,
        goodMessages[1]!,
        {
          role: 'assistant',
          content: `लेख\n${FACT_CHECK_DELIMITER}\nपरिशिष्ट`,
        },
      ],
    }).some((problem) => problem.includes('appendix')),
    'a pair carrying a traceability appendix was accepted',
  );
  check(
    validatePair({
      messages: [
        goodMessages[0]!,
        { role: 'user', content: 'मजकूर' },
        goodMessages[2]!,
      ],
    }).some((problem) => problem.includes('SOURCE INFORMATION')),
    'a pair with no source-information block was accepted',
  );

  // --- hashUnit / splitFor ---
  check(
    hashUnit('abc', 's') === hashUnit('abc', 's'),
    'the hash is not deterministic',
  );
  check(
    hashUnit('abc', 's') !== hashUnit('abc', 't'),
    'the salt does not change the hash',
  );
  check(
    hashUnit('abc', 's') >= 0 && hashUnit('abc', 's') < 1,
    'the hash is outside [0, 1)',
  );
  // The whole reason for hashing rather than shuffling: the split of an existing key must not
  // depend on how many other keys exist.
  const before = splitFor('group-17', 0.1, 'x');
  check(
    splitFor('group-17', 0.1, 'x') === before,
    'the split moved between two calls with the same inputs',
  );
  const sample = Array.from({ length: 4000 }, (_, i) => `g${i}`);
  const evalShare =
    sample.filter((key) => splitFor(key, 0.1, 'x') === 'eval').length /
    sample.length;
  check(
    Math.abs(evalShare - 0.1) < 0.02,
    `the hash split is not close to the requested fraction: ${evalShare.toFixed(3)}`,
  );
  check(
    sample.filter((key) => splitFor(key, 0.5, 'x') === 'eval').length >
      sample.filter((key) => splitFor(key, 0.1, 'x') === 'eval').length,
    'a larger eval fraction did not hold out more groups',
  );
  // Monotone in the fraction: everything held out at 10% is still held out at 50%, which is
  // what lets the fraction be raised without reshuffling what was already eval.
  check(
    sample
      .filter((key) => splitFor(key, 0.1, 'x') === 'eval')
      .every((key) => splitFor(key, 0.5, 'x') === 'eval'),
    'raising the eval fraction moved a group out of eval',
  );

  // --- GroupUnion / mergeDuplicatePrompts ---
  const union = new GroupUnion();
  union.union('b', 'c');
  union.union('c', 'd');
  check(
    union.canonical('d') === 'b' && union.canonical('b') === 'b',
    'union-find did not make the smallest key canonical across a transitive chain',
  );
  check(
    union.canonical('zz') === 'zz',
    'an unrelated key was absorbed into a component',
  );

  const exampleWith = (
    id: string,
    group: string,
    user: string,
    files = 0,
  ): LoadedExample => ({
    id,
    sidecar: {
      formatVersion: CAPTURE_FORMAT_VERSION,
      generationId: id,
      groupKey: group,
      dloIntakeId: group,
      rowCreatedAt: '2026-09-01T00:00:00.000Z',
      capturedAt: '2026-09-20T00:00:00.000Z',
      category: 'news',
      lane: files > 0 ? 'text' : 'notes-only',
      teacherModel: 'gpt-5.6-sol',
      teacherPromptVersion: 'dlo-rag-v2',
      teacherReasoningEffort: 'high',
      studentPromptVersion: 'dlo-rag-v2',
      intakeFileCount: files,
      hasArticleRevision: false,
      styleReferencesPassed: 0,
    },
    messages: [
      { role: 'system', content: EXPECTED_SYSTEM_MESSAGE },
      { role: 'user', content: `### SOURCE INFORMATION\n\n${user}` },
      { role: 'assistant', content: 'लेख' },
    ],
    userChars: user.length,
    assistantChars: 3,
  });

  const duplicates = [
    exampleWith('a', 'g1', 'एकच मजकूर'),
    exampleWith('b', 'g2', 'एकच मजकूर'),
    exampleWith('c', 'g3', 'वेगळा मजकूर'),
  ];
  const merged = mergeDuplicatePrompts(duplicates);
  check(
    merged.get('a') === merged.get('b'),
    'two examples with an identical prompt were left in different groups',
  );
  check(
    merged.get('c') !== merged.get('a'),
    'an example with a different prompt was merged anyway',
  );
  check(
    JSON.stringify([...mergeDuplicatePrompts([...duplicates].reverse())]) !==
      undefined &&
      mergeDuplicatePrompts([...duplicates].reverse()).get('a') ===
        merged.get('a'),
    'duplicate merging is not deterministic under input order',
  );

  // --- assignSplits ---
  // The property that matters: every example of a group lands on one side.
  const threadRows = [
    exampleWith('r1', 'intake-1', 'पहिला'),
    exampleWith('r2', 'intake-1', 'दुसरा'),
  ];
  const threadGroups = mergeDuplicatePrompts(threadRows);
  const threadSplit = assignSplits(threadRows, threadGroups, {
    evalFraction: 0.5,
    salt: 'x',
  });
  check(
    threadSplit.get('r1') === threadSplit.get('r2'),
    'two rows of one intake were split across train and eval — the leak this exists to stop',
  );
  const dupSplit = assignSplits(duplicates, merged, {
    evalFraction: 0.5,
    salt: 'x',
  });
  check(
    dupSplit.get('a') === dupSplit.get('b'),
    'duplicate prompts were split across train and eval',
  );
  // Stratification: a file-carrying pool should reach eval on its own terms.
  const stratified = Array.from({ length: 200 }, (_, i) =>
    exampleWith(`s${i}`, `sg${i}`, `मजकूर ${i}`, i % 3 === 0 ? 1 : 0),
  );
  const stratGroups = mergeDuplicatePrompts(stratified);
  const stratSplit = assignSplits(stratified, stratGroups, {
    evalFraction: 0.2,
    salt: 'x',
  });
  const heldOutWithFiles = stratified.filter(
    (example) =>
      stratSplit.get(example.id) === 'eval' && hasSourceFiles(example),
  ).length;
  check(
    heldOutWithFiles > 0,
    'stratification held out no file-carrying example, so Phase 5 has nothing to measure on',
  );
  // Oversampling the scarce stratum must not disturb the other one — that is the whole
  // point of thresholding them independently.
  const oversampled = assignSplits(stratified, stratGroups, {
    evalFraction: 0.2,
    salt: 'x',
    evalFractionWithFiles: 0.6,
  });
  check(
    stratified.filter(
      (example) =>
        oversampled.get(example.id) === 'eval' && hasSourceFiles(example),
    ).length > heldOutWithFiles,
    'raising the file-carrying eval fraction did not hold out more of them',
  );
  check(
    stratified
      .filter((example) => !hasSourceFiles(example))
      .every(
        (example) => oversampled.get(example.id) === stratSplit.get(example.id),
      ),
    'oversampling the file-carrying stratum moved notes-only examples too',
  );
  const heldOutNotes = stratified.filter(
    (example) =>
      stratSplit.get(example.id) === 'eval' && !hasSourceFiles(example),
  ).length;
  check(
    heldOutNotes > 0,
    'stratification held out only file-carrying examples',
  );

  // --- percentile / recommendMaxSeqLength ---
  check(percentile([], 50) === null, 'an empty percentile returned a number');
  check(percentile([1, 2, 3, 4], 50) === 2, 'the median is wrong');
  check(percentile([1, 2, 3, 4], 100) === 4, 'the max is wrong');
  check(percentile([5], 95) === 5, 'a single value is not its own p95');
  const rec = recommendMaxSeqLength([100, 200, 300, 5000]);
  check(
    rec !== null && rec.maxSeqLength === 8192,
    'the bucket for a 5000-token p95 is wrong',
  );
  check(
    rec !== null && rec.longest === 5000,
    'the longest example was misreported',
  );
  const tight = recommendMaxSeqLength(Array.from({ length: 100 }, () => 1500));
  check(
    tight !== null && tight.maxSeqLength === 2048 && tight.truncated === 0,
    'a uniform 1500-token pool did not fit the 2048 bucket cleanly',
  );
  check(
    rec !== null && rec.buckets.length === SEQ_LENGTH_BUCKETS.length,
    'the bucket table does not cover every candidate window',
  );
  check(
    rec !== null &&
      rec.buckets.every(
        (bucket, i) =>
          i === 0 || bucket.truncated <= rec.buckets[i - 1]!.truncated,
      ),
    'a larger window truncated more examples than a smaller one',
  );
  check(
    rec !== null &&
      rec.buckets.find((bucket) => bucket.maxSeqLength === 4096)?.truncated ===
        1,
    'the bucket table miscounted what a 4096 window would truncate',
  );
  check(
    rec !== null &&
      rec.buckets.find((bucket) => bucket.maxSeqLength === 8192)?.keptShare ===
        1,
    'the recommended window did not report keeping every example',
  );
  const huge = recommendMaxSeqLength([40000]);
  check(
    huge !== null && huge.overflowsEveryBucket,
    'an example longer than every bucket was not flagged',
  );
  check(
    recommendMaxSeqLength([]) === null,
    'an empty length list produced a recommendation',
  );

  // --- serializePair ---
  const line = serializePair(goodMessages);
  check(
    line.startsWith('{"messages":[{"role":"system"'),
    'the JSONL line is not in TRL conversational shape',
  );
  check(!line.includes('\n'), 'a JSONL line contains a raw newline');
  check(
    JSON.parse(line).messages[1].content.includes('मुंबई'),
    'Devanagari did not survive serialization',
  );
  check(
    serializePair(goodMessages) === serializePair([...goodMessages]),
    'serialization is not stable',
  );

  // --- countBy ---
  check(
    JSON.stringify(countBy(['a', 'b', 'a'], (x) => x)) ===
      JSON.stringify({ a: 2, b: 1 }),
    'countBy is wrong',
  );

  if (failures.length > 0) {
    console.error(`\n${failures.length} FAILURE(S):`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exitCode = 1;
  } else {
    console.log('All build-distillation-dataset assertions passed.');
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error: unknown) => {
    console.error(
      error instanceof Error ? error.message : 'Dataset build failed.',
    );
    process.exitCode = 1;
  });
}
