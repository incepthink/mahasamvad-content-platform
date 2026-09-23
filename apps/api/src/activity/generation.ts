// /activity helpers for the `generations` family — the routes in routes/generations.ts and
// routes/dlo.ts that start, edit, export or publish a run.
//
// A generation's feature is decided by its lineage, not its category, exactly as /analytics
// splits them: a row that came from a /dlo intake is article work, everything else is
// क्रिएटिव्ह आणि सोशल.

import type { FastifyRequest } from 'fastify';
import type { GenerationRow, SupabaseClient } from '@dgipr/database';
import {
  activitySummary,
  firstLine,
  isDynamicPosterCategory,
  isSocialCategory,
  isYoutubeCategory,
  type ActivityAction,
  type ActivityStatus,
  type Category,
} from '@dgipr/schemas';
import { shortError, trackActivity } from './actor.js';

type GenerationLike = Pick<
  GenerationRow,
  | 'id'
  | 'category'
  | 'dloIntakeId'
  | 'heading'
  | 'posterHeading'
  | 'note'
  | 'outputType'
>;

// The task key the job a fresh run starts under — the same key runJob settles with.
export function generationJobTask(category: Category): ActivityAction {
  if (isSocialCategory(category)) return 'social_post_creation';
  if (isYoutubeCategory(category)) return 'youtube_thumbnail_creation';
  if (isDynamicPosterCategory(category)) return 'dynamic_poster_creation';
  return 'article_generation';
}

export function generationSummary(row: GenerationLike): string | null {
  return activitySummary(row.heading, row.posterHeading, firstLine(row.note));
}

export function trackGenerationActivity(
  client: SupabaseClient,
  request: FastifyRequest,
  row: GenerationLike,
  action: ActivityAction,
  options: {
    status?: ActivityStatus;
    summary?: string | null;
    detail?: Record<string, string | number | boolean | null>;
    error?: unknown;
  } = {},
): void {
  const status = options.status ?? 'in_progress';
  trackActivity(client, request, {
    feature: row.dloIntakeId ? 'dlo' : 'creative',
    action,
    status,
    subject: { kind: 'generation', id: row.id },
    summary:
      options.summary === undefined ? generationSummary(row) : options.summary,
    detail: {
      category: row.category,
      ...(isSocialCategory(row.category) && row.outputType === 'article'
        ? { captionOnly: true }
        : {}),
      ...(options.detail ?? {}),
    },
    error: status === 'failed' ? shortError(options.error) : null,
  });
}
