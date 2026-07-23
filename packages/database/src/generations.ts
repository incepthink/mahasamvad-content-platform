// Persistence for generation runs + their revision log (see
// supabase/migrations/0002_generations.sql).

import type { SupabaseClient } from '@supabase/supabase-js';

export const GENERATIONS_TABLE = 'generations';
export const GENERATION_REVISIONS_TABLE = 'generation_revisions';

export type OutputType = 'article' | 'poster' | 'both';
export type Category = 'news' | 'scheme' | 'twitter' | 'facebook';
export type DesignMode = 'onbrand' | 'adaptive' | 'fresh';
// Template brand family (migration 0024); mirrors TemplateBrand in reference-types.ts.
export type TemplateBrand = 'dgipr' | 'cmo';
export type GenerationStatus = 'queued' | 'running' | 'completed' | 'failed';
// Mirrors RevisionTargetSchema in @dgipr/schemas and the generation_revisions CHECK
// constraint (latest: migration 0023). The 'caption'/'manual_caption' pair records
// edits to a social run's caption, which is stored in the `article` column.
export type RevisionTarget =
  | 'article'
  | 'poster_copy'
  | 'poster_scene'
  | 'manual_copy'
  | 'poster_image'
  | 'caption'
  | 'manual_caption';

// One row in generations. `copy` stays `unknown` here — the database package does
// not depend on the Copy schema; callers validate with CopySchema when needed.
export type GenerationRow = Readonly<{
  id: string;
  note: string;
  outputType: OutputType;
  category: Category;
  designMode: DesignMode | null;
  // Template brand the run was created with (migration 0024). 'dgipr' for every
  // non-social row and for social rows created before the CMO feature.
  templateBrand: TemplateBrand;
  heading: string | null;
  // Optional pin: the exact reference image the run was asked to use (null =
  // automatic rotation; the FK sets null if the image is later deleted).
  referenceImageId: string | null;
  // Optional Twitter section pin: force this reference type while choosing one
  // of its enabled images at job start. The FK sets null if the type is deleted.
  referenceTypeId: string | null;
  // Lineage: the run this one was spawned from (detail-page "next step" actions
  // + failed-run retry) and the thread's first run, denormalized so membership
  // is one query. Both null on thread roots and pre-feature rows.
  sourceGenerationId: string | null;
  threadRootId: string | null;
  // Lineage/audit: the DLO intake this run's note came from (null = home form
  // or detail-page follow-up). Insert-only, like the pins.
  dloIntakeId: string | null;
  status: GenerationStatus;
  step: string | null;
  error: string | null;
  article: string | null;
  // On-demand translations of `article` (Sarvam + locked glossary); each null until
  // the user requests it. Plain nullable text, like `article`, and independent of
  // each other — translating to one language never touches the other.
  articleEnglish: string | null;
  articleHindi: string | null;
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
  // Latest live social post of this run (twitter/facebook categories only);
  // re-publishing overwrites both. Null = never published. Migration 0021.
  publishedUrl: string | null;
  publishedAt: string | null;
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
  template_brand: string | null;
  heading: string | null;
  reference_image_id: string | null;
  reference_type_id: string | null;
  source_generation_id: string | null;
  thread_root_id: string | null;
  dlo_intake_id: string | null;
  status: GenerationStatus;
  step: string | null;
  error: string | null;
  article: string | null;
  article_english: string | null;
  article_hindi: string | null;
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
  published_url: string | null;
  published_at: string | null;
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
    // ?? 'dgipr': pre-0024 databases have no such column (undefined).
    templateBrand: (row.template_brand as TemplateBrand | null) ?? 'dgipr',
    heading: row.heading,
    referenceImageId: row.reference_image_id,
    referenceTypeId: row.reference_type_id,
    sourceGenerationId: row.source_generation_id,
    threadRootId: row.thread_root_id,
    dloIntakeId: row.dlo_intake_id,
    status: row.status,
    step: row.step,
    error: row.error,
    article: row.article,
    articleEnglish: row.article_english,
    // ?? null for the same reason as the 0021 columns below: a pre-0022 database
    // returns no such column (undefined), which JSON.stringify would drop from the
    // detail payload and fail the web's Zod parse.
    articleHindi: row.article_hindi ?? null,
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
    // ?? null: pre-0021 databases return no such columns (undefined), which
    // JSON.stringify would silently DROP from the detail payload — failing the
    // web's Zod parse on every detail fetch. Coalescing keeps the API usable
    // until the migration is applied.
    publishedUrl: row.published_url ?? null,
    publishedAt: row.published_at ?? null,
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
    | 'articleHindi'
    | 'factCheck'
    | 'referenceTitle'
    | 'referenceUrl'
    | 'copy'
    | 'fiveWOneH'
    | 'scenePrompt'
    | 'scenePath'
    | 'posterPath'
    | 'publishedUrl'
    | 'publishedAt'
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
  if (patch.articleHindi !== undefined) row.article_hindi = patch.articleHindi;
  if (patch.factCheck !== undefined) row.fact_check = patch.factCheck;
  if (patch.referenceTitle !== undefined)
    row.reference_title = patch.referenceTitle;
  if (patch.referenceUrl !== undefined) row.reference_url = patch.referenceUrl;
  if (patch.copy !== undefined) row.copy = patch.copy;
  if (patch.fiveWOneH !== undefined) row.five_w_one_h = patch.fiveWOneH;
  if (patch.scenePrompt !== undefined) row.scene_prompt = patch.scenePrompt;
  if (patch.scenePath !== undefined) row.scene_path = patch.scenePath;
  if (patch.posterPath !== undefined) row.poster_path = patch.posterPath;
  if (patch.publishedUrl !== undefined) row.published_url = patch.publishedUrl;
  if (patch.publishedAt !== undefined) row.published_at = patch.publishedAt;
  return row;
}

export async function insertGeneration(
  client: SupabaseClient,
  input: Readonly<{
    note: string;
    outputType: OutputType;
    category: Category;
    designMode?: DesignMode | undefined;
    // Insert-only (like designMode): absent ⇒ 'dgipr'. Set to 'cmo' by a
    // विभाग = CMO social run.
    templateBrand?: TemplateBrand | undefined;
    heading?: string | undefined;
    // Insert-only (not in GenerationPatch): a pin never changes after creation.
    referenceImageId?: string | undefined;
    referenceTypeId?: string | undefined;
    // Insert-only lineage: immutable after creation, like the pins.
    sourceGenerationId?: string | undefined;
    threadRootId?: string | undefined;
    dloIntakeId?: string | undefined;
  }>,
): Promise<GenerationRow> {
  const { data, error } = await client
    .from(GENERATIONS_TABLE)
    .insert({
      note: input.note,
      output_type: input.outputType,
      category: input.category,
      design_mode: input.designMode ?? null,
      template_brand: input.templateBrand ?? 'dgipr',
      heading: input.heading ?? null,
      reference_image_id: input.referenceImageId ?? null,
      reference_type_id: input.referenceTypeId ?? null,
      source_generation_id: input.sourceGenerationId ?? null,
      thread_root_id: input.threadRootId ?? null,
      dlo_intake_id: input.dloIntakeId ?? null,
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

// All members of a thread (the root itself + every follow-up), oldest first.
// rootId must come from a fetched row (threadRootId ?? id), never raw input.
export async function listThreadGenerations(
  client: SupabaseClient,
  rootId: string,
): Promise<GenerationRow[]> {
  const { data, error } = await client
    .from(GENERATIONS_TABLE)
    .select()
    .or(`id.eq.${rootId},thread_root_id.eq.${rootId}`)
    .order('created_at', { ascending: true });
  if (error) {
    throw new Error(`Failed to list thread ${rootId}: ${error.message}`);
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
