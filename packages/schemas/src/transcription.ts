// Request/response schemas for the standalone transcription API (apps/api parsing +
// apps/web typed fetch wrappers): uploaded meeting recordings → Marathi text, with the
// transcript as the deliverable.
//
// The audio container rules are NOT redefined here — AUDIO_FILE_ACCEPT / audioMimeForFileName
// live in dlo.ts and are shared, so the picker on /transcribe can never offer a file this
// API would refuse (the same two-lists-drift argument that put them there).

import { z } from 'zod';
import { AudioTrimSchema, AudioTrimsSchema } from './audio-trim.js';
import { YouTubeSourcesSchema } from './youtube.js';

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
  // The slice of this recording the officer asked for, in seconds. Absent means the whole
  // recording, which is every run made before this feature and most runs after it.
  //
  // Additive on a jsonb column, so NO MIGRATION. It is kept on the entry rather than consumed
  // and discarded by the job because it is the answer to "why is this transcript short?" — the
  // result card states the window, and a re-run reproduces the same one.
  trim: AudioTrimSchema.optional(),
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

// ---------- direct-to-S3 upload (2026-10-16) ----------
//
// The browser PUTs each recording straight into the private bucket with a presigned URL, so the
// bytes no longer pass through the API on their way in (and, with Transfer Acceleration, enter
// AWS at the nearest edge instead of crossing the internet to us-east-2). Two calls:
//
//   1. POST /transcriptions/uploads  — names + sizes in, a run id + one signed PUT per file out.
//   2. POST /transcriptions (JSON)   — after every PUT has landed: the run id, the files as
//      uploaded, plus the same trims/links the multipart form carries. The server checks each
//      object really exists under that run's prefix before creating the row.
//
// The multipart POST /transcriptions is kept unchanged and is the browser's fallback whenever
// the direct path fails (a bucket with no CORS rule, an old API) — so a deploy can never make
// an upload worse than it was.

export const TranscriptionUploadFileSchema = z.object({
  name: z.string().min(1).max(300),
  // Bytes. Signed into the PUT, so the object that lands is exactly this size.
  size: z.number().int().positive(),
});
export type TranscriptionUploadFile = z.infer<
  typeof TranscriptionUploadFileSchema
>;

export const PrepareTranscriptionUploadsRequestSchema = z.object({
  files: z
    .array(TranscriptionUploadFileSchema)
    .min(1)
    .max(TRANSCRIPTION_MAX_FILES),
});
export type PrepareTranscriptionUploadsRequest = z.infer<
  typeof PrepareTranscriptionUploadsRequestSchema
>;

export const PrepareTranscriptionUploadsResponseSchema = z.object({
  runId: z.string(),
  uploads: z.array(
    z.object({
      storagePath: z.string(),
      // A presigned PUT. The browser must send exactly this Content-Type.
      url: z.string(),
      contentType: z.string(),
    }),
  ),
});
export type PrepareTranscriptionUploadsResponse = z.infer<
  typeof PrepareTranscriptionUploadsResponseSchema
>;

export const CreateTranscriptionFromUploadsRequestSchema = z.object({
  runId: z.string().uuid(),
  // In the order they were prepared; `storagePath` must be the one the server issued.
  files: z
    .array(z.object({ name: z.string().min(1), storagePath: z.string() }))
    .max(TRANSCRIPTION_MAX_FILES),
  audioTrims: AudioTrimsSchema.default([]),
  youtube: YouTubeSourcesSchema.default([]),
});
export type CreateTranscriptionFromUploadsRequest = z.input<
  typeof CreateTranscriptionFromUploadsRequestSchema
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
