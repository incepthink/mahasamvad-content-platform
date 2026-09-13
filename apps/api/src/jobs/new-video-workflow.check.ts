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
import type { NewVideoTurnRow, SupabaseClient } from '@dgipr/database';
import { newVideoTitleFrom } from '@dgipr/schemas';
import {
  appendTurn,
  castPortraitCount,
  conversationIsBusy,
  conversationIsFull,
  createConversation,
  getConversation,
  getConversationTurns,
  listConversationSummaries,
  createCharacter,
  editCharacter,
  getConversationCharacters,
  listCharacters,
  markTurnCompleted,
  markTurnFailed,
  removeCharacter,
  resolveCharacters,
  resolveForkPoint,
  resolvePortrait,
  resolveReferenceImages,
  setConversationCast,
  toCharacterPayload,
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
  private rows: Row[] = [];

  constructor(private readonly table: string) {}

  insert(row: Row | Row[]): this {
    this.op = 'insert';
    // The cast is written as one statement, so the fake has to take a list — a fake that
    // silently accepted only the first row would pass a test the real driver would fail.
    this.rows = Array.isArray(row) ? row : [row];
    this.payload = Array.isArray(row) ? (row[0] ?? {}) : row;
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
      const written: Row[] = [];
      for (const payload of this.rows) {
        const id = randomUUID();
        const row: Row = { id, created_at: now, updated_at: now, ...payload };
        store.set(id, row);
        written.push(row);
      }
      return written;
    }

    const hits = [...store.values()].filter((row) => this.matches(row));

    if (this.op === 'update') {
      for (const row of hits) Object.assign(row, this.payload);
      return hits;
    }
    if (this.op === 'delete') {
      for (const row of hits) store.delete(row.id as string);
      // The real tables cascade; the fake does it by hand so a deletion test is honest.
      if (this.table === 'new_video_conversations') {
        const turns = tableOf('new_video_turns');
        for (const [key, turn] of turns) {
          if (hits.some((row) => row.id === turn.conversation_id)) {
            turns.delete(key);
          }
        }
        const cast = tableOf('new_video_conversation_characters');
        for (const [key, entry] of cast) {
          if (hits.some((row) => row.id === entry.conversation_id)) {
            cast.delete(key);
          }
        }
      }
      // 0054's other foreign key: a deleted character leaves every cast it was in, so it
      // cannot keep being re-emitted into future turns of a conversation.
      if (this.table === 'new_video_characters') {
        const cast = tableOf('new_video_conversation_characters');
        for (const [key, entry] of cast) {
          if (hits.some((row) => row.id === entry.character_id)) {
            cast.delete(key);
          }
        }
      }
      return hits;
    }

    const sorted = [...hits];
    for (const order of [...this.orders].reverse()) {
      sorted.sort((a, b) => {
        const left = a[order.column];
        const right = b[order.column];
        // Numbers compare as numbers: `position` is an integer, and a string sort would put
        // cast member 10 ahead of cast member 2 — which would re-bind a portrait to the
        // wrong name, the one thing the ordering exists to prevent.
        const delta =
          typeof left === 'number' && typeof right === 'number'
            ? left - right
            : String(left ?? '').localeCompare(String(right ?? ''));
        return order.ascending ? delta : -delta;
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

  // --- FORKING (Step 4) -----------------------------------------------------
  //
  // Where a paid render starts from. Every one of these is a silent failure if it is wrong:
  // continuing from another conversation's video, or from a render that has not finished,
  // both produce a plausible-looking clip that answers a question nobody asked.

  const forkTurns = await getConversationTurns(client, first.id);

  const forkToFirst = resolveForkPoint(forkTurns, turn1.id);
  check(
    'a completed turn resolves to the interaction that produced it',
    forkToFirst.ok && forkToFirst.interactionId === 'interactions/one',
    forkToFirst,
  );

  const forkToFailed = resolveForkPoint(forkTurns, turn2.id);
  check(
    'a FAILED turn cannot be forked from — it produced no video',
    !forkToFailed.ok && forkToFailed.reason === 'unfinished',
    forkToFailed,
  );

  check(
    'an id that is not a turn of this conversation is unknown, never a guess',
    (() => {
      const answer = resolveForkPoint(forkTurns, randomUUID());
      return !answer.ok && answer.reason === 'unknown';
    })(),
  );

  // A turn of a DIFFERENT conversation is the dangerous case: it is a real turn with a real
  // interaction behind it, so nothing but the conversation filter stops it editing a video
  // the officer is not looking at.
  const elsewhere = await createConversation(client);
  const elsewhereTurn = await appendTurn(
    client,
    elsewhere,
    'वेगळे संभाषण',
    [],
    0,
  );
  await markTurnCompleted(client, elsewhere.id, elsewhereTurn.id, {
    interactionId: 'interactions/elsewhere',
    videoUrl: 'https://example.test/elsewhere.mp4',
  });
  check(
    "another conversation's turn is refused, real interaction and all",
    (() => {
      const answer = resolveForkPoint(forkTurns, elsewhereTurn.id);
      return !answer.ok && answer.reason === 'unknown';
    })(),
  );

  // Handed rows directly: these two shapes are what the STATUS check exists for, and both
  // are states the database passes through rather than settles on.
  const rowShape = (
    over: Partial<NewVideoTurnRow>,
  ): readonly NewVideoTurnRow[] => [
    {
      id: 'turn-under-test',
      conversationId: first.id,
      prompt: '',
      images: [],
      status: 'completed',
      videoUrl: null,
      interactionId: 'interactions/whatever',
      modelText: null,
      error: null,
      createdAt: '',
      updatedAt: '',
      ...over,
    },
  ];
  check(
    'a turn still GENERATING cannot be forked from, though it already has an interaction',
    (() => {
      const answer = resolveForkPoint(
        rowShape({ status: 'generating' }),
        'turn-under-test',
      );
      return !answer.ok && answer.reason === 'unfinished';
    })(),
  );
  check(
    'and a completed turn with no interaction id is unfinished too',
    (() => {
      const answer = resolveForkPoint(
        rowShape({ interactionId: null }),
        'turn-under-test',
      );
      return !answer.ok && answer.reason === 'unfinished';
    })(),
  );

  // Forking from the current chain point is a no-op rather than an error: it resolves to the
  // very interaction the ordinary path would have used. The page does not offer it; refusing
  // a client that echoed it back would buy nothing.
  check(
    'forking from the latest completed turn resolves to the ordinary chain point',
    (() => {
      const answer = resolveForkPoint(forkTurns, turn1.id);
      return (
        answer.ok && answer.interactionId === afterFailure?.lastInteractionId
      );
    })(),
  );

  check(
    'a conversation with no turns has nothing to fork from',
    (() => {
      const answer = resolveForkPoint([], turn1.id);
      return !answer.ok && answer.reason === 'unknown';
    })(),
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

  // --- the character & voice registry (0054) --------------------------------

  const portraitId = await seedImage('priya.png');
  // Narrowed rather than cast: `resolvePortrait` answers 'missing' for an id this API did not
  // mint, and the route turns that into a Marathi 400 instead of storing half a portrait.
  const seededPortrait = await resolvePortrait(client, portraitId);
  check(
    'an uploaded id resolves to a portrait rather than to nothing',
    seededPortrait !== 'missing' && seededPortrait !== null,
  );
  const priya = await createCharacter(client, {
    name: 'प्रिया देशमुख',
    appearance: 'A woman in her early thirties in a green cotton saree.',
    voice: 'warm and measured, with a gentle Marathi accent',
    portrait: seededPortrait === 'missing' ? null : seededPortrait,
  });
  const rahul = await createCharacter(client, {
    name: 'Rahul Kale',
    appearance: 'A man in his fifties.',
    voice: 'low and gravelly',
    // Described in words alone: a registry entry does not require a picture.
    portrait: null,
  });

  check(
    'an uploaded picture becomes a portrait the job can fetch',
    priya.portraitUrl === 'https://example.test/priya.png' &&
      priya.portraitPath === 'new-video-workflow/priya.png' &&
      priya.portraitMime === 'image/png',
    priya,
  );
  check(
    'a character may be described in words alone',
    rahul.portraitUrl === null && rahul.portraitPath === null,
  );
  check(
    'an id this API did not mint is reported, never silently dropped',
    (await resolvePortrait(client, randomUUID())) === 'missing',
  );
  check(
    'no portrait asked about resolves to none',
    (await resolvePortrait(client, null)) === null &&
      (await resolvePortrait(client, undefined)) === null,
  );
  check(
    'the registry is one shared library',
    (await listCharacters(client)).length === 2,
  );

  // THE BOUNDARY, for the registry: the storage path and mime type are what the job needs to
  // fetch the bytes, and neither may reach a browser — the same rule an image row follows.
  const characterPayload = JSON.stringify(toCharacterPayload(priya));
  check(
    'a character payload carries the public URL and the words',
    characterPayload.includes('https://example.test/priya.png') &&
      characterPayload.includes('gentle Marathi accent'),
  );
  check(
    'and never the storage path or the mime type',
    !characterPayload.includes('new-video-workflow/priya.png') &&
      !characterPayload.includes('image/png'),
    characterPayload,
  );

  // --- a conversation's cast ------------------------------------------------

  const cast = await createConversation(client);
  await setConversationCast(client, cast.id, [rahul.id, priya.id]);
  const storedCast = await getConversationCharacters(client, cast.id);
  check(
    'a cast comes back in the order it was picked',
    storedCast.map((character) => character.name).join(' | ') ===
      'Rahul Kale | प्रिया देशमुख',
    storedCast.map((character) => character.name),
  );
  // The order is what binds a portrait to a name, so it must survive a database that answers
  // in whatever order it likes.
  check(
    'a cast of ten keeps its order rather than sorting like text',
    await (async () => {
      const many = await createConversation(client);
      const ids: string[] = [];
      for (let i = 0; i < 11; i += 1) {
        const row = await createCharacter(client, {
          name: `Extra ${i}`,
          appearance: '',
          voice: '',
          portrait: null,
        });
        ids.push(row.id);
      }
      await setConversationCast(client, many.id, ids);
      const back = await getConversationCharacters(client, many.id);
      return back.map((row) => row.id).join(',') === ids.join(',');
    })(),
  );
  check(
    'a conversation with no cast is not an error',
    (await getConversationCharacters(client, first.id)).length === 0,
  );

  // Only a character with a picture spends one of the turn's reference-image slots — the
  // number the route's combined budget is computed from.
  check(
    'the portrait count is what a cast costs in image slots',
    castPortraitCount(storedCast) === 1 && castPortraitCount([]) === 0,
  );

  // Resolved fresh from the registry on every read, so an edit reaches every FUTURE turn of a
  // conversation that already started — which is what a stored voice description is for.
  await editCharacter(client, priya.id, { voice: 'brisk and formal' });
  check(
    'editing a voice reaches a conversation already under way',
    (await getConversationCharacters(client, cast.id))
      .map((character) => character.voice)
      .includes('brisk and formal'),
  );

  check(
    'a cast reaches the polled payload',
    JSON.stringify(
      toConversationDetail(
        cast,
        [],
        await getConversationCharacters(client, cast.id),
      ),
    ).includes('brisk and formal'),
  );
  check(
    'and a conversation with no cast carries an empty one rather than nothing',
    JSON.stringify(toConversationDetail(first, [])).includes('"characters":[]'),
  );

  const { resolved: pickedCast, missing: missingCast } =
    await resolveCharacters(client, [priya.id, randomUUID()]);
  check(
    'a cast id we did not mint is reported so the turn can be refused',
    pickedCast.length === 1 && missingCast.length === 1,
  );

  // Deleting a registry entry leaves every cast it was in (0054's foreign key): a character
  // nobody can describe any more must not keep being re-emitted into future turns.
  await removeCharacter(client, rahul.id);
  check(
    'deleting a character removes them from the casts they were in',
    (await getConversationCharacters(client, cast.id)).length === 1,
  );
  check(
    'and the videos already rendered are untouched',
    (await getConversationTurns(client, cast.id)).length === 0,
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
