// Generation API routes. Thin handlers only: Zod-parse the request with the shared
// schemas, read/write rows via @dgipr/database, and hand real work to jobs/runner.

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  getGeneration,
  getReferenceImageRow,
  getReferenceTypeRow,
  insertGeneration,
  insertRevision,
  listGenerations,
  listRevisions,
  publicUrl,
  downloadPng,
  uploadPng,
  updateGeneration,
  type GenerationRow,
  type SupabaseClient,
} from '@dgipr/database';
import { generateArticlePoster } from '@dgipr/poster-renderer';
import {
  ArticleFeedbackRequestSchema,
  CopySchema,
  CreateGenerationRequestSchema,
  FiveWOneHSchema,
  GenerationStepSchema,
  PosterFeedbackRequestSchema,
  PosterImageFeedbackRequestSchema,
  UpdateCopyRequestSchema,
  type GenerationDetail,
  type GenerationStep,
  type GenerationSummary,
} from '@dgipr/schemas';
import {
  getTranslateError,
  isJobRunning,
  isTranslating,
  startArticleFeedbackJob,
  startGenerationJob,
  startPosterFeedbackJob,
  startPosterImageFeedbackJob,
  startSocialPostJob,
  startTranslateJob,
} from '../jobs/runner.js';

// Stage ping n8n POSTs to /generations/:id/progress after each social-post stage.
const ProgressPingSchema = z.object({ step: GenerationStepSchema });

// First non-empty line of the article, as a headline for history cards.
function articleHeadline(article: string | null): string | null {
  if (!article) return null;
  const line = article
    .split('\n')
    .map((l) => l.replace(/^#+\s*/, '').trim())
    .find((l) => l.length > 0);
  return line ?? null;
}

function toSummary(
  client: SupabaseClient,
  row: GenerationRow,
): GenerationSummary {
  const copy = CopySchema.safeParse(row.copy);
  const copyHeadline = copy.success
    ? ((copy.data as { headline?: string }).headline ?? null)
    : null;
  return {
    id: row.id,
    createdAt: row.createdAt,
    outputType: row.outputType,
    category: row.category,
    status: row.status,
    step: (row.step as GenerationStep | null) ?? null,
    noteExcerpt: row.note.slice(0, 160),
    headline: copyHeadline ?? articleHeadline(row.article),
    posterUrl: row.posterPath ? publicUrl(client, row.posterPath) : null,
    costUsd: row.costUsd,
  };
}

async function toDetail(
  client: SupabaseClient,
  row: GenerationRow,
): Promise<GenerationDetail> {
  const revisions = await listRevisions(client, row.id);
  const copy = CopySchema.safeParse(row.copy);
  const fiveWOneH = FiveWOneHSchema.safeParse(row.fiveWOneH);
  return {
    id: row.id,
    status: row.status,
    step: (row.step as GenerationStep | null) ?? null,
    outputType: row.outputType,
    category: row.category,
    designMode: row.designMode,
    heading: row.heading,
    referenceImageId: row.referenceImageId,
    referenceTypeId: row.referenceTypeId,
    note: row.note,
    article: row.article,
    articleEnglish: row.articleEnglish,
    factCheck: row.factCheck,
    copy: copy.success ? copy.data : null,
    fiveWOneH: fiveWOneH.success ? fiveWOneH.data : null,
    posterUrl: row.posterPath ? publicUrl(client, row.posterPath) : null,
    sceneUrl: row.scenePath ? publicUrl(client, row.scenePath) : null,
    error: row.error,
    // Translation runs beside the main job, so its state lives in the runner's
    // in-process registry rather than on the row (see startTranslateJob).
    translating: isTranslating(row.id),
    translateError: getTranslateError(row.id),
    costUsd: row.costUsd,
    costBreakdown: row.costBreakdown ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    revisions: revisions.map((revision) => ({
      id: revision.id,
      target: revision.target,
      feedback: revision.feedback,
      createdAt: revision.createdAt,
    })),
  };
}

export function registerGenerationRoutes(
  app: FastifyInstance,
  client: SupabaseClient,
): void {
  app.post('/generations', async (request, reply) => {
    const body = CreateGenerationRequestSchema.parse(request.body);
    // Twitter runs always need a design mode; default to 'onbrand' when absent.
    const designMode =
      body.category === 'twitter'
        ? (body.designMode ?? 'onbrand')
        : body.designMode;
    // Optional pin: must reference an existing library image of the matching
    // category (twitter↔twitter, news/scheme↔article), and only for runs that
    // actually render a poster.
    if (body.referenceImageId) {
      if (body.category !== 'twitter' && body.outputType === 'article') {
        return reply.code(400).send({
          error: {
            message:
              'A reference image cannot be pinned for an article-only run.',
          },
        });
      }
      const image = await getReferenceImageRow(client, body.referenceImageId);
      const expectedCategory =
        body.category === 'twitter' ? 'twitter' : 'article';
      if (!image || image.category !== expectedCategory) {
        return reply.code(400).send({
          error: { message: 'Unknown or mismatched reference image.' },
        });
      }
    }
    if (body.referenceTypeId) {
      if (body.category !== 'twitter') {
        return reply.code(400).send({
          error: {
            message: 'A reference type can only be pinned for a Twitter run.',
          },
        });
      }
      const type = await getReferenceTypeRow(client, body.referenceTypeId);
      if (!type || type.category !== 'twitter') {
        return reply.code(400).send({
          error: { message: 'Unknown or mismatched reference type.' },
        });
      }
    }
    const row = await insertGeneration(client, {
      note: body.note,
      outputType: body.outputType,
      category: body.category,
      designMode,
      heading: body.heading,
      referenceImageId: body.referenceImageId,
      referenceTypeId: body.referenceTypeId,
    });
    // Twitter → external n8n social-post job; news/scheme → in-process article pipeline.
    if (row.category === 'twitter') {
      startSocialPostJob(client, row.id);
    } else {
      startGenerationJob(client, row.id);
    }
    return reply.code(202).send({ id: row.id });
  });

  // Stage progress ping from n8n (fire-and-forget). Thin: advance the row's step only
  // while it is still running, so late/duplicate pings after completion are ignored.
  app.post<{ Params: { id: string } }>(
    '/generations/:id/progress',
    async (request, reply) => {
      const { step } = ProgressPingSchema.parse(request.body);
      const row = await getGeneration(client, request.params.id);
      if (row && row.status === 'running') {
        await updateGeneration(client, request.params.id, { step });
      }
      return reply.code(204).send();
    },
  );

  app.get('/generations', async () => {
    // Cap at 100 so the client-side history search/pagination has more to work with.
    const rows = await listGenerations(client, 100);
    return rows.map((row) => toSummary(client, row));
  });

  app.get<{ Params: { id: string } }>(
    '/generations/:id',
    async (request, reply) => {
      const row = await getGeneration(client, request.params.id);
      if (!row) {
        return reply
          .code(404)
          .send({ error: { message: 'Generation not found.' } });
      }
      // Orphan check: a row stuck in queued/running whose job is not in this
      // process died with a previous server; fail it so the UI stops spinning.
      if (
        (row.status === 'queued' || row.status === 'running') &&
        !isJobRunning(row.id)
      ) {
        await updateGeneration(client, row.id, {
          status: 'failed',
          error: 'Server restarted while this job was running.',
        });
        return toDetail(client, {
          ...row,
          status: 'failed',
          error: 'Server restarted while this job was running.',
        });
      }
      return toDetail(client, row);
    },
  );

  app.post<{ Params: { id: string } }>(
    '/generations/:id/article/feedback',
    async (request, reply) => {
      const body = ArticleFeedbackRequestSchema.parse(request.body);
      const row = await getGeneration(client, request.params.id);
      if (!row) {
        return reply
          .code(404)
          .send({ error: { message: 'Generation not found.' } });
      }
      if (isJobRunning(row.id)) {
        return reply
          .code(409)
          .send({ error: { message: 'A job is already running.' } });
      }
      if (!row.article) {
        return reply
          .code(409)
          .send({ error: { message: 'No article to revise yet.' } });
      }
      // Flip to running BEFORE returning so the client's immediate refresh sees
      // the transition and keeps polling; the detached job would otherwise set
      // running a beat later, letting a racing poll read stale 'completed' and
      // stop polling (the revised result then never loads without a reload).
      await updateGeneration(client, row.id, {
        status: 'running',
        step: 'revise_article',
        error: null,
      });
      startArticleFeedbackJob(client, row.id, body.feedback);
      return reply.code(202).send({});
    },
  );

  // On-demand English translation. Unlike the other jobs this one may run while the
  // main job is still going — the article is persisted before the poster phase, so
  // the UI offers Translate as soon as the article appears rather than making the
  // user wait out the poster render. It never touches status/step, so there is no
  // transition to flip here; the detail payload's `translating` flag keeps the client
  // polling. Re-translatable (e.g. after a glossary correction), so the only guards
  // are: an article must exist, one translation at a time, and not while a revision
  // is rewriting the very article we would translate.
  app.post<{ Params: { id: string } }>(
    '/generations/:id/translate',
    async (request, reply) => {
      const row = await getGeneration(client, request.params.id);
      if (!row) {
        return reply
          .code(404)
          .send({ error: { message: 'Generation not found.' } });
      }
      if (!row.article) {
        return reply
          .code(409)
          .send({ error: { message: 'No article to translate yet.' } });
      }
      if (isTranslating(row.id)) {
        return reply
          .code(409)
          .send({ error: { message: 'A translation is already running.' } });
      }
      if (isJobRunning(row.id) && row.step === 'revise_article') {
        return reply
          .code(409)
          .send({ error: { message: 'The article is being revised.' } });
      }
      startTranslateJob(client, row.id);
      return reply.code(202).send({});
    },
  );

  app.post<{ Params: { id: string } }>(
    '/generations/:id/poster/feedback',
    async (request, reply) => {
      const body = PosterFeedbackRequestSchema.parse(request.body);
      const row = await getGeneration(client, request.params.id);
      if (!row) {
        return reply
          .code(404)
          .send({ error: { message: 'Generation not found.' } });
      }
      if (isJobRunning(row.id)) {
        return reply
          .code(409)
          .send({ error: { message: 'A job is already running.' } });
      }
      if (!row.posterPath) {
        return reply
          .code(409)
          .send({ error: { message: 'No poster to revise yet.' } });
      }
      // Flip to running BEFORE returning so the client's immediate refresh sees
      // the transition and keeps polling; the detached job would otherwise set
      // running a beat later, letting a racing poll read stale 'completed' and
      // stop polling (the new poster then never loads without a reload).
      await updateGeneration(client, row.id, {
        status: 'running',
        step: body.target === 'copy' ? 'revise_copy' : 'revise_scene',
        error: null,
      });
      startPosterFeedbackJob(client, row.id, body.target, body.feedback);
      return reply.code(202).send({});
    },
  );

  // Edit the latest complete poster through the relevant n8n image-edit
  // workflow. This is separate from the legacy scenePath-bound copy/scene route
  // above and therefore works for article n8n posters and Twitter posters.
  app.post<{ Params: { id: string } }>(
    '/generations/:id/poster/image-feedback',
    async (request, reply) => {
      const body = PosterImageFeedbackRequestSchema.parse(request.body);
      const row = await getGeneration(client, request.params.id);
      if (!row) {
        return reply
          .code(404)
          .send({ error: { message: 'Generation not found.' } });
      }
      if (isJobRunning(row.id)) {
        return reply
          .code(409)
          .send({ error: { message: 'A job is already running.' } });
      }
      if (!row.posterPath) {
        return reply
          .code(409)
          .send({ error: { message: 'No poster to revise yet.' } });
      }

      // Persist the transition before returning so the first client poll cannot
      // observe a stale completed row and stop before the new poster is stored.
      await updateGeneration(client, row.id, {
        status: 'running',
        step: 'revise_image',
        error: null,
      });
      startPosterImageFeedbackJob(client, row.id, body.feedback);
      return reply.code(202).send({});
    },
  );

  // Manual poster text edit: re-typeset with the CACHED scene image and return the
  // new poster URL synchronously (~seconds; no image-generation call).
  app.put<{ Params: { id: string } }>(
    '/generations/:id/poster/copy',
    async (request, reply) => {
      const editedCopy = UpdateCopyRequestSchema.parse(request.body);
      const row = await getGeneration(client, request.params.id);
      if (!row) {
        return reply
          .code(404)
          .send({ error: { message: 'Generation not found.' } });
      }
      if (isJobRunning(row.id)) {
        return reply
          .code(409)
          .send({ error: { message: 'A job is already running.' } });
      }
      if (!row.scenePath) {
        return reply
          .code(409)
          .send({ error: { message: 'No poster to edit yet.' } });
      }

      const sceneImage = await downloadPng(client, row.scenePath);
      const poster = await generateArticlePoster({
        copy: editedCopy,
        sceneImage,
      });

      const revisions = await listRevisions(client, row.id);
      const version = revisions.length + 2;
      const posterObjectPath = `generations/${row.id}/poster-v${version}.png`;
      await uploadPng(client, posterObjectPath, poster.png);

      await updateGeneration(client, row.id, {
        copy: editedCopy,
        posterPath: posterObjectPath,
      });
      await insertRevision(client, {
        generationId: row.id,
        target: 'manual_copy',
        copy: editedCopy,
        posterPath: posterObjectPath,
      });

      return reply.send({ posterUrl: publicUrl(client, posterObjectPath) });
    },
  );

  // Download proxy: the HTML `download` attribute is ignored cross-origin, so the
  // frontend cannot force a download from the storage URL directly.
  app.get<{ Params: { id: string } }>(
    '/generations/:id/poster.png',
    async (request, reply) => {
      const row = await getGeneration(client, request.params.id);
      if (!row?.posterPath) {
        return reply
          .code(404)
          .send({ error: { message: 'Poster not found.' } });
      }
      const png = await downloadPng(client, row.posterPath);
      return reply
        .header('content-type', 'image/png')
        .header(
          'content-disposition',
          `attachment; filename="dgipr-poster-${row.id}.png"`,
        )
        .send(png);
    },
  );
}
