// Request/response schemas for the standalone transcription API (apps/api parsing +
// apps/web typed fetch wrappers): uploaded meeting recordings → Marathi text, with the
// transcript as the deliverable.
//
// The audio container rules are NOT redefined here — AUDIO_FILE_ACCEPT / audioMimeForFileName
// live in dlo.ts and are shared, so the picker on /transcribe can never offer a file this
// API would refuse (the same two-lists-drift argument that put them there).

import { z } from 'zod';

export const TranscriptionStatusSchema = z.enum([
  'queued',
  'running',
  'ready',
  'failed',
]);
export type TranscriptionStatus = z.infer<typeof TranscriptionStatusSchema>;

// Ceiling on one run, matching the DLO intake's multipart limits: a meeting's worth of
// recordings, not an archive.
export const TRANSCRIPTION_MAX_FILES = 10;

// One uploaded recording's state. A failed recording carries a Marathi error and does NOT
// fail the whole run — the result card shows the warning beside the transcripts that worked.
//
// `text` ships only when the request asks for it (`?text=1`): the 2.5 s progress poll would
// otherwise re-ship a whole meeting transcript on every tick.
export const TranscriptionFileSchema = z.object({
  name: z.string(),
  status: z.enum(['pending', 'done', 'failed']),
  chars: z.number().int().nonnegative().optional(),
  error: z.string().optional(),
  text: z.string().optional(),
  // This transcript was reused from the content-addressed cache (migration 0031) rather than
  // transcribed afresh — worth surfacing, since it is the difference between minutes and none.
  cached: z.boolean().optional(),
  // A pasted YouTube link, and what the probe knew about it. Present instead of an archived
  // upload — the transcriber fetches the media itself, so nothing was ever downloaded. Its
  // presence is what makes the result card render a video chip rather than a file name.
  sourceUrl: z.string().optional(),
  sourceAuthor: z.string().optional(),
  sourceThumbnailUrl: z.string().optional(),
});
export type TranscriptionFile = z.infer<typeof TranscriptionFileSchema>;

export const TranscriptionDetailSchema = z.object({
  id: z.string(),
  status: TranscriptionStatusSchema,
  error: z.string().nullable(),
  title: z.string(),
  files: z.array(TranscriptionFileSchema),
  // Every transcript under its own Marathi header; a single recording yields the bare
  // transcript. Null until the run is ready.
  combinedText: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type TranscriptionDetail = z.infer<typeof TranscriptionDetailSchema>;

// One row of the recent-run list. Deliberately carries no text: the list route omits both
// the per-file transcripts and the combined text, which is what keeps it cheap to poll.
export const TranscriptionSummarySchema = z.object({
  id: z.string(),
  status: TranscriptionStatusSchema,
  error: z.string().nullable(),
  title: z.string(),
  fileCount: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative(),
  charCount: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type TranscriptionSummary = z.infer<typeof TranscriptionSummarySchema>;

export const TranscriptionListResponseSchema = z.array(
  TranscriptionSummarySchema,
);

export const CreateTranscriptionResponseSchema = z.object({ id: z.string() });
export type CreateTranscriptionResponse = z.infer<
  typeof CreateTranscriptionResponseSchema
>;

// Every transcript under its own header, in upload order. Shared so the job and the web
// agree on the format byte-for-byte (the combineIntakeSources argument). A single recording
// gets no header at all — a header over one block is noise the officer would only delete.
export function combineTranscripts(
  sources: ReadonlyArray<Readonly<{ label: string; text: string }>>,
): string {
  const clean = sources
    .map((source) => ({
      label: source.label,
      text: source.text
        .replace(/\r\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim(),
    }))
    .filter((source) => source.text.length > 0);
  if (clean.length === 0) return '';
  if (clean.length === 1) return clean[0]!.text;
  return clean
    .map((source) => `=== ध्वनिमुद्रण: ${source.label} ===\n${source.text}`)
    .join('\n\n');
}
