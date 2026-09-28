// Offline check of the edit assistant route's guards: every refusal is decided before any
// model call, and a well-formed turn always comes back as a PLAN — never a 5xx — even when the
// planning call cannot be made (no API key here, so it fails fast and the planner degrades to
// a Marathi reply). No network, no database: the client is a stub that serves one row.
//
// Run from packages/content-engine (which has tsx):
//   npx tsx ../../apps/api/src/routes/edit-assistant.check.ts
import Fastify from 'fastify';
import { registerEditAssistantRoutes } from './edit-assistant.js';

delete process.env.OPENAI_API_KEY;

let failed = 0;
function check(name: string, ok: boolean, detail?: unknown): void {
  if (ok) {
    console.log('  ok   ' + name);
  } else {
    failed += 1;
    console.log('  FAIL ' + name, detail === undefined ? '' : detail);
  }
}

const ID = '11111111-1111-4111-8111-111111111111';
let served: Record<string, unknown> | null = null;
let reads = 0;

// Just enough of the supabase-js chain for getGeneration (select → eq → maybeSingle) and for
// the best-effort cost write, whose failure must not matter.
const client = {
  from() {
    const chain = {
      select: () => chain,
      eq: () => chain,
      update: () => chain,
      maybeSingle: async () => {
        reads += 1;
        return { data: served, error: null };
      },
      single: async () => ({ data: served, error: null }),
      then: (resolve: (v: unknown) => void) =>
        resolve({ data: null, error: null }),
    };
    return chain;
  },
  rpc: async () => ({ data: null, error: null }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

function row(over: Record<string, unknown>): Record<string, unknown> {
  return {
    id: ID,
    note: 'पुण्यात ५०० कोटींच्या प्रकल्पाचे उद्घाटन.',
    output_type: 'poster',
    category: 'twitter',
    status: 'completed',
    article: '📍पुणे — उद्घाटन. @MahaDGIPR',
    poster_path: 'generations/x/poster-v1.png',
    poster_heading: null,
    ...over,
  };
}

const app = Fastify();
registerEditAssistantRoutes(app, client);

async function assist(body: unknown) {
  const res = await app.inject({
    method: 'POST',
    url: `/generations/${ID}/assist`,
    payload: body as Record<string, unknown>,
  });
  return {
    status: res.statusCode,
    body: res.json<{
      kind?: string;
      message?: string;
      actions?: unknown[];
      error?: { message: string };
    }>(),
  };
}

const turn = (text: string) => ({ role: 'user', text });

async function main(): Promise<void> {
  console.log('edit assistant route');

  served = null;
  reads = 0;
  let res = await assist({ surface: 'social', messages: [] });
  check(
    'an empty conversation is refused before the database',
    res.status >= 400 && reads === 0,
    res,
  );

  res = await assist({
    surface: 'social',
    messages: [turn('कॅप्शन लहान करा'), { role: 'assistant', text: 'ठीक' }],
  });
  check(
    'a conversation that does not end with the officer is refused',
    res.status >= 400 && reads === 0,
    res,
  );

  res = await assist({ surface: 'social', messages: [turn('लहान करा')] });
  check(
    'an unknown run is a Marathi 404',
    res.status === 404 && /[ऀ-ॿ]/.test(res.body.error?.message ?? ''),
    res,
  );

  served = row({ category: 'news' });
  res = await assist({ surface: 'social', messages: [turn('लहान करा')] });
  check(
    'a surface that does not fit the run is a Marathi 400',
    res.status === 400 && /[ऀ-ॿ]/.test(res.body.error?.message ?? ''),
    res,
  );

  served = row({ category: 'dynamic_poster' });
  res = await assist({ surface: 'poster', messages: [turn('लहान करा')] });
  check('a Dynamic Poster has no assistant here', res.status === 400, res);

  served = row({});
  res = await assist({
    surface: 'social',
    messages: [turn('कॅप्शन थोडे लहान करा')],
    markers: [{ note: '' }],
  });
  check(
    'a well-formed turn returns a plan, even when planning cannot run',
    res.status === 200 &&
      typeof res.body.kind === 'string' &&
      typeof res.body.message === 'string' &&
      Array.isArray(res.body.actions),
    res,
  );
  check(
    'a failed planning call executes nothing',
    res.body.actions?.length === 0,
    res.body,
  );

  served = row({ category: 'carousel', poster_path: 'x.png' });
  res = await assist({ surface: 'caption', messages: [turn('हॅशटॅग जोडा')] });
  check('a carousel caption is a valid surface', res.status === 200, res);

  served = row({ category: 'news', article: 'लेख' });
  res = await assist({ surface: 'poster', messages: [turn('शीर्षक मोठे करा')] });
  check('an article poster is a valid surface', res.status === 200, res);

  await app.close();
  console.log(
    failed === 0
      ? '\nAll edit-assistant route checks passed.'
      : `\n${failed} check(s) FAILED.`,
  );
  if (failed > 0) process.exitCode = 1;
}

void main();
