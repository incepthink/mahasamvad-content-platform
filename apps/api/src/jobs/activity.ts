// Aggregation behind the hidden /activity page. Read-only and derived per request from
// `activity_events` (0058) — there is no rollup table, the analytics.ts stance.
//
// Day boundaries are Indian (ANALYTICS_TIME_ZONE, a fixed +05:30 with no DST), and every
// window is half-open [from, to) with `to` the start of the NEXT day, so "today" includes now.

import {
  listActivityEvents,
  listActivityWindow,
  type ActivityFilters,
  type SupabaseClient,
} from '@dgipr/database';
import {
  ACTIVITY_PAGE_DEFAULT,
  ANALYTICS_TIME_ZONE,
  type ActivityActorResponse,
  type ActivityListResponse,
  type ActivityQuery,
  type ActivitySummaryResponse,
} from '@dgipr/schemas';

// Asia/Kolkata has no daylight saving, so a calendar day there is always this offset.
const IST_OFFSET = '+05:30';

export function todayInIndia(now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ANALYTICS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function dayStartIso(day: string): string {
  return new Date(`${day}T00:00:00${IST_OFFSET}`).toISOString();
}

export function nextDayStartIso(day: string): string {
  const start = new Date(`${day}T00:00:00${IST_OFFSET}`);
  return new Date(start.getTime() + 24 * 60 * 60 * 1000).toISOString();
}

function filtersOf(query: ActivityQuery): ActivityFilters {
  return {
    ip: query.ip,
    deviceId: query.device,
    feature: query.feature,
    status: query.status,
    from: query.from ? dayStartIso(query.from) : undefined,
    to: query.to ? nextDayStartIso(query.to) : undefined,
  };
}

export async function activityFeed(
  client: SupabaseClient,
  query: ActivityQuery,
): Promise<ActivityListResponse> {
  const { events, nextCursor } = await listActivityEvents(
    client,
    filtersOf(query),
    query.cursor ?? null,
    query.limit ?? ACTIVITY_PAGE_DEFAULT,
  );
  return { events, nextCursor };
}

function counted(
  map: Map<string, number>,
): Array<{ key: string; count: number }> {
  return [...map.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

function bump(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

export async function activitySummaryFor(
  client: SupabaseClient,
  day: string,
): Promise<ActivitySummaryResponse> {
  const rows = await listActivityWindow(client, {
    from: dayStartIso(day),
    to: nextDayStartIso(day),
  });

  const ips = new Map<
    string,
    { actions: number; devices: Set<string>; lastAt: string }
  >();
  const devices = new Set<string>();
  const byFeature = new Map<string, number>();
  const byStatus = new Map<string, number>();
  let failed = 0;
  let inProgress = 0;

  for (const row of rows) {
    bump(byFeature, row.feature);
    bump(byStatus, row.status);
    if (row.status === 'failed') failed += 1;
    if (row.status === 'in_progress') inProgress += 1;
    if (row.deviceId) devices.add(row.deviceId);
    const entry = ips.get(row.ip) ?? {
      actions: 0,
      devices: new Set<string>(),
      lastAt: row.createdAt,
    };
    entry.actions += 1;
    if (row.deviceId) entry.devices.add(row.deviceId);
    if (row.createdAt > entry.lastAt) entry.lastAt = row.createdAt;
    ips.set(row.ip, entry);
  }

  const busiestIps = [...ips.entries()]
    .map(([ip, entry]) => ({
      ip,
      actions: entry.actions,
      devices: entry.devices.size,
      lastAt: entry.lastAt,
    }))
    .sort((a, b) => b.actions - a.actions || b.lastAt.localeCompare(a.lastAt))
    .slice(0, 10);

  return {
    day,
    activeIps: ips.size,
    devices: devices.size,
    actions: rows.length,
    failed,
    inProgress,
    byFeature: counted(byFeature),
    byStatus: counted(byStatus),
    busiestIps,
  };
}

// The journey header for one IP or one device: first/last seen, and who else it touched.
export async function activityActor(
  client: SupabaseClient,
  target: { ip?: string | undefined; deviceId?: string | undefined },
): Promise<ActivityActorResponse> {
  const rows = await listActivityWindow(client, {
    ip: target.ip,
    deviceId: target.deviceId,
  });

  const devices = new Map<
    string,
    {
      deviceId: string | null;
      userAgent: string | null;
      actions: number;
      lastAt: string;
    }
  >();
  const ips = new Map<string, number>();
  let firstAt: string | null = null;
  let lastAt: string | null = null;

  for (const row of rows) {
    if (firstAt === null || row.createdAt < firstAt) firstAt = row.createdAt;
    if (lastAt === null || row.createdAt > lastAt) lastAt = row.createdAt;
    bump(ips, row.ip);
    const key = row.deviceId ?? '';
    const entry = devices.get(key) ?? {
      deviceId: row.deviceId,
      userAgent: row.userAgent,
      actions: 0,
      lastAt: row.createdAt,
    };
    entry.actions += 1;
    // Rows arrive newest first, so the first user agent seen is the latest one.
    if (row.createdAt > entry.lastAt) entry.lastAt = row.createdAt;
    devices.set(key, entry);
  }

  return {
    ip: target.ip ?? null,
    deviceId: target.deviceId ?? null,
    firstAt,
    lastAt,
    actions: rows.length,
    devices: [...devices.values()].sort((a, b) =>
      b.lastAt.localeCompare(a.lastAt),
    ),
    ips: counted(ips),
  };
}
