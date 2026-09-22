// Offline check of the editorial-learning pass (migration 0057, Phase 2). No network, no
// database and no model call: the two model steps are injected, and the client is a routed
// stub that answers each PostgREST chain from a canned table. What is asserted is therefore
// the part that actually decides what gets written — the guard, the free de-duplication, and
// all four consolidation outcomes — plus the structural fact that BOTH feedback jobs reach the
// helper at all.
//
// Run from packages/content-engine (which has tsx):
//   npx tsx ../../apps/api/src/jobs/editorial-learning.check.ts

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  editorialLearningEnabled,
  learnFromArticleFeedback,
  type LearningDeps,
} from './editorial-learning.js';

let failed = 0;
function check(name: string, ok: boolean, detail?: unknown): void {
  if (ok) console.log('  ok   ' + name);
  else {
    failed += 1;
    console.log('  FAIL ' + name, detail === undefined ? '' : detail);
  }
}

// ---------------------------------------------------------------------------------------
// A routed PostgREST stub
// ---------------------------------------------------------------------------------------

type Write = { table: string; op: string; payload: unknown; id?: string };

const NOW = '2026-09-21T00:00:00.000Z';

function prefRow(over: Record<string, unknown>) {
  return {
    id: 'p1',
    rule: 'नियम',
    scope: 'news',
    status: 'active',
    source: 'learned',
    reinforcement_count: 1,
    source_feedback: null,
    source_generation_id: null,
    superseded_by: null,
    last_seen_at: NOW,
    created_at: NOW,
    updated_at: NOW,
    ...over,
  };
}

/**
 * `active` is what listActiveEditorialPreferences returns; `glossary` what
 * findGlossaryTermsInText scans. Every write is recorded rather than applied — the point is
 * what the pass SENDS, and applying it would only let the stub's own semantics be asserted.
 */
function stubClient(opts: {
  active?: Record<string, unknown>[];
  glossary?: Record<string, unknown>[];
  count?: number;
}) {
  const writes: Write[] = [];
  const active = opts.active ?? [];
  const glossary = opts.glossary ?? [];
  const count = opts.count ?? active.length;

  function chainFor(table: string) {
    const state: { op: string; payload: unknown; id?: string; head: boolean } =
      {
        op: 'select',
        payload: null,
        head: false,
      };
    const chain: Record<string, unknown> = {};
    const self = () => chain;
    chain.insert = (payload: unknown) => {
      state.op = 'insert';
      state.payload = payload;
      return self();
    };
    chain.update = (payload: unknown) => {
      state.op = 'update';
      state.payload = payload;
      return self();
    };
    chain.delete = () => {
      state.op = 'delete';
      return self();
    };
    chain.select = (_cols?: unknown, o?: { head?: boolean }) => {
      if (o?.head) state.head = true;
      return self();
    };
    chain.eq = (column: string, value: unknown) => {
      if (column === 'id') state.id = String(value);
      return self();
    };
    chain.in = () => self();
    chain.order = () => self();
    chain.limit = () => self();
    const settle = () => {
      if (state.op === 'insert' || state.op === 'update') {
        writes.push({
          table,
          op: state.op,
          payload: state.payload,
          ...(state.id ? { id: state.id } : {}),
        });
        const base =
          state.op === 'insert'
            ? prefRow({ id: 'new-id' })
            : (active.find((row) => row.id === state.id) ??
              prefRow({ id: state.id ?? 'p1' }));
        const patch = (state.payload ?? {}) as Record<string, unknown>;
        return { data: { ...base, ...patch }, error: null, count: null };
      }
      if (state.head) return { data: null, error: null, count };
      if (table === 'glossary_terms') {
        return { data: glossary, error: null, count: null };
      }
      return { data: active, error: null, count: null };
    };
    chain.single = () => Promise.resolve(settle());
    chain.maybeSingle = () => Promise.resolve(settle());
    chain.then = (resolveFn: (value: unknown) => unknown) =>
      Promise.resolve(settle()).then(resolveFn);
    return chain;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = { from: (table: string) => chainFor(table) } as any;
  return { client, writes };
}

// The note the feedback is about. It carries ५०० कोटी and सोमवार so the guard has something
// real to reject against.
const NOTE =
  'मुंबई येथील बैठकीत ५०० कोटी रुपये मंजूर झाले. बैठक सोमवारी पार पडली. ' +
  'यावेळी देवेंद्र फडणवीस उपस्थित होते.';

const GLOSSARY = [
  {
    marathi: 'देवेंद्र फडणवीस',
    english: 'Devendra Fadnavis',
    term_type: 'person',
  },
  { marathi: 'मुंबई', english: 'Mumbai', term_type: 'place' },
];

function deps(
  candidates: Parameters<LearningDeps['extract']> extends never
    ? never
    : Awaited<ReturnType<LearningDeps['extract']>>,
  decision: Awaited<ReturnType<LearningDeps['consolidate']>> = {
    action: 'ADD',
    targetId: null,
  },
): LearningDeps & { consolidateCalls: number } {
  const state = { consolidateCalls: 0 };
  return {
    extract: async () => candidates,
    consolidate: async () => {
      state.consolidateCalls += 1;
      return decision;
    },
    get consolidateCalls() {
      return state.consolidateCalls;
    },
  } as LearningDeps & { consolidateCalls: number };
}

const INPUT = {
  generationId: 'gen-1',
  note: NOTE,
  feedback: 'शीर्षक खूप लांब आहे, लहान ठेवा',
  category: 'news' as const,
};

async function main(): Promise<void> {
  console.log('\n=== the flag ===');
  const restore = process.env.EDITORIAL_LEARNING_ENABLED;
  delete process.env.EDITORIAL_LEARNING_ENABLED;
  check('unset means OFF', editorialLearningEnabled() === false);
  process.env.EDITORIAL_LEARNING_ENABLED = 'false';
  check('"false" means OFF', editorialLearningEnabled() === false);
  process.env.EDITORIAL_LEARNING_ENABLED = 'maybe';
  check(
    'an unrecognised value means OFF (the safe state)',
    editorialLearningEnabled() === false,
  );
  for (const on of ['1', 'true', 'TRUE', ' yes ', 'on']) {
    process.env.EDITORIAL_LEARNING_ENABLED = on;
    check(`"${on.trim()}" turns it on`, editorialLearningEnabled() === true);
  }
  if (restore === undefined) delete process.env.EDITORIAL_LEARNING_ENABLED;
  else process.env.EDITORIAL_LEARNING_ENABLED = restore;

  console.log('\n=== a factual correction writes NOTHING ===');
  {
    const stub = stubClient({ glossary: GLOSSARY });
    const notes = await learnFromArticleFeedback(
      stub.client,
      INPUT,
      deps([
        {
          kind: 'editorial',
          rule: 'बजेट ६०० कोटी आहे असे लिहा',
          scope: 'both',
        },
      ]),
    );
    check('no note is returned', notes.length === 0);
    check(
      'and nothing was inserted or updated',
      stub.writes.length === 0,
      stub.writes,
    );
  }

  console.log('\n=== a portable rule is INSERTED with its provenance ===');
  {
    const stub = stubClient({ glossary: GLOSSARY });
    const notes = await learnFromArticleFeedback(
      stub.client,
      INPUT,
      deps([{ kind: 'editorial', rule: 'शीर्षक लहान ठेवा', scope: 'news' }]),
    );
    check('one note comes back', notes.length === 1);
    check('and it reads as added', notes[0]?.action === 'added');
    const insert = stub.writes.find((w) => w.op === 'insert');
    const payload = (insert?.payload ?? {}) as Record<string, unknown>;
    check(
      'an insert reached editorial_preferences',
      insert?.table === 'editorial_preferences',
    );
    check('marked learned, not manual', payload.source === 'learned');
    check('active', payload.status === 'active');
    check('scoped as the candidate said', payload.scope === 'news');
    check(
      "the officer's own words are kept as provenance",
      payload.source_feedback === INPUT.feedback,
    );
    check('and the run it came from', payload.source_generation_id === 'gen-1');
  }

  console.log(
    '\n=== a repeat REINFORCES, free, with no consolidation call ===',
  );
  {
    const stub = stubClient({
      glossary: GLOSSARY,
      active: [
        prefRow({
          id: 'p1',
          rule: 'शीर्षक लहान ठेवा.',
          reinforcement_count: 3,
        }),
      ],
    });
    const d = deps([
      { kind: 'editorial', rule: 'शीर्षक लहान ठेवा', scope: 'news' },
    ]);
    const notes = await learnFromArticleFeedback(stub.client, INPUT, d);
    check('the note reads as reinforced', notes[0]?.action === 'reinforced');
    check('nothing was inserted', !stub.writes.some((w) => w.op === 'insert'));
    const update = stub.writes.find((w) => w.op === 'update');
    const payload = (update?.payload ?? {}) as Record<string, unknown>;
    check('the existing row was updated', update?.id === 'p1');
    check('its count rose from 3 to 4', payload.reinforcement_count === 4);
    check('and recency was stamped', typeof payload.last_seen_at === 'string');
    check(
      'THE FREE TEST SHORT-CIRCUITS: no consolidation call was made',
      d.consolidateCalls === 0,
    );
  }

  console.log('\n=== an inflected near-repeat reinforces too ===');
  {
    const stub = stubClient({
      glossary: GLOSSARY,
      active: [prefRow({ id: 'p1', rule: 'शीर्षक लहान ठेवा.' })],
    });
    const d = deps([
      { kind: 'editorial', rule: 'शीर्षक लहान ठेवावे', scope: 'news' },
    ]);
    const notes = await learnFromArticleFeedback(stub.client, INPUT, d);
    check('reinforced rather than added', notes[0]?.action === 'reinforced');
    check('still no consolidation call', d.consolidateCalls === 0);
  }

  console.log('\n=== DUPLICATE_OF reinforces the named rule ===');
  {
    const stub = stubClient({
      glossary: GLOSSARY,
      active: [prefRow({ id: 'p1', rule: 'शीर्षक फार मोठे नको' })],
    });
    const notes = await learnFromArticleFeedback(
      stub.client,
      INPUT,
      deps(
        [
          {
            kind: 'editorial',
            rule: 'लेखाचे शीर्षक आटोपशीर असावे',
            scope: 'news',
          },
        ],
        { action: 'DUPLICATE_OF', targetId: 'p1' },
      ),
    );
    check('reinforced', notes[0]?.action === 'reinforced');
    check('nothing inserted', !stub.writes.some((w) => w.op === 'insert'));
  }

  console.log(
    '\n=== SUPERSEDES inserts, then MARKS the old row — never deletes ===',
  );
  {
    const stub = stubClient({
      glossary: GLOSSARY,
      active: [prefRow({ id: 'p1', rule: 'शीर्षक १५ शब्दांच्या आत ठेवा' })],
    });
    const notes = await learnFromArticleFeedback(
      stub.client,
      INPUT,
      deps(
        [
          {
            kind: 'editorial',
            rule: 'शीर्षक दहा शब्दांच्या आत ठेवा',
            scope: 'news',
          },
        ],
        { action: 'SUPERSEDES', targetId: 'p1' },
      ),
    );
    check('the note reads as superseded', notes[0]?.action === 'superseded');
    check(
      'the new rule was inserted',
      stub.writes.some((w) => w.op === 'insert'),
    );
    const mark = stub.writes.find((w) => w.op === 'update' && w.id === 'p1');
    const payload = (mark?.payload ?? {}) as Record<string, unknown>;
    check('the old row was marked superseded', payload.status === 'superseded');
    check('and points at its replacement', payload.superseded_by === 'new-id');
    check('NOTHING WAS DELETED', !stub.writes.some((w) => w.op === 'delete'));
  }

  console.log(
    '\n=== MERGE_WITH rewrites the existing rule and inserts nothing ===',
  );
  {
    const stub = stubClient({
      glossary: GLOSSARY,
      active: [prefRow({ id: 'p1', rule: 'शीर्षक लहान ठेवा' })],
    });
    const merged = 'शीर्षक लहान ठेवा आणि पहिल्या ओळीत निर्णय द्या';
    const notes = await learnFromArticleFeedback(
      stub.client,
      INPUT,
      deps(
        [
          {
            kind: 'editorial',
            rule: 'पहिल्या ओळीत निर्णय द्या',
            scope: 'news',
          },
        ],
        { action: 'MERGE_WITH', targetId: 'p1', mergedRule: merged },
      ),
    );
    check('the note reads as merged', notes[0]?.action === 'merged');
    check('and carries the MERGED wording', notes[0]?.rule === merged);
    check('nothing was inserted', !stub.writes.some((w) => w.op === 'insert'));
    const update = stub.writes.find((w) => w.op === 'update' && w.id === 'p1');
    const payload = (update?.payload ?? {}) as Record<string, unknown>;
    check(
      'the existing row now holds the merged rule',
      payload.rule === merged,
    );
  }

  console.log('\n=== mixed feedback: one dropped, one kept ===');
  {
    const stub = stubClient({ glossary: GLOSSARY });
    const notes = await learnFromArticleFeedback(
      stub.client,
      INPUT,
      deps([
        { kind: 'factual', rule: 'बजेट ६०० कोटी आहे असे लिहा', scope: 'both' },
        { kind: 'editorial', rule: 'शीर्षक लहान ठेवा', scope: 'news' },
      ]),
    );
    check('exactly one rule is written', notes.length === 1);
    check('and it is the editorial one', notes[0]?.rule === 'शीर्षक लहान ठेवा');
    check(
      'exactly one insert',
      stub.writes.filter((w) => w.op === 'insert').length === 1,
    );
  }

  console.log(
    '\n=== the guard overrules the model, not the other way round ===',
  );
  {
    const stub = stubClient({ glossary: GLOSSARY });
    // The model says `editorial`; the rule names a glossary person.
    const notes = await learnFromArticleFeedback(
      stub.client,
      INPUT,
      deps([
        {
          kind: 'editorial',
          rule: 'देवेंद्र फडणवीस यांचे नाव आधी द्या',
          scope: 'both',
        },
      ]),
    );
    check('nothing is learned', notes.length === 0 && stub.writes.length === 0);
  }
  {
    const stub = stubClient({ glossary: GLOSSARY });
    // The model says `factual`; the rule would have passed the guard. Still dropped.
    const notes = await learnFromArticleFeedback(
      stub.client,
      INPUT,
      deps([{ kind: 'factual', rule: 'शीर्षक लहान ठेवा', scope: 'news' }]),
    );
    check(
      'a candidate the model called factual is not written either',
      notes.length === 0 && stub.writes.length === 0,
    );
  }

  console.log('\n=== failures cost the learning and nothing else ===');
  {
    const stub = stubClient({ glossary: GLOSSARY });
    const notes = await learnFromArticleFeedback(stub.client, INPUT, {
      extract: async () => {
        throw new Error('provider down');
      },
      consolidate: async () => ({ action: 'ADD', targetId: null }),
    });
    check(
      'a classifier failure returns [] rather than throwing',
      notes.length === 0,
    );
  }
  {
    const stub = stubClient({ glossary: GLOSSARY });
    const notes = await learnFromArticleFeedback(
      stub.client,
      { ...INPUT, feedback: '   ' },
      deps([{ kind: 'editorial', rule: 'शीर्षक लहान ठेवा', scope: 'news' }]),
    );
    check(
      'empty feedback is not even classified',
      notes.length === 0 && stub.writes.length === 0,
    );
  }
  {
    const stub = stubClient({ glossary: GLOSSARY, count: 200 });
    const notes = await learnFromArticleFeedback(
      stub.client,
      INPUT,
      deps([{ kind: 'editorial', rule: 'शीर्षक लहान ठेवा', scope: 'news' }]),
    );
    check(
      'the stored-rule ceiling refuses a new INSERT',
      notes.length === 0 && !stub.writes.some((w) => w.op === 'insert'),
    );
  }

  // ---------------------------------------------------------------------------------------
  // The structural check the plan asks for by name
  // ---------------------------------------------------------------------------------------
  console.log('\n=== BOTH feedback jobs reach the helper ===');
  {
    const here = dirname(fileURLToPath(import.meta.url));
    const runner = readFileSync(resolve(here, 'runner.ts'), 'utf8');
    // Each feedback job ends with insertRevision({... target: 'article', feedback ...}).
    // Hooking only the status-owning one would silently miss every revision made while a
    // poster is still rendering — which is why this is asserted rather than reviewed.
    const tails = runner.split("target: 'article',").slice(1);
    const withFeedback = tails.filter((tail) =>
      /^\s*\n\s*feedback,/u.test(tail),
    );
    check(
      'runner.ts has exactly two feedback-carrying revision tails',
      withFeedback.length === 2,
      withFeedback.length,
    );
    check(
      'and each is followed by learnFromFeedback(',
      withFeedback.every((tail) =>
        tail.slice(0, 900).includes('learnFromFeedback(client, row, feedback)'),
      ),
    );
    check(
      'the helper is gated on the flag',
      /function learnFromFeedback[\s\S]{0,900}editorialLearningEnabled\(\)/u.test(
        runner,
      ),
    );
    check(
      'and on /dlo',
      /function learnFromFeedback[\s\S]{0,1200}row\.dloIntakeId/u.test(runner),
    );
    check(
      'it is fired without being awaited',
      /function learnFromFeedback[\s\S]{0,2600}void \(async \(\) => \{/u.test(
        runner,
      ),
    );
    check(
      'with its OWN cost accumulator, not the revision job’s',
      /function learnFromFeedback[\s\S]{0,2200}const cost = createCostAccumulator\(\)/u.test(
        runner,
      ),
    );
    check(
      "metered as its own 'feedback_learning' task",
      /runInCostTask\('feedback_learning'/u.test(runner),
    );
  }

  if (failed > 0) {
    console.log(`\n${failed} check(s) FAILED.`);
    process.exitCode = 1;
  } else {
    console.log('\nAll editorial-learning checks passed.');
  }
}

void main();
