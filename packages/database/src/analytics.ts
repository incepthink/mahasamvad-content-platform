// Read side of the analytics page: lean, windowed pulls from the tables that already record
// real work (generations, dlo_intakes, transcriptions, video_projects, generation_revisions).
// Grouping happens in Node — see apps/api/src/jobs/analytics.ts — so this file stays plain
// PostgREST with no SQL functions to keep in sync with the code that reads them.
//
// THE RULE EVERY SELECT HERE FOLLOWS: never pull a text column. `note`, `article`,
// `combined_text`, `files` and `scenes` hold whole meeting transcripts and whole articles;
// selecting them would move megabytes to answer "how many". Where a metric genuinely depends
// on a text column existing (does this social run have a caption?), it is answered with a
// head-only COUNT below instead, which transfers no rows at all.
//
// Every window is half-open [from, to) so a run cannot be counted in two periods.

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  GENERATIONS_TABLE,
  GENERATION_REVISIONS_TABLE,
} from './generations.js';
import { DLO_INTAKES_TABLE } from './dlo-intakes.js';
import { TRANSCRIPTIONS_TABLE } from './transcriptions.js';
import { VIDEO_PROJECTS_TABLE } from './video-projects.js';

// PostgREST caps a select at 1000 rows by default, silently. A department's busy quarter is
// more than that, and a silently truncated analytics page reports a decline that did not
// happen — so every list here pages explicitly, up to a stated ceiling.
const PAGE_SIZE = 1000;
const MAX_ROWS = 50_000;

async function fetchPaged<T>(
  client: SupabaseClient,
  table: string,
  columns: string,
  from: string,
  to: string,
): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; offset < MAX_ROWS; offset += PAGE_SIZE) {
    const { data, error } = await client
      .from(table)
      .select(columns)
      .gte('created_at', from)
      .lt('created_at', to)
      .order('created_at', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) {
      throw new Error(
        `Failed to read ${table} for analytics: ${error.message}`,
      );
    }
    const page = (data ?? []) as unknown as T[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

// One generation run, reduced to what can be counted. `posterPath` is here because its mere
// presence is the answer to "was a poster produced" and it is a short path, not a document.
export type AnalyticsGenerationRow = Readonly<{
  id: string;
  category: string;
  outputType: string;
  status: string;
  designMode: string | null;
  templateBrand: string | null;
  dloIntakeId: string | null;
  articleProvided: boolean | null;
  posterPath: string | null;
  publishedAt: string | null;
  costUsd: number;
  // The per-capability audit detail behind cost_usd (chat calls + tokens + image renders).
  // Selected because it is what lets /analytics report WHICH service a feature ran on with
  // FULL history — an events-only answer would begin at instrumentation deploy day. It is a
  // small fixed-shape jsonb of integers, not a text column, so it does not violate the
  // no-text-column rule this file otherwise follows.
  costBreakdown: AnalyticsCostBreakdown | null;
  createdAt: string;
}>;

// The subset of GenerationCostBreakdown / VideoProjectCostBreakdown the analytics page
// reads. Every field optional: rows written before a field existed simply lack it, and a
// missing figure must read as zero rather than crash the page.
export type AnalyticsCostBreakdown = Readonly<{
  chatCalls?: number;
  textCostUsd?: number;
  imageCount?: number;
  imageCostUsd?: number;
  videoSeconds?: number;
  videoCostUsd?: number;
  ttsCharacters?: number;
  ttsCostUsd?: number;
}>;

const GENERATION_COLUMNS =
  'id,category,output_type,status,design_mode,template_brand,dlo_intake_id,article_provided,poster_path,published_at,cost_usd,cost_breakdown,created_at';

export async function listGenerationsForAnalytics(
  client: SupabaseClient,
  from: string,
  to: string,
): Promise<AnalyticsGenerationRow[]> {
  const rows = await fetchPaged<{
    id: string;
    category: string;
    output_type: string;
    status: string;
    design_mode: string | null;
    template_brand: string | null;
    dlo_intake_id: string | null;
    article_provided: boolean | null;
    poster_path: string | null;
    published_at: string | null;
    // numeric(10,4) arrives as a string from PostgREST.
    cost_usd: number | string | null;
    cost_breakdown: AnalyticsCostBreakdown | null;
    created_at: string;
  }>(client, GENERATIONS_TABLE, GENERATION_COLUMNS, from, to);
  return rows.map((row) => ({
    id: row.id,
    category: row.category,
    outputType: row.output_type,
    status: row.status,
    designMode: row.design_mode,
    templateBrand: row.template_brand,
    dloIntakeId: row.dlo_intake_id,
    articleProvided: row.article_provided,
    posterPath: row.poster_path,
    publishedAt: row.published_at,
    costUsd: Number(row.cost_usd ?? 0) || 0,
    costBreakdown: row.cost_breakdown ?? null,
    createdAt: row.created_at,
  }));
}

export type AnalyticsRevisionRow = Readonly<{
  generationId: string;
  target: string;
  createdAt: string;
}>;

// Feedback rounds. Which feature each belongs to is resolved by joining `generationId`
// against the generations already fetched for the same window, rather than by a second
// query — a revision is always created after its generation, so the parent is in the window
// except at its very edge.
export async function listRevisionsForAnalytics(
  client: SupabaseClient,
  from: string,
  to: string,
): Promise<AnalyticsRevisionRow[]> {
  const rows = await fetchPaged<{
    generation_id: string;
    target: string;
    created_at: string;
  }>(
    client,
    GENERATION_REVISIONS_TABLE,
    'generation_id,target,created_at',
    from,
    to,
  );
  return rows.map((row) => ({
    generationId: row.generation_id,
    target: row.target,
    createdAt: row.created_at,
  }));
}

export type AnalyticsIntakeRow = Readonly<{
  id: string;
  status: string;
  category: string;
  createdAt: string;
}>;

// `files` is deliberately NOT selected: it carries every recording's transcript and every
// PDF page's text. That costs the analytics page the source mix (recordings vs documents vs
// YouTube), which is not worth moving a meeting's transcript per intake per page load.
export async function listIntakesForAnalytics(
  client: SupabaseClient,
  from: string,
  to: string,
): Promise<AnalyticsIntakeRow[]> {
  const rows = await fetchPaged<{
    id: string;
    status: string;
    category: string;
    created_at: string;
  }>(client, DLO_INTAKES_TABLE, 'id,status,category,created_at', from, to);
  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    category: row.category,
    createdAt: row.created_at,
  }));
}

export type AnalyticsTranscriptionRow = Readonly<{
  id: string;
  status: string;
  fileCount: number;
  failedCount: number;
  charCount: number;
  createdAt: string;
}>;

// The three counters exist as columns precisely so a listing never has to read `files` or
// `combined_text` (0037) — analytics is the second consumer of that decision.
export async function listTranscriptionsForAnalytics(
  client: SupabaseClient,
  from: string,
  to: string,
): Promise<AnalyticsTranscriptionRow[]> {
  const rows = await fetchPaged<{
    id: string;
    status: string;
    file_count: number | null;
    failed_count: number | null;
    char_count: number | null;
    created_at: string;
  }>(
    client,
    TRANSCRIPTIONS_TABLE,
    'id,status,file_count,failed_count,char_count,created_at',
    from,
    to,
  );
  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    fileCount: row.file_count ?? 0,
    failedCount: row.failed_count ?? 0,
    charCount: row.char_count ?? 0,
    createdAt: row.created_at,
  }));
}

export type AnalyticsVideoRow = Readonly<{
  id: string;
  status: string;
  inputMode: string | null;
  costUsd: number;
  costBreakdown: AnalyticsCostBreakdown | null;
  createdAt: string;
}>;

// `scenes` is not selected because it holds every scene's narration. Rendered
// seconds come from the lightweight cost breakdown instead.
export async function listVideoProjectsForAnalytics(
  client: SupabaseClient,
  from: string,
  to: string,
): Promise<AnalyticsVideoRow[]> {
  const rows = await fetchPaged<{
    id: string;
    status: string;
    input_mode: string | null;
    cost_usd: number | string | null;
    cost_breakdown: AnalyticsCostBreakdown | null;
    created_at: string;
  }>(
    client,
    VIDEO_PROJECTS_TABLE,
    'id,status,input_mode,cost_usd,cost_breakdown,created_at',
    from,
    to,
  );
  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    inputMode: row.input_mode ?? null,
    costUsd: Number(row.cost_usd ?? 0) || 0,
    costBreakdown: row.cost_breakdown ?? null,
    createdAt: row.created_at,
  }));
}

// Head-only COUNT for the handful of metrics that depend on a big text column being
// non-null: whether a social run got a caption, whether an article was translated. `head:
// true` means PostgREST returns the count in a header and no rows at all, which is the only
// reason these are affordable.
async function countWhereNotNull(
  client: SupabaseClient,
  column: string,
  from: string,
  to: string,
  categories?: readonly string[],
): Promise<number> {
  let query = client
    .from(GENERATIONS_TABLE)
    .select('id', { count: 'exact', head: true })
    .gte('created_at', from)
    .lt('created_at', to)
    .not(column, 'is', null);
  if (categories) query = query.in('category', categories);
  const { count, error } = await query;
  if (error) {
    throw new Error(
      `Failed to count generations.${column} for analytics: ${error.message}`,
    );
  }
  return count ?? 0;
}

export type AnalyticsTextCounts = Readonly<{
  socialCaptions: number;
  articlesWritten: number;
  translatedEnglish: number;
  translatedHindi: number;
}>;

// `article` holds the caption on a social run and the article on an article run — the same
// column, two meanings (see CLAUDE.md), which is why the two counts differ only by category.
export async function countGenerationTexts(
  client: SupabaseClient,
  from: string,
  to: string,
  socialCategories: readonly string[],
  articleCategories: readonly string[],
): Promise<AnalyticsTextCounts> {
  const [socialCaptions, articlesWritten, translatedEnglish, translatedHindi] =
    await Promise.all([
      countWhereNotNull(client, 'article', from, to, socialCategories),
      countWhereNotNull(client, 'article', from, to, articleCategories),
      countWhereNotNull(client, 'article_english', from, to),
      countWhereNotNull(client, 'article_hindi', from, to),
    ]);
  return {
    socialCaptions,
    articlesWritten,
    translatedEnglish,
    translatedHindi,
  };
}
