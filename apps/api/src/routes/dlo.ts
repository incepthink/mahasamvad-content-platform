// DLO intake API routes. Thin handlers only (per AGENTS.md): parse the
// multipart/JSON request, persist rows + storage objects via @dgipr/database,
// and hand the real transcription/extraction work to jobs/dlo-runner. The
// generate step funnels straight into the EXISTING generation pipeline — the
// reviewed combined text becomes a normal generations row's note.

import type { FastifyInstance } from 'fastify';
import {
  DLO_UPLOADS_BUCKET,
  getDloIntake,
  insertDloIntake,
  insertGeneration,
  listDloIntakes,
  listGenerationsForDloIntakes,
  updateDloIntake,
  uploadFile,
  type DloIntakeFileEntry,
  type DloIntakeFileKind,
  type DloIntakeRow,
  type DloIntakeSummaryRow,
  type SupabaseClient,
} from '@dgipr/database';
import {
  ARTICLE_INSTRUCTIONS_MAX_CHARS,
  AUDIO_FILE_EXTENSIONS,
  audioMimeForFileName,
  DLO_REVIEW_STATE_MAX_CHARS,
  DloCategorySchema,
  DloCreateDocumentsSchema,
  DloExtractRequestSchema,
  DloGenerateRequestSchema,
  DloReextractFileRequestSchema,
  DloReviewPatchRequestSchema,
  parseDloReviewState,
  parseYouTubeVideoId,
  serializeDloReviewState,
  UPLOAD_FILE_MAX_BYTES,
  UPLOAD_FILE_MAX_MB,
  YouTubeSourcesSchema,
  type DloIntakeDetail,
  type DloIntakeGeneration,
  type DloIntakeSummary,
  type DloPreReadDocument,
  type YouTubeVideo,
} from '@dgipr/schemas';
import {
  isIntakeJobRunning,
  startDloExtractionJob,
  startDloFileReextractionJob,
  startDloIntakeJob,
} from '../jobs/dlo-runner.js';
import { getDocumentIntakeJob } from '../jobs/document-intake.js';
import { startGenerationJob } from '../jobs/runner.js';
import { rememberDesignations } from '../jobs/designation-writeback.js';

// Meeting recordings and scanned GRs are big, so this route overrides the conservative global
// multipart limits (10 MiB / 1 file, sized for reference-image uploads) per request. The
// ceiling itself is @dgipr/schemas' UPLOAD_FILE_MAX_BYTES — the same number the web picker
// refuses at, so a file the browser accepted can never be rejected here.
const MAX_FILE_BYTES = UPLOAD_FILE_MAX_BYTES;
const MAX_FILES = 10;
// The `documents` field carries whole documents' worth of extracted Marathi text, and
// busboy defaults a field to 1 MiB — which a couple of GRs in Devanagari (3 bytes a
// character) will pass straight through. Raised to 64 MiB alongside the removal of the
// upload and note ceilings: a booklet read at the input step arrives here as TEXT, so this
// field is now the largest thing in the request.
const MAX_FIELD_BYTES = 64 * 1024 * 1024;

// The kinds that arrive as BYTES and are archived in the private bucket. 'youtube' is
// deliberately excluded rather than given a placeholder content type: such a source is a
// link the transcriber fetches for itself, so it has no file name, no content type and no
// storage object, and the two tables below would have to lie about all three.
type UploadedFileKind = Exclude<DloIntakeFileKind, 'youtube'>;

const KIND_BY_EXTENSION: Record<string, UploadedFileKind> = {
  // MP3/AAC/M4A only. The list lives in @dgipr/schemas so the web picker offers exactly
  // what this accepts.
  ...Object.fromEntries(
    AUDIO_FILE_EXTENSIONS.map((ext) => [ext, 'audio' as const]),
  ),
  '.pdf': 'pdf',
  '.docx': 'docx',
};

// Fallback per kind. Recordings are stored under their OWN container's type
// (`audioMimeForFileName`); this entry only covers a name with no known extension,
// which `kindOf` cannot classify as audio in the first place.
const CONTENT_TYPE_BY_KIND: Record<UploadedFileKind, string> = {
  audio: 'audio/mpeg',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain',
};

function kindOf(fileName: string): UploadedFileKind | null {
  const dot = fileName.lastIndexOf('.');
  if (dot === -1) return null;
  return KIND_BY_EXTENSION[fileName.slice(dot).toLowerCase()] ?? null;
}

// Storage object names must be ASCII-safe; the index prefix keeps them unique
// (display names may collide and may be entirely Devanagari).
function storagePathFor(intakeId: string, index: number, name: string): string {
  const safe = name.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `intakes/${intakeId}/${index}-${safe || 'file'}`;
}

// `includeText` carries the extracted text (per source, and page by page for
// PDFs) plus the combined text. It is opt-in because the review step needs a whole
// meeting transcript exactly once, while the 2.5 s poll behind it runs for minutes.
// What the /dlo list card calls this intake. The officer's heading if they gave one, else the
// opening of their notes, else the first uploaded file — computed here rather than in the web
// so every surface names an intake the same way.
const TITLE_EXCERPT_CHARS = 80;

function intakeTitle(
  row: Readonly<{
    heading: string | null;
    notes: string;
    files: readonly Readonly<{ name: string }>[];
  }>,
): string {
  const heading = row.heading?.trim();
  if (heading) return heading;
  const notes = row.notes.trim().replace(/\s+/g, ' ');
  if (notes.length > 0) {
    return notes.length > TITLE_EXCERPT_CHARS
      ? `${notes.slice(0, TITLE_EXCERPT_CHARS)}…`
      : notes;
  }
  return row.files[0]?.name ?? 'विनाशीर्षक';
}

function toSummary(
  row: DloIntakeSummaryRow,
  generations: readonly DloIntakeGeneration[],
): DloIntakeSummary {
  return {
    id: row.id,
    status: row.status,
    step: row.step,
    category: row.category,
    heading: row.heading,
    title: intakeTitle(row),
    sourceCount: row.files.length,
    failedCount: row.files.filter((file) => file.status === 'failed').length,
    needsSelection: row.files.some((file) => file.status === 'needs-selection'),
    generationCount: generations.length,
    latestGenerationId: generations[0]?.id ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toDetail(
  row: DloIntakeRow,
  includeText: boolean,
  generations: readonly DloIntakeGeneration[] = [],
): DloIntakeDetail {
  return {
    id: row.id,
    status: row.status,
    step: row.step,
    notes: row.notes,
    category: row.category,
    heading: row.heading,
    // storagePath is a server-side concern; the client sees name + progress.
    files: row.files.map((entry) => ({
      name: entry.name,
      kind: entry.kind,
      status: entry.status,
      ...(entry.chars !== undefined ? { chars: entry.chars } : {}),
      ...(entry.error !== undefined ? { error: entry.error } : {}),
      // Lean on purpose: the page picker only needs the COUNT, so a scanned PDF
      // awaiting selection costs the poll nothing.
      ...(entry.pageCount !== undefined ? { pageCount: entry.pageCount } : {}),
      ...(entry.pdfSource !== undefined ? { pdfSource: entry.pdfSource } : {}),
      // Only a PDF whose original is still archived can be re-read; a document read at
      // the input step after its ephemeral job expired has no bytes left, so the review
      // step must not offer an override that could only fail.
      ...(entry.kind === 'pdf' && entry.storagePath !== undefined
        ? { canReextract: true }
        : {}),
      // A YouTube source's link and what the probe knew about it, so the review card can
      // name and link the video. Cheap enough for the poll — a URL and a title.
      ...(entry.sourceUrl !== undefined ? { sourceUrl: entry.sourceUrl } : {}),
      ...(entry.sourceAuthor !== undefined
        ? { sourceAuthor: entry.sourceAuthor }
        : {}),
      ...(entry.sourceThumbnailUrl !== undefined
        ? { sourceThumbnailUrl: entry.sourceThumbnailUrl }
        : {}),
      ...(includeText && entry.text !== undefined ? { text: entry.text } : {}),
      ...(includeText && entry.pages !== undefined
        ? { pages: [...entry.pages] }
        : {}),
    })),
    combinedText: includeText ? row.combinedText : null,
    error: row.error,
    // Text-gated for the same reason the per-source text is: the blob CARRIES the officer's
    // corrected page text, and the 2.5 s poll runs for minutes. `parseDloReviewState` returns
    // null for anything unusable — including the absent column on a database without 0036 —
    // so a bad blob degrades to "nothing saved" rather than failing the whole detail fetch.
    reviewState: includeText ? parseDloReviewState(row.reviewState) : null,
    generations: [...generations],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function registerDloRoutes(
  app: FastifyInstance,
  client: SupabaseClient,
): void {
  app.post('/dlo/intakes', async (request, reply) => {
    const uploads: Array<{
      name: string;
      kind: UploadedFileKind;
      data: Buffer;
    }> = [];
    let notes = '';
    let category = 'news';
    let heading = '';
    // Two fields the officer can fill in on the intake FORM even though they are only used at
    // generate time: the officer's trusted request and the pasted style model.
    // Neither has a column on dlo_intakes, so they are handed on through the review-state blob
    // (see the seed below) rather than being lost the moment the form is submitted.
    let instructions = '';
    let styleReference = '';
    // Documents the officer uploaded and READ at the input step, through the shared
    // ephemeral service. They arrive already extracted — see the entry-building loop below.
    let documents: DloPreReadDocument[] = [];
    // YouTube links, already probed by the input step. Nothing is downloaded here or ever:
    // the transcriber fetches the media itself (@dgipr/schemas' youtube.ts), so these become
    // entries with a URL and no archive.
    let youtube: YouTubeVideo[] = [];

    const parts = request.parts({
      limits: {
        fileSize: MAX_FILE_BYTES,
        files: MAX_FILES,
        fieldSize: MAX_FIELD_BYTES,
      },
    });
    try {
      for await (const part of parts) {
        if (part.type === 'field') {
          const value = typeof part.value === 'string' ? part.value : '';
          if (part.fieldname === 'notes') notes = value;
          if (part.fieldname === 'category') category = value;
          if (part.fieldname === 'heading') heading = value;
          if (part.fieldname === 'instructions') instructions = value;
          if (part.fieldname === 'styleReference') styleReference = value;
          if (part.fieldname === 'documents' && value.trim().length > 0) {
            try {
              documents = DloCreateDocumentsSchema.parse(JSON.parse(value));
            } catch {
              return reply.code(400).send({
                error: { message: 'कागदपत्रांची माहिती वाचता आली नाही.' },
              });
            }
          }
          if (part.fieldname === 'youtube' && value.trim().length > 0) {
            try {
              youtube = YouTubeSourcesSchema.parse(JSON.parse(value));
            } catch {
              return reply.code(400).send({
                error: { message: 'यूट्युब लिंकची माहिती वाचता आली नाही.' },
              });
            }
            // The client sends what it probed; this re-derives the id from the URL rather
            // than trusting it, so a malformed or hand-crafted payload cannot put an
            // arbitrary URL in front of the transcriber.
            for (const video of youtube) {
              if (parseYouTubeVideoId(video.url) === null) {
                return reply.code(400).send({
                  error: { message: 'यूट्युब लिंक वैध नाही.' },
                });
              }
            }
          }
          continue;
        }
        const kind = kindOf(part.filename ?? '');
        if (!kind) {
          return reply.code(400).send({
            error: {
              message:
                'फक्त ध्वनिमुद्रण (MP3, AAC, M4A), PDF आणि DOCX फाईल्स स्वीकारल्या जातात.',
            },
          });
        }
        uploads.push({
          name: part.filename ?? 'file',
          kind,
          data: await part.toBuffer(),
        });
      }
    } catch (error) {
      // @fastify/multipart raises FST_REQ_FILE_TOO_LARGE from toBuffer when a
      // part exceeds the per-request fileSize limit above.
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'FST_REQ_FILE_TOO_LARGE'
      ) {
        return reply.code(413).send({
          error: {
            message: `फाईल खूप मोठी आहे (कमाल ${UPLOAD_FILE_MAX_MB.toLocaleString('mr-IN')} MB प्रति फाईल).`,
          },
        });
      }
      throw error;
    }

    const parsedCategory = DloCategorySchema.safeParse(category);
    if (!parsedCategory.success) {
      return reply.code(400).send({ error: { message: 'Unknown category.' } });
    }
    if (
      notes.trim().length === 0 &&
      uploads.length === 0 &&
      documents.length === 0 &&
      youtube.length === 0
    ) {
      return reply.code(400).send({
        error: { message: 'टिपणी लिहा किंवा किमान एक फाईल जोडा.' },
      });
    }

    // Insert first (the storage paths need the row id), then upload the
    // originals to the private bucket, then attach the per-file entries and
    // start the job — the job reads everything back off the row.
    const row = await insertDloIntake(client, {
      notes: notes.trim(),
      category: parsedCategory.data,
      heading: heading.trim() || undefined,
      files: [],
    });
    const entries: DloIntakeFileEntry[] = [];
    for (const [index, upload] of uploads.entries()) {
      const storagePath = storagePathFor(row.id, index, upload.name);
      await uploadFile(
        client,
        DLO_UPLOADS_BUCKET,
        storagePath,
        upload.data,
        audioMimeForFileName(upload.name) ?? CONTENT_TYPE_BY_KIND[upload.kind],
      );
      entries.push({
        name: upload.name,
        storagePath,
        kind: upload.kind,
        status: 'pending',
      });
    }

    // Then the YouTube links, beside the recordings because that is what they are — the
    // transcribe phase reads them in the same pass. Nothing is uploaded and nothing is
    // archived: there are no bytes on our side at any point, only a URL.
    //
    // The display name is the probed title where there is one, so the review card and the
    // `=== स्रोत: … ===` header name the video rather than repeating a URL. A probe that
    // failed leaves the link itself, which is still a usable label.
    for (const video of youtube) {
      entries.push({
        name: video.title ?? video.url,
        kind: 'youtube',
        status: 'pending',
        sourceUrl: video.url,
        ...(video.author !== undefined ? { sourceAuthor: video.author } : {}),
        ...(video.thumbnailUrl !== undefined
          ? { sourceThumbnailUrl: video.thumbnailUrl }
          : {}),
      });
    }

    // Then the documents from the input step, in one of two shapes. Normally they are already
    // READ — the officer picked their pages and corrected their text there — so they land as
    // finished entries and the intake job skips them, which is what keeps a scanned PDF from
    // being OCR'd twice. A scan the officer declined to wait for instead carries only its page
    // SELECTION (`pendingPages`) and lands 'pending', for the job's extract phase to read.
    //
    // Their bytes are still held by the ephemeral job in THIS process, so the archive is a
    // copy rather than a second upload from the browser. An expired job (60-min TTL) simply
    // means no archive: the text already travelled in the request, and the only thing lost
    // is the ability to re-read that file later.
    const documentBase = entries.length;
    for (const [offset, document] of documents.entries()) {
      const source = document.jobId
        ? getDocumentIntakeJob(document.jobId)
        : null;
      let storagePath: string | undefined;
      if (source) {
        storagePath = storagePathFor(
          row.id,
          documentBase + offset,
          document.name,
        );
        await uploadFile(
          client,
          DLO_UPLOADS_BUCKET,
          storagePath,
          source.data,
          CONTENT_TYPE_BY_KIND[document.kind],
        );
      }
      // A document whose pages the officer picked but chose NOT to wait for. Nothing has been
      // read, so there is no text to store: what travels is the SELECTION, and the intake job's
      // extract phase reads exactly those pages out of the archive below.
      if (document.pendingPages && document.pendingPages.length > 0) {
        entries.push(
          storagePath === undefined
            ? {
                // No text and no bytes — the ephemeral job expired (or the API restarted)
                // between the upload and this submit, so nothing about this file can be
                // recovered. Fail the file, not the intake: every other source still generates
                // and the review step's warning names this one.
                name: document.name,
                kind: document.kind,
                status: 'failed',
                error:
                  'या फाईलची मूळ प्रत उपलब्ध नाही, त्यामुळे ती वाचता आली नाही. कृपया ती पुन्हा जोडा.',
                ...(document.pageCount !== undefined
                  ? { pageCount: document.pageCount }
                  : {}),
              }
            : {
                name: document.name,
                storagePath,
                kind: document.kind,
                status: 'pending',
                pendingPages: document.pendingPages,
                ...(document.pageCount !== undefined
                  ? { pageCount: document.pageCount }
                  : {}),
              },
        );
        continue;
      }

      const text = document.pages
        ? document.pages
            .map((page) => page.text)
            .filter((value) => value.length > 0)
            .join('\n\n')
        : (document.text ?? '');
      entries.push({
        name: document.name,
        ...(storagePath !== undefined ? { storagePath } : {}),
        kind: document.kind,
        status: 'done',
        chars: text.length,
        ...(document.pages !== undefined
          ? { pages: document.pages }
          : { text: document.text ?? '' }),
        ...(document.pageCount !== undefined
          ? { pageCount: document.pageCount }
          : {}),
        ...(document.pdfSource !== undefined
          ? { pdfSource: document.pdfSource }
          : {}),
      });
    }

    await updateDloIntake(client, row.id, { files: entries });

    // Carry the form's generate-time fields over to the review step. A SEPARATE, best-effort
    // update rather than part of the insert or of the files write above: `review_state` is
    // 0036's column, so on a database without it this costs the handover alone instead of the
    // whole intake (the 0028 principle). Trimmed to the same ceiling the generate route
    // enforces, so an over-long paste cannot make every later autosave fail.
    const seededInstructions = instructions
      .trim()
      .slice(0, ARTICLE_INSTRUCTIONS_MAX_CHARS);
    const seededStyleReference = styleReference.trim();
    if (seededInstructions || seededStyleReference) {
      try {
        await updateDloIntake(client, row.id, {
          reviewState: serializeDloReviewState({
            edits: {},
            excluded: [],
            ...(seededInstructions ? { instructions: seededInstructions } : {}),
            ...(seededStyleReference
              ? { styleReference: seededStyleReference }
              : {}),
            // Named rather than a random per-tab id: the officer's own browser adopts this
            // writer when it seeds, so resuming its own submission is never reported as a
            // second officer's edit.
            writer: 'intake-form',
          }),
        });
      } catch (error) {
        console.error(
          `[dlo ${row.id}] could not seed review state (is 0036 applied?):`,
          error,
        );
      }
    }

    startDloIntakeJob(client, row.id);
    return reply.code(202).send({ id: row.id });
  });

  // The shared recent-intake list behind /dlo. Every intake, newest first — there is no auth
  // and no owner column, so the web groups the caller's own runs above the rest purely for
  // ordering (a localStorage id list, never a permission).
  //
  // This route deliberately does NOT run the orphan check below. That check fails any
  // queued/running row absent from THIS PROCESS's job set, which is correct for one row the
  // client is actively watching and catastrophic across a whole list: opening /dlo in a second
  // tab would mass-fail every intake currently running. Statuses are reported verbatim here;
  // the detail route is where a genuinely orphaned row gets reaped.
  app.get('/dlo/intakes', async () => {
    const rows = await listDloIntakes(client);
    const generations = await listGenerationsForDloIntakes(
      client,
      rows.map((row) => row.id),
    );
    // One batched query for the page, grouped in memory — never N+1.
    const byIntake = new Map<string, DloIntakeGeneration[]>();
    for (const generation of generations) {
      const list = byIntake.get(generation.dloIntakeId) ?? [];
      list.push({
        id: generation.id,
        status: generation.status,
        createdAt: generation.createdAt,
      });
      byIntake.set(generation.dloIntakeId, list);
    }
    return rows.map((row) => toSummary(row, byIntake.get(row.id) ?? []));
  });

  app.get<{ Params: { id: string }; Querystring: { text?: string } }>(
    '/dlo/intakes/:id',
    async (request, reply) => {
      const row = await getDloIntake(client, request.params.id);
      if (!row) {
        return reply
          .code(404)
          .send({ error: { message: 'Intake not found.' } });
      }
      const includeText = request.query.text === '1';
      // Orphan check, same as the generation detail route: a row stuck in
      // queued/running whose job is not in this process died with a previous
      // server; fail it so the UI stops spinning.
      //
      // NOTE: this makes the API a SINGLE-PROCESS service. With two instances behind a load
      // balancer, instance B's poll would fail a job running healthily on instance A. Scaling
      // horizontally requires replacing this with a heartbeat + grace window (and the same
      // change in runner.ts / video-runner.ts, which share the pattern).
      if (
        (row.status === 'queued' || row.status === 'running') &&
        !isIntakeJobRunning(row.id)
      ) {
        const error = 'Server restarted while this job was running.';
        await updateDloIntake(client, row.id, { status: 'failed', error });
        return toDetail({ ...row, status: 'failed', error }, includeText);
      }
      // Only a `ready` intake can have produced an article, and useDloIntake stops polling at
      // ready — so this runs on the ready-transition fetch and manual refreshes, not on the
      // 2.5 s progress poll.
      const generations =
        row.status === 'ready'
          ? (await listGenerationsForDloIntakes(client, [row.id])).map(
              (generation) => ({
                id: generation.id,
                status: generation.status,
                createdAt: generation.createdAt,
              }),
            )
          : [];
      return toDetail(row, includeText, generations);
    },
  );

  // The review step's autosave: the officer's corrections, unticked pages, and the two PAID
  // lookups (pointers, prepared names), so leaving /dlo costs nothing already bought.
  //
  // Last-writer-wins by design. The list is shared and there is no identity to lock against,
  // so the blob carries a `writer` id and the client warns when it reads back one it did not
  // produce; it never silently overwrites what is on screen. Optimistic concurrency on the
  // row's updated_at was rejected: the intake job stamps that column too, so an OCR re-read
  // would spuriously reject the officer's own save.
  app.patch<{ Params: { id: string } }>(
    '/dlo/intakes/:id/review',
    async (request, reply) => {
      const body = DloReviewPatchRequestSchema.parse(request.body);
      const row = await getDloIntake(client, request.params.id);
      if (!row) {
        return reply
          .code(404)
          .send({ error: { message: 'Intake not found.' } });
      }
      // The client checks this before sending; the guard here is what stops an oversized blob
      // reaching the 1 MiB body limit as an opaque 413.
      const size = JSON.stringify(body.reviewState).length;
      if (size > DLO_REVIEW_STATE_MAX_CHARS) {
        return reply.code(400).send({
          error: { message: 'तपासणीतील बदल जतन करण्यासाठी खूप मोठे आहेत.' },
        });
      }
      // Who wrote what this save is about to replace. Read BEFORE the update, and reported
      // back so the client can tell "I am overwriting my own last save" (the normal case)
      // from "somebody else has been in here since I loaded".
      const previous = parseDloReviewState(row.reviewState);
      await updateDloIntake(client, row.id, {
        reviewState: body.reviewState,
        ...(body.category !== undefined ? { category: body.category } : {}),
        ...(body.heading !== undefined ? { heading: body.heading } : {}),
      });
      return {
        previousWriter: previous?.writer ?? null,
        updatedAt: body.reviewState.updatedAt,
      };
    },
  );

  // "Read these pages." The officer's page choice for every scanned PDF in this intake —
  // the one call that spends OCR credits, bounded to exactly what was ticked.
  app.post<{ Params: { id: string } }>(
    '/dlo/intakes/:id/extract',
    async (request, reply) => {
      const body = DloExtractRequestSchema.parse(request.body);
      const row = await getDloIntake(client, request.params.id);
      if (!row) {
        return reply
          .code(404)
          .send({ error: { message: 'Intake not found.' } });
      }
      if (row.status !== 'ready' || isIntakeJobRunning(row.id)) {
        return reply
          .code(409)
          .send({ error: { message: 'या फाईलवर आधीच काम सुरू आहे.' } });
      }
      for (const selection of body.selections) {
        const entry = row.files[selection.index];
        if (!entry || entry.kind !== 'pdf') {
          return reply
            .code(404)
            .send({ error: { message: 'File not found.' } });
        }
        const total = entry.pageCount;
        if (total !== undefined) {
          const outOfRange = selection.pages.filter(
            (page) => page < 1 || page > total,
          );
          if (outOfRange.length > 0) {
            return reply.code(400).send({
              error: {
                message: `निवडलेली पृष्ठे ${entry.name} मध्ये नाहीत: ${outOfRange.join(
                  ', ',
                )} (एकूण ${total} पृष्ठे).`,
              },
            });
          }
        }
      }
      // Flip the row BEFORE returning, for the same reason as the re-read below.
      await updateDloIntake(client, row.id, {
        status: 'running',
        step: 'extract',
        error: null,
      });
      startDloExtractionJob(client, row.id, body.selections);
      return reply.code(202).send({ id: row.id });
    },
  );

  // "This PDF came out wrong — read it with OCR instead." Re-reads ONE file of a
  // ready intake; the officer's edits to the other sources live client-side and
  // are untouched. The intake goes back to running, so the review step's existing
  // poll shows the progress and picks up the new pages.
  app.post<{ Params: { id: string; index: string } }>(
    '/dlo/intakes/:id/files/:index/reextract',
    async (request, reply) => {
      const body = DloReextractFileRequestSchema.parse(request.body);
      const row = await getDloIntake(client, request.params.id);
      if (!row) {
        return reply
          .code(404)
          .send({ error: { message: 'Intake not found.' } });
      }
      const index = Number(request.params.index);
      const entry = Number.isInteger(index) ? row.files[index] : undefined;
      if (!entry) {
        return reply.code(404).send({ error: { message: 'File not found.' } });
      }
      if (entry.kind !== 'pdf') {
        return reply.code(400).send({
          error: { message: 'फक्त PDF फाईल पुन्हा वाचता येते.' },
        });
      }
      // A document read at the input step whose ephemeral job had expired by the time
      // this intake was created: its text is here, its bytes are not.
      if (entry.storagePath === undefined) {
        return reply.code(400).send({
          error: {
            message:
              'या फाईलची मूळ प्रत उपलब्ध नाही, त्यामुळे ती पुन्हा वाचता येत नाही.',
          },
        });
      }
      if (row.status !== 'ready' || isIntakeJobRunning(row.id)) {
        return reply
          .code(409)
          .send({ error: { message: 'या फाईलवर आधीच काम सुरू आहे.' } });
      }
      // Flip the row BEFORE returning, not inside the job: the client refreshes
      // the moment this 202 lands, and a row still reading 'ready' would stop its
      // poll and sit there while the OCR ran.
      await updateDloIntake(client, row.id, {
        status: 'running',
        step: 'extract',
        error: null,
      });
      startDloFileReextractionJob(client, row.id, index, body.pages);
      return reply.code(202).send({ id: row.id });
    },
  );

  // The review step's submit: the officer-edited combined text becomes the
  // note of a brand-new generation on the shared article runner. That runner
  // selects generateArticleSimple by default (ARTICLE_GENERATION_MODE=full is
  // the explicit legacy opt-out), while history, feedback, translation, and
  // posters continue to work through the normal generation row.
  app.post<{ Params: { id: string } }>(
    '/dlo/intakes/:id/generate',
    async (request, reply) => {
      const body = DloGenerateRequestSchema.parse(request.body);
      const row = await getDloIntake(client, request.params.id);
      if (!row) {
        return reply
          .code(404)
          .send({ error: { message: 'Intake not found.' } });
      }
      if (row.status !== 'ready') {
        return reply
          .code(409)
          .send({ error: { message: 'Intake is not ready yet.' } });
      }
      // Save the pairings the officer ticked "यापुढेही हेच वापरा" BEFORE inserting, so the
      // dictionary is right even if the generation itself later fails. Best-effort inside —
      // the pairs travel on the row regardless, so this run is unaffected either way.
      await rememberDesignations(client, body.designations ?? []);

      const generation = await insertGeneration(client, {
        note: body.combinedText,
        outputType: 'article',
        category: body.category,
        heading: body.heading,
        dloIntakeId: row.id,
        // LEGACY (migrations 0030 + 0034) — /dlo no longer sends any of these three, since
        // the Pointers step became a read-only summary and the article is written from
        // combinedText. They are still forwarded rather than dropped so a browser tab on the
        // old bundle mid-deploy keeps working, and so stored rows behave identically on
        // retry and article feedback. insertGeneration omits each column when empty/absent,
        // so an un-applied 0030/0034 only disables the feature rather than failing the create.
        excludedFacts: body.excludedFacts,
        selectedFacts: body.selectedFacts,
        statements: body.statements,
        // Approved person → पदनाम pairs (migration 0033), minus the request-only `remember`
        // flag. Same omit-when-empty treatment as excludedFacts.
        nameDesignations: (body.designations ?? []).map((pair) => ({
          name: pair.name,
          designation: pair.designation,
        })),
        // The article the officer pasted as the STYLE model (migration 0035) — tier 1 of the
        // simplified generator's reference hierarchy. Same omit-when-empty treatment again.
        styleReference: body.styleReference,
        // The officer's trusted request for this article (migration 0041). Same
        // omit-when-empty treatment again.
        instructions: body.instructions,
      });
      startGenerationJob(client, generation.id);
      return reply.code(202).send({ generationId: generation.id });
    },
  );
}
