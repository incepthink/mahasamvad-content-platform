// Which rows become round-1 traces. "Diverse, not just complaints": per feature, a seeded,
// stratified pick across status (about a quarter failed, where failures exist), reaction (with
// and without feedback), lane, input size and time.
//
// Two halves. `pickStratified` is PURE and is what the harness checks. The `*Candidates`
// fetchers are the only database reads, and they select LEAN columns — ids, timestamps,
// statuses, counters — never the text columns, with the one exception called out on /dlo.
// Everything pages, because PostgREST caps a select at 1000 rows without saying so.

import {
  CHAT_MESSAGES_TABLE,
  CHAT_THREADS_TABLE,
  DLO_INTAKES_TABLE,
  GENERATION_REVISIONS_TABLE,
  GENERATIONS_TABLE,
  NEW_VIDEO_CONVERSATIONS_TABLE,
  NEW_VIDEO_TURNS_TABLE,
  REFERENCE_IMAGES_TABLE,
  TRANSCRIPTIONS_TABLE,
  type DloIntakeFileEntry,
  type SupabaseClient,
} from '@dgipr/database';
import { creativeLane } from './reconstruct/generation-common.js';
import { dloSourceLane } from './reconstruct/dlo.js';
import type { EvalFeature } from './trace.js';

export type Candidate = Readonly<{
  id: string;
  createdAt: string;
  failed: boolean;
  // The feature's own sub-kind (category, source mix, language, …).
  lane: string;
  // The officer reacted: feedback rounds, follow-up turns, a re-run.
  reacted: boolean;
  // A size proxy (characters, messages, turns); null when the feature has no cheap one.
  size: number | null;
}>;

export const FAILED_SHARE = 0.25;

// ---------------------------------------------------------------------------
// Pure, seeded selection
// ---------------------------------------------------------------------------

function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

// Take items group by group, one at a time, so every group is represented before any repeats.
function roundRobin<T>(groups: readonly (readonly T[])[]): T[] {
  const queues = groups.map((group) => [...group]);
  const out: T[] = [];
  while (queues.some((queue) => queue.length > 0)) {
    for (const queue of queues) {
      const next = queue.shift();
      if (next !== undefined) out.push(next);
    }
  }
  return out;
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): T[][] {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = map.get(k);
    if (list) list.push(item);
    else map.set(k, [item]);
  }
  return [...map.keys()].sort().map((k) => map.get(k)!);
}

// Lanes alternate at the top; inside a lane, reaction × time quarter × size bucket alternate.
function interleave(
  pool: readonly Candidate[],
  quarterOf: ReadonlyMap<string, number>,
  sizeBucketOf: (c: Candidate) => string,
  random: () => number,
): Candidate[] {
  const lanes = shuffle(
    groupBy(pool, (c) => c.lane),
    random,
  );
  return roundRobin(
    lanes.map((lane) =>
      roundRobin(
        shuffle(
          groupBy(
            lane,
            (c) => `${c.reacted}|${quarterOf.get(c.id)}|${sizeBucketOf(c)}`,
          ),
          random,
        ),
      ),
    ),
  );
}

// The `count` most recent candidates, newest first. No stratification: `--latest` is for
// reviewing what the platform produces NOW. Ties on the timestamp break on id, so the pick
// does not depend on the order the database answered in.
export function pickLatest(
  candidates: readonly Candidate[],
  count: number,
): Candidate[] {
  if (count <= 0) return [];
  return [...candidates]
    .sort(
      (a, b) =>
        b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id),
    )
    .slice(0, count);
}

export function pickStratified(
  candidates: readonly Candidate[],
  count: number,
  seed: string,
  feature: string,
): Candidate[] {
  if (count <= 0 || candidates.length === 0) return [];
  const random = mulberry32(hashSeed(`${seed}:${feature}`));
  // Sort first so the pick depends on the seed alone, not on the order the database answered.
  const base = shuffle(
    [...candidates].sort((a, b) => a.id.localeCompare(b.id)),
    random,
  );

  const byTime = [...base].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );
  const quarterOf = new Map(
    byTime.map((c, i) => [c.id, Math.floor((i * 4) / byTime.length)]),
  );
  const sizes = base
    .map((c) => c.size)
    .filter((s): s is number => s !== null)
    .sort((a, b) => a - b);
  const median = sizes.length > 0 ? sizes[Math.floor(sizes.length / 2)]! : 0;
  const sizeBucketOf = (c: Candidate) =>
    c.size === null ? 'na' : c.size < median ? 'short' : 'long';

  const failed = base.filter((c) => c.failed);
  const ok = base.filter((c) => !c.failed);
  const failedQuota = Math.min(Math.round(count * FAILED_SHARE), failed.length);
  const picked = [
    ...interleave(failed, quarterOf, sizeBucketOf, random).slice(
      0,
      failedQuota,
    ),
  ];
  const rest = interleave(ok, quarterOf, sizeBucketOf, random);
  for (const candidate of rest) {
    if (picked.length >= count) break;
    picked.push(candidate);
  }
  // Too few successes: top up with further failures rather than return short.
  if (picked.length < count) {
    const chosen = new Set(picked.map((c) => c.id));
    for (const candidate of interleave(
      failed,
      quarterOf,
      sizeBucketOf,
      random,
    )) {
      if (picked.length >= count) break;
      if (!chosen.has(candidate.id)) picked.push(candidate);
    }
  }
  return picked;
}

// ---------------------------------------------------------------------------
// Lean candidate reads
// ---------------------------------------------------------------------------

const PAGE_SIZE = 1000;
const MAX_ROWS = 50_000;
const PAGE_RETRIES = 4;

type Filter = (query: any) => any; // eslint-disable-line @typescript-eslint/no-explicit-any

export async function pageAll<T>(
  client: SupabaseClient,
  table: string,
  columns: string,
  filter: Filter = (q) => q,
): Promise<T[]> {
  const rows: T[] = [];
  let size = PAGE_SIZE;
  let attempt = 0;
  for (let offset = 0; offset < MAX_ROWS;) {
    const { data, error } = await filter(client.from(table).select(columns))
      .order('created_at', { ascending: true })
      .range(offset, offset + size - 1);
    if (error) {
      // A large page over the DB tunnel can be cut off mid-stream ("terminated"). Retry the
      // same offset with a smaller page rather than losing the whole export.
      attempt += 1;
      if (attempt > PAGE_RETRIES) {
        throw new Error(`Failed to read ${table}: ${error.message}`);
      }
      size = Math.max(50, Math.floor(size / 2));
      console.warn(
        `  read of ${table} failed (${error.message}); retrying with ${size} rows per page`,
      );
      continue;
    }
    attempt = 0;
    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < size) break;
    offset += size;
  }
  return rows;
}

const FINISHED = ['completed', 'failed'];

async function reactedGenerationIds(
  client: SupabaseClient,
): Promise<Set<string>> {
  const [revisions, followUps] = await Promise.all([
    pageAll<{ generation_id: string }>(
      client,
      GENERATION_REVISIONS_TABLE,
      'generation_id,created_at',
    ),
    pageAll<{ source_generation_id: string }>(
      client,
      GENERATIONS_TABLE,
      'source_generation_id,created_at',
      (q) => q.not('source_generation_id', 'is', null),
    ),
  ]);
  return new Set([
    ...revisions.map((r) => r.generation_id),
    ...followUps.map((r) => r.source_generation_id),
  ]);
}

async function creativeCandidates(
  client: SupabaseClient,
): Promise<Candidate[]> {
  const [rows, reacted] = await Promise.all([
    pageAll<{
      id: string;
      created_at: string;
      status: string;
      category: string;
      output_type: string;
    }>(
      client,
      GENERATIONS_TABLE,
      'id,created_at,status,category,output_type',
      (q) => q.is('dlo_intake_id', null).in('status', FINISHED),
    ),
    reactedGenerationIds(client),
  ]);
  return rows.map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    failed: row.status === 'failed',
    lane: creativeLane({
      category: row.category as never,
      outputType: row.output_type as never,
    }),
    reacted: reacted.has(row.id),
    size: null,
  }));
}

// The one heavy read: `files` cannot be projected inside a jsonb array, and it is the only way to
// know an intake's source mix. Acceptable in an offline script (the survey-dlo-pool precedent).
async function dloCandidates(client: SupabaseClient): Promise<Candidate[]> {
  const [intakes, generations, reacted] = await Promise.all([
    pageAll<{
      id: string;
      created_at: string;
      status: string;
      notes: string | null;
      files: DloIntakeFileEntry[] | null;
    }>(client, DLO_INTAKES_TABLE, 'id,created_at,status,notes,files'),
    pageAll<{ id: string; dlo_intake_id: string; status: string }>(
      client,
      GENERATIONS_TABLE,
      'id,dlo_intake_id,status,created_at',
      (q) => q.not('dlo_intake_id', 'is', null),
    ),
    reactedGenerationIds(client),
  ]);
  const byIntake = new Map<string, { id: string; status: string }[]>();
  for (const g of generations) {
    const list = byIntake.get(g.dlo_intake_id) ?? [];
    list.push(g);
    byIntake.set(g.dlo_intake_id, list);
  }
  return intakes.flatMap((intake) => {
    const files = intake.files ?? [];
    const notes = intake.notes ?? '';
    const gens = byIntake.get(intake.id) ?? [];
    // An empty draft, or an intake still being read that produced nothing: not a finished run.
    if (!notes.trim() && files.length === 0) return [];
    if (gens.length === 0 && intake.status !== 'failed') return [];
    const failed =
      intake.status === 'failed' || gens.some((g) => g.status === 'failed');
    return [
      {
        id: intake.id,
        createdAt: intake.created_at,
        failed,
        lane: dloSourceLane(notes, files),
        reacted: gens.length > 1 || gens.some((g) => reacted.has(g.id)),
        size: files.reduce((sum, f) => sum + (f.chars ?? 0), notes.length),
      },
    ];
  });
}

async function transcriptionCandidates(
  client: SupabaseClient,
): Promise<Candidate[]> {
  const rows = await pageAll<{
    id: string;
    created_at: string;
    status: string;
    file_count: number | null;
    failed_count: number | null;
    char_count: number | null;
  }>(
    client,
    TRANSCRIPTIONS_TABLE,
    'id,created_at,status,file_count,failed_count,char_count',
    (q) => q.in('status', ['ready', 'failed']),
  );
  return rows.map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    failed: row.status === 'failed' || (row.failed_count ?? 0) > 0,
    lane: (row.file_count ?? 0) > 1 ? 'several-recordings' : 'one-recording',
    reacted: false,
    size: row.char_count,
  }));
}

async function translationCandidates(
  client: SupabaseClient,
): Promise<Candidate[]> {
  const columns = 'id,created_at,dlo_intake_id';
  const [english, hindi] = await Promise.all([
    pageAll<{ id: string; created_at: string; dlo_intake_id: string | null }>(
      client,
      GENERATIONS_TABLE,
      columns,
      (q) => q.not('article_english', 'is', null),
    ),
    pageAll<{ id: string; created_at: string; dlo_intake_id: string | null }>(
      client,
      GENERATIONS_TABLE,
      columns,
      (q) => q.not('article_hindi', 'is', null),
    ),
  ]);
  const hindiIds = new Set(hindi.map((r) => r.id));
  const englishIds = new Set(english.map((r) => r.id));
  const all = new Map([...english, ...hindi].map((r) => [r.id, r]));
  return [...all.values()].map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    failed: false,
    lane:
      englishIds.has(row.id) && hindiIds.has(row.id)
        ? 'en+hi'
        : englishIds.has(row.id)
          ? 'en'
          : 'hi',
    reacted: row.dlo_intake_id !== null,
    size: null,
  }));
}

async function referenceCandidates(
  client: SupabaseClient,
): Promise<Candidate[]> {
  const rows = await pageAll<{
    id: string;
    created_at: string;
    category: string;
    layout_spec: { bulletSlots?: number } | null;
  }>(client, REFERENCE_IMAGES_TABLE, 'id,created_at,category,layout_spec');
  return rows.map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    failed: row.layout_spec === null,
    lane: row.category,
    reacted: false,
    size: row.layout_spec?.bulletSlots ?? null,
  }));
}

async function newVideoCandidates(
  client: SupabaseClient,
  mode: 'video' | 'storyboard',
): Promise<Candidate[]> {
  const [conversations, turns] = await Promise.all([
    // `*` like the database module: `mode` is absent on a database without 0060.
    pageAll<{
      id: string;
      created_at: string;
      mode?: string | null;
      turn_count: number | null;
    }>(client, NEW_VIDEO_CONVERSATIONS_TABLE, '*'),
    pageAll<{ conversation_id: string; status: string }>(
      client,
      NEW_VIDEO_TURNS_TABLE,
      'conversation_id,status,created_at',
    ),
  ]);
  const failedIn = new Set(
    turns.filter((t) => t.status === 'failed').map((t) => t.conversation_id),
  );
  return conversations
    .filter((c) => (c.mode === 'storyboard' ? 'storyboard' : 'video') === mode)
    .filter((c) => (c.turn_count ?? 0) > 0)
    .map((c) => ({
      id: c.id,
      createdAt: c.created_at,
      failed: failedIn.has(c.id),
      lane: (c.turn_count ?? 0) > 1 ? 'multi-turn' : 'single-turn',
      reacted: (c.turn_count ?? 0) > 1,
      size: c.turn_count,
    }));
}

async function chatCandidates(client: SupabaseClient): Promise<Candidate[]> {
  const [threads, errored] = await Promise.all([
    pageAll<{ id: string; created_at: string; message_count: number | null }>(
      client,
      CHAT_THREADS_TABLE,
      'id,created_at,message_count',
    ),
    pageAll<{ thread_id: string }>(
      client,
      CHAT_MESSAGES_TABLE,
      'thread_id,created_at',
      (q) => q.not('error', 'is', null),
    ),
  ]);
  const failedIn = new Set(errored.map((m) => m.thread_id));
  return threads
    .filter((t) => (t.message_count ?? 0) > 0)
    .map((t) => ({
      id: t.id,
      createdAt: t.created_at,
      failed: failedIn.has(t.id),
      lane: (t.message_count ?? 0) > 2 ? 'conversation' : 'single-question',
      reacted: (t.message_count ?? 0) > 2,
      size: t.message_count,
    }));
}

export async function fetchCandidates(
  client: SupabaseClient,
  feature: EvalFeature,
): Promise<Candidate[]> {
  switch (feature) {
    case 'creative':
      return creativeCandidates(client);
    case 'dlo':
      return dloCandidates(client);
    case 'transcribe':
      return transcriptionCandidates(client);
    case 'translate':
      return translationCandidates(client);
    case 'references':
      return referenceCandidates(client);
    case 'storyboard':
      return newVideoCandidates(client, 'storyboard');
    case 'new-video':
      return newVideoCandidates(client, 'video');
    case 'chat':
      return chatCandidates(client);
  }
}
