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
  updateDloIntake,
  uploadFile,
  type DloIntakeFileEntry,
  type DloIntakeFileKind,
  type DloIntakeRow,
  type SupabaseClient,
} from '@dgipr/database';
import {
  DloCategorySchema,
  DloExtractRequestSchema,
  DloGenerateRequestSchema,
  DloReextractFileRequestSchema,
  type DloIntakeDetail,
} from '@dgipr/schemas';
import {
  isIntakeJobRunning,
  startDloExtractionJob,
  startDloFileReextractionJob,
  startDloIntakeJob,
} from '../jobs/dlo-runner.js';
import { startGenerationJob } from '../jobs/runner.js';

// Meeting recordings are big (a 2h mp3 @128kbps ≈ 115 MB — the Sarvam batch
// ceiling), so this route overrides the conservative global multipart limits
// (10 MiB / 1 file, sized for reference-image uploads) per request.
const MAX_FILE_BYTES = 120 * 1024 * 1024;
const MAX_FILES = 10;

const KIND_BY_EXTENSION: Record<string, DloIntakeFileKind> = {
  '.mp3': 'audio',
  '.pdf': 'pdf',
  '.docx': 'docx',
};

const CONTENT_TYPE_BY_KIND: Record<DloIntakeFileKind, string> = {
  audio: 'audio/mpeg',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

function kindOf(fileName: string): DloIntakeFileKind | null {
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
function toDetail(row: DloIntakeRow, includeText: boolean): DloIntakeDetail {
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
      ...(includeText && entry.text !== undefined ? { text: entry.text } : {}),
      ...(includeText && entry.pages !== undefined
        ? { pages: [...entry.pages] }
        : {}),
    })),
    combinedText: includeText ? row.combinedText : null,
    error: row.error,
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
      kind: DloIntakeFileKind;
      data: Buffer;
    }> = [];
    let notes = '';
    let category = 'news';
    let heading = '';

    const parts = request.parts({
      limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES },
    });
    try {
      for await (const part of parts) {
        if (part.type === 'field') {
          const value = typeof part.value === 'string' ? part.value : '';
          if (part.fieldname === 'notes') notes = value;
          if (part.fieldname === 'category') category = value;
          if (part.fieldname === 'heading') heading = value;
          continue;
        }
        const kind = kindOf(part.filename ?? '');
        if (!kind) {
          return reply.code(400).send({
            error: {
              message: 'फक्त PDF, MP3 आणि DOCX फाईल्स स्वीकारल्या जातात.',
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
            message: 'फाईल खूप मोठी आहे (कमाल १२० MB प्रति फाईल).',
          },
        });
      }
      throw error;
    }

    const parsedCategory = DloCategorySchema.safeParse(category);
    if (!parsedCategory.success) {
      return reply.code(400).send({ error: { message: 'Unknown category.' } });
    }
    if (notes.trim().length === 0 && uploads.length === 0) {
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
        CONTENT_TYPE_BY_KIND[upload.kind],
      );
      entries.push({
        name: upload.name,
        storagePath,
        kind: upload.kind,
        status: 'pending',
      });
    }
    await updateDloIntake(client, row.id, { files: entries });
    startDloIntakeJob(client, row.id);
    return reply.code(202).send({ id: row.id });
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
      if (
        (row.status === 'queued' || row.status === 'running') &&
        !isIntakeJobRunning(row.id)
      ) {
        const error = 'Server restarted while this job was running.';
        await updateDloIntake(client, row.id, { status: 'failed', error });
        return toDetail({ ...row, status: 'failed', error }, includeText);
      }
      return toDetail(row, includeText);
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
  // note of a brand-new generation on the EXISTING pipeline (history, feedback,
  // translation, and posters via the detail page all work on it for free).
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
      const generation = await insertGeneration(client, {
        note: body.combinedText,
        outputType: 'article',
        category: body.category,
        heading: body.heading,
        dloIntakeId: row.id,
      });
      startGenerationJob(client, generation.id);
      return reply.code(202).send({ generationId: generation.id });
    },
  );
}
