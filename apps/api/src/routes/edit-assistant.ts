// The poster/caption edit assistant — the conversational box that replaced the
// "AI ला सूचना द्या" fold. Thin, like every route here: decide what this card may do from the
// row and the in-process job registries, hand the conversation to the engine's planner, and
// return its plan. It EXECUTES NOTHING. The web carries a plan out through the existing
// caption-feedback / caption-generate / poster image-feedback / poster regenerate routes, so
// each of their guards, activity rows and jobs applies exactly as it did from the fold.
//
// Synchronous and stateless: the conversation lives in the browser and arrives in full on
// every turn. The one planning call is metered to the generation and to /analytics.

import type { FastifyInstance } from 'fastify';
import { getGeneration, type SupabaseClient } from '@dgipr/database';
import {
  createCostAccumulator,
  planEditRequest,
  runInCostScope,
  runInCostTask,
  type EditAssistantContext,
  type EditAssistantLane,
} from '@dgipr/content-engine';
import {
  EditAssistantRequestSchema,
  carriesSocialCaption,
  isArticleCategory,
  isCarouselCategory,
  isSocialCategory,
  isYoutubeCategory,
  type Category,
  type EditAssistantSurface,
} from '@dgipr/schemas';
import {
  isJobRunning,
  isRevisingCaption,
  persistCost,
} from '../jobs/runner.js';
import { recordTasksFromCost } from '../jobs/service-usage.js';

function laneOf(category: Category): EditAssistantLane | null {
  if (isSocialCategory(category)) return 'social';
  if (isCarouselCategory(category)) return 'carousel';
  if (isYoutubeCategory(category)) return 'thumbnail';
  if (isArticleCategory(category)) return 'article';
  return null;
}

// Which surfaces a lane can host — a mismatch is a client bug, answered in Marathi.
function surfaceFits(
  surface: EditAssistantSurface,
  lane: EditAssistantLane,
): boolean {
  if (surface === 'social') return lane === 'social';
  if (surface === 'caption') return lane === 'social' || lane === 'carousel';
  return lane === 'article' || lane === 'thumbnail';
}

export function registerEditAssistantRoutes(
  app: FastifyInstance,
  client: SupabaseClient,
): void {
  app.post<{ Params: { id: string } }>(
    '/generations/:id/assist',
    async (request, reply) => {
      const body = EditAssistantRequestSchema.parse(request.body);
      const row = await getGeneration(client, request.params.id);
      if (!row) {
        return reply
          .code(404)
          .send({ error: { message: 'हे काम सापडले नाही.' } });
      }
      const lane = laneOf(row.category);
      if (!lane || !surfaceFits(body.surface, lane)) {
        return reply.code(400).send({
          error: { message: 'या कामासाठी येथून बदल सांगता येत नाहीत.' },
        });
      }

      const captionSurface =
        body.surface !== 'poster' && carriesSocialCaption(row.category);
      // A carousel's slides are edited on the slides; this box only reaches its caption.
      const posterSurface =
        body.surface !== 'caption' &&
        row.posterPath !== null &&
        !isCarouselCategory(row.category);
      const articleLane = lane === 'article';

      const context: EditAssistantContext = {
        lane,
        note: row.note,
        caption: captionSurface ? row.article : null,
        posterHeading: articleLane ? row.posterHeading : null,
        can: {
          reviseCaption: captionSurface && row.article !== null,
          // Same condition the generate route enforces: a settled run with no caption.
          generateCaption:
            captionSurface &&
            row.article === null &&
            row.status === 'completed',
          editPoster: posterSurface,
          // An article poster is re-derived from the article, so it needs one.
          redesignPoster:
            posterSurface && (!articleLane || row.article !== null),
          changeHeading: posterSurface && articleLane && row.article !== null,
        },
        busy: {
          caption: isRevisingCaption(row.id),
          poster:
            isJobRunning(row.id) ||
            row.status === 'running' ||
            row.status === 'queued',
        },
        // The route only needs to know how many marks there are and what is already written
        // beside them; the positions never leave the browser.
        markers: posterSurface ? body.markers : [],
        clearRegions: posterSurface ? body.clearRegions : [],
      };

      const cost = createCostAccumulator();
      const plan = await runInCostScope(cost, () =>
        runInCostTask('edit_assistant', () =>
          planEditRequest(context, body.messages),
        ),
      );
      recordTasksFromCost(
        client,
        lane === 'social' || lane === 'carousel' ? 'social' : 'article',
        cost,
      );
      // Best-effort: a metering write must never fail the officer's turn.
      void persistCost(client, row.id, cost).catch((error: unknown) => {
        request.log.warn({ err: error }, 'edit assistant cost write failed');
      });
      return plan;
    },
  );
}
