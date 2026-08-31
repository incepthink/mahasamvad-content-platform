import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { fileURLToPath } from 'node:url';
import { ZodError } from 'zod';
import { createServiceRoleClient } from '@dgipr/database';
import { isAllowedOrigin } from './cors-origins.js';
import { registerAnalyticsRoutes } from './routes/analytics.js';
import { registerCanvaRoutes } from './routes/canva.js';
import { registerChatRoutes } from './routes/chat.js';
import { registerDloRoutes } from './routes/dlo.js';
import { registerNewDloRoutes } from './routes/new-dlo.js';
import { registerDocumentRoutes } from './routes/documents.js';
import { registerGenerationRoutes } from './routes/generations.js';
import { registerGlossaryRoutes } from './routes/glossary.js';
import { registerTranslateRoutes } from './routes/translate.js';
import { registerProofreadRoutes } from './routes/proofread.js';
import { registerPointerRoutes } from './routes/pointers.js';
import { registerDesignationRoutes } from './routes/designations.js';
import { registerReferenceRoutes } from './routes/references.js';
import { registerTranscriptionRoutes } from './routes/transcriptions.js';
import { registerVideoRoutes } from './routes/video.js';
import { registerYouTubeRoutes } from './routes/youtube.js';

export async function createServer() {
  const app = Fastify({
    logger: true,
    // JSON requests. 64 MiB rather than Fastify's 1 MiB default because /dlo's reviewed
    // text is no longer capped: a whole scanned booklet's Marathi (3 bytes a character)
    // travels as JSON on the review autosave and again on generate. Kept in step with
    // DLO_REVIEW_STATE_MAX_CHARS (@dgipr/schemas), which is deliberately sized under a
    // third of this so the officer gets a Marathi 400 rather than an opaque 413.
    // Multipart uploads have their own limits below.
    bodyLimit: 67_108_864,
  });

  // A callback rather than the list itself, because CORS_ORIGIN entries may be wildcard
  // patterns (see cors-origins.ts - Vercel gives every deployment a fresh hostname). A
  // request carrying no Origin header is not a browser request and is left alone; a
  // disallowed one simply gets no CORS header, which is the array form's behaviour too.
  await app.register(cors, {
    origin: (origin, cb) => {
      cb(null, origin === undefined || isAllowedOrigin(origin));
    },
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
  });

  // Multipart default. Every upload route now sets its OWN per-request limits — /dlo,
  // /transcribe, /documents, /translate and /references all unlimited per file, /chat and
  // /video to UPLOAD_FILE_MAX_BYTES — so nothing reaches this 10 MiB
  // fallback today. It is kept as a conservative default for a future route that forgets to
  // state one: a small cap surfaces as a 413 the first time it is tested, where an unlimited
  // default would only surface as memory pressure in production.
  await app.register(multipart, {
    limits: { fileSize: 10_485_760, files: 1 },
  });

  // The LAST-RESORT error path, and the only one an officer was never meant to read.
  //
  // Routes that refuse a request on purpose answer with `reply.code(4xx).send(...)` and
  // their own Marathi sentence; those return directly and never arrive here. What lands
  // here is the unplanned half — a schema rejection, a driver failure, a missing column,
  // a provider timeout — and until now its raw `error.message` was sent to the browser
  // and rendered verbatim. Two of those shapes were actively harmful on screen:
  //
  //   * `ZodError.message` is a JSON array of issue objects, pretty-printed. 401
  //     characters for a two-field schema and several thousand for a real request body.
  //     That is the blob that overflowed the card on a phone.
  //   * an internal message names a column, a bucket path or a provider request id.
  //
  // So the wire now carries a short Marathi sentence plus a stable machine `code`, and
  // the detail goes to the log, where it was always the only useful audience. The `code`
  // is additive — `readJsonResponse` in apps/web reads `error.message` and ignores it —
  // and exists so a future client can branch without matching on prose.
  const FAILURE_TEXT = {
    invalid_request:
      'पाठवलेली माहिती अपूर्ण किंवा चुकीची आहे. कृपया तपासून पुन्हा प्रयत्न करा.',
    internal_error: 'सेवेत तात्पुरती अडचण आली. कृपया पुन्हा प्रयत्न करा.',
  } as const;

  app.setErrorHandler((error: unknown, request, reply) => {
    if (error instanceof ZodError) {
      // Logged in full: the issue list is how a malformed client is diagnosed, and it is
      // the only copy of it once the response stops carrying it.
      request.log.warn(
        { issues: error.issues, url: request.url },
        'request failed schema validation',
      );
      return reply.code(400).send({
        error: {
          message: FAILURE_TEXT.invalid_request,
          code: 'invalid_request',
        },
      });
    }

    request.log.error(error);

    const statusCode =
      typeof error === 'object' &&
      error !== null &&
      'statusCode' in error &&
      typeof error.statusCode === 'number' &&
      error.statusCode >= 400
        ? error.statusCode
        : 500;

    // A 4xx that reached the error handler rather than a route's own reply is Fastify's
    // own (an unparseable body, a multipart file over the limit, an unsupported media
    // type). Its message is English framework text, so it is replaced too — the STATUS is
    // what the client acts on, and apps/web turns 413 into "फाईल खूप मोठी आहे" from the
    // status alone.
    const code = statusCode >= 500 ? 'internal_error' : 'invalid_request';
    return reply
      .code(statusCode)
      .send({ error: { message: FAILURE_TEXT[code], code } });
  });

  app.get('/health', async () => ({
    status: 'ok' as const,
  }));

  const client = createServiceRoleClient();
  await app.register(
    async (instance) => {
      registerGenerationRoutes(instance, client);
      registerCanvaRoutes(instance, client);
      registerGlossaryRoutes(instance, client);
      registerTranslateRoutes(instance, client);
      // Generic file upload → pages of text. It still persists no document and no text;
      // the client is here only so a PAID OCR read can be attributed on /analytics.
      registerDocumentRoutes(instance, client);
      // "What is this YouTube link?" for the intake cards. Persists nothing either.
      registerYouTubeRoutes(instance);
      registerProofreadRoutes(instance, client);
      registerPointerRoutes(instance);
      registerDesignationRoutes(instance, client);
      registerReferenceRoutes(instance, client);
      registerDloRoutes(instance, client);
      registerNewDloRoutes(instance, client);
      registerTranscriptionRoutes(instance, client);
      registerVideoRoutes(instance, client);
      // The general assistant. The only route in this API that streams its response.
      registerChatRoutes(instance, client);
      // Department usage analytics. Read-only and derived — writes nothing.
      registerAnalyticsRoutes(instance, client);
    },
    { prefix: '/api' },
  );

  return app;
}

async function main() {
  const server = await createServer();
  const port = Number(process.env.PORT ?? 3001);
  const host = process.env.HOST ?? '127.0.0.1';

  await server.listen({
    host,
    port,
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void main();
}
