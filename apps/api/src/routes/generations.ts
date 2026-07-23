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
  listThreadGenerations,
  publicUrl,
  downloadPng,
  uploadPng,
  updateGeneration,
  type GenerationRow,
  type SupabaseClient,
} from '@dgipr/database';
import { generateArticlePoster } from '@dgipr/poster-renderer';
import {
  SocialPublishError,
  publishFacebookPhotoPost,
  publishTweet,
  type PublishResult,
} from '@dgipr/social-publisher';
import {
  ArticleFeedbackRequestSchema,
  CaptionFeedbackRequestSchema,
  CopySchema,
  CreateArticlePosterRequestSchema,
  CreateGenerationRequestSchema,
  FiveWOneHSchema,
  GenerationStepSchema,
  PosterFeedbackRequestSchema,
  PosterImageFeedbackRequestSchema,
  TWEET_MAX_LENGTH,
  TranslateGenerationRequestSchema,
  UpdateCaptionRequestSchema,
  UpdateCopyRequestSchema,
  isSocialCategory,
  tweetWeightedLength,
  type GenerationDetail,
  type GenerationStep,
  type GenerationSummary,
  type ThreadItem,
} from '@dgipr/schemas';
import {
  getCaptionReviseError,
  getReviseArticleError,
  getTranslateError,
  getTranslateWarnings,
  getTranslatingLanguage,
  isJobRunning,
  isRevisingArticle,
  isRevisingCaption,
  isTranslating,
  startArticleFeedbackJob,
  startArticlePosterJob,
  startCaptionFeedbackJob,
  startConcurrentArticleFeedbackJob,
  startGenerationJob,
  startPosterFeedbackJob,
  startPosterImageFeedbackJob,
  startSocialPostJob,
  startTranslateJob,
} from '../jobs/runner.js';
import { prepareTranslationTerms } from '../jobs/translation-terms.js';

// Stage ping n8n POSTs to /generations/:id/progress after each social-post stage.
const ProgressPingSchema = z.object({ step: GenerationStepSchema });

// In-flight publish guard: posting to the official account is irreversible, so a
// double click must never produce two live posts. In-process only (like the
// runner's job registry) — resets on restart, fine for a seconds-long call.
const publishing = new Set<string>();

// Official-account credentials, read from env at point of use (repo pattern).
// Empty/missing values → null so the route can 503 with a setup message.
function twitterCredentialsFromEnv(): {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessSecret: string;
} | null {
  const apiKey = process.env.TWITTER_API_KEY?.trim();
  const apiSecret = process.env.TWITTER_API_SECRET?.trim();
  const accessToken = process.env.TWITTER_ACCESS_TOKEN?.trim();
  const accessSecret = process.env.TWITTER_ACCESS_SECRET?.trim();
  if (!apiKey || !apiSecret || !accessToken || !accessSecret) return null;
  return { apiKey, apiSecret, accessToken, accessSecret };
}

function facebookCredentialsFromEnv(): {
  pageId: string;
  accessToken: string;
} | null {
  const pageId = process.env.FACEBOOK_PAGE_ID?.trim();
  const accessToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN?.trim();
  if (!pageId || !accessToken) return null;
  return { pageId, accessToken };
}

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
  // Every poster render, oldest→newest. Renders are immutable versioned PNGs:
  // the original is always poster-v1 (its path is deterministic — the row's
  // posterPath moves on with each revision, but v1 must have existed for any
  // poster to exist), later versions are the poster-bearing revision snapshots.
  const posterVersions = row.posterPath
    ? [
        {
          posterUrl: publicUrl(client, `generations/${row.id}/poster-v1.png`),
          createdAt: row.createdAt,
        },
        ...revisions.flatMap((revision) =>
          revision.posterPath
            ? [
                {
                  posterUrl: publicUrl(client, revision.posterPath),
                  createdAt: revision.createdAt,
                },
              ]
            : [],
        ),
      ]
    : [];
  return {
    id: row.id,
    status: row.status,
    step: (row.step as GenerationStep | null) ?? null,
    outputType: row.outputType,
    category: row.category,
    designMode: row.designMode,
    templateBrand: row.templateBrand,
    heading: row.heading,
    referenceImageId: row.referenceImageId,
    referenceTypeId: row.referenceTypeId,
    note: row.note,
    article: row.article,
    articleEnglish: row.articleEnglish,
    articleHindi: row.articleHindi,
    factCheck: row.factCheck,
    copy: copy.success ? copy.data : null,
    fiveWOneH: fiveWOneH.success ? fiveWOneH.data : null,
    posterUrl: row.posterPath ? publicUrl(client, row.posterPath) : null,
    sceneUrl: row.scenePath ? publicUrl(client, row.scenePath) : null,
    posterVersions,
    publishedUrl: row.publishedUrl,
    publishedAt: row.publishedAt,
    error: row.error,
    // Translation runs beside the main job, so its state lives in the runner's
    // in-process registry rather than on the row (see startTranslateJob).
    translating: isTranslating(row.id),
    translatingLanguage: getTranslatingLanguage(row.id),
    translateError: getTranslateError(row.id),
    translateWarnings: getTranslateWarnings(row.id),
    // Article revision can run beside the poster render (same registry pattern as
    // translation), so its liveness/failure also come from the runner, not the row.
    articleRevising: isRevisingArticle(row.id),
    articleReviseError: getReviseArticleError(row.id),
    // A social caption revision is likewise off the row's status (it edits a settled
    // run and may overlap a poster re-render), so it reports from the same registry.
    captionRevising: isRevisingCaption(row.id),
    captionReviseError: getCaptionReviseError(row.id),
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
    // Social runs (twitter/facebook) always need a design mode; default to
    // 'onbrand' when absent.
    const designMode = isSocialCategory(body.category)
      ? (body.designMode ?? 'onbrand')
      : body.designMode;
    // Template brand is a social-only concept; force 'dgipr' for news/scheme so a
    // stray value can never route an article run into the CMO chrome branch.
    const templateBrand = isSocialCategory(body.category)
      ? (body.templateBrand ?? 'dgipr')
      : 'dgipr';
    // Optional pin: must reference an existing library image of the matching
    // category (social↔twitter library, news/scheme↔article), and only for runs
    // that actually render a poster.
    if (body.referenceImageId) {
      if (!isSocialCategory(body.category) && body.outputType === 'article') {
        return reply.code(400).send({
          error: {
            message:
              'A reference image cannot be pinned for an article-only run.',
          },
        });
      }
      const image = await getReferenceImageRow(client, body.referenceImageId);
      const expectedCategory = isSocialCategory(body.category)
        ? 'twitter'
        : 'article';
      if (!image || image.category !== expectedCategory) {
        return reply.code(400).send({
          error: { message: 'Unknown or mismatched reference image.' },
        });
      }
    }
    if (body.referenceTypeId) {
      if (!isSocialCategory(body.category)) {
        return reply.code(400).send({
          error: {
            message: 'A reference type can only be pinned for a social post.',
          },
        });
      }
      const type = await getReferenceTypeRow(client, body.referenceTypeId);
      if (!type || type.category !== 'twitter') {
        return reply.code(400).send({
          error: { message: 'Unknown or mismatched reference type.' },
        });
      }
      // The pinned type's brand must match the run's विभाग, or a CMO template would
      // render under DGIPR chrome (or vice versa).
      if (type.brand !== templateBrand) {
        return reply.code(400).send({
          error: {
            message: 'Pinned reference type does not match the selected विभाग.',
          },
        });
      }
    }
    // Lineage: a follow-up spawned from a run's detail page names its source;
    // the thread root is derived here (never client-supplied) so chains stay
    // flat under the original run.
    let threadRootId: string | undefined;
    if (body.sourceGenerationId) {
      const source = await getGeneration(client, body.sourceGenerationId);
      if (!source) {
        return reply
          .code(400)
          .send({ error: { message: 'Unknown source generation.' } });
      }
      threadRootId = source.threadRootId ?? source.id;
    }
    const row = await insertGeneration(client, {
      note: body.note,
      outputType: body.outputType,
      category: body.category,
      designMode,
      templateBrand,
      heading: body.heading,
      referenceImageId: body.referenceImageId,
      referenceTypeId: body.referenceTypeId,
      sourceGenerationId: body.sourceGenerationId,
      threadRootId,
    });
    // Twitter/Facebook → external n8n social-post job; news/scheme → in-process
    // article pipeline.
    if (isSocialCategory(row.category)) {
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

  // All runs in this generation's thread (the root + every follow-up spawned
  // from any member's detail page), oldest first. Summaries only — the detail
  // poll stays untouched; the web fetches this separately for the thread strip.
  app.get<{ Params: { id: string } }>(
    '/generations/:id/thread',
    async (request, reply) => {
      const row = await getGeneration(client, request.params.id);
      if (!row) {
        return reply
          .code(404)
          .send({ error: { message: 'Generation not found.' } });
      }
      const rootId = row.threadRootId ?? row.id;
      const members = await listThreadGenerations(client, rootId);
      const byId = new Map(members.map((m) => [m.id, m]));
      return members.map((m): ThreadItem => ({
        ...toSummary(client, m),
        sourceGenerationId: m.sourceGenerationId,
        // An edit-note rerun: the note differs from the direct source's. A
        // FK-nulled source degrades to false rather than guessing.
        noteChanged:
          m.sourceGenerationId !== null &&
          (byId.get(m.sourceGenerationId)?.note ?? m.note) !== m.note,
      }));
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
      if (!row.article) {
        return reply
          .code(409)
          .send({ error: { message: 'No article to revise yet.' } });
      }
      if (isRevisingArticle(row.id)) {
        return reply
          .code(409)
          .send({ error: { message: 'A revision is already running.' } });
      }
      // While the initial job is still in its poster phase the article is already
      // final, so refine it concurrently instead of forcing the user to wait out the
      // render. This path does NOT flip status (the poster job owns it) — its liveness
      // is reported via isRevisingArticle. Any other running state (e.g. a revise_*
      // step) still rejects, so two revisions never stack.
      if (isJobRunning(row.id)) {
        const posterPhase =
          row.status === 'running' &&
          (row.step === 'faithfulness' ||
            row.step === 'copy' ||
            row.step === 'scene' ||
            row.step === 'render');
        if (!posterPhase) {
          return reply
            .code(409)
            .send({ error: { message: 'A job is already running.' } });
        }
        startConcurrentArticleFeedbackJob(client, row.id, body.feedback);
        return reply.code(202).send({});
      }
      // Settled run: flip to running BEFORE returning so the client's immediate
      // refresh sees the transition and keeps polling; the detached job would
      // otherwise set running a beat later, letting a racing poll read stale
      // 'completed' and stop polling (the revised result then never loads without a
      // reload).
      await updateGeneration(client, row.id, {
        status: 'running',
        step: 'revise_article',
        error: null,
      });
      startArticleFeedbackJob(client, row.id, body.feedback);
      return reply.code(202).send({});
    },
  );

  // Feedback on a social run's caption. Separate from the article route above because
  // the article pipeline rejects social categories by design (articleCategoryOf throws);
  // this runs the caption editor instead. The job owns no status/step — it reports
  // through the detail payload's captionRevising — so the finished post stays on screen
  // and a poster re-render may be in flight at the same time. Guards, in order: the run
  // must be social, must already have a caption (which also excludes an initial run
  // still in flight — startSocialPostJob writes the caption last), and only one caption
  // revision at a time.
  app.post<{ Params: { id: string } }>(
    '/generations/:id/caption/feedback',
    async (request, reply) => {
      const body = CaptionFeedbackRequestSchema.parse(request.body);
      const row = await getGeneration(client, request.params.id);
      if (!row) {
        return reply
          .code(404)
          .send({ error: { message: 'Generation not found.' } });
      }
      if (!isSocialCategory(row.category)) {
        return reply.code(400).send({
          error: { message: 'Only social-post runs have a caption.' },
        });
      }
      if (!row.article) {
        return reply
          .code(409)
          .send({ error: { message: 'No caption to revise yet.' } });
      }
      if (isRevisingCaption(row.id)) {
        return reply.code(409).send({
          error: { message: 'A caption revision is already running.' },
        });
      }
      startCaptionFeedbackJob(client, row.id, body.feedback);
      return reply.code(202).send({});
    },
  );

  // Hand edit of a social run's caption: the officer typed it, so it is stored verbatim.
  // Synchronous — no model call (same shape as the manual poster-copy edit below). Same
  // guards as the feedback route, so a hand edit can't race the AI revision of the very
  // text it replaces.
  app.put<{ Params: { id: string } }>(
    '/generations/:id/caption',
    async (request, reply) => {
      const body = UpdateCaptionRequestSchema.parse(request.body);
      const row = await getGeneration(client, request.params.id);
      if (!row) {
        return reply
          .code(404)
          .send({ error: { message: 'Generation not found.' } });
      }
      if (!isSocialCategory(row.category)) {
        return reply.code(400).send({
          error: { message: 'Only social-post runs have a caption.' },
        });
      }
      if (!row.article) {
        return reply
          .code(409)
          .send({ error: { message: 'No caption to edit yet.' } });
      }
      if (isRevisingCaption(row.id)) {
        return reply.code(409).send({
          error: { message: 'A caption revision is already running.' },
        });
      }
      await updateGeneration(client, row.id, { article: body.caption });
      await insertRevision(client, {
        generationId: row.id,
        target: 'manual_caption',
        article: body.caption,
      });
      return reply.send({ caption: body.caption });
    },
  );

  // Pre-translation name check: extracts the article's proper nouns (merged with
  // glossary rows found in the text) so the user confirms/corrects the English
  // spellings BEFORE translating — the confirmed set then arrives on the translate
  // request below. Synchronous like /api/translate (one OpenAI call); errors bubble
  // to the shared error handler so the UI shows a retry rather than silently
  // translating with unchecked names.
  app.post<{ Params: { id: string } }>(
    '/generations/:id/translate/prepare',
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
      return prepareTranslationTerms(client, row.article);
    },
  );

  // On-demand translation into `language` (English or Hindi; defaults to English so an
  // older client's bare body still works). Unlike the other jobs this one may run while
  // the main job is still going — the article is persisted before the poster phase, so
  // the UI offers Translate as soon as the article appears rather than making the
  // user wait out the poster render. It never touches status/step, so there is no
  // transition to flip here; the detail payload's `translating` flag keeps the client
  // polling. Re-translatable (e.g. after a name correction), so the only guards
  // are: an article must exist, one translation at a time (either language — they share
  // the Sarvam lane), and not while a revision is rewriting the very article we would
  // translate. The body carries the user-confirmed names from the prepare step
  // (optional for older clients).
  app.post<{ Params: { id: string } }>(
    '/generations/:id/translate',
    async (request, reply) => {
      const body = TranslateGenerationRequestSchema.parse(request.body ?? {});
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
      startTranslateJob(client, row.id, body.language, body.terms);
      return reply.code(202).send({});
    },
  );

  // Attach a poster to an article run that has none (article-only runs, DLO
  // runs, and poster-phase-failure retries). Same row — no new generation; the
  // job reuses the stored article, so this costs one copy call + one render.
  app.post<{ Params: { id: string } }>(
    '/generations/:id/poster',
    async (request, reply) => {
      const body = CreateArticlePosterRequestSchema.parse(request.body ?? {});
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
      if (isSocialCategory(row.category)) {
        return reply.code(400).send({
          error: { message: 'Social posts always include a poster.' },
        });
      }
      if (!row.article) {
        return reply.code(409).send({
          error: { message: 'No article to make a poster from yet.' },
        });
      }
      if (row.posterPath) {
        return reply.code(409).send({
          error: { message: 'This generation already has a poster.' },
        });
      }
      if (body.referenceImageId) {
        const image = await getReferenceImageRow(client, body.referenceImageId);
        if (!image || image.category !== 'article') {
          return reply.code(400).send({
            error: { message: 'Unknown or mismatched reference image.' },
          });
        }
      }
      // Flip BEFORE returning (same stale-poll race note as /poster/feedback).
      // outputType 'both' is what engages the detail page's posterPending
      // skeleton; a later edit-note rerun / failed-card retry then creates a
      // 'both' run too — accepted.
      await updateGeneration(client, row.id, {
        status: 'running',
        step: 'copy',
        error: null,
        outputType: 'both',
      });
      startArticlePosterJob(client, row.id, body.referenceImageId);
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
      startPosterImageFeedbackJob(client, row.id, body);
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

  // Post the poster + caption to the official account of the run's own platform
  // (twitter → X, facebook → the Facebook Page). Synchronous — a publish is one
  // media upload + one create (~3-10s). The latest live post URL is persisted on
  // the row (migration 0021); re-publishing after a poster re-render overwrites it.
  app.post<{ Params: { id: string } }>(
    '/generations/:id/publish',
    async (request, reply) => {
      const row = await getGeneration(client, request.params.id);
      if (!row) {
        return reply
          .code(404)
          .send({ error: { message: 'Generation not found.' } });
      }
      if (!isSocialCategory(row.category)) {
        return reply.code(400).send({
          error: { message: 'Only social-post runs can be published.' },
        });
      }
      if (publishing.has(row.id)) {
        return reply
          .code(409)
          .send({ error: { message: 'प्रकाशन आधीच सुरू आहे.' } });
      }
      if (isJobRunning(row.id)) {
        return reply
          .code(409)
          .send({ error: { message: 'A job is already running.' } });
      }
      if (row.status !== 'completed') {
        return reply
          .code(409)
          .send({ error: { message: 'The run has not completed yet.' } });
      }
      if (!row.posterPath || !row.article) {
        return reply.code(409).send({
          error: { message: 'No poster and caption to publish yet.' },
        });
      }
      // Within-social platform branch — the legitimate divergence point the
      // isSocialCategory() rule funnels toward (it guards social-vs-article
      // routing; X and the Facebook Page genuinely need different APIs here).
      const platform = row.category;
      const twitterCredentials =
        platform === 'twitter' ? twitterCredentialsFromEnv() : null;
      const facebookCredentials =
        platform === 'facebook' ? facebookCredentialsFromEnv() : null;
      if (platform === 'twitter' && !twitterCredentials) {
        return reply.code(503).send({
          error: {
            message:
              'X (ट्विटर) खात्याची क्रेडेन्शियल्स कॉन्फिगर केलेली नाहीत — सर्व्हरच्या .env मध्ये TWITTER_API_KEY, TWITTER_API_SECRET, TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_SECRET सेट करा.',
          },
        });
      }
      if (platform === 'facebook' && !facebookCredentials) {
        return reply.code(503).send({
          error: {
            message:
              'फेसबुक पेजची क्रेडेन्शियल्स कॉन्फिगर केलेली नाहीत — सर्व्हरच्या .env मध्ये FACEBOOK_PAGE_ID व FACEBOOK_PAGE_ACCESS_TOKEN सेट करा.',
          },
        });
      }
      // Reject, never auto-truncate: silently shortening a Marathi caption and
      // posting it to an official account irreversibly is worse than an error.
      if (
        platform === 'twitter' &&
        tweetWeightedLength(row.article) > TWEET_MAX_LENGTH
      ) {
        return reply.code(422).send({
          error: {
            message:
              'कॅप्शन X च्या २८० अक्षरांच्या मर्यादेपेक्षा मोठी आहे — फीडबॅक देऊन ती लहान करा आणि पुन्हा प्रयत्न करा.',
          },
        });
      }

      publishing.add(row.id);
      try {
        let result: PublishResult;
        if (twitterCredentials) {
          const imagePng = await downloadPng(client, row.posterPath);
          result = await publishTweet({
            credentials: twitterCredentials,
            text: row.article,
            imagePng,
          });
        } else if (facebookCredentials) {
          result = await publishFacebookPhotoPost({
            pageId: facebookCredentials.pageId,
            accessToken: facebookCredentials.accessToken,
            caption: row.article,
            // Meta fetches the image itself — the public poster URL suffices.
            imageUrl: publicUrl(client, row.posterPath),
            apiVersion: process.env.FACEBOOK_GRAPH_API_VERSION,
          });
        } else {
          // Unreachable: one of the credential guards above has already returned.
          return reply.code(500).send({ error: { message: 'Unreachable.' } });
        }
        await updateGeneration(client, row.id, {
          publishedUrl: result.postUrl,
          publishedAt: new Date().toISOString(),
        });
        return reply.send({ postUrl: result.postUrl });
      } catch (error) {
        // Upstream platform failures (duplicate tweet, expired token, …) carry a
        // readable message; 502 keeps the status honest vs the handler's 500.
        if (error instanceof SocialPublishError) {
          request.log.error({ err: error }, 'social publish failed');
          return reply.code(502).send({ error: { message: error.message } });
        }
        throw error;
      } finally {
        publishing.delete(row.id);
      }
    },
  );
}
