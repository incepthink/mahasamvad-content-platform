// Learned editorial preferences (migration 0057). Thin handlers over the exported
// @dgipr/database layer: list them, seed one by hand, edit or disable one, delete one.
//
// WHAT THIS IS FOR. Phase 1 used it to seed a rule by hand and ask the one question that
// phase existed to answer — does the article model actually FOLLOW an injected editorial
// rule? Since Phase 3 it is also the whole of /preferences, the review page: the same four
// handlers list, edit, disable and delete a rule an officer never typed.
//
// NO AUTH, because there is none anywhere in this platform. A rule any officer adds binds
// every /dlo article the department writes. That is stated on the review page rather than
// pretended away, and it is why nothing here is destructive by default: `status: 'disabled'`
// turns a rule off while keeping it, and supersession keeps the row it replaced.
//
// MARATHI 4xx. These are fetch-backed routes, so apps/web would replace an English message
// with a canned sentence chosen from the status anyway — but "this rule no longer exists"
// and "a rule may be at most 240 characters" are worth more to the officer than "not found"
// and "the request was wrong", and `isOfficerReadable` passes a Marathi one straight through.

import type { FastifyInstance, FastifyReply } from 'fastify';
import { z, ZodError } from 'zod';
import {
  countEditorialPreferences,
  deleteEditorialPreference,
  getEditorialPreference,
  insertEditorialPreference,
  listActiveEditorialPreferences,
  listEditorialPreferences,
  updateEditorialPreference,
  type EditorialPreferenceScope,
  type EditorialPreferenceStatus,
  type SupabaseClient,
} from '@dgipr/database';
import {
  CreateEditorialPreferenceRequestSchema,
  EditorialPreferenceScopeSchema,
  EditorialPreferenceStatusSchema,
  MAX_INJECTED_PREFERENCES,
  PREFERENCE_RULE_MAX_CHARS,
  UpdateEditorialPreferenceRequestSchema,
} from '@dgipr/schemas';

const ListQuerySchema = z.object({
  status: EditorialPreferenceStatusSchema.optional(),
  scope: EditorialPreferenceScopeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

// Marathi, because these are the two refusals an officer can actually act on: shorten the
// rule, or pick one of the three scopes. Everything else falls through to the server's own
// Marathi invalid-request sentence.
const MSG = {
  notFound: 'हा नियम सापडला नाही. कदाचित तो आधीच काढून टाकला असेल.',
  ruleEmpty: 'नियम लिहा — रिकामा नियम साठवता येत नाही.',
  ruleTooLong: `नियम ${PREFERENCE_RULE_MAX_CHARS} अक्षरांपेक्षा मोठा असू शकत नाही. एका नियमात एकच गोष्ट सांगा.`,
  badScope:
    'नियम कोणत्या लेखांना लागू होतो ते चुकीचे आहे: बातमी, योजना-लेख किंवा सर्व लेख यापैकी एक निवडा.',
  badStatus: 'नियमाची स्थिती चुकीची आहे: सुरू, बंद किंवा बदललेला यापैकी एक असावी.',
  nothingToChange: 'बदलण्यासारखे काहीही पाठवलेले नाही.',
} as const;

function notFound(reply: FastifyReply) {
  return reply.code(404).send({ error: { message: MSG.notFound } });
}

// The id is a uuid column (0057). Without this a hand-typed id reaches PostgREST, comes back
// as a driver error and surfaces as a 500 — i.e. "the server broke" for what is an ordinary
// client mistake. Nothing with a malformed id can exist, so the honest answer is the same
// 404 an unknown-but-well-formed id gets.
const UuidSchema = z.string().uuid();

// Maps the FIRST zod issue onto one of the sentences above. Deliberately narrow: only the
// two guards the review page can put in front of a person (the rule's length, the scope)
// and the "changes nothing" refine. Anything else is re-thrown to the server's handler.
function zodMessage(error: ZodError): string | null {
  const issue = error.issues[0];
  if (!issue) return null;
  const field = issue.path[0];
  if (field === 'rule') {
    return issue.code === 'too_big' ? MSG.ruleTooLong : MSG.ruleEmpty;
  }
  if (field === 'scope') return MSG.badScope;
  if (field === 'status') return MSG.badStatus;
  // A top-level refine carries an empty path — here, the "a PATCH must change something"
  // rule on UpdateEditorialPreferenceRequestSchema.
  if (issue.path.length === 0) return MSG.nothingToChange;
  return null;
}

function parseOrReply<T>(
  schema: { parse: (value: unknown) => T },
  value: unknown,
  reply: FastifyReply,
): { ok: true; value: T } | { ok: false } {
  try {
    return { ok: true, value: schema.parse(value) };
  } catch (error) {
    if (error instanceof ZodError) {
      const message = zodMessage(error);
      if (message) {
        reply.code(400).send({ error: { message } });
        return { ok: false };
      }
    }
    throw error;
  }
}

export function registerEditorialPreferenceRoutes(
  app: FastifyInstance,
  client: SupabaseClient,
): void {
  app.get('/preferences', async (request) => {
    const q = ListQuerySchema.parse(request.query);
    // Built conditionally so exactOptionalPropertyTypes never sees an explicit `undefined`
    // on a non-`| undefined` optional field (the glossary route's rule).
    const filters: {
      status?: EditorialPreferenceStatus;
      scope?: EditorialPreferenceScope;
    } = {};
    if (q.status !== undefined) filters.status = q.status;
    if (q.scope !== undefined) filters.scope = q.scope;
    const listOpts: typeof filters & { limit?: number; offset?: number } = {
      ...filters,
    };
    if (q.limit !== undefined) listOpts.limit = q.limit;
    if (q.offset !== undefined) listOpts.offset = q.offset;
    // `injected` is the review page's in-use marker, and it is computed with the SAME
    // function the article is written with rather than by re-ranking `items` in the browser
    // — see InjectedPreferenceIdsSchema. Two capped reads of at most twelve rows each, and
    // independent of the display filters above, since the question is about the whole
    // active set rather than about the page being looked at.
    const [items, total, injectedNews, injectedScheme] = await Promise.all([
      listEditorialPreferences(client, listOpts),
      countEditorialPreferences(client, filters),
      listActiveEditorialPreferences(client, 'news', MAX_INJECTED_PREFERENCES),
      listActiveEditorialPreferences(
        client,
        'scheme',
        MAX_INJECTED_PREFERENCES,
      ),
    ]);
    return {
      items,
      total,
      injected: {
        news: injectedNews.map((row) => row.id),
        scheme: injectedScheme.map((row) => row.id),
      },
    };
  });

  app.post('/preferences', async (request, reply) => {
    const parsed = parseOrReply(
      CreateEditorialPreferenceRequestSchema,
      request.body,
      reply,
    );
    if (!parsed.ok) return reply;
    const body = parsed.value;
    // `source: 'manual'` is not a request field: a rule that arrives through this route was
    // typed by a person, which is exactly what the column records. Phase 2's extraction
    // writes `learned` through the database layer directly.
    const preference = await insertEditorialPreference(client, {
      rule: body.rule,
      scope: body.scope ?? 'both',
      status: body.status ?? 'active',
      source: 'manual',
      sourceFeedback: null,
      sourceGenerationId: null,
    });
    return reply.code(201).send(preference);
  });

  app.patch<{ Params: { id: string } }>(
    '/preferences/:id',
    async (request, reply) => {
      if (!UuidSchema.safeParse(request.params.id).success) {
        return notFound(reply);
      }
      const parsed = parseOrReply(
        UpdateEditorialPreferenceRequestSchema,
        request.body,
        reply,
      );
      if (!parsed.ok) return reply;
      const body = parsed.value;
      const patch: {
        rule?: string;
        scope?: EditorialPreferenceScope;
        status?: EditorialPreferenceStatus;
      } = {};
      if (body.rule !== undefined) patch.rule = body.rule;
      if (body.scope !== undefined) patch.scope = body.scope;
      if (body.status !== undefined) patch.status = body.status;
      const preference = await updateEditorialPreference(
        client,
        request.params.id,
        patch,
      );
      // maybeSingle returns null for a row that is not there, so this is a 404 rather than
      // an exception — an unknown id is an ordinary client mistake, not a failure.
      if (!preference) return notFound(reply);
      return preference;
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/preferences/:id',
    async (request, reply) => {
      if (!UuidSchema.safeParse(request.params.id).success) {
        return notFound(reply);
      }
      // Read before deleting, which a bare DELETE does not need to do — `delete().eq()`
      // reports no row count, so without this the route answers 204 whether or not anything
      // was removed. The review page is unauthenticated and shared, so two officers holding
      // the same list is ordinary; "done" for a rule that was never there is the one answer
      // the page cannot tell from a real deletion.
      const existing = await getEditorialPreference(client, request.params.id);
      if (!existing) return notFound(reply);
      await deleteEditorialPreference(client, request.params.id);
      return reply.code(204).send();
    },
  );
}
