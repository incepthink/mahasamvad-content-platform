// Offline check of the /activity actor and the settle rule. No network, no database: a
// fastify instance with the SAME trustProxy setting index.ts uses, and a recording stub
// client.
//
// Run from packages/content-engine (which has tsx):
//   npx tsx ../../apps/api/src/activity/actor.check.ts
import Fastify from 'fastify';
import {
  recordActivity,
  settleActivity,
  settleAllActivity,
} from '@dgipr/database';
import { actorOf, registerActorHook } from './actor.js';

let failed = 0;
function check(name: string, ok: boolean, detail?: unknown): void {
  if (ok) {
    console.log('  ok   ' + name);
  } else {
    failed += 1;
    console.log('  FAIL ' + name, detail === undefined ? '' : detail);
  }
}

// ---- actor resolution -----------------------------------------------------

const app = Fastify({ trustProxy: 1 });
app.get('/health', async (request) => ({
  actor: request.activityActor ?? null,
}));
await app.register(
  async (instance) => {
    registerActorHook(instance);
    instance.get('/who', async (request) => actorOf(request));
  },
  { prefix: '/api' },
);
await app.ready();

let res = await app.inject({
  method: 'GET',
  url: '/api/who',
  headers: {
    // The client forged the first entry; Caddy appended the address it actually saw.
    'x-forwarded-for': '1.2.3.4, 203.0.113.9',
    'x-dgipr-device': 'd-abcdefghij1234',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0) Chrome/130',
  },
});
let body = res.json();
check(
  'forged leading X-Forwarded-For is ignored',
  body.ip === '203.0.113.9',
  body,
);
check('device header accepted', body.deviceId === 'd-abcdefghij1234', body);
check('user agent carried', /Chrome/.test(body.userAgent ?? ''), body);

res = await app.inject({
  method: 'GET',
  url: '/api/who',
  headers: { 'x-dgipr-device': 'd-bad!!; drop table' },
});
body = res.json();
check('malformed device id becomes null', body.deviceId === null, body);
check('no proxy header → socket address', body.ip === '127.0.0.1', body);

res = await app.inject({
  method: 'GET',
  url: '/api/who?device=d-querydevice01',
});
body = res.json();
check(
  'device from ?device= on a navigation',
  body.deviceId === 'd-querydevice01',
  body,
);

res = await app.inject({
  method: 'GET',
  url: '/api/who?device=nope',
  headers: { 'x-dgipr-device': 'd-headerwins001' },
});
body = res.json();
check('header wins over query', body.deviceId === 'd-headerwins001', body);

res = await app.inject({ method: 'GET', url: '/health' });
check('/health gets no actor', res.json().actor === null, res.json());

// ---- writes never throw, settles are scoped ------------------------------

type Call = { op: string; table: string; payload?: unknown; filters: string[] };
const calls: Call[] = [];
function stubClient(mode: 'ok' | 'reject' | 'throw') {
  return {
    from(table: string) {
      if (mode === 'throw') throw new Error('boom');
      const call: Call = { op: '', table, filters: [] };
      calls.push(call);
      const result =
        mode === 'reject'
          ? Promise.reject(new Error('network'))
          : Promise.resolve({ error: null });
      const chain = {
        insert(payload: unknown) {
          call.op = 'insert';
          call.payload = payload;
          return chain;
        },
        update(payload: unknown) {
          call.op = 'update';
          call.payload = payload;
          return chain;
        },
        eq(column: string, value: unknown) {
          call.filters.push(`${column}=${String(value)}`);
          return chain;
        },
        then(ok: (v: { error: null }) => void, bad: (e: unknown) => void) {
          return result.then(ok, bad);
        },
      };
      return chain;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const actor = { ip: '10.0.0.1', deviceId: null, userAgent: null };
let threw = false;
try {
  recordActivity(stubClient('throw'), actor, {
    feature: 'creative',
    action: 'publish',
    status: 'success',
  });
  settleActivity(
    stubClient('throw'),
    { kind: 'generation', id: 'g' },
    'publish',
    'failed',
  );
  recordActivity(stubClient('reject'), actor, {
    feature: 'creative',
    action: 'publish',
    status: 'success',
  });
} catch {
  threw = true;
}
check('a failing client never throws out of a write', !threw);
await new Promise((resolve) => setTimeout(resolve, 10));

calls.length = 0;
settleActivity(
  stubClient('ok'),
  { kind: 'generation', id: 'g1' },
  'social_caption_revision',
  'failed',
  'x'.repeat(1000),
);
const settle = calls[0];
check('settle is an update', settle?.op === 'update', settle);
check(
  'settle matches subject, ACTION and only in_progress rows',
  JSON.stringify(settle?.filters) ===
    JSON.stringify([
      'subject_kind=generation',
      'subject_id=g1',
      'action=social_caption_revision',
      'status=in_progress',
    ]),
  settle?.filters,
);
const settlePayload = settle?.payload as { error: string; status: string };
check('settled status written', settlePayload?.status === 'failed');
check('settle error clamped', (settlePayload?.error ?? '').length <= 300);

calls.length = 0;
settleAllActivity(stubClient('ok'), { kind: 'dlo_intake', id: 'i1' }, 'failed');
check(
  'reaper settle ignores action but still only in_progress',
  JSON.stringify(calls[0]?.filters) ===
    JSON.stringify([
      'subject_kind=dlo_intake',
      'subject_id=i1',
      'status=in_progress',
    ]),
  calls[0]?.filters,
);

calls.length = 0;
recordActivity(stubClient('ok'), actor, {
  feature: 'creative',
  action: 'publish',
  status: 'success',
  summary: 'क'.repeat(500),
  error: 'should be dropped',
});
const inserted = calls[0]?.payload as {
  summary: string;
  settled_at?: string;
  error: string | null;
};
check(
  'summary clamped to 140',
  Array.from(inserted?.summary ?? '').length <= 140,
);
check(
  'finished work is inserted settled',
  typeof inserted?.settled_at === 'string',
);
check('error only kept on failed rows', inserted?.error === null);

calls.length = 0;
recordActivity(stubClient('ok'), actor, {
  feature: 'creative',
  action: 'social_post_creation',
  status: 'in_progress',
});
const open = calls[0]?.payload as { settled_at?: string };
check('in-progress row carries no settled_at', open?.settled_at === undefined);

await app.close();
console.log(
  failed === 0 ? '\nall activity checks passed' : `\n${failed} failed`,
);
if (failed > 0) process.exitCode = 1;
