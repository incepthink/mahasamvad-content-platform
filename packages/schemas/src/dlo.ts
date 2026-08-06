// Request/response schemas for the DLO intake API (apps/api parsing + apps/web
// typed fetch wrappers): uploaded meeting files + notes → transcribed/extracted
// combined text → (after the officer's review) a normal generation.

import { z } from 'zod';
import { PdfTextSourceSchema } from './document.js';
import {
  KnownDesignationSchema,
  NameDesignationsSchema,
  PreparedNameSchema,
} from './designations.js';
import {
  ARTICLE_INSTRUCTIONS_MAX_CHARS,
  GenerationStatusSchema,
} from './api.js';

export const DloIntakeStatusSchema = z.enum([
  'queued',
  'running',
  'ready',
  'failed',
]);
export type DloIntakeStatus = z.infer<typeof DloIntakeStatusSchema>;

// Machine step keys written by the intake job; the web UI maps each to a Marathi
// progress label. Order mirrors pipeline order.
export const DloIntakeStepSchema = z.enum([
  'upload',
  'transcribe',
  'extract',
  'combine',
  'done',
]);
export type DloIntakeStep = z.infer<typeof DloIntakeStepSchema>;

// The article voices DLO can generate — 'twitter' is deliberately excluded.
export const DloCategorySchema = z.enum(['news', 'scheme']);
export type DloCategory = z.infer<typeof DloCategorySchema>;

// One extracted PDF page. `page` is the ORIGINAL document's page number (never a
// running index — see PdfPage in @dgipr/content-engine), because the review step
// lists and selects by it.
export const DloIntakePageSchema = z.object({
  page: z.number().int().positive(),
  text: z.string(),
});
export type DloIntakePage = z.infer<typeof DloIntakePageSchema>;

// One uploaded file's intake state. A failed file carries a Marathi error and
// does NOT fail the whole intake (the review step shows the warning instead).
//
// The text fields are what the review step edits, and they are only sent when the
// request asks for them (`?text=1`) — the 2.5 s poll would otherwise re-ship a
// whole meeting transcript on every tick.
export const DloIntakeFileSchema = z.object({
  name: z.string(),
  // 'txt' arrives only through the pre-read document path below — the intake job has no
  // reader for it, because a .txt is read locally and free at upload time.
  //
  // 'youtube' is a recording that was never uploaded: the officer pasted a link and the
  // transcriber fetches the media itself. It behaves exactly like 'audio' from the review
  // step onward — one card, one editable transcript — so nothing downstream branches on it.
  kind: z.enum(['audio', 'youtube', 'pdf', 'docx', 'txt']),
  // 'needs-selection': a scanned PDF that was probed but deliberately NOT read, because
  // reading it costs OCR credits per page. It waits here until the officer picks pages.
  status: z.enum(['pending', 'needs-selection', 'done', 'failed']),
  // How many characters this source contributed to the combined text.
  chars: z.number().int().nonnegative().optional(),
  error: z.string().optional(),
  // Audio/DOCX: the whole extracted text. PDFs use `pages` instead so the review
  // step can offer per-page selection.
  text: z.string().optional(),
  pages: z.array(DloIntakePageSchema).optional(),
  // Total pages in this PDF, from the free probe — what the page picker lists before
  // anything has been read. Always present on a 'needs-selection' file.
  pageCount: z.number().int().nonnegative().optional(),
  // Which backend read this PDF. Surfaced because OCR misreads names and amounts
  // while a text layer is exact — and it gates the "read it with OCR instead" offer.
  pdfSource: z.enum(['text-layer', 'ocr']).optional(),
  // Whether this file can still be re-read with OCR, i.e. its original bytes are in the
  // private bucket. False for a document whose ephemeral upload job had already expired
  // when the intake was created — there is nothing left to re-read, so the review step
  // hides the override rather than offering a button that can only fail.
  canReextract: z.boolean().optional(),
  // A 'youtube' source's link and what the probe knew about it, so the review card can name
  // and link the video instead of showing a bare URL. Absent on every other kind.
  sourceUrl: z.string().optional(),
  sourceAuthor: z.string().optional(),
  sourceThumbnailUrl: z.string().optional(),
});
export type DloIntakeFile = z.infer<typeof DloIntakeFileSchema>;

// ---------- how big one uploaded file may be ----------
//
// The ceiling for a single file on the officer-facing intake surfaces: /dlo's recordings and
// documents, and /transcribe's recordings. It lives here because it is asked in three places
// and must be answered identically in all of them — the two API routes enforce it, and the web
// pickers refuse an oversized file BEFORE the upload starts, which on a meeting recording is
// the difference between a refusal now and a refusal several minutes from now.
//
// `_MB` is stated rather than derived so the Marathi copy and the messages cannot disagree with
// the number actually enforced.
export const UPLOAD_FILE_MAX_MB = 50;
export const UPLOAD_FILE_MAX_BYTES = UPLOAD_FILE_MAX_MB * 1024 * 1024;

// ---------- meeting recordings: the audio containers the STT path can transcribe ----------
//
// The production STT provider (ElevenLabs Scribe) accepts every container listed here, so a
// phone recording or WhatsApp OPUS note needs no conversion before upload. Keep the list to
// the provider's documented AUDIO formats: video containers, AMR/WMA and raw PCM remain out.
// That makes Android's broad `audio/*` share target useful without turning the normal picker
// into "accept anything and fail after upload".
//
// Shared because the API validates an upload by its extension and stores the object under
// the matching content type, while the web picker's `accept` must offer exactly the same
// set — two lists would drift into "the browser let me pick it, the server refused it".
export const AUDIO_MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.aif': 'audio/aiff',
  '.aiff': 'audio/aiff',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/opus',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.webm': 'audio/webm',
};

export const AUDIO_FILE_EXTENSIONS: readonly string[] = Object.keys(
  AUDIO_MIME_BY_EXTENSION,
);

// The `accept` attribute for a recording picker. Extensions AND media types, because
// browsers differ over which they honour, and offering both is what keeps the picker from
// greying out a file the server would have accepted.
export const AUDIO_FILE_ACCEPT: string = [
  ...AUDIO_FILE_EXTENSIONS,
  ...new Set(Object.values(AUDIO_MIME_BY_EXTENSION)),
].join(',');

// The content type to store a recording under, or null when the name is not a recording.
// Extension-driven rather than trusting the browser's reported type, which is empty or
// wrong for several of these containers.
export function audioMimeForFileName(fileName: string): string | null {
  const dot = fileName.lastIndexOf('.');
  if (dot === -1) return null;
  return AUDIO_MIME_BY_EXTENSION[fileName.slice(dot).toLowerCase()] ?? null;
}

export function isAudioFileName(fileName: string): boolean {
  return audioMimeForFileName(fileName) !== null;
}

// A document the officer uploaded and READ at the input step, through the shared ephemeral
// document service, before this intake existed. It arrives already extracted, so the intake
// job has nothing to do with it — the route stores it as a finished file entry and every
// downstream step (review cards, assembly, generation) treats it like any other source.
//
// `jobId` is the ephemeral job the text came from. The API looks it up IN PROCESS to archive
// the original bytes into the private bucket; an expired job simply means the archive (and
// with it the per-file OCR re-read) is skipped, never that the text is lost — the text is
// right here in the payload.
export const DloPreReadDocumentSchema = z.object({
  jobId: z.string().optional(),
  name: z.string().min(1),
  kind: z.enum(['pdf', 'docx', 'txt']),
  // Total pages in the source document, for the record. Not the number of pages read: a
  // scanned PDF ships only the pages the officer chose to pay for.
  pageCount: z.number().int().nonnegative().optional(),
  pdfSource: PdfTextSourceSchema.optional(),
  // PDFs carry the SELECTED pages, with the officer's corrections already applied, so the
  // review card lists exactly what was kept. DOCX/TXT carry one string.
  pages: z.array(DloIntakePageSchema).optional(),
  text: z.string().optional(),
  // Pages the officer chose but chose NOT to wait for ("न वाचता ही पृष्ठे वापरा"). The intake job
  // reads exactly these from the archived original during its extract phase, so the OCR wait
  // folds into प्रक्रिया instead of standing in front of the form. Mutually exclusive with
  // `pages`, and PDF-only — nothing else has pages to defer. It needs the original bytes, so a
  // document whose ephemeral job has expired cannot be deferred: the route marks that file
  // failed rather than dropping a source silently.
  pendingPages: z.array(z.number().int().positive()).min(1).optional(),
});
export type DloPreReadDocument = z.infer<typeof DloPreReadDocumentSchema>;

// Same ceiling as the multipart file limit — an intake is a meeting's worth of material,
// not a document library.
export const DloCreateDocumentsSchema = z
  .array(DloPreReadDocumentSchema)
  .max(10);

// ---------- durable review state (migration 0036) ----------
//
// Everything the officer does in the review step that is NOT already a column: their
// corrections to the extracted text, the pages they unticked, and the two PAID lookups
// (pointers, prepared names). It is persisted so that reloading — or handing the intake to a
// colleague, or coming back tomorrow — costs nothing that has already been bought.
//
// It is stored in its OWN jsonb column rather than written back into `files`, for three
// reasons worth keeping: (1) `files` is rewritten wholesale by the extract/re-extract jobs, so
// an officer's autosave landing there would be a lost-update race against a live job, while
// disjoint columns can never clobber each other; (2) `files[].text` is the machine's answer and
// has to stay readable as such — the client's `edits[key] ?? page.text` overlay keeps both; and
// (3) the existing `forgetFile`/`forgetFileKeys` helpers prune that overlay by file index after
// an OCR re-read, and work unchanged on a restored blob.

// Sized against the API's JSON body limit, NOT picked round — and that relationship is the
// whole point of the number. Devanagari is 3 bytes per character in UTF-8, so this cap must
// stay comfortably under `bodyLimit / 3` or it becomes unreachable: the body limit would
// reject the request first and the officer would get an opaque English "Request body is too
// large" instead of the Marathi message. (Verified live at the old pairing: 300k chars
// against a 1 MiB limit fired the intended 400, 410k Devanagari fired a 413.)
//
// With the note's own ceiling removed and PDF uploads unbounded, a review state now holds a
// whole booklet's text, so the pair was raised together: bodyLimit is 64 MiB
// (apps/api/src/index.ts) and this is 15,000,000 characters ≈ 45 MB of Devanagari. Change
// one and you must change the other.
export const DLO_REVIEW_STATE_MAX_CHARS = 15_000_000;

// The pointer summary, kept verbatim. Re-running it is several paid model calls on a long
// source (one per POINTERS_REQUEST_CHUNK_CHARS block), which is exactly what resuming must not
// cost. `generatedAt` is shown so a stale summary can be recognised and refreshed by hand.
export const DloReviewPointersSchema = z.object({
  points: z.array(z.string()).max(120),
  generatedAt: z.string(),
});

// One person's edited पदनाम, keyed by the person's Marathi name (the same key
// DesignationReview edits by, so a re-fetch returning the same people keeps what was typed).
export const DloReviewDesignationEditSchema = z.object({
  designation: z.string(),
  remember: z.boolean(),
  // Whether the officer accepted a `suggested` row (a person the note does not name, proposed
  // because the नाव-शब्दकोश knows who holds the office it DOES name). Autosaved so the decision
  // survives a reload; defaulted so a review blob written before this field still parses.
  accepted: z.boolean().default(false),
});

// A name the officer added by hand because the extractor missed it.
export const DloReviewDesignationExtraSchema = z.object({
  name: z.string(),
  designation: z.string(),
  remember: z.boolean(),
});

// `names` and `known` both ride on the PAID prepare call, so both are stored. `known` going
// stale is harmless — it is only the autocomplete datalist.
export const DloReviewDesignationsSchema = z.object({
  // Version of the free/dictionary resolver around the paid name extraction. Old snapshots
  // remain parseable, but the web refreshes their suggestions once when this is absent.
  resolverVersion: z.literal(2).optional(),
  names: z.array(PreparedNameSchema),
  known: z.array(KnownDesignationSchema),
  edits: z.record(z.string(), DloReviewDesignationEditSchema),
  extras: z.array(DloReviewDesignationExtraSchema),
});

export const DloReviewStateSchema = z.object({
  // Shape version, so a future change is DETECTED rather than silently mis-parsed.
  v: z.literal(1),
  // Per-source corrections and unticked pages. Keys are the review layer's own scheme
  // (`notes` | `${fileIndex}` | `${fileIndex}:${page}`) — see apps/web/lib/dloReview.ts, which
  // stays the single owner of that format. `excluded` is the client's Set, sorted.
  edits: z.record(z.string(), z.string()).default({}),
  excluded: z.array(z.string()).default([]),
  // Pasted style reference. Unlike category/heading this has no column of its own.
  styleReference: z.string().optional(),
  // Trusted request for the article model (see ARTICLE_INSTRUCTIONS_MAX_CHARS). Stored
  // here rather than in a column for the same reason as the style reference — and this is also
  // how something typed on the intake FORM reaches the review step: the create route seeds an
  // initial blob with it.
  instructions: z.string().optional(),
  pointers: DloReviewPointersSchema.optional(),
  designations: DloReviewDesignationsSchema.optional(),
  // Who wrote this and when. The intake list is shared and there is no auth, so two people can
  // open the same intake; a client that reads back a `writer` it did not produce knows someone
  // else has saved and warns instead of silently overwriting. A random per-tab id rather than a
  // timestamp comparison, because two saves can land in the same millisecond.
  writer: z.string().max(64),
  updatedAt: z.string(),
});
export type DloReviewState = z.infer<typeof DloReviewStateSchema>;

// The autosave request. `category`/`heading` ride along because they are real columns and so
// survive even without 0036 — strictly better than putting them in the blob.
export const DloReviewPatchRequestSchema = z.object({
  reviewState: DloReviewStateSchema,
  category: DloCategorySchema.optional(),
  heading: z.string().trim().max(200).optional(),
});
export type DloReviewPatchRequest = z.infer<typeof DloReviewPatchRequestSchema>;

// The response reports who wrote the blob this save REPLACED, not who wrote the new one —
// echoing our own writer back would be information we already have, and comparing it to
// ourselves could never detect anything. `null` means the intake had no saved state yet.
// The client compares this to the writer it last saw: a different one means somebody else
// saved between our load and our save, which is exactly the case worth warning about.
export const DloReviewPatchResponseSchema = z.object({
  previousWriter: z.string().nullable(),
  updatedAt: z.string(),
});
export type DloReviewPatchResponse = z.infer<
  typeof DloReviewPatchResponseSchema
>;

// Build the blob from the client's live state. The sort is not cosmetic: `excluded` is a Set,
// whose iteration order follows insertion, so an unsorted array would differ between two
// clients holding the SAME selection and make every comparison report a spurious change.
export function serializeDloReviewState(
  input: Readonly<{
    edits: Readonly<Record<string, string>>;
    excluded: Iterable<string>;
    styleReference?: string | undefined;
    instructions?: string | undefined;
    pointers?: z.infer<typeof DloReviewPointersSchema> | undefined;
    designations?: z.infer<typeof DloReviewDesignationsSchema> | undefined;
    writer: string;
    updatedAt?: string | undefined;
  }>,
): DloReviewState {
  return {
    v: 1,
    edits: { ...input.edits },
    excluded: [...input.excluded].sort(),
    ...(input.styleReference ? { styleReference: input.styleReference } : {}),
    ...(input.instructions ? { instructions: input.instructions } : {}),
    ...(input.pointers ? { pointers: input.pointers } : {}),
    ...(input.designations ? { designations: input.designations } : {}),
    writer: input.writer,
    updatedAt: input.updatedAt ?? new Date().toISOString(),
  };
}

// Read a stored blob back. Returns null for anything unusable — an absent column on a database
// without 0036, a shape from a future version, or junk — because a resumed review that silently
// restores the WRONG corrections would be far worse than one that restores none.
export function parseDloReviewState(raw: unknown): DloReviewState | null {
  if (raw === null || raw === undefined) return null;
  const parsed = DloReviewStateSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

// ---------- detail + list payloads ----------

// A generation produced from this intake. An intake is never marked "consumed" — it stays
// `ready` forever and can legitimately produce several articles — so this is a list, and the
// list card shows a COUNT rather than a done/not-done flag.
export const DloIntakeGenerationSchema = z.object({
  id: z.string(),
  status: GenerationStatusSchema,
  createdAt: z.string(),
});
export type DloIntakeGeneration = z.infer<typeof DloIntakeGenerationSchema>;

export const DloIntakeDetailSchema = z.object({
  id: z.string(),
  status: DloIntakeStatusSchema,
  step: DloIntakeStepSchema.nullable(),
  notes: z.string(),
  category: DloCategorySchema,
  heading: z.string().nullable(),
  files: z.array(DloIntakeFileSchema),
  // The combined transcription/extraction output; null until status is 'ready'.
  combinedText: z.string().nullable(),
  error: z.string().nullable(),
  // The officer's saved review state. Like the per-source text this ships only on `?text=1`
  // (it CARRIES that text), so the 2.5 s poll stays lean. Defaulted so a web build can roll
  // out before the matching API, and null on a database without 0036.
  reviewState: DloReviewStateSchema.nullable().default(null),
  // Articles already generated from this intake. Computed only once the intake is `ready` —
  // none can exist before that. Defaulted for the same roll-out reason.
  generations: z.array(DloIntakeGenerationSchema).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type DloIntakeDetail = z.infer<typeof DloIntakeDetailSchema>;

// One row of the shared recent-intake list on /dlo. Deliberately carries no text: the list
// route omits `combined_text` and `review_state` from its select, because a card needs
// neither and both are large.
export const DloIntakeSummarySchema = z.object({
  id: z.string(),
  status: DloIntakeStatusSchema,
  step: DloIntakeStepSchema.nullable(),
  category: DloCategorySchema,
  heading: z.string().nullable(),
  // What the card shows: the officer's heading, else an excerpt of the notes, else the first
  // file's name, else a fallback. Computed server-side so every surface names an intake alike.
  title: z.string(),
  sourceCount: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative(),
  // A scanned PDF is still waiting for its pages to be read, so this intake cannot generate yet.
  needsSelection: z.boolean(),
  generationCount: z.number().int().nonnegative(),
  latestGenerationId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type DloIntakeSummary = z.infer<typeof DloIntakeSummarySchema>;

export const DloIntakeListResponseSchema = z.array(DloIntakeSummarySchema);

export const CreateDloIntakeResponseSchema = z.object({ id: z.string() });
export type CreateDloIntakeResponse = z.infer<
  typeof CreateDloIntakeResponseSchema
>;

// The review step's "generate" submission. combinedText is the officer-edited
// text and becomes the generation's note verbatim.
//
// It carries NO upper bound, deliberately: /dlo's source is a meeting's worth of recordings
// and scans, and truncating that at a round number would have thrown away material the
// officer had already reviewed and paid to extract. The lower bound stays — a run needs
// something to write from. The real ceiling now lives downstream in the model's context
// window, so a very long note costs proportionally more and can fail at the chat call
// rather than at this schema; that is the accepted trade.
export const DloGenerateRequestSchema = z.object({
  combinedText: z.string().trim().min(20),
  category: DloCategorySchema,
  heading: z.string().trim().max(200).optional(),
  // LEGACY (see pointers.ts). Back when Pointers was a 5W1H checkbox list, these three
  // fields carried the officer's approved inventory and became the article's completeness
  // contract. /dlo no longer sends any of them — the article is written from combinedText —
  // but they are deliberately KEPT and still honoured: zod objects are non-strict, so
  // dropping them would silently STRIP rather than reject, and a browser tab still on the
  // old bundle mid-deploy would lose its officer's selections without a trace. Stored rows
  // that carry them stay fully supported on retry and article feedback.
  //
  // Facts the officer kept in the Pointers step. The dimension is persisted with each
  // bullet so the article pipeline can reuse the approved inventory as its 5W1H scaffold.
  selectedFacts: z
    .array(
      z.object({
        dimension: z.enum(['who', 'what', 'when', 'where', 'why', 'how']),
        text: z.string().trim().min(1).max(500),
      }),
    )
    .max(60)
    .optional(),
  // Attributed statements the officer kept. Empty designation/venue fields mean the note
  // did not state them and are never filled by inference.
  statements: z
    .array(
      z.object({
        speaker: z.string().trim().min(1).max(200),
        designation: z.string().trim().max(200),
        venue: z.string().trim().max(300),
        claim: z.string().trim().min(1).max(1000),
      }),
    )
    .max(12)
    .optional(),
  // Facts the officer deselected in the Pointers step (their AI-summarized bullet text).
  // The generation pipeline is instructed to leave these out — see pointers.ts. Absent/empty
  // ⇒ nothing excluded ⇒ the article the intake would have produced before this feature,
  // which is what every new /dlo run now sends.
  excludedFacts: z.array(z.string().trim().min(1).max(500)).max(60).optional(),
  // Person → पदनाम pairs the officer approved in the "व्यक्ती व पदनाम" step — see
  // designations.ts. The designation is printed before the name on its first mention in the
  // article, and both translations inherit it. Absent/empty ⇒ every name prints bare.
  designations: NameDesignationsSchema.optional(),
  // A published article the officer pasted as the STYLE reference — tier 1 of the simplified
  // generator's reference hierarchy (see CreateGenerationRequestSchema.styleReference). Style
  // and structure only; never a factual source. Absent/empty ⇒ semantic retrieval, then any
  // available article from the requested news/scheme style category.
  styleReference: z.string().trim().optional(),
  // The officer's trusted request for the article model — writing direction plus any facts or
  // corrections supplied directly here (see CreateGenerationRequestSchema.instructions).
  // Absent/empty ⇒ the article this intake would have produced before this field existed.
  instructions: z
    .string()
    .trim()
    .max(ARTICLE_INSTRUCTIONS_MAX_CHARS)
    .optional(),
});
export type DloGenerateRequest = z.infer<typeof DloGenerateRequestSchema>;

export const DloGenerateResponseSchema = z.object({
  generationId: z.string(),
});
export type DloGenerateResponse = z.infer<typeof DloGenerateResponseSchema>;

// "Read these pages of these PDFs." One request covering every file the officer just chose
// pages for, since an intake can hold several scanned documents. This is the call that
// spends OCR credits, and it spends them only on the pages listed here.
export const DloExtractRequestSchema = z.object({
  selections: z
    .array(
      z.object({
        index: z.number().int().nonnegative(),
        pages: z.array(z.number().int().positive()).min(1),
      }),
    )
    .min(1),
});
export type DloExtractRequest = z.infer<typeof DloExtractRequestSchema>;

// The re-read request: "this PDF's text came out wrong, read it with OCR instead."
// Only 'ocr' is accepted — going back to the text layer would just reproduce the
// text the user is rejecting. `pages` is required for the same reason it is on the
// /translate override: re-reading is not a licence to re-bill excluded pages.
export const DloReextractFileRequestSchema = z.object({
  source: z.literal('ocr'),
  pages: z.array(z.number().int().positive()).min(1),
});
export type DloReextractFileRequest = z.infer<
  typeof DloReextractFileRequestSchema
>;

// ---------- combining sources into the reviewable text ----------
//
// Lives here, not in @dgipr/content-engine, because BOTH sides build this string:
// the intake job writes the full combined text to the row, and the web review step
// re-assembles it from the officer's per-source edits and page selection. The
// `=== स्रोत: … ===` header format must be identical in both, and apps/web cannot
// import content-engine (pdfjs, sarvam, openai). Same reason tweetWeightedLength
// lives here rather than in @dgipr/social-publisher.

export type IntakeSource = Readonly<{
  // Display label, usually the uploaded file's name.
  label: string;
  text: string;
}>;

function normalize(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function combineIntakeSources(
  notes: string,
  sources: readonly IntakeSource[],
): string {
  const cleanNotes = normalize(notes);
  const cleanSources = sources
    .map((source) => ({ label: source.label, text: normalize(source.text) }))
    .filter((source) => source.text.length > 0);

  // A single source with no notes needs no header — keep the note clean.
  if (!cleanNotes && cleanSources.length === 1) return cleanSources[0]!.text;
  if (cleanNotes && cleanSources.length === 0) return cleanNotes;

  const parts: string[] = [];
  if (cleanNotes) parts.push(`=== टिपणी ===\n${cleanNotes}`);
  for (const source of cleanSources) {
    parts.push(`=== स्रोत: ${source.label} ===\n${source.text}`);
  }
  return parts.join('\n\n');
}
