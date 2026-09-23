// The ACTOR behind a request — for the /activity audit log, and for nothing else.
//
// There is no login and there must not be one, so "who" is:
//   * the IP as the ONE trusted proxy (Caddy) observed it — `trustProxy: 1` in index.ts, so a
//     client-supplied X-Forwarded-For prefix is ignored rather than believed;
//   * the browser-scoped device id apps/web sends as `x-dgipr-device` (or `?device=` on a
//     plain navigation, which cannot set a header), validated against a strict pattern so it
//     is never stored as free text;
//   * the user agent, truncated by the writer.
//
// NONE OF THIS IS AUTH. Nothing here grants, filters or refuses anything; a request with no
// device id is served exactly like one with. The hook is wrapped so that it can never reject a
// request, whatever arrives.

import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  recordActivity,
  settleActivity,
  type ActivityActor,
  type NewActivityEvent,
  type SupabaseClient,
} from '@dgipr/database';
import {
  DEVICE_HEADER,
  DEVICE_QUERY_PARAM,
  isDeviceId,
  type ActivityAction,
  type ActivityFeature,
  type ActivitySubject,
} from '@dgipr/schemas';

declare module 'fastify' {
  interface FastifyRequest {
    activityActor?: ActivityActor;
  }
}

function headerValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return typeof value === 'string' ? value : null;
}

export function resolveActor(request: FastifyRequest): ActivityActor {
  let deviceId: string | null = null;
  const fromHeader = headerValue(request.headers[DEVICE_HEADER]);
  if (isDeviceId(fromHeader)) {
    deviceId = fromHeader;
  } else {
    const query = request.query as Record<string, unknown> | undefined;
    const fromQuery = query?.[DEVICE_QUERY_PARAM];
    if (isDeviceId(fromQuery)) deviceId = fromQuery;
  }
  return {
    ip: request.ip || 'unknown',
    deviceId,
    userAgent: headerValue(request.headers['user-agent']),
  };
}

// Registered inside the /api plugin scope, so /health gets no actor and pays nothing.
export function registerActorHook(instance: FastifyInstance): void {
  instance.addHook('onRequest', async (request) => {
    try {
      request.activityActor = resolveActor(request);
    } catch (error) {
      request.log.warn({ err: error }, 'could not resolve activity actor');
    }
  });
}

export function actorOf(request: FastifyRequest): ActivityActor {
  if (request.activityActor) return request.activityActor;
  try {
    return resolveActor(request);
  } catch {
    return { ip: 'unknown', deviceId: null, userAgent: null };
  }
}

export type TrackedActivity = Omit<
  NewActivityEvent,
  'feature' | 'action' | 'subject'
> & {
  feature: ActivityFeature;
  action: ActivityAction;
  subject?: ActivitySubject | null;
};

// The one call a route makes. Fire-and-forget; never throws.
export function trackActivity(
  client: SupabaseClient,
  request: FastifyRequest,
  event: TrackedActivity,
): void {
  try {
    recordActivity(client, actorOf(request), event);
  } catch (error) {
    request.log.warn({ err: error }, 'could not record activity');
  }
}

// What a finished job calls. Typed on the action vocabulary so a job cannot settle a key no
// route ever opens.
export function settleJobActivity(
  client: SupabaseClient,
  subject: ActivitySubject,
  action: ActivityAction,
  status: 'success' | 'failed',
  error?: unknown,
): void {
  settleActivity(
    client,
    subject,
    action,
    status,
    status === 'failed' ? shortError(error) : null,
  );
}

export function shortError(error: unknown): string | null {
  if (error === undefined || error === null) return null;
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : null;
  if (!message) return null;
  return message.replace(/\s+/g, ' ').trim().slice(0, 300) || null;
}
