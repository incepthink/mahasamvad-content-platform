import type { FastifyInstance } from 'fastify';
import { findReferenceTypeRow, type SupabaseClient } from '@dgipr/database';
import {
  ACCEPTED_UPLOAD_MIME_TYPES,
  createReferenceType,
  deleteReferenceImage,
  deleteReferenceType,
  listReferenceLibrary,
  listReferenceTypes,
  overrideReferenceImagePhotoZone,
  reanalyzeReferenceImage,
  setReferenceImageEnabled,
  updateReferenceType,
  uploadReferenceImage,
} from '@dgipr/content-engine';
import {
  CreateReferenceTypeRequestSchema,
  ReferenceCategorySchema,
  UpdateLayoutSpecRequestSchema,
  UpdateReferenceTypeRequestSchema,
} from '@dgipr/schemas';
import { z } from 'zod';

// The subtype must be an existing reference_types slug; existence is checked
// against the DB below (the regex only guards the charset).
const UploadQuerySchema = z.object({
  category: ReferenceCategorySchema,
  subtype: z.string().regex(/^[a-z0-9_]+$/),
});

export function registerReferenceRoutes(
  app: FastifyInstance,
  client: SupabaseClient,
): void {
  // ---------- reference types (the catalog) ----------

  app.get('/reference-types', async () => listReferenceTypes(client));

  app.post('/reference-types', async (request, reply) => {
    const body = CreateReferenceTypeRequestSchema.parse(request.body);
    const type = await createReferenceType(client, body);
    return reply.code(201).send(type);
  });

  app.patch<{ Params: { id: string } }>(
    '/reference-types/:id',
    async (request, reply) => {
      const body = UpdateReferenceTypeRequestSchema.parse(request.body);
      const type = await updateReferenceType(client, request.params.id, body);
      if (!type) {
        return reply
          .code(404)
          .send({ error: { message: 'Reference type not found.' } });
      }
      return type;
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/reference-types/:id',
    async (request, reply) => {
      const result = await deleteReferenceType(client, request.params.id);
      if (result === 'not_found') {
        return reply
          .code(404)
          .send({ error: { message: 'Reference type not found.' } });
      }
      if (result === 'builtin') {
        return reply
          .code(409)
          .send({ error: { message: 'Builtin types cannot be deleted.' } });
      }
      return reply.code(204).send();
    },
  );

  // ---------- reference images (the library) ----------

  app.get('/references', async () => listReferenceLibrary(client));

  app.post('/references', async (request, reply) => {
    const { category, subtype } = UploadQuerySchema.parse(request.query);
    const type = await findReferenceTypeRow(client, category, subtype);
    if (!type) {
      return reply.code(400).send({
        error: { message: `Unknown reference type ${category}/${subtype}.` },
      });
    }

    const file = await request.file();
    if (!file) {
      return reply
        .code(400)
        .send({ error: { message: 'An image file is required.' } });
    }

    if (
      !(ACCEPTED_UPLOAD_MIME_TYPES as readonly string[]).includes(file.mimetype)
    ) {
      return reply.code(400).send({
        error: { message: 'Only PNG, JPEG, and WebP images are accepted.' },
      });
    }

    const image = await uploadReferenceImage(
      client,
      category,
      subtype,
      await file.toBuffer(),
    );
    return reply.code(201).send(image);
  });

  // Enable/disable an image in the per-generation random rotation. Reversible,
  // so no confirmation semantics server-side.
  for (const [action, enabled] of [
    ['enable', true],
    ['disable', false],
  ] as const) {
    app.post<{ Params: { id: string } }>(
      `/references/:id/${action}`,
      async (request, reply) => {
        const image = await setReferenceImageEnabled(
          client,
          request.params.id,
          enabled,
        );
        if (!image) {
          return reply
            .code(404)
            .send({ error: { message: 'Reference image not found.' } });
        }
        return image;
      },
    );
  }

  // Re-read the master's layout off its pixels. The cached spec is what decides
  // whether the poster may contain photography at all, so a stale or wrong read
  // silently produces a wrong poster — this is the operator's way to redo it.
  app.post<{ Params: { id: string } }>(
    '/references/:id/analyze',
    async (request, reply) => {
      const image = await reanalyzeReferenceImage(client, request.params.id);
      if (!image) {
        return reply
          .code(404)
          .send({ error: { message: 'Reference image not found.' } });
      }
      return image;
    },
  );

  // Manual override when the vision pass gets the photo-zone call wrong.
  app.patch<{ Params: { id: string } }>(
    '/references/:id/layout-spec',
    async (request, reply) => {
      const body = UpdateLayoutSpecRequestSchema.parse(request.body);
      const image = await overrideReferenceImagePhotoZone(
        client,
        request.params.id,
        body.hasPhotoZone,
      );
      if (!image) {
        return reply
          .code(404)
          .send({ error: { message: 'Reference image not found.' } });
      }
      return image;
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/references/:id',
    async (request, reply) => {
      const result = await deleteReferenceImage(client, request.params.id);
      if (result === 'not_found') {
        return reply
          .code(404)
          .send({ error: { message: 'Reference image not found.' } });
      }
      return reply.code(204).send();
    },
  );
}
