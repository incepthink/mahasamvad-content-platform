// Generic document upload: read a PDF/DOCX/TXT and hand its pages back. No translation,
// no generation, no persistence — the surfaces that need those build on top of this.
//
// Thin handlers only (per AGENTS.md): parse the request, guard it, and let
// jobs/document-intake.ts sequence the work.
//
// The contract that matters here is the SPEND GATE: uploading probes and nothing more, so
// a scanned document costs nothing until POST /extract names the pages. Every guard below
// exists to keep a nonsense request from reaching a paid OCR call.

import type { FastifyInstance } from 'fastify';
import { chatOcrProviderName, documentKindOf } from '@dgipr/content-engine';
import type { SupabaseClient, UsageFeature } from '@dgipr/database';
import {
  AnalyticsFeatureKeySchema,
  DOCUMENT_MAX_BYTES,
  DocumentUploadSurfaceSchema,
  ExtractDocumentRequestSchema,
  ReextractDocumentRequestSchema,
} from '@dgipr/schemas';
import {
  getDocumentIntakeJob,
  startDocumentIntake,
  startDocumentIntakeExtraction,
  startDocumentIntakeReextraction,
  toDocumentIntakeDetail,
  type DocumentIntakeJob,
} from '../jobs/document-intake.js';

export function registerDocumentRoutes(
  app: FastifyInstance,
  client: SupabaseClient,
): void {
  app.post('/documents', async (request, reply) => {
    let upload: { name: string; data: Buffer } | null = null;
    // Which sidebar feature is uploading, for /analytics attribution only. This service is
    // shared by four surfaces, so without it a paid OCR read is countable in the bill and
    // attributable to nobody. Optional: an older web build sends none and the read is
    // simply not attributed, which is better than guessing a card to put it on.
    let feature: UsageFeature | null = null;
    // Which surface uploaded this, when that changes HOW the document is read. Only /chat
    // sends one, and it selects the whole-document Gemini backend (see gemini-doc.ts). The
    // browser names the SURFACE, never the provider: what a paid read runs on is a server
    // decision, and an unrecognised value simply leaves the deployment's default in place.
    let ocrProvider: string | null = null;
    try {
      // Per-request limits: the global multipart config is sized for small reference
      // images. DOCUMENT_MAX_BYTES is unlimited, so this override exists to LIFT that
      // global 10 MiB cap rather than to impose one; the 413 branch below is unreachable
      // and kept only so a future ceiling has somewhere to land.
      const parts = request.parts({
        limits: { fileSize: DOCUMENT_MAX_BYTES, files: 1 },
      });
      for await (const part of parts) {
        if (part.type !== 'file') {
          // Validated against the enum rather than trusted: `feature` reaches a jsonb
          // column, and an unrecognised value would create a card nobody can read.
          if (part.fieldname === 'feature') {
            const parsed = AnalyticsFeatureKeySchema.safeParse(part.value);
            if (parsed.success) feature = parsed.data;
          }
          if (part.fieldname === 'surface') {
            const parsed = DocumentUploadSurfaceSchema.safeParse(part.value);
            if (parsed.success && parsed.data === 'chat') {
              ocrProvider = chatOcrProviderName();
            }
          }
          continue;
        }
        const name = part.filename ?? 'document';
        if (!documentKindOf(name)) {
          return reply.code(400).send({
            error: {
              message: 'फक्त PDF, DOCX आणि TXT फाईल्स स्वीकारल्या जातात.',
            },
          });
        }
        upload = { name, data: await part.toBuffer() };
      }
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'FST_REQ_FILE_TOO_LARGE'
      ) {
        return reply
          .code(413)
          .send({ error: { message: 'फाईल खूप मोठी आहे.' } });
      }
      throw error;
    }

    if (!upload) {
      return reply.code(400).send({ error: { message: 'कृपया एक फाईल जोडा.' } });
    }
    try {
      // Probes only. Nothing reaches Sarvam until the user has picked pages at /extract.
      return reply
        .code(202)
        .send(
          await startDocumentIntake(
            upload.name,
            upload.data,
            feature,
            ocrProvider,
          ),
        );
    } catch (error) {
      request.log.error(error, 'document probe failed');
      return reply.code(400).send({
        error: { message: 'ही फाईल वाचता आली नाही. कृपया दुसरी फाईल पाठवा.' },
      });
    }
  });

  // `text=1` returns the full page text; the polling client omits it and keeps the copy it
  // already fetched, so a long OCR does not re-ship tens of thousands of characters every
  // 2.5 s.
  app.get<{ Params: { id: string }; Querystring: { text?: string } }>(
    '/documents/:id',
    async (request, reply) => {
      const job = getDocumentIntakeJob(request.params.id);
      if (!job) return reply.code(404).send(documentGoneError());
      return toDocumentIntakeDetail(job, request.query.text === '1');
    },
  );

  // The page selection: read these pages and no others. On a scanned document this is the
  // request that spends credits, and it spends them only on what is listed here.
  app.post<{ Params: { id: string } }>(
    '/documents/:id/extract',
    async (request, reply) => {
      const job = getDocumentIntakeJob(request.params.id);
      if (!job) return reply.code(404).send(documentGoneError());
      if (job.status === 'extracting') return reply.code(409).send(busyError());

      const body = ExtractDocumentRequestSchema.parse(request.body);
      const invalid = guardPageSelection(job, body.pages);
      if (invalid) return reply.code(400).send(invalid);

      startDocumentIntakeExtraction(job, body.pages, client);
      return reply.code(202).send({ id: job.id });
    },
  );

  // Re-read with OCR because the text layer came out wrong. The quality gate in
  // @dgipr/content-engine cannot catch every broken PDF font, and the user is the one
  // looking at the text, so the override is theirs.
  app.post<{ Params: { id: string } }>(
    '/documents/:id/reextract',
    async (request, reply) => {
      const job = getDocumentIntakeJob(request.params.id);
      if (!job) return reply.code(404).send(documentGoneError());
      if (job.status === 'extracting') return reply.code(409).send(busyError());
      // Only a PDF has two backends to choose between; there is no OCR reading of a .txt.
      if (job.kind !== 'pdf') {
        return reply.code(400).send({
          error: { message: 'फक्त PDF फाईल पुन्हा वाचता येते.' },
        });
      }

      const body = ReextractDocumentRequestSchema.parse(request.body);
      const invalid = guardPageSelection(job, body.pages);
      if (invalid) return reply.code(400).send(invalid);

      startDocumentIntakeReextraction(job, body.pages, client);
      return reply.code(202).send({ id: job.id });
    },
  );
}

// A job that has expired (TTL) or died with a previous API process is indistinguishable
// from one that never existed, and the honest answer is the same: upload it again.
function documentGoneError() {
  return {
    error: {
      message: 'ही फाईल आता उपलब्ध नाही. कृपया फाईल पुन्हा अपलोड करा.',
    },
  };
}

function busyError() {
  return { error: { message: 'या फाईलवर आधीच काम सुरू आहे.' } };
}

// The selection must name pages this document actually has. Rejected here rather than deep
// in the splitter so the user gets a Marathi message instead of a failed job, and so a
// nonsense request never reaches a paid OCR call.
function guardPageSelection(
  job: DocumentIntakeJob,
  pages: readonly number[],
) {
  const total = job.pageCount;
  if (total === null) return null;
  const outOfRange = pages.filter((page) => page < 1 || page > total);
  if (outOfRange.length === 0) return null;
  return {
    error: {
      message: `निवडलेली पृष्ठे या फाईलमध्ये नाहीत: ${outOfRange.join(
        ', ',
      )} (एकूण ${total} पृष्ठे).`,
    },
  };
}
