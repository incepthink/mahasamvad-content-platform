// Persistence for generation runs + their revision log (see
// supabase/migrations/0002_generations.sql).

import type { SupabaseClient } from '@supabase/supabase-js';

export const GENERATIONS_TABLE = 'generations';
export const GENERATION_REVISIONS_TABLE = 'generation_revisions';

export type OutputType = 'article' | 'poster' | 'both';
export type Category = 'news' | 'scheme' | 'twitter';
export type DesignMode = 'onbrand' | 'adaptive' | 'fresh';
export type GenerationStatus = 'queued' | 'running' | 'completed' | 'failed';
export type RevisionTarget =
  'article' | 'poster_copy' | 'poster_scene' | 'manual_copy';

// One row in generations. `copy` stays `unknown` here — the database package does
// not depend on the Copy schema; callers validate with CopySchema when needed.
export type GenerationRow = Readonly<{
  id: string;
  note: string;
  outputType: OutputType;
  category: Category;
  designMode: DesignMode | null;
  heading: string | null;
  // Optional pin: the exact reference image the run was asked to use (null =
  // automatic rotation; the FK sets null if the image is later deleted).
  referenceImageId: string | null;
  status: GenerationStatus;
  step: string | null;
  error: string | null;
  article: string | null;
  // On-demand English translation of `article` (Sarvam + locked glossary); null
  // until the user requests it. Plain nullable text, like `article`.
  articleEnglish: string | null;
  factCheck: string | null;
  referenceTitle: string | null;
  referenceUrl: string | null;
  copy: unknown;
  // 5W1H fact scaffold extracted from the note; stays `unknown` like `copy` —
  // callers validate with FiveWOneHSchema when needed.
  fiveWOneH: unknown;
  scenePrompt: string | null;
  scenePath: string | null;
  posterPath: string | null;
  // Total USD this generation has cost so far (text measured from OpenAI usage + a fixed
  // per-render image tier price), accumulated across the initial run and any feedback
  // jobs. Null for pre-feature rows. `costBreakdown` holds the token/split audit detail.
  costUsd: number | null;
  costBreakdown: unknown;
  createdAt: string;
  updatedAt: string;
}>;

// Structured audit detail stored in cost_breakdown (jsonb). `runs` counts how many jobs
// (initial + feedback) have contributed to the totals.
export type GenerationCostBreakdown = Readonly<{
  chatCalls: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  textCostUsd: number;
  imageCount: number;
  imageCostUsd: number;
  runs: number;
}>;

// One job's contribution to a generation's cost (matches the engine's CostAccumulator).
export type GenerationCostIncrement = Readonly<{
  chatCalls: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  textCostUsd: number;
  imageCount: number;
  imageCostUsd: number;
}>;

// Shape returned by selects (snake_case column names).
type GenerationDbRow = {
  id: string;
  note: string;
  output_type: OutputType;
  category: Category;
  design_mode: string | null;
  heading: string | null;
  reference_image_id: string | null;
  status: GenerationStatus;
  step: string | null;
  error: string | null;
  article: string | null;
  article_english: string | null;
  fact_check: string | null;
  reference_title: string | null;
  reference_url: string | null;
  copy: unknown;
  five_w_one_h: unknown;
  scene_prompt: string | null;
  scene_path: string | null;
  poster_path: string | null;
  // PostgREST may serialise numeric as a string; fromDbRow coerces to number.
  cost_usd: number | string | null;
  cost_breakdown: unknown;
  created_at: string;
  updated_at: string;
};

function fromDbRow(row: GenerationDbRow): GenerationRow {
  return {
    id: row.id,
    note: row.note,
    outputType: row.output_type,
    category: row.category,
    designMode: row.design_mode as DesignMode | null,
    heading: row.heading,
    referenceImageId: row.reference_image_id,
    status: row.status,
    step: row.step,
    error: row.error,
    article: row.article,
    articleEnglish: row.article_english,
    factCheck: row.fact_check,
    referenceTitle: row.reference_title,
    referenceUrl: row.reference_url,
    copy: row.copy,
    fiveWOneH: row.five_w_one_h,
    scenePrompt: row.scene_prompt,
    scenePath: row.scene_path,
    posterPath: row.poster_path,
    costUsd:
      row.cost_usd === null || row.cost_usd === undefined
        ? null
        : Number(row.cost_usd),
    costBreakdown: row.cost_breakdown,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Fields a caller may update after creation (everything except id/note/created_at).
export type GenerationPatch = Partial<
  Pick<
    GenerationRow,
    | 'outputType'
    | 'status'
    | 'step'
    | 'error'
    | 'article'
    | 'articleEnglish'
    | 'factCheck'
    | 'referenceTitle'
    | 'referenceUrl'
    | 'copy'
    | 'fiveWOneH'
    | 'scenePrompt'
    | 'scenePath'
    | 'posterPath'
  >
>;

function patchToDbRow(patch: GenerationPatch): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (patch.outputType !== undefined) row.output_type = patch.outputType;
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.step !== undefined) row.step = patch.step;
  if (patch.error !== undefined) row.error = patch.error;
  if (patch.article !== undefined) row.article = patch.article;
  if (patch.articleEnglish !== undefined)
    row.article_english = patch.articleEnglish;
  if (patch.factCheck !== undefined) row.fact_check = patch.factCheck;
  if (patch.referenceTitle !== undefined)
    row.reference_title = patch.referenceTitle;
  if (patch.referenceUrl !== undefined) row.reference_url = patch.referenceUrl;
  if (patch.copy !== undefined) row.copy = patch.copy;
  if (patch.fiveWOneH !== undefined) row.five_w_one_h = patch.fiveWOneH;
  if (patch.scenePrompt !== undefined) row.scene_prompt = patch.scenePrompt;
  if (patch.scenePath !== undefined) row.scene_path = patch.scenePath;
  if (patch.posterPath !== undefined) row.poster_path = patch.posterPath;
  return row;
}

export async function insertGeneration(
  client: SupabaseClient,
  input: Readonly<{
    note: string;
    outputType: OutputType;
    category: Category;
    designMode?: DesignMode | undefined;
    heading?: string | undefined;
    // Insert-only (not in GenerationPatch): a pin never changes after creation.
    referenceImageId?: string | undefined;
  }>,
): Promise<GenerationRow> {
  const { data, error } = await client
    .from(GENERATIONS_TABLE)
    .insert({
      note: input.note,
      output_type: input.outputType,
      category: input.category,
      design_mode: input.designMode ?? null,
      heading: input.heading ?? null,
      reference_image_id: input.referenceImageId ?? null,
    })
    .select()
    .single();
  if (error) {
    throw new Error(`Failed to insert generation: ${error.message}`);
  }
  return fromDbRow(data as GenerationDbRow);
}

export async function updateGeneration(
  client: SupabaseClient,
  id: string,
  patch: GenerationPatch,
): Promise<void> {
  const row = patchToDbRow(patch);
  row.updated_at = new Date().toISOString();
  const { error } = await client
    .from(GENERATIONS_TABLE)
    .update(row)
    .eq('id', id);
  if (error) {
    throw new Error(`Failed to update generation ${id}: ${error.message}`);
  }
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

// Add one job's cost to a generation's running totals. Read-modify-write (jobs for a
// given generation run one at a time, so no lost-update race in practice): reads the
// current cost_usd/cost_breakdown, folds in the increment, and writes both back — so
// cost is additive across the initial run and every later feedback/revision job. A
// genuinely zero increment is a no-op (no needless write / run bump).
export async function addGenerationCost(
  client: SupabaseClient,
  id: string,
  increment: GenerationCostIncrement,
): Promise<void> {
  const isZero =
    increment.chatCalls === 0 &&
    increment.imageCount === 0 &&
    increment.textCostUsd === 0 &&
    increment.imageCostUsd === 0;
  if (isZero) return;

  const { data, error } = await client
    .from(GENERATIONS_TABLE)
    .select('cost_breakdown')
    .eq('id', id)
    .maybeSingle();
  if (error) {
    throw new Error(
      `Failed to read cost for generation ${id}: ${error.message}`,
    );
  }
  const prev = (data?.cost_breakdown ??
    null) as Partial<GenerationCostBreakdown> | null;

  const merged: GenerationCostBreakdown = {
    chatCalls: (prev?.chatCalls ?? 0) + increment.chatCalls,
    inputTokens: (prev?.inputTokens ?? 0) + increment.inputTokens,
    cachedInputTokens:
      (prev?.cachedInputTokens ?? 0) + increment.cachedInputTokens,
    outputTokens: (prev?.outputTokens ?? 0) + increment.outputTokens,
    textCostUsd: round((prev?.textCostUsd ?? 0) + increment.textCostUsd, 6),
    imageCount: (prev?.imageCount ?? 0) + increment.imageCount,
    imageCostUsd: round((prev?.imageCostUsd ?? 0) + increment.imageCostUsd, 6),
    runs: (prev?.runs ?? 0) + 1,
  };
  const totalUsd = round(merged.textCostUsd + merged.imageCostUsd, 4);

  const { error: updateError } = await client
    .from(GENERATIONS_TABLE)
    .update({
      cost_usd: totalUsd,
      cost_breakdown: merged,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (updateError) {
    throw new Error(
      `Failed to persist cost for generation ${id}: ${updateError.message}`,
    );
  }
}

export async function getGeneration(
  client: SupabaseClient,
  id: string,
): Promise<GenerationRow | null> {
  const { data, error } = await client
    .from(GENERATIONS_TABLE)
    .select()
    .eq('id', id)
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to fetch generation ${id}: ${error.message}`);
  }
  return data ? fromDbRow(data as GenerationDbRow) : null;
}

export async function listGenerations(
  client: SupabaseClient,
  limit = 50,
): Promise<GenerationRow[]> {
  const { data, error } = await client
    .from(GENERATIONS_TABLE)
    .select()
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    throw new Error(`Failed to list generations: ${error.message}`);
  }
  return ((data ?? []) as GenerationDbRow[]).map(fromDbRow);
}

// One row in generation_revisions: the feedback that drove a revision plus
// snapshots of whatever it changed.
export type RevisionRow = Readonly<{
  id: string;
  generationId: string;
  target: RevisionTarget;
  feedback: string | null;
  article: string | null;
  factCheck: string | null;
  copy: unknown;
  scenePrompt: string | null;
  scenePath: string | null;
  posterPath: string | null;
  createdAt: string;
}>;

export type NewRevision = Readonly<{
  generationId: string;
  target: RevisionTarget;
  feedback?: string | null;
  article?: string | null;
  factCheck?: string | null;
  copy?: unknown;
  scenePrompt?: string | null;
  scenePath?: string | null;
  posterPath?: string | null;
}>;

type RevisionDbRow = {
  id: string;
  generation_id: string;
  target: RevisionTarget;
  feedback: string | null;
  article: string | null;
  fact_check: string | null;
  copy: unknown;
  scene_prompt: string | null;
  scene_path: string | null;
  poster_path: string | null;
  created_at: string;
};

export async function insertRevision(
  client: SupabaseClient,
  revision: NewRevision,
): Promise<void> {
  const { error } = await client.from(GENERATION_REVISIONS_TABLE).insert({
    generation_id: revision.generationId,
    target: revision.target,
    feedback: revision.feedback ?? null,
    article: revision.article ?? null,
    fact_check: revision.factCheck ?? null,
    copy: revision.copy ?? null,
    scene_prompt: revision.scenePrompt ?? null,
    scene_path: revision.scenePath ?? null,
    poster_path: revision.posterPath ?? null,
  });
  if (error) {
    throw new Error(`Failed to insert revision: ${error.message}`);
  }
}

export async function listRevisions(
  client: SupabaseClient,
  generationId: string,
): Promise<RevisionRow[]> {
  const { data, error } = await client
    .from(GENERATION_REVISIONS_TABLE)
    .select()
    .eq('generation_id', generationId)
    .order('created_at', { ascending: true });
  if (error) {
    throw new Error(
      `Failed to list revisions for ${generationId}: ${error.message}`,
    );
  }
  return ((data ?? []) as RevisionDbRow[]).map((row) => ({
    id: row.id,
    generationId: row.generation_id,
    target: row.target,
    feedback: row.feedback,
    article: row.article,
    factCheck: row.fact_check,
    copy: row.copy,
    scenePrompt: row.scene_prompt,
    scenePath: row.scene_path,
    posterPath: row.poster_path,
    createdAt: row.created_at,
  }));
}
