// Offline check of the learned-editorial-preferences routes (migration 0057). No network and
// no database: the client is a recording stub that answers every PostgREST chain with a
// canned result, so what is asserted is what the route SENDS and how it answers.
//
// Run from packages/content-engine (which has tsx):
//   npx tsx ../../apps/api/src/routes/editorial-preferences.check.ts
import Fastify from 'fastify';
import { ZodError } from 'zod';
import { registerEditorialPreferenceRoutes } from './editorial-preferences.js';

let failed = 0;
function check(name: string, ok: boolean, detail?: unknown): void {
  if (ok) {
    console.log('  ok   ' + name);
  } else {
    failed += 1;
    console.log('  FAIL ' + name, detail === undefined ? '' : detail);
  }
}

type Call = { method: string; args: unknown[] };

const ROW = {
  id: '00000000-0000-4000-8000-0000000000aa',
  rule: 'शीर्षक १० शब्दांच्या आत ठेवा.',
  scope: 'news',
  status: 'active',
  source: 'manual',
  reinforcement_count: 1,
  source_feedback: null,
  source_generation_id: null,
  superseded_by: null,
  last_seen_at: '2026-09-21T00:00:00.000Z',
  created_at: '2026-09-21T00:00:00.000Z',
  updated_at: '2026-09-21T00:00:00.000Z',
};

const DEVANAGARI = /[ऀ-ॿ]/;
// What apps/web's errorMessage whitelist accepts verbatim: Devanagari, one line, short, no
// code punctuation. A route message that fails this is replaced by a canned sentence, which
// is why "answers in Marathi" has to be asserted on the SHAPE and not just on the status.
function isOfficerReadable(message: unknown): boolean {
  return (
    typeof message === 'string' &&
    DEVANAGARI.test(message) &&
    !message.includes('\n') &&
    message.trim().length > 0 &&
    message.length <= 240 &&
    !/[{}[\]]|::|:\/\//.test(message)
  );
}

function errorMessageOf(response: { json: () => unknown }): unknown {
  const body = response.json() as { error?: { message?: unknown } };
  return body.error?.message;
}

// One stub per request: every chain method records itself and returns the same thenable,
// which resolves to `result`. `from()` counts as reaching the database.
function stubClient(result: unknown) {
  const calls: Call[] = [];
  const chain: Record<string, unknown> = {};
  for (const method of [
    'insert',
    'update',
    'delete',
    'select',
    'eq',
    'in',
    'order',
    'limit',
    'range',
    'single',
    'maybeSingle',
  ]) {
    chain[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return chain;
    };
  }
  chain.then = (resolve: (value: unknown) => unknown) => resolve(result);
  const client = {
    from(table: string) {
      calls.push({ method: 'from', args: [table] });
      return chain;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  return { client, calls };
}

async function appFor(result: unknown) {
  const stub = stubClient(result);
  const app = Fastify();
  // The real server's handler turns a ZodError into a 400; mirror just that part.
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError)
      return reply.code(400).send({ error: 'invalid' });
    return reply.code(500).send({ error: String(error) });
  });
  await app.register(
    async (instance) => {
      registerEditorialPreferenceRoutes(instance, stub.client);
    },
    { prefix: '/api' },
  );
  return { app, calls: stub.calls };
}

const reachedDb = (calls: Call[]) => calls.some((c) => c.method === 'from');

console.log('\n=== guards answer before the database ===');
{
  const { app, calls } = await appFor({ data: ROW, error: null });
  const empty = await app.inject({
    method: 'POST',
    url: '/api/preferences',
    payload: { rule: '   ' },
  });
  check('a blank rule is a 400', empty.statusCode === 400, empty.statusCode);
  const long = await app.inject({
    method: 'POST',
    url: '/api/preferences',
    payload: { rule: 'क'.repeat(241) },
  });
  check('a rule over 240 characters is a 400', long.statusCode === 400);
  const badScope = await app.inject({
    method: 'POST',
    url: '/api/preferences',
    payload: { rule: 'नियम.', scope: 'twitter' },
  });
  check('an unknown scope is a 400', badScope.statusCode === 400);
  const noop = await app.inject({
    method: 'PATCH',
    url: `/api/preferences/${ROW.id}`,
    payload: {},
  });
  check('a PATCH that changes nothing is a 400', noop.statusCode === 400);
  check('none of those reached the database', !reachedDb(calls));

  // Each of the four says WHICH thing was wrong, in a sentence apps/web will render as
  // written rather than replace with its canned by-status one.
  check(
    'the blank-rule 400 answers in Marathi',
    isOfficerReadable(errorMessageOf(empty)),
    errorMessageOf(empty),
  );
  check(
    'the over-length 400 answers in Marathi and names the limit',
    isOfficerReadable(errorMessageOf(long)) &&
      String(errorMessageOf(long)).includes('240'),
    errorMessageOf(long),
  );
  check(
    'the bad-scope 400 answers in Marathi',
    isOfficerReadable(errorMessageOf(badScope)),
    errorMessageOf(badScope),
  );
  check(
    'the empty-PATCH 400 answers in Marathi',
    isOfficerReadable(errorMessageOf(noop)),
    errorMessageOf(noop),
  );
  // The two messages must be distinguishable, or the marker "shorten it" is indistinguishable
  // from "type something" on a page where both are one keystroke apart.
  check(
    'blank and over-length do not share a message',
    errorMessageOf(empty) !== errorMessageOf(long),
  );
}

console.log('\n=== the list carries the in-use marker ===');
{
  // The stub answers every chain the same way, so all three reads see this one row; what is
  // asserted is that the route ASKS the injection query and reports its ids, not the ranking
  // itself (that is listActiveEditorialPreferences', and it is tested where it lives).
  const { app, calls } = await appFor({ data: [ROW], error: null, count: 1 });
  const listed = await app.inject({
    method: 'GET',
    url: '/api/preferences?limit=20&offset=20',
  });
  check('answers 200', listed.statusCode === 200, listed.body);
  const body = listed.json() as {
    items: unknown[];
    total: number;
    injected: { news: string[]; scheme: string[] };
  };
  check('items are returned', body.items.length === 1);
  check(
    'injected names both article categories',
    Array.isArray(body.injected?.news) && Array.isArray(body.injected?.scheme),
    body.injected,
  );
  check(
    'the injected ids are ids, not rows',
    body.injected.news[0] === ROW.id && body.injected.scheme[0] === ROW.id,
    body.injected,
  );
  // The marker is only honest if it comes from the query the ARTICLE runs: active only,
  // scope matched, capped. Assert the route made exactly that request twice.
  const statusEq = calls.filter(
    (c) => c.method === 'eq' && c.args[0] === 'status' && c.args[1] === 'active',
  );
  check('it filters to active rules', statusEq.length === 2, statusEq.length);
  const scopeIn = calls.filter((c) => c.method === 'in');
  check(
    'it asks the news and the scheme pool separately',
    scopeIn.length === 2 &&
      JSON.stringify(scopeIn[0]?.args[1]) === JSON.stringify(['news', 'both']) &&
      JSON.stringify(scopeIn[1]?.args[1]) ===
        JSON.stringify(['scheme', 'both']),
    scopeIn.map((c) => c.args[1]),
  );
  check(
    'both pools are capped at MAX_INJECTED_PREFERENCES',
    calls.filter((c) => c.method === 'limit' && c.args[0] === 12).length === 2,
  );
  // Paging: an offset must become a range, or a second page silently re-serves the first.
  const range = calls.find((c) => c.method === 'range');
  check(
    'an offset pages with .range',
    range?.args[0] === 20 && range?.args[1] === 39,
    range?.args,
  );
}

console.log(
  '\n=== a hand-seeded rule is recorded as manual, scope both by default ===',
);
{
  const { app, calls } = await appFor({ data: ROW, error: null });
  const created = await app.inject({
    method: 'POST',
    url: '/api/preferences',
    payload: { rule: '  शीर्षक १० शब्दांच्या आत ठेवा.  ' },
  });
  check('answers 201', created.statusCode === 201, created.body);
  const insert = calls.find((c) => c.method === 'insert')?.args[0] as
    Record<string, unknown> | undefined;
  check(
    'writes to editorial_preferences',
    calls[0]?.args[0] === 'editorial_preferences',
  );
  check(
    'the rule is trimmed',
    insert?.rule === 'शीर्षक १० शब्दांच्या आत ठेवा.',
  );
  check('source is manual', insert?.source === 'manual');
  check('scope defaults to both', insert?.scope === 'both');
  check('status defaults to active', insert?.status === 'active');
  const body = created.json() as Record<string, unknown>;
  check(
    'the response is camelCase',
    body.reinforcementCount === 1 && body.sourceFeedback === null,
  );
}

console.log('\n=== PATCH ===');
{
  const { app } = await appFor({ data: null, error: null });
  const missing = await app.inject({
    method: 'PATCH',
    url: `/api/preferences/${ROW.id}`,
    payload: { status: 'disabled' },
  });
  check('an unknown id is a 404, not a 500', missing.statusCode === 404);
  check(
    'the 404 answers in Marathi',
    isOfficerReadable(errorMessageOf(missing)),
    errorMessageOf(missing),
  );
}
{
  // A malformed id reaches PostgREST as a uuid comparison and comes back as a driver error,
  // i.e. a 500 — "the server broke" for an ordinary client mistake. Nothing with that id can
  // exist, so it gets the same 404, and it must not cost a query.
  const { app, calls } = await appFor({ data: ROW, error: null });
  const junk = await app.inject({
    method: 'PATCH',
    url: '/api/preferences/not-a-uuid',
    payload: { status: 'disabled' },
  });
  check('a malformed id is a 404, not a 500', junk.statusCode === 404);
  check('and never reaches the database', !reachedDb(calls));
}
{
  const { app, calls } = await appFor({
    data: { ...ROW, status: 'disabled' },
    error: null,
  });
  const disabled = await app.inject({
    method: 'PATCH',
    url: `/api/preferences/${ROW.id}`,
    payload: { status: 'disabled' },
  });
  const update = calls.find((c) => c.method === 'update')?.args[0] as
    Record<string, unknown> | undefined;
  check('answers 200', disabled.statusCode === 200);
  check(
    'writes only the status and the timestamp',
    update?.status === 'disabled' &&
      typeof update?.updated_at === 'string' &&
      Object.keys(update).length === 2,
  );
}

console.log('\n=== DELETE ===');
{
  const { app, calls } = await appFor({ data: ROW, error: null });
  const deleted = await app.inject({
    method: 'DELETE',
    url: `/api/preferences/${ROW.id}`,
  });
  check('answers 204 when the rule is there', deleted.statusCode === 204);
  check(
    'it reads before it deletes',
    calls.some((c) => c.method === 'delete'),
  );
}
{
  // `delete().eq()` reports no row count, so without the read above this answers 204 whether
  // or not anything was removed — and the page cannot tell that from a real deletion.
  const { app, calls } = await appFor({ data: null, error: null });
  const missing = await app.inject({
    method: 'DELETE',
    url: `/api/preferences/${ROW.id}`,
  });
  check('an unknown id is a 404, not a silent 204', missing.statusCode === 404);
  check(
    'and nothing was deleted',
    !calls.some((c) => c.method === 'delete'),
  );
  check(
    'the 404 answers in Marathi',
    isOfficerReadable(errorMessageOf(missing)),
    errorMessageOf(missing),
  );
}
{
  const { app, calls } = await appFor({ data: ROW, error: null });
  const junk = await app.inject({
    method: 'DELETE',
    url: '/api/preferences/not-a-uuid',
  });
  check('a malformed id is a 404', junk.statusCode === 404);
  check('and never reaches the database', !reachedDb(calls));
}

if (failed > 0) {
  console.log(`\n${failed} check(s) failed.`);
  process.exitCode = 1;
} else {
  console.log('\nAll editorial-preferences route checks passed.');
}
