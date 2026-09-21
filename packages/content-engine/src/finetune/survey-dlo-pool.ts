// Phase 0.2 + 0.3 of the Gemma distillation plan: what does production actually emit, and
// how big is the pool?
//
// READ-ONLY AND FREE. No model call, no upload, no write, no training. It answers two
// questions that must be settled with evidence before a single training pair is captured,
// because both decide the SHAPE of the dataset and neither can be corrected afterwards
// without a re-capture:
//
//   0.2  Do production DLO runs carry style exemplars? If the pool is uniform, teacher and
//        student prompts both carry no `### MAHASAMVAD STYLE REFERENCES` block and nothing
//        further is needed. If it is MIXED, the capture harness must pin
//        ARTICLE_STYLE_REFERENCES_ENABLED=false in its own env so the dataset is uniform.
//   0.3  How many INDEPENDENT groups are there? A generation UUID does not identify an
//        independent example — a thread's re-runs and feedback rounds are correlated, so the
//        group count is the real one, and it is what decides whether the older /dlo text lane
//        has to be folded in.
//
// WHY NO TEXT COLUMN IS SELECTED. `note`, `article` and `combined_text` hold whole articles
// and whole meeting transcripts; this survey needs none of them. The one heavy read is
// `dlo_intakes.files`, which cannot be projected inside a jsonb array — a text-lane file entry
// carries its extracted pages. That is accepted here, and only here, because this is a one-off
// offline survey rather than a polled endpoint; `--max-intakes` bounds it.
//
// THE PROVIDER DISCRIMINATOR IS COST PER TOKEN, NOT COST. `style_reference_meta` records
// neither provider nor model, and `cost_breakdown` records aggregates rather than model ids.
// A gemma-written article is metered at exactly zero — GEMMA_COST_PROVIDER is in
// UNBILLED_TEXT_PROVIDERS, so its tokens are COUNTED and its cost is not — while an OpenAI one
// bills at the published rate. So the reading is: zero billed text against real tokens is
// gemma, and an implied rate at or above sol's own floor is OpenAI.
//
// A RATE, because an absolute figure does not work and that was measured rather than reasoned:
// the first version of this file used a $0.08 floor and filed 26 of 38 real rows as
// "ambiguous", when every one of them reconciles to the cent against gpt-5.6-sol's $5/1M in
// and $30/1M out. A short OpenAI article is simply cheap. What the band below the floor is
// genuinely for is a gemma article whose length fit or name scan ran on OpenAI — a small bill
// against a large token count. Every row's cost, tokens and implied rate are printed, so the
// verdict can be disagreed with rather than merely read.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import {
  createServiceRoleClient,
  DLO_INTAKES_TABLE,
  GENERATION_REVISIONS_TABLE,
  GENERATIONS_TABLE,
  type DloIntakeFileEntry,
  type SupabaseClient,
} from '@dgipr/database';

// PostgREST caps a select at 1000 rows, silently. A silently truncated survey understates the
// pool, which is the one error here that would send Phase 1 after the wrong dataset.
const PAGE_SIZE = 1000;
const MAX_ROWS = 50_000;
// An `.in()` list travels in the query string. 80 uuids is ~3 KB, comfortably inside every URL
// limit in the stack.
const ID_BATCH = 80;

const DEFAULT_OUT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../data/finetune/distill',
);

/** Plan 0.3's floor: under this many INDEPENDENT groups, widen to the older text lane. */
export const DEFAULT_GROUPS_TARGET = 80;

/**
 * The IMPLIED blended rate, in USD per 1,000 metered tokens, at or above which a run reads as
 * written by OpenAI.
 *
 * A rate rather than an absolute figure, and the difference is not academic: the first draft
 * of this file used an absolute $0.08 floor and filed 26 of 38 real rows as "ambiguous"
 * because a SHORT OpenAI article is cheap. Checked against the published `gpt-5.6-sol` prices
 * ($5/1M input, $30/1M output), every one of those rows reconciles to the cent — 1213 in +
 * 837 out really is $0.0312 — so they were OpenAI all along and the classifier was the thing
 * that was wrong.
 *
 * 0.004 sits just below sol's theoretical minimum, which is an all-input run at $0.005/1K; a
 * real one blends in output at $0.03/1K and lands between $0.008 and $0.027. A gemma article
 * is metered at exactly zero (GEMMA_COST_PROVIDER is unbilled) while its tokens are still
 * counted, so a gemma run that also made one billed helper call implies a rate far below this
 * — which is what the band between zero and the floor is for.
 */
export const OPENAI_RATE_FLOOR_USD_PER_1K = 0.004;

// ---------------------------------------------------------------------------
// Row shapes — exactly the columns this survey reads, and no more.
// ---------------------------------------------------------------------------

export type SurveyGenerationRow = Readonly<{
  id: string;
  created_at: string;
  dlo_intake_id: string | null;
  thread_root_id: string | null;
  category: string;
  output_type: string;
  cost_usd: number | string | null;
  cost_breakdown: unknown;
  style_reference_meta: unknown;
}>;

const GENERATION_COLUMNS =
  'id,created_at,dlo_intake_id,thread_root_id,category,output_type,cost_usd,cost_breakdown,style_reference_meta';

export type SurveyIntakeRow = Readonly<{
  id: string;
  files: readonly DloIntakeFileEntry[] | null;
}>;

// ---------------------------------------------------------------------------
// Pure classification — everything below is testable with no database at all, which is what
// `--check` exercises.
// ---------------------------------------------------------------------------

export type Lane = 'native' | 'text' | 'mixed' | 'notes-only' | 'unknown';

/**
 * Which /dlo lane produced this run's sources.
 *
 * `openaiFileId` is the /new-dlo native-file lane: the document was handed to the model as a
 * file and never transcribed, so the student has no source TEXT and Phase 1 must OCR it once.
 * `text`/`pages` is the older lane, whose characters are already in the row — free.
 */
export function classifyLane(
  files: readonly DloIntakeFileEntry[] | null | undefined,
): Lane {
  if (files === null || files === undefined) return 'unknown';
  const usable = files.filter((file) => file.status !== 'failed');
  if (usable.length === 0) return 'notes-only';
  let native = 0;
  let text = 0;
  for (const file of usable) {
    if (file.openaiFileId) native += 1;
    else if (file.text?.trim() || (file.pages ?? []).some((p) => p.text.trim()))
      text += 1;
  }
  if (native > 0 && text > 0) return 'mixed';
  if (native > 0) return 'native';
  if (text > 0) return 'text';
  return 'notes-only';
}

export type Provider = 'gemma' | 'openai' | 'ambiguous' | 'unknown';

export type CostFacts = Readonly<{
  costUsd: number | null;
  chatCalls: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
}>;

export function readCostFacts(row: {
  cost_usd: number | string | null;
  cost_breakdown: unknown;
}): CostFacts {
  const raw = row.cost_breakdown;
  const breakdown =
    raw !== null && typeof raw === 'object'
      ? (raw as Partial<Record<string, unknown>>)
      : null;
  const num = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) ? value : null;
  return {
    costUsd:
      row.cost_usd === null || row.cost_usd === undefined
        ? null
        : Number(row.cost_usd),
    chatCalls: num(breakdown?.['chatCalls']),
    inputTokens: num(breakdown?.['inputTokens']),
    outputTokens: num(breakdown?.['outputTokens']),
  };
}

/** Metered tokens, or null when the breakdown recorded none. */
export function meteredTokens(facts: CostFacts): number | null {
  if (facts.inputTokens === null && facts.outputTokens === null) return null;
  return (facts.inputTokens ?? 0) + (facts.outputTokens ?? 0);
}

/** USD per 1,000 metered tokens, or null when it cannot be computed. */
export function impliedRatePer1K(facts: CostFacts): number | null {
  const tokens = meteredTokens(facts);
  if (facts.costUsd === null || tokens === null || tokens === 0) return null;
  return (facts.costUsd / tokens) * 1000;
}

/**
 * Which model wrote this article, inferred from what it cost PER TOKEN.
 *
 * `unknown` when nothing was metered at all — a run that recorded no chat call, or no tokens,
 * cannot be attributed, and calling that "gemma" because the figure is zero would read a
 * MISSING measurement as a positive one.
 */
export function classifyProvider(facts: CostFacts): Provider {
  const { costUsd, chatCalls } = facts;
  if (costUsd === null) return 'unknown';
  if (chatCalls !== null && chatCalls === 0) return 'unknown';
  const tokens = meteredTokens(facts);
  if (tokens === null || tokens === 0) return 'unknown';
  // Exactly zero billed text against real tokens is the unbilled self-hosted provider, and it
  // is the one reading that needs no threshold at all.
  if (costUsd === 0) return 'gemma';
  const rate = impliedRatePer1K(facts);
  if (rate === null) return 'unknown';
  return rate >= OPENAI_RATE_FLOOR_USD_PER_1K ? 'openai' : 'ambiguous';
}

export type StyleFacts = Readonly<{
  promptVersion: string | null;
  source: string | null;
  articleCount: number | null;
}>;

export function readStyleFacts(meta: unknown): StyleFacts {
  if (meta === null || typeof meta !== 'object') {
    return { promptVersion: null, source: null, articleCount: null };
  }
  const record = meta as Partial<Record<string, unknown>>;
  const str = (value: unknown): string | null =>
    typeof value === 'string' && value.trim() !== '' ? value : null;
  const count = record['articleCount'];
  return {
    promptVersion: str(record['promptVersion']),
    source: str(record['source']),
    articleCount:
      typeof count === 'number' && Number.isFinite(count) ? count : null,
  };
}

/**
 * The key an example is INDEPENDENT under.
 *
 * The intake first: several generations from one intake are the same source material, so they
 * are one example however many times the officer re-ran it. Then the thread root, which
 * catches a follow-up chain. The id itself is the last resort and is exactly the case the
 * export doc warns about — never the default.
 */
export function groupKeyOf(row: {
  id: string;
  dlo_intake_id: string | null;
  thread_root_id: string | null;
}): string {
  return row.dlo_intake_id ?? row.thread_root_id ?? row.id;
}

export type RowFinding = Readonly<{
  id: string;
  createdAt: string;
  group: string;
  intakeId: string | null;
  category: string;
  lane: Lane;
  provider: Provider;
  cost: CostFacts;
  style: StyleFacts;
  hasArticleRevision: boolean;
  fileCount: number;
}>;

function tally(values: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const value of values) out[value] = (out[value] ?? 0) + 1;
  return out;
}

export type PoolSummary = Readonly<{
  rows: number;
  groups: number;
  intakes: number;
  lanes: Record<string, number>;
  providers: Record<string, number>;
  promptVersions: Record<string, number>;
  styleSources: Record<string, number>;
  articleCounts: Record<string, number>;
  categories: Record<string, number>;
  withArticleRevision: number;
  /** Plan 0.2's verdict, and what decides the capture harness's env. */
  exemplarUniformity: 'none' | 'some' | 'mixed' | 'unknown';
}>;

export function summarize(findings: readonly RowFinding[]): PoolSummary {
  const withRefs = findings.filter((f) => (f.style.articleCount ?? 0) > 0);
  const withoutRefs = findings.filter(
    (f) => f.style.articleCount !== null && f.style.articleCount === 0,
  );
  const uniformity: PoolSummary['exemplarUniformity'] =
    findings.length === 0
      ? 'unknown'
      : withRefs.length > 0 && withoutRefs.length > 0
        ? 'mixed'
        : withRefs.length > 0
          ? 'some'
          : withoutRefs.length > 0
            ? 'none'
            : 'unknown';
  return {
    rows: findings.length,
    groups: new Set(findings.map((f) => f.group)).size,
    intakes: new Set(
      findings.map((f) => f.intakeId).filter((id): id is string => id !== null),
    ).size,
    lanes: tally(findings.map((f) => f.lane)),
    providers: tally(findings.map((f) => f.provider)),
    promptVersions: tally(
      findings.map((f) => f.style.promptVersion ?? '(none)'),
    ),
    styleSources: tally(findings.map((f) => f.style.source ?? '(none)')),
    articleCounts: tally(
      findings.map((f) =>
        f.style.articleCount === null ? '(none)' : String(f.style.articleCount),
      ),
    ),
    categories: tally(findings.map((f) => f.category)),
    withArticleRevision: findings.filter((f) => f.hasArticleRevision).length,
    exemplarUniformity: uniformity,
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function fetchDloArticleRows(
  client: SupabaseClient,
  since: string | null,
): Promise<SurveyGenerationRow[]> {
  const rows: SurveyGenerationRow[] = [];
  for (let offset = 0; offset < MAX_ROWS; offset += PAGE_SIZE) {
    let query = client
      .from(GENERATIONS_TABLE)
      .select(GENERATION_COLUMNS)
      .not('dlo_intake_id', 'is', null)
      .eq('status', 'completed')
      .in('category', ['news', 'scheme'])
      .neq('output_type', 'poster')
      // `eq(false)` would exclude NULL, and a row created before article_provided existed
      // carries one — dropping exactly the oldest rows the widening in 0.3 depends on.
      .or('article_provided.is.null,article_provided.eq.false');
    if (since) query = query.gte('created_at', since);
    const { data, error } = await query
      .order('created_at', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) {
      throw new Error(`Failed to read ${GENERATIONS_TABLE}: ${error.message}`);
    }
    const page = (data ?? []) as unknown as SurveyGenerationRow[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

export async function fetchIntakeFiles(
  client: SupabaseClient,
  ids: readonly string[],
): Promise<Map<string, readonly DloIntakeFileEntry[] | null>> {
  const out = new Map<string, readonly DloIntakeFileEntry[] | null>();
  for (let i = 0; i < ids.length; i += ID_BATCH) {
    const batch = ids.slice(i, i + ID_BATCH);
    const { data, error } = await client
      .from(DLO_INTAKES_TABLE)
      .select('id,files')
      .in('id', batch);
    if (error) {
      throw new Error(`Failed to read ${DLO_INTAKES_TABLE}: ${error.message}`);
    }
    for (const row of (data ?? []) as unknown as SurveyIntakeRow[]) {
      out.set(row.id, row.files ?? null);
    }
  }
  return out;
}

export async function fetchArticleRevisionIds(
  client: SupabaseClient,
  ids: readonly string[],
): Promise<Set<string>> {
  const out = new Set<string>();
  for (let i = 0; i < ids.length; i += ID_BATCH) {
    const batch = ids.slice(i, i + ID_BATCH);
    const { data, error } = await client
      .from(GENERATION_REVISIONS_TABLE)
      .select('generation_id')
      .eq('target', 'article')
      .in('generation_id', batch);
    if (error) {
      throw new Error(
        `Failed to read ${GENERATION_REVISIONS_TABLE}: ${error.message}`,
      );
    }
    for (const row of (data ?? []) as unknown as Array<{
      generation_id: string;
    }>) {
      out.add(row.generation_id);
    }
  }
  return out;
}

export async function surveyPool(
  client: SupabaseClient,
  options: Readonly<{ since: string | null; maxIntakes: number }>,
): Promise<RowFinding[]> {
  const rows = await fetchDloArticleRows(client, options.since);
  const intakeIds = [
    ...new Set(
      rows
        .map((row) => row.dlo_intake_id)
        .filter((id): id is string => id !== null),
    ),
  ];
  if (intakeIds.length > options.maxIntakes) {
    throw new Error(
      `${intakeIds.length} intakes are in range, above the --max-intakes ceiling of ` +
        `${options.maxIntakes}. Narrow the window or raise the ceiling deliberately — each ` +
        `intake's files column can carry a whole document's extracted pages.`,
    );
  }
  const [files, revised] = await Promise.all([
    fetchIntakeFiles(client, intakeIds),
    fetchArticleRevisionIds(
      client,
      rows.map((row) => row.id),
    ),
  ]);

  return rows.map((row): RowFinding => {
    const cost = readCostFacts(row);
    const entries = row.dlo_intake_id
      ? (files.get(row.dlo_intake_id) ?? null)
      : null;
    return {
      id: row.id,
      createdAt: row.created_at,
      group: groupKeyOf(row),
      intakeId: row.dlo_intake_id,
      category: row.category,
      lane: classifyLane(entries),
      provider: classifyProvider(cost),
      cost,
      style: readStyleFacts(row.style_reference_meta),
      hasArticleRevision: revised.has(row.id),
      fileCount: entries?.length ?? 0,
    };
  });
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function table(counts: Record<string, number>): string {
  const keys = Object.keys(counts).sort();
  if (keys.length === 0) return '    (none)';
  return keys.map((key) => `    ${key.padEnd(22)} ${counts[key]}`).join('\n');
}

export function renderSummary(label: string, summary: PoolSummary): string {
  return [
    `=== ${label} ===`,
    `  rows:                                     ${summary.rows}`,
    `  INDEPENDENT groups:                       ${summary.groups}   (distinct intakes: ${summary.intakes})`,
    `  with a feedback round (target='article'): ${summary.withArticleRevision}`,
    '',
    '  category',
    table(summary.categories),
    '  lane (0.2: where the student source text has to come from)',
    table(summary.lanes),
    '  provider, inferred from billed text (0.2)',
    table(summary.providers),
    '  style_reference_meta.promptVersion',
    table(summary.promptVersions),
    '  style_reference_meta.source',
    table(summary.styleSources),
    '  style_reference_meta.articleCount',
    table(summary.articleCounts),
  ].join('\n');
}

export function renderVerdicts(
  summary: PoolSummary,
  groupsTarget: number,
): string {
  const lines: string[] = ['=== verdicts ==='];

  switch (summary.exemplarUniformity) {
    case 'none':
      lines.push(
        '  0.2 exemplars: UNIFORM (every row received 0). Teacher and student prompts both',
        "      carry no '### MAHASAMVAD STYLE REFERENCES' block. Nothing further is needed.",
      );
      break;
    case 'some':
      lines.push(
        '  0.2 exemplars: UNIFORM, but every row DID receive references. The capture harness',
        '      must reproduce that — confirm ARTICLE_STYLE_REFERENCES_ENABLED and the retrieval',
        '      floor match production, and record both in the sidecar.',
      );
      break;
    case 'mixed':
      lines.push(
        '  0.2 exemplars: MIXED — some rows received references and some did not. Pin',
        "      ARTICLE_STYLE_REFERENCES_ENABLED=false in the capture harness's own env so the",
        '      dataset is uniform, and record that in the sidecar.',
      );
      break;
    default:
      lines.push(
        '  0.2 exemplars: UNKNOWN — no row carried a readable style_reference_meta. Confirm the',
        '      rows exist and were written by a build that records it before deciding.',
      );
  }

  const gemma = summary.providers['gemma'] ?? 0;
  const openai = summary.providers['openai'] ?? 0;
  if (gemma + openai > 0) {
    lines.push(
      `  0.2 provider: ${gemma} gemma-written, ${openai} OpenAI-written. NOTE this is about the`,
      '      article the row already holds, which the plan discards anyway — every target is',
      '      teacher-regenerated. What it does affect is Phase 5, whose "base gemma (today\'s',
      '      behaviour)" arm only means today if the deployed ARTICLE_PROVIDER really is gemma.',
    );
  }
  const ambiguous = summary.providers['ambiguous'] ?? 0;
  if (ambiguous > 0) {
    lines.push(
      `  0.2 provider: ${ambiguous} row(s) billed something, but under $${OPENAI_RATE_FLOOR_USD_PER_1K}/1K tokens — too`,
      '      cheap for an OpenAI article. Read them with --rows: a gemma article whose length',
      '      fit or name scan fired on OpenAI looks exactly like this.',
    );
  }

  if (summary.groups >= groupsTarget) {
    lines.push(
      `  0.3 pool: ${summary.groups} independent groups, at or above the ${groupsTarget} floor. Capture from`,
      '      this window alone.',
    );
  } else {
    lines.push(
      `  0.3 pool: ${summary.groups} independent groups, BELOW the ${groupsTarget} floor. Widen to the older`,
      '      /dlo text lane — those rows carry their source as text already, so they need no',
      '      OCR at all. The ALL TIME section below is that count.',
    );
  }
  return lines.join('\n');
}

export function renderRows(findings: readonly RowFinding[]): string {
  const header = [
    'id'.padEnd(38),
    'date'.padEnd(11),
    'lane'.padEnd(11),
    'provider'.padEnd(10),
    'cost'.padEnd(9),
    // The number the provider verdict is actually made on, printed so the verdict can be
    // disagreed with rather than merely read.
    '$/1Ktok'.padEnd(10),
    'tok(in/out)'.padEnd(16),
    'promptVersion'.padEnd(16),
    'style'.padEnd(18),
    'fb',
  ].join('');
  const body = findings.map((f) => {
    const io =
      f.cost.inputTokens === null && f.cost.outputTokens === null
        ? '-'
        : `${f.cost.inputTokens ?? '?'}/${f.cost.outputTokens ?? '?'}`;
    const rate = impliedRatePer1K(f.cost);
    return [
      f.id.padEnd(38),
      f.createdAt.slice(0, 10).padEnd(11),
      f.lane.padEnd(11),
      f.provider.padEnd(10),
      (f.cost.costUsd === null ? '-' : f.cost.costUsd.toFixed(4)).padEnd(9),
      (rate === null ? '-' : rate.toFixed(5)).padEnd(10),
      io.padEnd(16),
      (f.style.promptVersion ?? '-').padEnd(16),
      `${f.style.source ?? '-'}x${f.style.articleCount ?? '-'}`.padEnd(18),
      f.hasArticleRevision ? 'yes' : '-',
    ].join('');
  });
  return ['=== rows ===', header, ...body].join('\n');
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      days: { type: 'string' },
      'groups-target': { type: 'string' },
      'max-intakes': { type: 'string' },
      extended: { type: 'boolean' },
      rows: { type: 'boolean' },
      json: { type: 'string' },
      check: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    console.log(
      [
        'Usage: pnpm finetune:survey [--days 7] [--extended] [--rows] [--json <file>]',
        '',
        'Read-only. Answers plan 0.2 (what production emits) and 0.3 (how big the pool is).',
        'No model call, no write, nothing billed.',
        '',
        '  --days N           primary window, in days (default 7)',
        `  --groups-target N  the independent-group floor (default ${DEFAULT_GROUPS_TARGET})`,
        '  --max-intakes N    refuse above this many intakes (default 800)',
        '  --extended         also scan ALL TIME, for the widening decision',
        '  --rows             print the per-row evidence table',
        '  --json <file>      write the full report as JSON',
        '  --check            run the offline harness; touches no database',
      ].join('\n'),
    );
    return;
  }
  if (values.check) {
    runChecks();
    return;
  }

  const days = Number(values.days ?? 7);
  if (!Number.isFinite(days) || days <= 0) {
    throw new Error('--days must be a positive number.');
  }
  const groupsTarget = Number(values['groups-target'] ?? DEFAULT_GROUPS_TARGET);
  if (!Number.isFinite(groupsTarget) || groupsTarget <= 0) {
    throw new Error('--groups-target must be a positive number.');
  }
  const maxIntakes = Number(values['max-intakes'] ?? 800);
  if (!Number.isFinite(maxIntakes) || maxIntakes <= 0) {
    throw new Error('--max-intakes must be a positive number.');
  }

  const client = createServiceRoleClient();
  const since = daysAgoIso(days);
  const primary = await surveyPool(client, { since, maxIntakes });
  const primarySummary = summarize(primary);

  console.log(
    renderSummary(`last ${days} day(s) — since ${since}`, primarySummary),
  );
  console.log('');
  if (values.rows) {
    console.log(renderRows(primary));
    console.log('');
  }
  console.log(renderVerdicts(primarySummary, groupsTarget));

  // The widening question is only worth the extra read when the primary window falls short,
  // or when it was asked for outright.
  let extended: RowFinding[] | null = null;
  let extendedSummary: PoolSummary | null = null;
  let textLaneSummary: PoolSummary | null = null;
  if (values.extended || primarySummary.groups < groupsTarget) {
    console.log('');
    extended = await surveyPool(client, { since: null, maxIntakes });
    extendedSummary = summarize(extended);
    console.log(renderSummary('ALL TIME (the widening pool)', extendedSummary));

    // The text lane is what widening actually reaches for — those rows carry their source as
    // characters already, so they cost no OCR — which makes ITS uniformity the operative
    // question, not the whole pool's. Verdicting only the primary window would leave the
    // decision that is actually being taken unreported.
    textLaneSummary = summarize(
      extended.filter((f) => f.lane === 'text' || f.lane === 'notes-only'),
    );
    console.log('');
    console.log(
      renderSummary(
        'the OLDER TEXT LANE within it (no OCR needed — this is the widening target)',
        textLaneSummary,
      ),
    );
    console.log('');
    console.log(renderVerdicts(textLaneSummary, groupsTarget));
  }

  if (values.json) {
    // pnpm --filter changes cwd; resolve user paths relative to the invoking workspace.
    const invocationDir = process.env.INIT_CWD ?? process.cwd();
    const path = resolve(invocationDir, values.json);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(
      path,
      JSON.stringify(
        {
          capturedAt: new Date().toISOString(),
          window: { days, since },
          groupsTarget,
          primary: { summary: primarySummary, rows: primary },
          extended: extendedSummary
            ? {
                summary: extendedSummary,
                textLaneSummary,
                rows: extended,
              }
            : null,
        },
        null,
        2,
      ) + '\n',
      'utf8',
    );
    console.log(`\nReport written: ${path}`);
  } else {
    console.log(
      `\n(Phase 2 artefacts belong under ${DEFAULT_OUT}; pass --json to record this report.)`,
    );
  }
}

// ---------------------------------------------------------------------------
// Free harness: the pure classifiers, no network.
//   npx tsx src/finetune/survey-dlo-pool.ts --check
// ---------------------------------------------------------------------------

function runChecks(): void {
  const checks: Array<[string, boolean]> = [];
  const check = (label: string, ok: boolean): void => {
    checks.push([label, ok]);
  };
  const file = (over: Partial<DloIntakeFileEntry>): DloIntakeFileEntry =>
    ({
      name: 'f.pdf',
      kind: 'pdf',
      status: 'done',
      ...over,
    }) as DloIntakeFileEntry;

  check('no files at all is notes-only', classifyLane([]) === 'notes-only');
  check('a null files column is unknown', classifyLane(null) === 'unknown');
  check(
    'an openaiFileId is the native lane',
    classifyLane([file({ openaiFileId: 'file-1' })]) === 'native',
  );
  check(
    'extracted text is the older lane',
    classifyLane([file({ text: 'मजकूर' })]) === 'text',
  );
  check(
    'so are extracted pages',
    classifyLane([file({ pages: [{ page: 1, text: 'मजकूर' }] })]) === 'text',
  );
  check(
    'a page with no text is not a text source',
    classifyLane([file({ pages: [{ page: 1, text: '  ' }] })]) === 'notes-only',
  );
  check(
    'both kinds together is mixed',
    classifyLane([
      file({ openaiFileId: 'file-1' }),
      file({ text: 'मजकूर' }),
    ]) === 'mixed',
  );
  check(
    'a failed source is ignored',
    classifyLane([
      file({ status: 'failed', openaiFileId: 'file-1' }),
      file({ text: 'मजकूर' }),
    ]) === 'text',
  );

  const facts = (
    costUsd: number | null,
    chatCalls: number | null = 3,
  ): CostFacts => ({
    costUsd,
    chatCalls,
    inputTokens: 9000,
    outputTokens: 1800,
  });
  check(
    'free text with real calls reads as gemma',
    classifyProvider(facts(0)) === 'gemma',
  );
  check(
    'a real figure reads as openai',
    classifyProvider(facts(0.31)) === 'openai',
  );
  check(
    'an unmetered row is unknown, not gemma',
    classifyProvider(facts(null)) === 'unknown',
  );
  check(
    'and so is a row that recorded no chat call at all',
    classifyProvider(facts(0, 0)) === 'unknown',
  );
  check(
    'a row with a cost but no token counts is unknown, not a rate of infinity',
    classifyProvider({
      costUsd: 0.05,
      chatCalls: 2,
      inputTokens: null,
      outputTokens: null,
    }) === 'unknown',
  );

  // The four rows below are VERBATIM from the live survey of 2026-09-13..19, and each one
  // reconciles to the cent against gpt-5.6-sol's published $5/1M input, $30/1M output. They
  // are here because an absolute-dollar threshold filed every one of them as "ambiguous".
  const real = (
    costUsd: number,
    inputTokens: number,
    outputTokens: number,
  ): CostFacts => ({ costUsd, chatCalls: 2, inputTokens, outputTokens });
  check(
    'a SHORT openai article is still openai (0.0312 over 1213+837)',
    classifyProvider(real(0.0312, 1213, 837)) === 'openai',
  );
  check(
    'and a tiny one (0.0078 over 39+253)',
    classifyProvider(real(0.0078, 39, 253)) === 'openai',
  );
  check(
    'and an input-heavy one (0.1822 over 19702+2790)',
    classifyProvider(real(0.1822, 19702, 2790)) === 'openai',
  );
  check(
    'while the real gemma row is gemma (0.0000 over 1724+715)',
    classifyProvider(real(0, 1724, 715)) === 'gemma',
  );
  check(
    'a gemma article plus one small billed helper is ambiguous, not openai',
    classifyProvider(real(0.004, 9000, 1800)) === 'ambiguous',
  );
  check(
    'the implied rate is reported per 1K tokens',
    Math.abs((impliedRatePer1K(real(0.0312, 1213, 837)) ?? 0) - 0.01522) < 1e-5,
  );

  check(
    'cost facts are read off the breakdown',
    (() => {
      const read = readCostFacts({
        cost_usd: '0.2500',
        cost_breakdown: { chatCalls: 2, inputTokens: 100, outputTokens: 50 },
      });
      return (
        read.costUsd === 0.25 &&
        read.chatCalls === 2 &&
        read.inputTokens === 100 &&
        read.outputTokens === 50
      );
    })(),
  );
  check(
    'a missing breakdown is nulls, not zeroes',
    (() => {
      const read = readCostFacts({ cost_usd: null, cost_breakdown: null });
      return read.costUsd === null && read.chatCalls === null;
    })(),
  );

  const style = readStyleFacts({
    promptVersion: 'dlo-rag-v2',
    source: 'none',
    articleCount: 0,
  });
  check(
    'style meta is read',
    style.promptVersion === 'dlo-rag-v2' &&
      style.source === 'none' &&
      style.articleCount === 0,
  );
  check(
    'articleCount 0 survives as 0, never as null',
    readStyleFacts({ articleCount: 0 }).articleCount === 0,
  );
  check(
    'a null meta is all nulls',
    readStyleFacts(null).promptVersion === null,
  );

  check(
    'the intake is the group key',
    groupKeyOf({ id: 'g1', dlo_intake_id: 'i1', thread_root_id: 't1' }) ===
      'i1',
  );
  check(
    'the thread root is next',
    groupKeyOf({ id: 'g1', dlo_intake_id: null, thread_root_id: 't1' }) ===
      't1',
  );
  check(
    'the id is the last resort',
    groupKeyOf({ id: 'g1', dlo_intake_id: null, thread_root_id: null }) ===
      'g1',
  );

  const finding = (over: Partial<RowFinding>): RowFinding => ({
    id: 'a',
    createdAt: '2026-09-14T00:00:00Z',
    group: 'i1',
    intakeId: 'i1',
    category: 'news',
    lane: 'native',
    provider: 'gemma',
    cost: facts(0),
    style: { promptVersion: 'dlo-rag-v2', source: 'none', articleCount: 0 },
    hasArticleRevision: false,
    fileCount: 1,
    ...over,
  });

  const correlated = summarize([
    finding({ id: 'a', group: 'i1' }),
    finding({ id: 'b', group: 'i1' }),
    finding({ id: 'c', group: 'i2', intakeId: 'i2' }),
  ]);
  check('three rows', correlated.rows === 3);
  check(
    'but two INDEPENDENT groups — the number that matters',
    correlated.groups === 2,
  );
  check(
    'a pool where nothing got exemplars is uniform-none',
    correlated.exemplarUniformity === 'none',
  );

  const mixedPool = summarize([
    finding({}),
    finding({
      id: 'd',
      group: 'i3',
      style: {
        promptVersion: 'dlo-rag-v2',
        source: 'retrieval',
        articleCount: 3,
      },
    }),
  ]);
  check(
    'a pool where some did and some did not is mixed',
    mixedPool.exemplarUniformity === 'mixed',
  );
  check(
    'an empty pool is unknown, not uniform',
    summarize([]).exemplarUniformity === 'unknown',
  );
  check(
    'feedback rounds are counted',
    summarize([finding({ hasArticleRevision: true }), finding({ id: 'e' })])
      .withArticleRevision === 1,
  );

  const verdictMixed = renderVerdicts(mixedPool, 80);
  check(
    'a mixed pool is told to pin the flag off',
    verdictMixed.includes('ARTICLE_STYLE_REFERENCES_ENABLED=false'),
  );
  check(
    'a thin pool is told to widen',
    verdictMixed.includes('BELOW the 80 floor'),
  );
  check(
    'a pool at the floor is not',
    renderVerdicts(summarize([finding({})]), 1).includes('at or above'),
  );
  check(
    'an ambiguous row is surfaced in the verdict',
    renderVerdicts(
      summarize([finding({ provider: 'ambiguous', cost: facts(0.004) })]),
      1,
    ).includes('too'),
  );
  check(
    'and the provider split is reported so Phase 5 knows what "today" is',
    renderVerdicts(
      summarize([finding({}), finding({ id: 'z', provider: 'openai' })]),
      1,
    ).includes('1 gemma-written, 1 OpenAI-written'),
  );

  let failed = 0;
  for (const [label, ok] of checks) {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
    if (!ok) failed += 1;
  }
  console.log(`\n${checks.length - failed}/${checks.length} passed.`);
  process.exitCode = failed > 0 ? 1 : 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Survey failed.');
    process.exitCode = 1;
  });
}
