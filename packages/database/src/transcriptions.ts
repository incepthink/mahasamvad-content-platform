// Persistence for standalone transcription runs (see
// supabase/migrations/0037_transcriptions.sql): uploaded meeting recordings → Marathi text,
// with the transcript as the deliverable rather than the raw material for an article.
//
// Same shape and idioms as dlo-intakes.ts (camelCase rows, patch updates stamp updated_at
// here). The recordings are archived in the PRIVATE dlo-uploads bucket under
// `transcriptions/{id}/…`, so no new bucket and no new storage helper.

import type { SupabaseClient } from '@supabase/supabase-js';

export const TRANSCRIPTIONS_TABLE = 'transcriptions';

export type TranscriptionStatus = 'queued' | 'running' | 'ready' | 'failed';
// No 'needs-selection' equivalent: a recording has no pages to pick, so there is no spend
// gate to stop at — it is transcribed whole or not at all.
export type TranscriptionFileStatus = 'pending' | 'done' | 'failed';

// One uploaded recording's state, stored inside the files jsonb array. A failed recording
// carries its own error so the result card can show which one dropped out without failing
// the whole run.
export type TranscriptionFileEntry = Readonly<{
  name: string;
  // Where the original is archived. Present for an UPLOADED recording, which is most of
  // them; absent for a YouTube source, which was never downloaded — the transcriber fetches
  // the media itself from `sourceUrl` below, so there are no bytes on our side to archive.
  // `sourceUrl` is therefore the discriminator between the two, and exactly one is set.
  storagePath?: string | undefined;
  // The canonical watch URL of a pasted YouTube link, and what the oEmbed probe knew about
  // it — kept so the result card can name and link the video rather than repeating a URL.
  sourceUrl?: string;
  sourceAuthor?: string;
  sourceThumbnailUrl?: string;
  status: TranscriptionFileStatus;
  chars?: number;
  error?: string;
  text?: string;
  // Whether this transcript came from audio_transcript_cache (0031) rather than a fresh
  // Sarvam job. Shown on the result card, because "instant" is otherwise indistinguishable
  // from "suspiciously fast".
  cached?: boolean;
}>;

export type TranscriptionRow = Readonly<{
  id: string;
  status: TranscriptionStatus;
  error: string | null;
  title: string;
  files: readonly TranscriptionFileEntry[];
  combinedText: string | null;
  fileCount: number;
  failedCount: number;
  charCount: number;
  createdAt: string;
  updatedAt: string;
}>;

type TranscriptionDbRow = {
  id: string;
  status: TranscriptionStatus;
  error: string | null;
  title: string | null;
  files: TranscriptionFileEntry[] | null;
  combined_text: string | null;
  file_count: number | null;
  failed_count: number | null;
  char_count: number | null;
  created_at: string;
  updated_at: string;
};

function fromDbRow(row: TranscriptionDbRow): TranscriptionRow {
  return {
    id: row.id,
    status: row.status,
    error: row.error,
    title: row.title ?? '',
    files: row.files ?? [],
    combinedText: row.combined_text,
    fileCount: row.file_count ?? 0,
    failedCount: row.failed_count ?? 0,
    charCount: row.char_count ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// What the list needs and nothing more. `files` and `combined_text` are deliberately NOT
// selected: a card shows neither, and a meeting's transcript is tens of thousands of
// characters that would otherwise ride every list poll. The counters exist for exactly this.
const SUMMARY_COLUMNS =
  'id,status,error,title,file_count,failed_count,char_count,created_at,updated_at';

export type TranscriptionSummaryRow = Readonly<{
  id: string;
  status: TranscriptionStatus;
  error: string | null;
  title: string;
  fileCount: number;
  failedCount: number;
  charCount: number;
  createdAt: string;
  updatedAt: string;
}>;

export async function insertTranscription(
  client: SupabaseClient,
  input: Readonly<{
    title: string;
    files: readonly TranscriptionFileEntry[];
  }>,
): Promise<TranscriptionRow> {
  const { data, error } = await client
    .from(TRANSCRIPTIONS_TABLE)
    .insert({
      title: input.title,
      files: input.files,
      file_count: input.files.length,
    })
    .select()
    .single();
  if (error) {
    throw new Error(`Failed to insert transcription: ${error.message}`);
  }
  return fromDbRow(data as TranscriptionDbRow);
}

export type TranscriptionPatch = Partial<
  Pick<
    TranscriptionRow,
    | 'status'
    | 'error'
    | 'title'
    | 'files'
    | 'combinedText'
    | 'fileCount'
    | 'failedCount'
    | 'charCount'
  >
>;

export async function updateTranscription(
  client: SupabaseClient,
  id: string,
  patch: TranscriptionPatch,
): Promise<void> {
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.error !== undefined) row.error = patch.error;
  if (patch.title !== undefined) row.title = patch.title;
  if (patch.files !== undefined) row.files = patch.files;
  if (patch.combinedText !== undefined) row.combined_text = patch.combinedText;
  if (patch.fileCount !== undefined) row.file_count = patch.fileCount;
  if (patch.failedCount !== undefined) row.failed_count = patch.failedCount;
  if (patch.charCount !== undefined) row.char_count = patch.charCount;
  const { error } = await client
    .from(TRANSCRIPTIONS_TABLE)
    .update(row)
    .eq('id', id);
  if (error) {
    throw new Error(`Failed to update transcription ${id}: ${error.message}`);
  }
}

export async function getTranscription(
  client: SupabaseClient,
  id: string,
): Promise<TranscriptionRow | null> {
  const { data, error } = await client
    .from(TRANSCRIPTIONS_TABLE)
    .select()
    .eq('id', id)
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to fetch transcription ${id}: ${error.message}`);
  }
  return data ? fromDbRow(data as TranscriptionDbRow) : null;
}

// The recent-run list behind /transcribe. Newest first, and the same limit the /dlo and
// /video lists use. There is no auth and no owner column, so this is deliberately every run.
export async function listTranscriptions(
  client: SupabaseClient,
  limit = 20,
): Promise<TranscriptionSummaryRow[]> {
  const { data, error } = await client
    .from(TRANSCRIPTIONS_TABLE)
    .select(SUMMARY_COLUMNS)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    throw new Error(`Failed to list transcriptions: ${error.message}`);
  }
  return (
    (data ?? []) as unknown as Array<{
      id: string;
      status: TranscriptionStatus;
      error: string | null;
      title: string | null;
      file_count: number | null;
      failed_count: number | null;
      char_count: number | null;
      created_at: string;
      updated_at: string;
    }>
  ).map((row) => ({
    id: row.id,
    status: row.status,
    error: row.error,
    title: row.title ?? '',
    fileCount: row.file_count ?? 0,
    failedCount: row.failed_count ?? 0,
    charCount: row.char_count ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}
