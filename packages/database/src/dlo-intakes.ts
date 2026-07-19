// Persistence for DLO intake runs (see supabase/migrations/0018_dlo_intakes.sql):
// uploaded meeting files + free-text notes → transcribed/extracted combined text
// that the officer reviews before it becomes a generation's note. Same shape and
// idioms as generations.ts (camelCase rows, patch updates set updated_at here).

import type { SupabaseClient } from '@supabase/supabase-js';

export const DLO_INTAKES_TABLE = 'dlo_intakes';

export type DloIntakeStatus = 'queued' | 'running' | 'ready' | 'failed';
export type DloIntakeStep =
  | 'upload'
  | 'transcribe'
  | 'extract'
  | 'combine'
  | 'done';
export type DloIntakeFileKind = 'audio' | 'pdf' | 'docx';
export type DloIntakeFileStatus = 'pending' | 'done' | 'failed';
export type DloIntakeCategory = 'news' | 'scheme';

// One uploaded file's intake state, stored inside the files jsonb array. A failed
// file carries its (Marathi) error so the review step can show which source
// dropped out without failing the whole intake.
export type DloIntakeFileEntry = Readonly<{
  name: string;
  storagePath: string;
  kind: DloIntakeFileKind;
  status: DloIntakeFileStatus;
  chars?: number;
  error?: string;
}>;

export type DloIntakeRow = Readonly<{
  id: string;
  status: DloIntakeStatus;
  step: DloIntakeStep | null;
  error: string | null;
  notes: string;
  category: DloIntakeCategory;
  heading: string | null;
  files: readonly DloIntakeFileEntry[];
  combinedText: string | null;
  createdAt: string;
  updatedAt: string;
}>;

type DloIntakeDbRow = {
  id: string;
  status: DloIntakeStatus;
  step: DloIntakeStep | null;
  error: string | null;
  notes: string;
  category: DloIntakeCategory;
  heading: string | null;
  files: DloIntakeFileEntry[] | null;
  combined_text: string | null;
  created_at: string;
  updated_at: string;
};

function fromDbRow(row: DloIntakeDbRow): DloIntakeRow {
  return {
    id: row.id,
    status: row.status,
    step: row.step,
    error: row.error,
    notes: row.notes,
    category: row.category,
    heading: row.heading,
    files: row.files ?? [],
    combinedText: row.combined_text,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function insertDloIntake(
  client: SupabaseClient,
  input: Readonly<{
    notes: string;
    category: DloIntakeCategory;
    heading?: string | undefined;
    files: readonly DloIntakeFileEntry[];
  }>,
): Promise<DloIntakeRow> {
  const { data, error } = await client
    .from(DLO_INTAKES_TABLE)
    .insert({
      notes: input.notes,
      category: input.category,
      heading: input.heading ?? null,
      files: input.files,
    })
    .select()
    .single();
  if (error) {
    throw new Error(`Failed to insert DLO intake: ${error.message}`);
  }
  return fromDbRow(data as DloIntakeDbRow);
}

// Fields the intake job may update after creation.
export type DloIntakePatch = Partial<
  Pick<DloIntakeRow, 'status' | 'step' | 'error' | 'files' | 'combinedText'>
>;

export async function updateDloIntake(
  client: SupabaseClient,
  id: string,
  patch: DloIntakePatch,
): Promise<void> {
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.step !== undefined) row.step = patch.step;
  if (patch.error !== undefined) row.error = patch.error;
  if (patch.files !== undefined) row.files = patch.files;
  if (patch.combinedText !== undefined) row.combined_text = patch.combinedText;
  const { error } = await client
    .from(DLO_INTAKES_TABLE)
    .update(row)
    .eq('id', id);
  if (error) {
    throw new Error(`Failed to update DLO intake ${id}: ${error.message}`);
  }
}

export async function getDloIntake(
  client: SupabaseClient,
  id: string,
): Promise<DloIntakeRow | null> {
  const { data, error } = await client
    .from(DLO_INTAKES_TABLE)
    .select()
    .eq('id', id)
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to fetch DLO intake ${id}: ${error.message}`);
  }
  return data ? fromDbRow(data as DloIntakeDbRow) : null;
}
