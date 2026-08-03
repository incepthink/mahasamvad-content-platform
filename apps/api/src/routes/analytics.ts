// Analytics API. One GET, one query parameter — the whole page and all six drill-downs are
// served from a single payload so the landing figures and a feature's own page can never
// disagree. Thin per AGENTS.md: parse the range, delegate to jobs/analytics.ts.
//
// Read-only, and it writes nothing: every number is derived from rows the product already
// keeps. There is no rollup table to refresh and no backfill to run.

import type { FastifyInstance } from 'fastify';
import type { SupabaseClient } from '@dgipr/database';
import {
  ANALYTICS_DEFAULT_RANGE,
  AnalyticsRangeSchema,
  type AnalyticsRange,
} from '@dgipr/schemas';
import { buildAnalytics } from '../jobs/analytics.js';

export function registerAnalyticsRoutes(
  app: FastifyInstance,
  client: SupabaseClient,
): void {
  app.get<{ Querystring: { range?: string } }>(
    '/analytics',
    async (request, reply) => {
      const parsed = AnalyticsRangeSchema.safeParse(
        request.query.range ?? ANALYTICS_DEFAULT_RANGE,
      );
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: { message: 'कालावधी वैध नाही.' } });
      }
      const range: AnalyticsRange = parsed.data;
      // Aggregating a quarter takes a few hundred milliseconds and the numbers move with every
      // run, so the response is explicitly not cached — a stale dashboard in a live demo is
      // worse than a slightly slower one.
      reply.header('cache-control', 'no-store');
      return buildAnalytics(client, range);
    },
  );
}
