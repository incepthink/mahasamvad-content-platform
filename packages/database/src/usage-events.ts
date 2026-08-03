// Usage events (see supabase/migrations/0043_usage_events.sql): the analytics page's only
// source for the three features that deliberately persist nothing — /proofread, ad-hoc
// /translate — and for actions taken against an existing row (PDF export, poster download,
// publish) which are not rows of their own.
//
// Two rules this module enforces rather than documents:
//   1. WRITES NEVER THROW. `recordUsageEvent` swallows every failure and returns void. An
//      officer's translation must not fail because an analytics insert did, and a database
//      without 0043 applied must lose the page rather than the feature (the 0028 principle).
//   2. NO CONTENT. The shape below has no free-text field at all; `detail` takes small
//      enumerable values. There is nowhere for a note or an article to go, which is stronger
//      than a comment asking callers not to send one.

import type { SupabaseClient } from '@supabase/supabase-js';

export const USAGE_EVENTS_TABLE = 'usage_events';

// The sidebar features analytics reports on. Mirrors AnalyticsFeatureKey in @dgipr/schemas —
// duplicated rather than imported because @dgipr/database does not depend on @dgipr/schemas.
export type UsageFeature =
  'social' | 'article' | 'transcribe' | 'translate' | 'proofread' | 'video';

export type NewUsageEvent = Readonly<{
  feature: UsageFeature;
  action: string;
  charCount?: number;
  count?: number;
  // Small enumerable dimensions only: language, platform, source. Never content.
  detail?: Readonly<Record<string, string | number | boolean>>;
}>;

export type UsageEventRow = Readonly<{
  feature: string;
  action: string;
  charCount: number;
  count: number;
  detail: Record<string, unknown>;
  createdAt: string;
}>;

// Fire-and-forget. Callers do NOT await this (and must not depend on it having happened):
// the return is void, so there is nothing to await meaningfully, and every error path ends
// in a console warning. Deliberately not `Promise<void>` returning the insert promise —
// that would tempt a caller to await it inside a request and pay its latency.
export function recordUsageEvent(
  client: SupabaseClient,
  event: NewUsageEvent,
): void {
  void client
    .from(USAGE_EVENTS_TABLE)
    .insert({
      feature: event.feature,
      action: event.action,
      char_count: Math.max(0, Math.round(event.charCount ?? 0)),
      count: Math.max(0, Math.round(event.count ?? 1)),
      detail: event.detail ?? {},
    })
    .then(({ error }) => {
      if (error) {
        // Includes "relation usage_events does not exist" on a database without 0043 —
        // noisy once per event, but the alternative is a silent hole in the analytics.
        console.warn(`[usage-events] insert failed: ${error.message}`);
      }
    });
}

// ---------------------------------------------------------------------------
// Service usage — which paid external API a feature actually ran on.
// ---------------------------------------------------------------------------
//
// A CAPABILITY, not a provider: `stt` stays `stt` across a Sarvam→ElevenLabs swap, so the
// history is continuous and the provider is carried in `detail` instead. Mirrors
// AnalyticsServiceKey in @dgipr/schemas (duplicated for the same reason as UsageFeature —
// @dgipr/database does not depend on @dgipr/schemas).
export type UsageService =
  'text' | 'embedding' | 'image' | 'ocr' | 'stt' | 'tts' | 'clip' | 'translate';

// The action prefix these rows carry, so a service event is separable from the
// feature-level actions already in the table (`article_pdf`, `poster_download`, …) with a
// plain string test and no schema change. usage_events.action is free text, which is why
// this needed NO migration on top of 0043.
export const SERVICE_ACTION_PREFIX = 'service:';

export function serviceAction(service: UsageService): string {
  return `${SERVICE_ACTION_PREFIX}${service}`;
}

export function serviceFromAction(action: string): UsageService | null {
  if (!action.startsWith(SERVICE_ACTION_PREFIX)) return null;
  return action.slice(SERVICE_ACTION_PREFIX.length) as UsageService;
}

// Exact task rows name WHAT the current UI workflow was doing while `detail.service`
// records HOW it was done. They use the existing jsonb event shape, so task-level tracking
// starts at deployment without another table or any source content entering analytics.
export const TASK_ACTION_PREFIX = 'task:';

export function taskAction(task: string): string {
  return `${TASK_ACTION_PREFIX}${task}`;
}

export function taskFromAction(action: string): string | null {
  if (!action.startsWith(TASK_ACTION_PREFIX)) return null;
  const task = action.slice(TASK_ACTION_PREFIX.length);
  return task === '' ? null : task;
}

export type NewTaskUsage = Readonly<{
  feature: UsageFeature;
  task: string;
  service: UsageService;
  provider: string;
  model?: string;
  calls: number;
  units: number;
  costUsd?: number;
  costEstimated?: boolean;
}>;

export function recordTaskUsage(
  client: SupabaseClient,
  usage: NewTaskUsage,
): void {
  if (usage.calls <= 0 && usage.units <= 0) return;
  recordUsageEvent(client, {
    feature: usage.feature,
    action: taskAction(usage.task),
    count: usage.calls,
    charCount: Math.round(usage.units),
    detail: {
      service: usage.service,
      provider: usage.provider,
      ...(usage.model ? { model: usage.model } : {}),
      costUsd: Math.round((usage.costUsd ?? 0) * 1_000_000) / 1_000_000,
      costEstimated: usage.costEstimated ?? false,
    },
  });
}

export type NewServiceUsage = Readonly<{
  feature: UsageFeature;
  service: UsageService;
  // Live config value ('openai', 'elevenlabs', 'kling', 'sarvam', 'gemini'). Recorded per
  // event rather than looked up at read time, so a window that spans a provider swap
  // reports what each run actually used.
  provider: string;
  // How many times the service was invoked.
  calls: number;
  // How much it processed, in whatever unit the capability is billed by (seconds of audio,
  // pages, characters, images, clips). The reader knows the unit from the service key.
  units: number;
  // USD as metered or estimated at the call site — the ONE place that knows which rate
  // applied. Recomputing it at read time would silently re-price old runs.
  costUsd?: number;
}>;

// Fire-and-forget, exactly like recordUsageEvent: analytics must never fail an officer's
// run. A no-op when nothing was used, so a job that skipped a service writes no row.
export function recordServiceUsage(
  client: SupabaseClient,
  usage: NewServiceUsage,
): void {
  if (usage.calls <= 0 && usage.units <= 0) return;
  recordUsageEvent(client, {
    feature: usage.feature,
    action: serviceAction(usage.service),
    // `count` carries the invocations and `charCount` the units — the two integer columns
    // 0043 already has. Units are rounded because both columns are integers; a sub-unit
    // read (a fraction of a second of audio) rounds to zero and is simply not worth a row.
    count: usage.calls,
    charCount: Math.round(usage.units),
    detail: {
      provider: usage.provider,
      // Stored to 6 decimals: a single short call can be a fraction of a cent, and
      // truncating it to a rupee would make a busy month sum to nothing.
      costUsd: Math.round((usage.costUsd ?? 0) * 1_000_000) / 1_000_000,
    },
  });
}

// Every event in a window, newest first. Read by the analytics aggregator, which groups in
// Node; there is no server-side group-by here on purpose, so the page works against a plain
// table with no SQL functions to keep in sync.
//
// A read failure is the CALLER's to handle: unlike the write above, returning an empty array
// silently would report "nobody used /proofread" rather than "this could not be read".
export async function listUsageEvents(
  client: SupabaseClient,
  from: string,
  to: string,
  limit = 100_000,
): Promise<UsageEventRow[]> {
  const pageSize = 1_000;
  const data: Array<{
    feature: string;
    action: string;
    char_count: number | null;
    count: number | null;
    detail: Record<string, unknown> | null;
    created_at: string;
  }> = [];
  for (let offset = 0; offset < limit; offset += pageSize) {
    const { data: page, error } = await client
      .from(USAGE_EVENTS_TABLE)
      .select('feature,action,char_count,count,detail,created_at')
      .gte('created_at', from)
      .lt('created_at', to)
      .order('created_at', { ascending: false })
      .range(offset, Math.min(offset + pageSize - 1, limit - 1));
    if (error) {
      throw new Error(`Failed to list usage events: ${error.message}`);
    }
    const rows = (page ?? []) as unknown as typeof data;
    data.push(...rows);
    if (rows.length < pageSize) break;
  }
  return data.map((row) => ({
    feature: row.feature,
    action: row.action,
    charCount: row.char_count ?? 0,
    count: row.count ?? 1,
    detail: row.detail ?? {},
    createdAt: row.created_at,
  }));
}
