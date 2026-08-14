// Persistence for DLO intake runs (see supabase/migrations/0018_dlo_intakes.sql):
// uploaded meeting files + free-text notes → transcribed/extracted combined text
// that the officer reviews before it becomes a generation's note. Same shape and
// idioms as generations.ts (camelCase rows, patch updates set updated_at here).

import type { SupabaseClient } from '@supabase/supabase-js';

export const DLO_INTAKES_TABLE = 'dlo_intakes';

export type DloIntakeStatus = 'queued' | 'running' | 'ready' | 'failed';
export type DloIntakeStep =
  'upload' | 'transcribe' | 'extract' | 'combine' | 'done';
// 'txt' only ever reaches here through a document the officer uploaded and read at the
// input step (the shared ephemeral service reads a .txt locally and for free); the intake
// job itself has no .txt reader and never needs one.
// 'youtube' is a recording we never hold: the officer pasted a link and the transcriber
// fetches the media itself (ElevenLabs Scribe's source_url). So such an entry carries a
// `sourceUrl` and no `storagePath`, and is transcribed in the same phase as an uploaded
// recording — see the transcribe phase in apps/api/src/jobs/dlo-runner.ts.
// 'image' is a photograph or screenshot of a document. It is uploaded with the intake like a
// recording and read by the job's extract phase (intake/image-ocr.ts), and stores its result
// in `text` like a DOCX — an image has no pages, so there is nothing to select and nothing to
// number.
export type DloIntakeFileKind =
  'audio' | 'youtube' | 'image' | 'pdf' | 'docx' | 'txt';
// 'needs-selection' is a PDF that was probed but deliberately NOT read: its text layer was
// unusable, so reading it means paid OCR, and the officer chooses which pages are worth it
// before a single one is sent. Only PDFs ever hold this status.
export type DloIntakeFileStatus =
  'pending' | 'needs-selection' | 'done' | 'failed';
export type DloIntakeCategory = 'news' | 'scheme';

// One extracted PDF page, stored on its file's entry. `page` is the ORIGINAL
// document's page number — after OCR chunking, past blank pages, always — because
// the review step lists and selects by it.
export type DloIntakePageEntry = Readonly<{ page: number; text: string }>;

// One uploaded file's intake state, stored inside the files jsonb array. A failed
// file carries its (Marathi) error so the review step can show which source
// dropped out without failing the whole intake.
//
// The extracted text lives here per source (rather than only inside the combined
// text) so the review step can edit each source on its own and select PDF pages.
// jsonb has no column schema, so these fields needed no migration.
export type DloIntakeFileEntry = Readonly<{
  name: string;
  // Where the original is archived in the private dlo-uploads bucket. Absent only for a
  // document that was read at the input step and whose ephemeral upload job had already
  // expired by the time the intake was created — the text survived (it travelled in the
  // request), the bytes did not, so that file cannot be re-read. Explicitly `| undefined`
  // (exactOptionalPropertyTypes) so the job's entry builders can carry it straight through.
  storagePath?: string | undefined;
  kind: DloIntakeFileKind;
  status: DloIntakeFileStatus;
  chars?: number;
  error?: string;
  // Audio/DOCX carry their whole text; PDFs carry `pages` instead. A PDF's `pages`
  // hold only what was actually read, which on a scanned file is only what the
  // officer selected and paid to OCR.
  text?: string;
  pages?: readonly DloIntakePageEntry[];
  // How many pages this PDF has in total, from the free probe. Known before anything
  // is read, because it is what the page picker lists.
  pageCount?: number;
  // Which of the selected pages have been transcribed so far, ascending. Written DURING the
  // read so प्रक्रिया can fill in a row per page rather than spin; page numbers rather than
  // the partial text (the detail poll deliberately withholds text) and rather than a count
  // (pages finish out of order). Gone once the file is read — extractPdfEntry rebuilds the
  // entry rather than spreading it.
  readPages?: readonly number[];
  // Which backend read this PDF — OCR text deserves more scrutiny in review, and
  // only a text-layer read is worth offering to re-read with OCR.
  pdfSource?: 'text-layer' | 'ocr';
  // Pages the officer selected at the INPUT step but deliberately did not wait to have read
  // ("न वाचता ही पृष्ठे वापरा"). The intake job's extract phase reads exactly these instead of
  // probing the file, so the OCR wait happens inside प्रक्रिया rather than in front of the form.
  // Only ever set on a 'pending' PDF, and gone once the file is read — extractPdfEntry rebuilds
  // the entry rather than spreading it.
  pendingPages?: readonly number[];
  // ---------- 'youtube' sources ----------
  // The canonical watch URL, which is what is handed to the transcriber. Present on exactly
  // the 'youtube' entries; they have no storagePath, having never been downloaded.
  sourceUrl?: string;
  // What the oEmbed probe found when the officer pasted the link, kept so the review card can
  // name the video rather than showing a bare URL. Both absent when the probe failed (a
  // private or unlisted video), which never blocks the source.
  sourceAuthor?: string;
  sourceThumbnailUrl?: string;
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
  // The officer's saved review-step state (migration 0036) — corrections, unticked pages, and
  // the two paid lookups. Deliberately untyped here: its shape is owned by
  // DloReviewStateSchema in @dgipr/schemas, which the API parses it with, and this package
  // does not depend on schemas. Null both when nothing has been saved and when the column
  // does not exist yet, which is what makes an un-applied 0036 a disabled feature rather
  // than a broken intake.
  reviewState: unknown;
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
  review_state?: unknown;
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
    // `?? null` rather than a bare read: on a database without 0036 the column is simply
    // absent from the response, so the property is undefined and must collapse to "nothing
    // saved" instead of leaking undefined into the detail payload.
    reviewState: row.review_state ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// What the shared recent-intake list on /dlo needs, and nothing more. `combined_text` and
// `review_state` are deliberately NOT selected: a card shows neither, and on a long intake
// both are tens of thousands of characters that would be shipped on every list poll.
const SUMMARY_COLUMNS =
  'id,status,step,category,heading,notes,files,created_at,updated_at';

export type DloIntakeSummaryRow = Readonly<{
  id: string;
  status: DloIntakeStatus;
  step: DloIntakeStep | null;
  category: DloIntakeCategory;
  heading: string | null;
  notes: string;
  files: readonly DloIntakeFileEntry[];
  createdAt: string;
  updatedAt: string;
}>;

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

// Fields updatable after creation — by the intake job (status/step/error/files/combinedText)
// and by the officer's review autosave (reviewState/category/heading).
export type DloIntakePatch = Partial<
  Pick<
    DloIntakeRow,
    | 'status'
    | 'step'
    | 'error'
    | 'files'
    | 'combinedText'
    | 'reviewState'
    | 'category'
    | 'heading'
  >
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
  // Named only when the caller actually has one, so every job write stays untouched by 0036
  // and a database without the column keeps working for everything except the autosave.
  if (patch.reviewState !== undefined) row.review_state = patch.reviewState;
  if (patch.category !== undefined) row.category = patch.category;
  if (patch.heading !== undefined) row.heading = patch.heading;
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

// The shared recent-intake list behind /dlo. Newest first, and the same limit /video's project
// list uses. There is no auth and no owner column, so this is deliberately every intake — the
// web groups the caller's own runs above the rest purely for ordering.
export async function listDloIntakes(
  client: SupabaseClient,
  limit = 20,
): Promise<DloIntakeSummaryRow[]> {
  const { data, error } = await client
    .from(DLO_INTAKES_TABLE)
    .select(SUMMARY_COLUMNS)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    throw new Error(`Failed to list DLO intakes: ${error.message}`);
  }
  return ((data ?? []) as unknown as Array<{
    id: string;
    status: DloIntakeStatus;
    step: DloIntakeStep | null;
    category: DloIntakeCategory;
    heading: string | null;
    notes: string;
    files: DloIntakeFileEntry[] | null;
    created_at: string;
    updated_at: string;
  }>).map((row) => ({
    id: row.id,
    status: row.status,
    step: row.step,
    category: row.category,
    heading: row.heading,
    notes: row.notes,
    files: row.files ?? [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}
