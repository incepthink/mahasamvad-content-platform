import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { fileURLToPath } from 'node:url';
import { ZodError } from 'zod';
import { createServiceRoleClient } from '@dgipr/database';
import { registerDloRoutes } from './routes/dlo.js';
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

  await app.register(cors, {
    origin: (
      process.env.CORS_ORIGIN ?? 'http://localhost:3000,http://127.0.0.1:3000'
    ).split(','),
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
  });

  // Multipart default. Every upload route now sets its OWN per-request limits — /dlo and
  // /transcribe to UPLOAD_FILE_MAX_BYTES, /documents and /translate to their unlimited
  // DOCUMENT_MAX_BYTES, /references to unlimited as well — so nothing reaches this 10 MiB
  // fallback today. It is kept as a conservative default for a future route that forgets to
  // state one: a small cap surfaces as a 413 the first time it is tested, where an unlimited
  // default would only surface as memory pressure in production.
  await app.register(multipart, {
    limits: { fileSize: 10_485_760, files: 1 },
  });

  app.setErrorHandler((error: unknown, request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: { message: error.message } });
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
    const message =
      error instanceof Error ? error.message : 'Internal server error.';
    return reply.code(statusCode).send({ error: { message } });
  });

  app.get('/health', async () => ({
    status: 'ok' as const,
  }));

  const client = createServiceRoleClient();
  await app.register(
    async (instance) => {
      registerGenerationRoutes(instance, client);
      registerGlossaryRoutes(instance, client);
      registerTranslateRoutes(instance, client);
      // Generic file upload → pages of text. No Supabase client: it persists nothing.
      registerDocumentRoutes(instance);
      // "What is this YouTube link?" for the intake cards. Persists nothing either.
      registerYouTubeRoutes(instance);
      registerProofreadRoutes(instance, client);
      registerPointerRoutes(instance);
      registerDesignationRoutes(instance, client);
      registerReferenceRoutes(instance, client);
      registerDloRoutes(instance, client);
      registerTranscriptionRoutes(instance, client);
      registerVideoRoutes(instance, client);
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
