import Fastify from 'fastify';
import cors from '@fastify/cors';
import { fileURLToPath } from 'node:url';
import { ZodError } from 'zod';
import { createServiceRoleClient } from '@dgipr/database';
import { registerGenerationRoutes } from './routes/generations.js';

export async function createServer() {
  const app = Fastify({
    logger: true,
    // Requests carry note text + copy JSON only; images never pass through bodies.
    bodyLimit: 1_048_576,
  });

  await app.register(cors, {
    origin: (
      process.env.CORS_ORIGIN ?? 'http://localhost:3000,http://127.0.0.1:3000'
    ).split(','),
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
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
