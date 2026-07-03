// Persistence for generation runs + their revision log (see
// supabase/migrations/0002_generations.sql).

import type { SupabaseClient } from '@supabase/supabase-js';

export const GENERATIONS_TABLE = 'generations';
export const GENERATION_REVISIONS_TABLE = 'generation_revisions';

export type OutputType = 'article' | 'poster' | 'both';
export type GenerationStatus = 'queued' | 'running' | 'completed' | 'failed';
export type RevisionTarget =
  | 'article'
  | 'poster_copy'
  | 'poster_scene'
  | 'manual_copy';

// One row in generations. `copy` stays `unknown` here — the database package does
// not depend on the Copy schema; callers validate with CopySchema when needed.
export type GenerationRow = Readonly<{
  id: string;
  note: string;
  outputType: OutputType;
  status: GenerationStatus;
  step: string | null;
  error: string | null;
  article: string | null;
  factCheck: string | null;
  referenceTitle: string | null;
  referenceUrl: string | null;
  copy: unknown;
  scenePrompt: string | null;
  scenePath: string | null;
  posterPath: string | null;
  createdAt: string;
  updatedAt: string;
}>;

// Shape returned by selects (snake_case column names).
type GenerationDbRow = {
  id: string;
  note: string;
  output_type: OutputType;
  status: GenerationStatus;
  step: string | null;
  error: string | null;
  article: string | null;
  fact_check: string | null;
  reference_title: string | null;
  reference_url: string | null;
  copy: unknown;
  scene_prompt: string | null;
  scene_path: string | null;
  poster_path: string | null;
  created_at: string;
  updated_at: string;
};

function fromDbRow(row: GenerationDbRow): GenerationRow {
  return {
    id: row.id,
    note: row.note,
    outputType: row.output_type,
    status: row.status,
    step: row.step,
    error: row.error,
    article: row.article,
    factCheck: row.fact_check,
    referenceTitle: row.reference_title,
    referenceUrl: row.reference_url,
    copy: row.copy,
    scenePrompt: row.scene_prompt,
    scenePath: row.scene_path,
    posterPath: row.poster_path,
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
    | 'factCheck'
    | 'referenceTitle'
    | 'referenceUrl'
    | 'copy'
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
  if (patch.factCheck !== undefined) row.fact_check = patch.factCheck;
  if (patch.referenceTitle !== undefined)
    row.reference_title = patch.referenceTitle;
  if (patch.referenceUrl !== undefined) row.reference_url = patch.referenceUrl;
  if (patch.copy !== undefined) row.copy = patch.copy;
  if (patch.scenePrompt !== undefined) row.scene_prompt = patch.scenePrompt;
  if (patch.scenePath !== undefined) row.scene_path = patch.scenePath;
  if (patch.posterPath !== undefined) row.poster_path = patch.posterPath;
  return row;
}

export async function insertGeneration(
  client: SupabaseClient,
  input: Readonly<{ note: string; outputType: OutputType }>,
): Promise<GenerationRow> {
  const { data, error } = await client
    .from(GENERATIONS_TABLE)
    .insert({ note: input.note, output_type: input.outputType })
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
