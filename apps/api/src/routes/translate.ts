// Standalone Marathi→English/Hindi translation of ad-hoc pasted text (not tied to a
// generation). Two-step like the per-generation flow: /translate/prepare returns the
// text's proper nouns for the user to confirm/correct in place, then /translate
// receives the confirmed set, saves it as verified glossary rows, and locks it into
// the translation. Without `terms` (older client) the legacy path mines unverified
// candidates into the review queue after translating instead.
//
// The name check is language-independent: the same confirmed rows lock English spellings
// for an English run and freeze the Devanagari forms for a Hindi one (see
// translate-article.ts), so /translate/prepare needs no language of its own.

import type { FastifyInstance } from 'fastify';
import {
  extractGlossaryCandidates,
  interpretDocumentInstruction,
  translateArticle,
} from '@dgipr/content-engine';
import {
  findGlossaryTermsInText,
  insertGlossaryCandidates,
  upsertGlossaryTerm,
  type SupabaseClient,
} from '@dgipr/database';
import {
  ExtractDocumentRequestSchema,
  InterpretDocumentInstructionRequestSchema,
  PrepareDocumentTranslationRequestSchema,
  PrepareTranslateTextRequestSchema,
  ReextractDocumentRequestSchema,
  TranslateDocumentRequestSchema,
  TranslateTextRequestSchema,
  TRANSLATE_DOCUMENT_MAX_BYTES,
  TRANSLATE_DOCUMENT_MAX_CHARS,
} from '@dgipr/schemas';
import { prepareTranslationTerms } from '../jobs/translation-terms.js';
import {
  getDocumentJob,
  selectedPages,
  startDocument,
  startDocumentExtraction,
  startDocumentReextraction,
  startDocumentTranslation,
  toDocumentDetail,
  type DocumentJob,
} from '../jobs/translate-document.js';

export function registerTranslateRoutes(
  app: FastifyInstance,
  client: SupabaseClient,
): void {
  app.post('/translate/prepare', async (request) => {
    const body = PrepareTranslateTextRequestSchema.parse(request.body);
    return prepareTranslationTerms(client, body.text);
  });

  app.post('/translate', async (request) => {
    const body = TranslateTextRequestSchema.parse(request.body);

    // Persist the user-confirmed names first (verified, overwrite by Marathi key) so
    // the glossary scan below locks the exact spellings the user just approved —
    // and future translations inherit them.
    if (body.terms) {
      for (const term of body.terms) {
        await upsertGlossaryTerm(client, {
          marathi: term.marathi,
          // english is NOT NULL; a Hindi-only extra carries no English, so fall back
          // to the Marathi form rather than reject the row.
          english: term.english?.trim() || term.marathi,
          hindi: term.hindi?.trim() || term.marathi,
          termType: term.termType ?? 'other',
          verified: true,
          source: 'manual',
        });
      }
    }

    const terms = await findGlossaryTermsInText(client, body.text);
    const glossary = terms.map((term) => ({
      marathi: term.marathi,
      english: term.english,
      hindi: term.hindi ?? undefined,
      // Hindi freezes only true proper nouns; the type is what tells them apart.
      termType: term.termType,
    }));

    const { text: translated, unpreservedNames } = await translateArticle(
      body.text,
      glossary,
      body.language,
    );

    // Legacy path only: with no confirmed set, mine unverified candidates into the
    // review queue (best-effort). The prepare flow already extracted these, so
    // re-mining there would just double the spend.
    let minedTermCount = 0;
    if (!body.terms) {
      try {
        const candidates = await extractGlossaryCandidates(body.text);
        await insertGlossaryCandidates(
          client,
          candidates.map((candidate) => ({
            ...candidate,
            source: 'auto' as const,
            verified: false,
          })),
        );
        minedTermCount = candidates.length;
      } catch (error) {
        request.log.error(error, 'glossary candidate mining failed');
      }
    }

    return {
      translated,
      language: body.language,
      // Legacy mirror for a web build deployed ahead of this API (it reads `english`).
      ...(body.language === 'en' ? { english: translated } : {}),
      lockedTermCount: glossary.length,
      minedTermCount,
      unpreservedNames,
    };
  });

  // ---------- PDF path ----------
  //
  // Same two-step name check as above, wrapped around a background OCR + translation job
  // (see jobs/translate-document.ts). Nothing is stored: the job lives in memory for a TTL
  // and the uploaded PDF is dropped as soon as it has been read.

  app.post('/translate/documents', async (request, reply) => {
    let upload: { name: string; data: Buffer } | null = null;
    try {
      // Per-request limits, like the DLO route: the global multipart config is sized for
      // small reference images.
      const parts = request.parts({
        limits: { fileSize: TRANSLATE_DOCUMENT_MAX_BYTES, files: 1 },
      });
      for await (const part of parts) {
        if (part.type !== 'file') continue;
        const name = part.filename ?? 'document.pdf';
        if (!name.toLowerCase().endsWith('.pdf')) {
          return reply
            .code(400)
            .send({ error: { message: 'फक्त PDF फाईल स्वीकारली जाते.' } });
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
          .send({ error: { message: 'फाईल खूप मोठी आहे (कमाल २५ MB).' } });
      }
      throw error;
    }

    if (!upload) {
      return reply
        .code(400)
        .send({ error: { message: 'कृपया एक PDF फाईल जोडा.' } });
    }
    try {
      // Probes only — page count and a local text-layer read. Nothing reaches Sarvam until
      // the user has picked pages at /extract.
      return reply
        .code(202)
        .send(await startDocument(upload.name, upload.data));
    } catch (error) {
      request.log.error(error, 'PDF probe failed');
      return reply.code(400).send({
        error: {
          message: 'ही PDF वाचता आली नाही. कृपया दुसरी फाईल पाठवा.',
        },
      });
    }
  });

  // The page selection: read these pages and no others. On a scanned document this is the
  // request that spends credits, and it spends them only on what is listed here.
  app.post<{ Params: { id: string } }>(
    '/translate/documents/:id/extract',
    async (request, reply) => {
      const job = getDocumentJob(request.params.id);
      if (!job) return reply.code(404).send(documentGoneError());
      if (job.status === 'extracting' || job.status === 'translating') {
        return reply.code(409).send({
          error: { message: 'या फाईलवर आधीच काम सुरू आहे.' },
        });
      }
      const body = ExtractDocumentRequestSchema.parse(request.body);
      const invalid = guardPageSelection(job, body.pages);
      if (invalid) return reply.code(400).send(invalid);

      startDocumentExtraction(job, body.pages);
      return reply.code(202).send({ id: job.id });
    },
  );

  // `text=1` returns the full page/translation text; the polling client omits it and keeps
  // the copy it already fetched, so a long run does not re-ship tens of thousands of
  // characters every 2.5 s.
  app.get<{ Params: { id: string }; Querystring: { text?: string } }>(
    '/translate/documents/:id',
    async (request, reply) => {
      const job = getDocumentJob(request.params.id);
      if (!job) return reply.code(404).send(documentGoneError());
      return toDocumentDetail(job, request.query.text === '1');
    },
  );

  // Re-read the document with OCR because the text layer came out wrong. The quality gate
  // in @dgipr/content-engine cannot catch every broken PDF font, and the user is the one
  // looking at the text, so the override is theirs.
  app.post<{ Params: { id: string } }>(
    '/translate/documents/:id/reextract',
    async (request, reply) => {
      const job = getDocumentJob(request.params.id);
      if (!job) return reply.code(404).send(documentGoneError());
      if (job.status === 'extracting' || job.status === 'translating') {
        return reply.code(409).send({
          error: { message: 'या फाईलवर आधीच काम सुरू आहे.' },
        });
      }
      const body = ReextractDocumentRequestSchema.parse(request.body);
      const invalid = guardPageSelection(job, body.pages);
      if (invalid) return reply.code(400).send(invalid);

      startDocumentReextraction(job, body.pages);
      return reply.code(202).send({ id: job.id });
    },
  );

  app.post<{ Params: { id: string } }>(
    '/translate/documents/:id/interpret',
    async (request, reply) => {
      const job = getDocumentJob(request.params.id);
      if (!job) return reply.code(404).send(documentGoneError());
      const body = InterpretDocumentInstructionRequestSchema.parse(
        request.body,
      );
      return interpretDocumentInstruction({
        instruction: body.instruction,
        pages: job.pages.map((page) => ({
          page: page.page,
          chars: page.chars,
          language: page.language,
          preview: page.text.slice(0, 200),
        })),
      });
    },
  );

  // The name check for the selected pages. Runs server-side against the job's own text, so
  // the client never re-uploads 40k characters and the pasted-text route's 10k cap (a
  // synchronous-request budget) does not apply here.
  app.post<{ Params: { id: string } }>(
    '/translate/documents/:id/prepare',
    async (request, reply) => {
      const job = getDocumentJob(request.params.id);
      if (!job) return reply.code(404).send(documentGoneError());
      const body = PrepareDocumentTranslationRequestSchema.parse(request.body);
      const pages = selectedPages(job, body.pages, body.pageEdits);
      const text = pages.map((page) => page.text).join('\n\n');
      const tooLong = guardSelectionLength(text);
      if (tooLong) return reply.code(413).send(tooLong);
      return prepareTranslationTerms(client, text);
    },
  );

  app.post<{ Params: { id: string } }>(
    '/translate/documents/:id/translate',
    async (request, reply) => {
      const job = getDocumentJob(request.params.id);
      if (!job) return reply.code(404).send(documentGoneError());
      if (job.status === 'extracting' || job.status === 'translating') {
        return reply.code(409).send({
          error: { message: 'या फाईलवर आधीच काम सुरू आहे.' },
        });
      }
      const body = TranslateDocumentRequestSchema.parse(request.body);
      const pages = selectedPages(job, body.pages, body.pageEdits);
      const tooLong = guardSelectionLength(
        pages.map((page) => page.text).join('\n\n'),
      );
      if (tooLong) return reply.code(413).send(tooLong);

      startDocumentTranslation(client, job, body);
      return reply.code(202).send({ id: job.id });
    },
  );
}

// A job that has expired (TTL) or died with a previous API process is indistinguishable
// from one that never existed, and the honest answer is the same: upload it again.
function documentGoneError() {
  return {
    error: {
      message: 'ही फाईल आता उपलब्ध नाही. कृपया PDF पुन्हा अपलोड करा.',
    },
  };
}

// The selection must name pages this document actually has. Rejected here rather than deep
// in the splitter so the user gets a Marathi message instead of a failed job, and so a
// nonsense request never reaches a paid OCR call.
function guardPageSelection(job: DocumentJob, pages: readonly number[]) {
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

function guardSelectionLength(text: string) {
  if (text.length <= TRANSLATE_DOCUMENT_MAX_CHARS) return null;
  return {
    error: {
      message: `निवडलेला मजकूर खूप मोठा आहे (${text.length.toLocaleString(
        'en-IN',
      )} / ${TRANSLATE_DOCUMENT_MAX_CHARS.toLocaleString('en-IN')} अक्षरे). कृपया कमी पृष्ठे निवडा.`,
    },
  };
}
