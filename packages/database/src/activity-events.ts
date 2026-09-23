// Activity events (supabase/migrations/0058_activity_events.sql): the hidden /activity page's
// audit log of WHO (IP + browser device id — never auth) did WHAT.
//
// Modelled on usage-events.ts, and bound by the same first rule:
//   WRITES NEVER THROW. `recordActivity` and `settleActivity` return void and swallow every
//   failure. An officer's run must not fail, or even wait, because an audit insert did — and
//   a database without 0058 must lose the monitor page rather than any feature.
//
// Unlike usage_events this table DOES carry a short summary (a heading, a file name, the
// opening words of a prompt), capped at 140 characters by `activitySummary()` in
// @dgipr/schemas, which callers are expected to build it with. It is clamped here again so a
// caller that forgets cannot put an article in the log.

import type { SupabaseClient } from '@supabase/supabase-js';

export const ACTIVITY_EVENTS_TABLE = 'activity_events';

const SUMMARY_MAX = 140;
const USER_AGENT_MAX = 300;
const ERROR_MAX = 300;

export type ActivityActor = Readonly<{
  ip: string;
  deviceId: string | null;
  userAgent: string | null;
}>;

export type ActivityStatusValue = 'in_progress' | 'success' | 'failed';

export type ActivitySubjectRef = Readonly<{ kind: string; id: string }>;

export type NewActivityEvent = Readonly<{
  feature: string;
  action: string;
  status: ActivityStatusValue;
  summary?: string | null;
  subject?: ActivitySubjectRef | null;
  // Small facts only: language, platform, byte count, page count.
  detail?: Readonly<Record<string, string | number | boolean | null>>;
  error?: string | null;
}>;

export type ActivityEventRow = Readonly<{
  id: string;
  createdAt: string;
  settledAt: string | null;
  ip: string;
  deviceId: string | null;
  userAgent: string | null;
  feature: string;
  action: string;
  status: string;
  summary: string | null;
  subjectKind: string | null;
  subjectId: string | null;
  detail: Record<string, unknown>;
  error: string | null;
}>;

function clamp(value: string | null | undefined, max: number): string | null {
  if (typeof value !== 'string') return null;
  const chars = Array.from(value.trim());
  if (chars.length === 0) return null;
  return chars.length <= max
    ? chars.join('')
    : `${chars.slice(0, max - 1).join('')}…`;
}

// Fire-and-forget. Deliberately not returning the insert promise, so nothing is tempted to
// await it inside a request and pay its latency (the recordUsageEvent contract).
export function recordActivity(
  client: SupabaseClient,
  actor: ActivityActor,
  event: NewActivityEvent,
): void {
  try {
    const settled = event.status !== 'in_progress';
    void client
      .from(ACTIVITY_EVENTS_TABLE)
      .insert({
        ip: actor.ip || 'unknown',
        device_id: actor.deviceId,
        user_agent: clamp(actor.userAgent, USER_AGENT_MAX),
        feature: event.feature,
        action: event.action,
        status: event.status,
        summary: clamp(event.summary, SUMMARY_MAX),
        subject_kind: event.subject?.kind ?? null,
        subject_id: event.subject?.id ?? null,
        detail: event.detail ?? {},
        error: event.status === 'failed' ? clamp(event.error, ERROR_MAX) : null,
        ...(settled ? { settled_at: new Date().toISOString() } : {}),
      })
      .then(
        ({ error }) => {
          if (error) {
            // Includes "relation activity_events does not exist" on a database without 0058.
            console.warn(`[activity] insert failed: ${error.message}`);
          }
        },
        (error: unknown) => {
          console.warn('[activity] insert failed:', error);
        },
      );
  } catch (error) {
    console.warn('[activity] insert failed:', error);
  }
}

// Flip the ONE in-progress row a route opened for this job. Keyed by ACTION as well as the
// subject, because two jobs can run on one generation at once (a caption revision beside a
// poster re-render) and must not settle each other. Only `in_progress` rows are touched, so a
// settle can never overwrite a row that already reached its end, and a settle with nothing to
// match (work started by a path that recorded nothing) is a harmless no-op.
export function settleActivity(
  client: SupabaseClient,
  subject: ActivitySubjectRef,
  action: string,
  status: Exclude<ActivityStatusValue, 'in_progress'>,
  error?: string | null,
): void {
  try {
    void client
      .from(ACTIVITY_EVENTS_TABLE)
      .update({
        status,
        settled_at: new Date().toISOString(),
        error: status === 'failed' ? clamp(error ?? null, ERROR_MAX) : null,
      })
      .eq('subject_kind', subject.kind)
      .eq('subject_id', subject.id)
      .eq('action', action)
      .eq('status', 'in_progress')
      .then(
        ({ error: updateError }) => {
          if (updateError) {
            console.warn(`[activity] settle failed: ${updateError.message}`);
          }
        },
        (settleError: unknown) => {
          console.warn('[activity] settle failed:', settleError);
        },
      );
  } catch (settleError) {
    console.warn('[activity] settle failed:', settleError);
  }
}

// Every in-progress row a subject still holds, whatever the action — what an orphan reaper
// settles when it finds a job that can no longer finish (the API restarted mid-run).
export function settleAllActivity(
  client: SupabaseClient,
  subject: ActivitySubjectRef,
  status: Exclude<ActivityStatusValue, 'in_progress'>,
  error?: string | null,
): void {
  try {
    void client
      .from(ACTIVITY_EVENTS_TABLE)
      .update({
        status,
        settled_at: new Date().toISOString(),
        error: status === 'failed' ? clamp(error ?? null, ERROR_MAX) : null,
      })
      .eq('subject_kind', subject.kind)
      .eq('subject_id', subject.id)
      .eq('status', 'in_progress')
      .then(
        ({ error: updateError }) => {
          if (updateError) {
            console.warn(`[activity] settle failed: ${updateError.message}`);
          }
        },
        (settleError: unknown) => {
          console.warn('[activity] settle failed:', settleError);
        },
      );
  } catch (settleError) {
    console.warn('[activity] settle failed:', settleError);
  }
}

// ---------------------------------------------------------------------------
// Reads (the /activity page). Unlike the writes these THROW — the caller renders the failure
// rather than reporting "nobody did anything".
// ---------------------------------------------------------------------------

type ActivityDbRow = {
  id: string;
  created_at: string;
  settled_at: string | null;
  ip: string;
  device_id: string | null;
  user_agent: string | null;
  feature: string;
  action: string;
  status: string;
  summary: string | null;
  subject_kind: string | null;
  subject_id: string | null;
  detail: Record<string, unknown> | null;
  error: string | null;
};

const EVENT_COLUMNS =
  'id,created_at,settled_at,ip,device_id,user_agent,feature,action,status,summary,subject_kind,subject_id,detail,error';

function toEvent(row: ActivityDbRow): ActivityEventRow {
  return {
    id: row.id,
    createdAt: row.created_at,
    settledAt: row.settled_at,
    ip: row.ip,
    deviceId: row.device_id,
    userAgent: row.user_agent,
    feature: row.feature,
    action: row.action,
    status: row.status,
    summary: row.summary,
    subjectKind: row.subject_kind,
    subjectId: row.subject_id,
    detail: row.detail ?? {},
    error: row.error,
  };
}

export type ActivityFilters = Readonly<{
  ip?: string | undefined;
  deviceId?: string | undefined;
  feature?: string | undefined;
  status?: string | undefined;
  // Half-open [from, to) ISO timestamps.
  from?: string | undefined;
  to?: string | undefined;
}>;

// Keyset cursor on (created_at, id), newest first. Opaque to the client.
export function encodeActivityCursor(row: {
  createdAt: string;
  id: string;
}): string {
  return Buffer.from(`${row.createdAt}|${row.id}`, 'utf8').toString(
    'base64url',
  );
}

export function decodeActivityCursor(
  cursor: string,
): { createdAt: string; id: string } | null {
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const [createdAt, id] = raw.split('|');
    if (!createdAt || !id) return null;
    if (Number.isNaN(Date.parse(createdAt))) return null;
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

export async function listActivityEvents(
  client: SupabaseClient,
  filters: ActivityFilters,
  cursor: string | null,
  limit: number,
): Promise<{ events: ActivityEventRow[]; nextCursor: string | null }> {
  let query = client
    .from(ACTIVITY_EVENTS_TABLE)
    .select(EVENT_COLUMNS)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1);
  if (filters.ip) query = query.eq('ip', filters.ip);
  if (filters.deviceId) query = query.eq('device_id', filters.deviceId);
  if (filters.feature) query = query.eq('feature', filters.feature);
  if (filters.status) query = query.eq('status', filters.status);
  if (filters.from) query = query.gte('created_at', filters.from);
  if (filters.to) query = query.lt('created_at', filters.to);
  const after = cursor ? decodeActivityCursor(cursor) : null;
  if (after) {
    // Quoted: a timestamp carries `:` and `+`, which the or-filter grammar reserves.
    query = query.or(
      `created_at.lt."${after.createdAt}",and(created_at.eq."${after.createdAt}",id.lt.${after.id})`,
    );
  }
  const { data, error } = await query;
  if (error) throw new Error(`Failed to list activity: ${error.message}`);
  const rows = ((data ?? []) as unknown as ActivityDbRow[]).map(toEvent);
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    events: page,
    nextCursor: rows.length > limit && last ? encodeActivityCursor(last) : null,
  };
}

export type ActivityWindowRow = Readonly<{
  ip: string;
  deviceId: string | null;
  userAgent: string | null;
  feature: string;
  status: string;
  createdAt: string;
}>;

// Lean rows for aggregation — no summary, no detail. Pages past PostgREST's silent
// 1000-row cap, the analytics.ts rule.
export async function listActivityWindow(
  client: SupabaseClient,
  filters: ActivityFilters,
  limit = 50_000,
): Promise<ActivityWindowRow[]> {
  const pageSize = 1_000;
  const out: ActivityWindowRow[] = [];
  for (let offset = 0; offset < limit; offset += pageSize) {
    let query = client
      .from(ACTIVITY_EVENTS_TABLE)
      .select('ip,device_id,user_agent,feature,status,created_at')
      .order('created_at', { ascending: false })
      .range(offset, Math.min(offset + pageSize - 1, limit - 1));
    if (filters.ip) query = query.eq('ip', filters.ip);
    if (filters.deviceId) query = query.eq('device_id', filters.deviceId);
    if (filters.from) query = query.gte('created_at', filters.from);
    if (filters.to) query = query.lt('created_at', filters.to);
    const { data, error } = await query;
    if (error) throw new Error(`Failed to read activity: ${error.message}`);
    const rows = (data ?? []) as unknown as Array<{
      ip: string;
      device_id: string | null;
      user_agent: string | null;
      feature: string;
      status: string;
      created_at: string;
    }>;
    for (const row of rows) {
      out.push({
        ip: row.ip,
        deviceId: row.device_id,
        userAgent: row.user_agent,
        feature: row.feature,
        status: row.status,
        createdAt: row.created_at,
      });
    }
    if (rows.length < pageSize) break;
  }
  return out;
}
