// The hidden /activity page's API: a paged feed, the day's KPIs, and one actor's journey
// header. Thin per AGENTS.md — parse, delegate to jobs/activity.ts.
//
// OPEN TO ANYONE WITH THE URL, by the product decision that there is no login and no PIN.
// It exposes IPs and short summaries; an unlinked page is obscurity, not protection. A shared
// key set in the environment is the one-line follow-up if that ever matters.
//
// Not instrumented itself: reading the log is not an action worth logging.

import type { FastifyInstance } from 'fastify';
import type { SupabaseClient } from '@dgipr/database';
import { ActivityQuerySchema, isDeviceId } from '@dgipr/schemas';
import {
  activityActor,
  activityFeed,
  activitySummaryFor,
  todayInIndia,
} from '../jobs/activity.js';

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function registerActivityRoutes(
  app: FastifyInstance,
  client: SupabaseClient,
): void {
  app.get('/activity', async (request, reply) => {
    const parsed = ActivityQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: { message: 'शोधाचे निकष वैध नाहीत.' } });
    }
    reply.header('cache-control', 'no-store');
    return activityFeed(client, parsed.data);
  });

  app.get<{ Querystring: { day?: string } }>(
    '/activity/summary',
    async (request, reply) => {
      const day = request.query.day ?? todayInIndia();
      if (!DAY_PATTERN.test(day) || Number.isNaN(Date.parse(day))) {
        return reply.code(400).send({ error: { message: 'दिवस वैध नाही.' } });
      }
      reply.header('cache-control', 'no-store');
      return activitySummaryFor(client, day);
    },
  );

  app.get<{ Querystring: { ip?: string; device?: string } }>(
    '/activity/actor',
    async (request, reply) => {
      const ip = request.query.ip?.trim() || undefined;
      const device = request.query.device?.trim() || undefined;
      if ((!ip && !device) || (ip && ip.length > 64)) {
        return reply
          .code(400)
          .send({ error: { message: 'IP किंवा उपकरण निवडा.' } });
      }
      if (device && !isDeviceId(device)) {
        return reply
          .code(400)
          .send({ error: { message: 'उपकरण ओळख वैध नाही.' } });
      }
      reply.header('cache-control', 'no-store');
      return activityActor(client, { ip, deviceId: device });
    },
  );
}
