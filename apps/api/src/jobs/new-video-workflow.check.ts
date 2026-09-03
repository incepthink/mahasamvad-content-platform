// Offline check of the /new-video-workflow conversation layer. No network, no Gemini, no real
// database: the store below is a fake PostgREST client holding rows in Maps.
//
// It exists for two things that cannot be re-derived from a single request and that a
// migration made easier to get wrong, not harder:
//
//   THE CHAIN RULE — what `previous_interaction_id` will be. Before 0050 that lived in one
//   object in memory; it is now a column that two different code paths write, so the rule
//   that a FAILED turn must not advance it is worth a test of its own.
//
//   THE BOUNDARY — `toConversationDetail` is the one place rows become payloads, and the
//   things it must drop (a Gemini interaction id, a storage path) are now stored rather than
//   held transiently, so "it cannot leak because we never had it" stopped being true.
//
// Run from apps/api:  npx tsx src/jobs/new-video-workflow.check.ts

import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@dgipr/database';
import { newVideoTitleFrom } from '@dgipr/schemas';
import {
  appendTurn,
  conversationIsBusy,
  conversationIsFull,
  createConversation,
  getConversation,
  getConversationTurns,
  listConversationSummaries,
  markTurnCompleted,
  markTurnFailed,
  resolveReferenceImages,
  toConversationDetail,
} from './new-video-workflow.js';

let failed = 0;
function check(name: string, ok: boolean, detail?: unknown): void {
  if (ok) {
    console.log('  ok   ' + name);
  } else {
    failed += 1;
    console.log('  FAIL ' + name, detail === undefined ? '' : detail);
  }
}

// ---------------------------------------------------------------------------
// A fake PostgREST client
// ---------------------------------------------------------------------------
//
// Implements exactly the chained calls packages/database/src/new-video.ts makes and nothing
// else, so an unsupported query fails loudly here rather than passing a test that would not
// hold against the real driver.

type Row = Record<string, unknown>;

const tables = new Map<string, Map<string, Row>>();

function tableOf(name: string): Map<string, Row> {
  let table = tables.get(name);
  if (!table) {
    table = new Map();
    tables.set(name, table);
  }
  return table;
}

type Filter = { column: string; value: unknown; op: 'eq' | 'in' };

class Query implements PromiseLike<{ data: unknown; error: null }> {
  private filters: Filter[] = [];
  private orders: { column: string; ascending: boolean }[] = [];
  private op: 'select' | 'insert' | 'update' | 'delete' = 'select';
  private payload: Row = {};

  constructor(private readonly table: string) {}

  insert(row: Row): this {
    this.op = 'insert';
    this.payload = row;
    return this;
  }

  update(row: Row): this {
    this.op = 'update';
    this.payload = row;
    return this;
  }

  delete(): this {
    this.op = 'delete';
    return this;
  }

  select(_columns?: string): this {
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.push({ column, value, op: 'eq' });
    return this;
  }

  in(column: string, value: unknown[]): this {
    this.filters.push({ column, value, op: 'in' });
    return this;
  }

  order(column: string, options?: { ascending?: boolean }): this {
    this.orders.push({ column, ascending: options?.ascending !== false });
    return this;
  }

  limit(_count: number): this {
    return this;
  }

  range(_from: number, _to: number): this {
    return this;
  }

  private matches(row: Row): boolean {
    return this.filters.every((filter) =>
      filter.op === 'eq'
        ? row[filter.column] === filter.value
        : (filter.value as unknown[]).includes(row[filter.column]),
    );
  }

  private run(): unknown {
    const store = tableOf(this.table);
    const now = new Date().toISOString();

    if (this.op === 'insert') {
      const id = randomUUID();
      const row: Row = {
        id,
        created_at: now,
        updated_at: now,
        ...this.payload,
      };
      store.set(id, row);
      return [row];
    }

    const hits = [...store.values()].filter((row) => this.matches(row));

    if (this.op === 'update') {
      for (const row of hits) Object.assign(row, this.payload);
      return hits;
    }
    if (this.op === 'delete') {
      for (const row of hits) store.delete(row.id as string);
      // The real table cascades; the fake does it by hand so a deletion test is honest.
      if (this.table === 'new_video_conversations') {
        const turns = tableOf('new_video_turns');
        for (const [key, turn] of turns) {
          if (hits.some((row) => row.id === turn.conversation_id)) {
            turns.delete(key);
          }
        }
      }
      return hits;
    }

    const sorted = [...hits];
    for (const order of [...this.orders].reverse()) {
      sorted.sort((a, b) => {
        const left = String(a[order.column] ?? '');
        const right = String(b[order.column] ?? '');
        return order.ascending
          ? left.localeCompare(right)
          : right.localeCompare(left);
      });
    }
    return sorted;
  }

  async single(): Promise<{ data: unknown; error: null }> {
    const rows = this.run() as Row[];
    return { data: rows[0] ?? null, error: null };
  }

  async maybeSingle(): Promise<{ data: unknown; error: null }> {
    const rows = this.run() as Row[];
    return { data: rows[0] ?? null, error: null };
  }

  then<T1 = { data: unknown; error: null }, T2 = never>(
    onFulfilled?:
      ((value: { data: unknown; error: null }) => T1 | PromiseLike<T1>) | null,
    onRejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
  ): PromiseLike<T1 | T2> {
    return Promise.resolve({ data: this.run(), error: null as null }).then(
      onFulfilled,
      onRejected,
    );
  }
}

const client = {
  from: (table: string) => new Query(table),
} as unknown as SupabaseClient;

function seedImage(name: string): Promise<string> {
  return (async () => {
    const store = tableOf('new_video_images');
    const id = randomUUID();
    store.set(id, {
      id,
      display_name: name,
      url: `https://example.test/${name}`,
      storage_path: `new-video-workflow/${name}`,
      mime_type: 'image/png',
      created_at: new Date().toISOString(),
    });
    return id;
  })();
}

async function main(): Promise<void> {
  // --- a new conversation is independent ------------------------------------

  const first = await createConversation(client);
  check(
    'a new conversation continues from nothing',
    first.lastInteractionId === null,
    first.lastInteractionId,
  );
  check(
    'a new conversation has no turns',
    (await getConversationTurns(client, first.id)).length === 0,
  );
  check(
    'a new conversation is not busy',
    (await conversationIsBusy(client, first.id)) === false,
  );
  check('a new conversation has no title yet', first.title === '');

  // --- the first turn names the conversation --------------------------------

  const turn1 = await appendTurn(
    client,
    first,
    'समुद्रकिनारी सूर्यास्त',
    [],
    0,
  );
  check('a new turn starts queued', turn1.status === 'queued', turn1.status);
  check('a new turn has no video', turn1.videoUrl === null);

  const afterFirst = await getConversation(client, first.id);
  check(
    'the first prompt becomes the rail title',
    afterFirst?.title === 'समुद्रकिनारी सूर्यास्त',
    afterFirst?.title,
  );
  check('the turn is counted', afterFirst?.turnCount === 1);
  check('the ordering key is stamped', afterFirst?.lastTurnAt !== null);
  check(
    'a queued turn makes the conversation busy',
    (await conversationIsBusy(client, first.id)) === true,
  );

  // A follow-up must NOT rename the conversation: it is a chain of edits on one video, so
  // what names it is what was asked for at the start.
  await markTurnCompleted(client, first.id, turn1.id, {
    interactionId: 'interactions/one',
    videoUrl: 'https://example.test/one.mp4',
  });
  const turn2 = await appendTurn(client, first, 'पार्श्वभूमी बदला', [], 1);
  const afterSecond = await getConversation(client, first.id);
  check(
    'a follow-up does not rename the conversation',
    afterSecond?.title === 'समुद्रकिनारी सूर्यास्त',
    afterSecond?.title,
  );
  check('the second turn is counted', afterSecond?.turnCount === 2);

  // --- THE CHAIN RULE -------------------------------------------------------

  check(
    'a completed turn becomes the chain point',
    afterSecond?.lastInteractionId === 'interactions/one',
    afterSecond?.lastInteractionId,
  );

  await markTurnFailed(client, turn2.id, 'Gemini refused: safety filter.');
  const afterFailure = await getConversation(client, first.id);
  check(
    'a FAILED turn leaves the chain point where it was',
    afterFailure?.lastInteractionId === 'interactions/one',
    afterFailure?.lastInteractionId,
  );

  const failedTurns = await getConversationTurns(client, first.id);
  const stored = failedTurns.find((turn) => turn.id === turn2.id);
  check('a failed turn is marked failed', stored?.status === 'failed');
  check(
    "a failed turn keeps the provider's own words",
    stored?.error === 'Gemini refused: safety filter.',
    stored?.error,
  );
  check(
    'a failed turn does not make the conversation busy',
    (await conversationIsBusy(client, first.id)) === false,
  );

  // --- the boundary ---------------------------------------------------------

  const detail = toConversationDetail(
    afterFailure ?? first,
    await getConversationTurns(client, first.id),
  );
  const serialized = JSON.stringify(detail);
  check(
    'the payload carries no Gemini interaction id',
    !serialized.includes('interactions/one'),
    serialized,
  );
  check(
    'the payload carries no storage path',
    !serialized.includes('new-video-workflow/'),
  );
  check(
    'the payload carries the title',
    detail.title === 'समुद्रकिनारी सूर्यास्त',
  );
  check('the payload reports not busy', detail.busy === false);
  check('the payload carries both turns', detail.turns.length === 2);
  check(
    'a completed turn carries its video url',
    detail.turns[0]?.videoUrl === 'https://example.test/one.mp4',
  );

  // --- reference images -----------------------------------------------------

  const imageA = await seedImage('a.png');
  const imageB = await seedImage('b.png');

  const resolvedInOrder = await resolveReferenceImages(client, [
    imageB,
    imageA,
  ]);
  check(
    'reference images resolve IN THE ORDER THEY WERE SENT',
    resolvedInOrder.resolved.map((image) => image.id).join(',') ===
      `${imageB},${imageA}`,
    resolvedInOrder.resolved.map((image) => image.displayName),
  );
  check('every supplied id resolved', resolvedInOrder.missing.length === 0);

  const unknownId = randomUUID();
  const withUnknown = await resolveReferenceImages(client, [imageA, unknownId]);
  check(
    'an id this API did not mint is reported missing',
    withUnknown.missing.length === 1 && withUnknown.missing[0] === unknownId,
    withUnknown.missing,
  );
  check(
    'no ids resolve to nothing',
    (await resolveReferenceImages(client, [])).resolved.length === 0,
  );

  // --- the rail -------------------------------------------------------------

  const untouched = await createConversation(client);
  const summaries = await listConversationSummaries(client);
  check(
    'a conversation with no turns is not in the rail',
    !summaries.some((row) => row.id === untouched.id),
    summaries.map((row) => row.id),
  );
  check(
    'a conversation with turns is in the rail',
    summaries.some((row) => row.id === first.id),
  );
  const summarySerialized = JSON.stringify(summaries);
  check(
    'the rail carries no prompt',
    !summarySerialized.includes('पार्श्वभूमी बदला'),
    summarySerialized,
  );
  check(
    'the rail carries no interaction id',
    !summarySerialized.includes('interactions/one'),
  );

  // --- guards ---------------------------------------------------------------

  check('an empty conversation is not full', !conversationIsFull([]));
  check(
    'a conversation at the ceiling is full',
    conversationIsFull(new Array(60).fill(turn1)),
  );
  check(
    'a missing conversation resolves to nothing',
    (await getConversation(client, randomUUID())) === null,
  );

  // --- titles ---------------------------------------------------------------

  check(
    'a short prompt is its own title',
    newVideoTitleFrom('छोटा प्रॉम्प्ट') === 'छोटा प्रॉम्प्ट',
  );
  check(
    'only the first non-empty line names a conversation',
    newVideoTitleFrom('\n\nपहिली ओळ\nदुसरी ओळ') === 'पहिली ओळ',
    newVideoTitleFrom('\n\nपहिली ओळ\nदुसरी ओळ'),
  );
  const long = newVideoTitleFrom('क '.repeat(120));
  check('a long prompt is cut', long.length <= 81 && long.endsWith('…'), long);

  console.log(
    failed === 0
      ? '\nall new-video-workflow checks passed'
      : `\n${failed} check(s) FAILED`,
  );
  if (failed > 0) process.exitCode = 1;
}

void main();
