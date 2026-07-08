// Glossary admin routes. Thin handlers over the exported @dgipr/database glossary
// layer: list/search the Marathi->English terms, manually add one, edit (english/type/
// verified/notes), and delete. The review UI (apps/web/app/glossary) drives these so
// staff can confirm the auto-mined candidates a translation leaves behind — verified
// rows then lock into future translations (the "no more Donkey" guarantee).

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  listGlossaryTerms,
  upsertGlossaryTerm,
  updateGlossaryTerm,
  deleteGlossaryTerm,
  type TermType,
  type SupabaseClient,
} from '@dgipr/database';
import {
  CreateGlossaryTermRequestSchema,
  TermTypeSchema,
  UpdateGlossaryTermRequestSchema,
} from '@dgipr/schemas';

// verifiedOnly is a query string; parse the literal 'true'/'false' rather than a truthy
// coercion (z.coerce.boolean('false') === true, which would silently invert the filter).
const ListQuerySchema = z.object({
  verifiedOnly: z
    .union([z.literal('true'), z.literal('false')])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  type: TermTypeSchema.optional(),
  search: z.string().trim().min(1).optional(),
});

export function registerGlossaryRoutes(
  app: FastifyInstance,
  client: SupabaseClient,
): void {
  app.get('/glossary', async (request) => {
    const q = ListQuerySchema.parse(request.query);
    // Build the options conditionally so exactOptionalPropertyTypes never sees an
    // explicit `undefined` on a non-`| undefined` optional field.
    const opts: { verifiedOnly?: boolean; type?: TermType; search?: string } = {};
    if (q.verifiedOnly !== undefined) opts.verifiedOnly = q.verifiedOnly;
    if (q.type !== undefined) opts.type = q.type;
    if (q.search !== undefined) opts.search = q.search;
    return listGlossaryTerms(client, opts);
  });

  app.post('/glossary', async (request, reply) => {
    const body = CreateGlossaryTermRequestSchema.parse(request.body);
    // A human typing a term into the glossary is asserting a correct mapping, so a
    // manual add defaults to verified (locks into translations) unless told otherwise.
    const term = await upsertGlossaryTerm(client, {
      marathi: body.marathi,
      english: body.english,
      termType: body.termType ?? 'other',
      verified: body.verified ?? true,
      source: 'manual',
      notes: body.notes ?? null,
    });
    return reply.code(201).send(term);
  });

  app.patch<{ Params: { id: string } }>(
    '/glossary/:id',
    async (request, reply) => {
      const body = UpdateGlossaryTermRequestSchema.parse(request.body);
      // Mutable local (GlossaryTermPatch's fields are readonly); assignable to it.
      const patch: {
        english?: string;
        termType?: TermType;
        verified?: boolean;
        notes?: string | null;
      } = {};
      if (body.english !== undefined) patch.english = body.english;
      if (body.termType !== undefined) patch.termType = body.termType;
      if (body.verified !== undefined) patch.verified = body.verified;
      if (body.notes !== undefined) patch.notes = body.notes;
      try {
        const term = await updateGlossaryTerm(client, request.params.id, patch);
        return term;
      } catch {
        return reply
          .code(404)
          .send({ error: { message: 'Glossary term not found.' } });
      }
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/glossary/:id',
    async (request, reply) => {
      await deleteGlossaryTerm(client, request.params.id);
      return reply.code(204).send();
    },
  );
}
