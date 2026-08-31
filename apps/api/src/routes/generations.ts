// Generation API routes. Thin handlers only: Zod-parse the request with the shared
// schemas, read/write rows via @dgipr/database, and hand real work to jobs/runner.

import type { FastifyInstance } from 'fastify';
import { PassThrough } from 'node:stream';
import { once } from 'node:events';
import { z } from 'zod';
import {
  DLO_UPLOADS_BUCKET,
  downloadFile,
  downloadFileRange,
  getDloIntake,
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
  recordUsageEvent,
  uploadPng,
  updateGeneration,
  type GenerationRow,
  type SupabaseClient,
} from '@dgipr/database';
import {
  ChromiumUnavailableError,
  generateArticlePdf,
  generateArticlePoster,
} from '@dgipr/poster-renderer';
import {
  createCostAccumulator,
  posterStyleLabel,
  runInCostScope,
  runInCostTask,
} from '@dgipr/content-engine';
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
  RegeneratePosterRequestSchema,
  RestoreArticleVersionRequestSchema,
  RestorePosterVersionRequestSchema,
  TranslateGenerationRequestSchema,
  UpdateCaptionRequestSchema,
  UpdateCopyRequestSchema,
  isArticleCategory,
  isSocialCategory,
  isYoutubeCategory,
  intakeFileMimeForFileName,
  referenceCategoryOf,
  type GenerationDetail,
  type GenerationSourceFile,
  type GenerationStep,
  type GenerationSummary,
  type ThreadItem,
} from '@dgipr/schemas';
import {
  articleGenerationMode,
  getCaptionReviseError,
  getEditFailure,
  isEditRetryable,
  retryFailedEdit,
  clearEditFailure,
  getReviseArticleError,
  getTranslateError,
  getTranslateWarnings,
  getDesignationWarnings,
  getLengthWarning,
  getPosterCapacityWarning,
  nameDesignationsOf,
  getTranslatingLanguage,
  isJobRunning,
  isRevisingArticle,
  isRevisingCaption,
  isTranslating,
  subscribeArticleStream,
  startArticleFeedbackJob,
  startArticlePosterJob,
  startCaptionFeedbackJob,
  startConcurrentArticleFeedbackJob,
  startGenerateCaptionJob,
  startGenerationJob,
  startPosterFeedbackJob,
  startPosterImageFeedbackJob,
  startPosterRegenerateJob,
  startSocialPostJob,
  startYoutubeThumbnailJob,
  startTranslateJob,
} from '../jobs/runner.js';
import { rememberDesignations } from '../jobs/designation-writeback.js';
import { prepareTranslationTerms } from '../jobs/translation-terms.js';
import { recordTasksFromCost } from '../jobs/service-usage.js';

// Stage ping n8n POSTs to /generations/:id/progress after each social-post stage.
const ProgressPingSchema = z.object({ step: GenerationStepSchema });

// Which official account a publish targets. Optional, defaulting to the run's own
// category — which is what every caller before this sent, so an old client keeps working.
//
// It exists because the create form now has ONE क्रिएटिव्ह card, and it submits 'twitter'
// for every social poster (see FORMATS in apps/web/app/page.tsx). The poster it makes is
// used on X AND on the Facebook Page, so the row's category no longer says where the
// officer wants THIS post to go — the button they pressed does. Nothing else moves: the
// category still decides the pipeline, the master library and the chrome.
const PublishRequestSchema = z.object({
  platform: z.enum(['twitter', 'facebook']).optional(),
});

// In-flight publish guard: posting to the official account is irreversible, so a
// double click must never produce two live posts. In-process only (like the
// runner's job registry) — resets on restart, fine for a seconds-long call.
const publishing = new Set<string>();

// How much of one archived source file is held in memory at a time while it is forwarded to
// the browser. A meeting recording can be hundreds of megabytes, and buffering one whole is
// the shape that OOM-killed this container on the upload path (2026-08-30), so the byte route
// below streams it a part at a time instead.
const SOURCE_FILE_PART_BYTES = 8 * 1024 * 1024;

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

// Every poster render of a run, oldest→newest, as { storage path, when }. Renders are
// immutable versioned PNGs: the original is always poster-v1 (its path is deterministic —
// the row's posterPath moves on with each revision, but v1 must have existed for any poster
// to exist), later versions are the poster-bearing revision snapshots. Empty when the run
// has no poster. Shared by the detail payload and the restore route so a version INDEX means
// the same thing on both sides.
function posterVersionPaths(
  row: GenerationRow,
  revisions: readonly { posterPath: string | null; createdAt: string }[],
): { path: string; createdAt: string }[] {
  if (!row.posterPath) return [];
  return [
    { path: `generations/${row.id}/poster-v1.png`, createdAt: row.createdAt },
    ...revisions.flatMap((revision) =>
      revision.posterPath
        ? [{ path: revision.posterPath, createdAt: revision.createdAt }]
        : [],
    ),
  ];
}

// Every wording the article has had, oldest→newest. The article-target revision rows ARE the
// history: each one snapshots the text as it stood after that round, and the first article
// feedback of a run additionally snapshots the text BEFORE it (see startArticleFeedbackJob),
// so the original is in the list rather than lost to the round that replaced it.
//
// `current` is decided by comparing text against the row, NOT by taking the last entry:
// restoring an older wording repoints `row.article` and leaves the log alone — the poster
// restore route's model exactly — so after a restore the newest entry is not the current one.
// Shared by the detail payload, the text route and the restore route, so a version INDEX means
// the same thing on all three.
//
// A run that has never been given feedback has no rows and gets an empty list: one wording is
// not a history, and the page shows no version control for it.
function articleVersionsOf(
  row: GenerationRow,
  revisions: readonly {
    target: string;
    article: string | null;
    factCheck: string | null;
    feedback: string | null;
    createdAt: string;
  }[],
): {
  version: number;
  createdAt: string;
  feedback: string | null;
  current: boolean;
  article: string;
  factCheck: string | null;
}[] {
  const snapshots = revisions.filter(
    (revision) => revision.target === 'article' && revision.article !== null,
  );
  if (snapshots.length === 0) return [];
  // The row is the authority on the CURRENT wording, and it can differ from every snapshot —
  // a hand edit elsewhere, or a revision whose row-write landed and whose log insert did not.
  // Comparing trimmed text is enough: both sides are the same string written by the same code.
  const currentArticle = (row.article ?? '').trim();
  let matched = false;
  const versions = snapshots.map((revision, index) => {
    const article = revision.article ?? '';
    // Only the LAST matching snapshot is marked current, so a revision that happened to
    // reproduce an earlier wording does not put the marker in two places.
    const current = article.trim() === currentArticle;
    if (current) matched = true;
    return {
      version: index + 1,
      createdAt: revision.createdAt,
      feedback: revision.feedback,
      current,
      article,
      factCheck: revision.factCheck,
    };
  });
  const latestMatch = versions.reduce(
    (found, version) => (version.current ? version.version : found),
    0,
  );
  for (const version of versions) {
    if (version.current && version.version !== latestMatch) {
      versions[version.version - 1] = { ...version, current: false };
    }
  }
  // The row's wording is in none of them, so it is a version in its own right — appended
  // rather than swallowed, or the officer would be shown a history their article is not in.
  if (!matched && currentArticle.length > 0) {
    versions.push({
      version: versions.length + 1,
      createdAt: row.updatedAt,
      feedback: null,
      current: true,
      article: row.article ?? '',
      factCheck: row.factCheck,
    });
  }
  return versions;
}

async function toDetail(
  client: SupabaseClient,
  row: GenerationRow,
): Promise<GenerationDetail> {
  const revisions = await listRevisions(client, row.id);
  const copy = CopySchema.safeParse(row.copy);
  const fiveWOneH = FiveWOneHSchema.safeParse(row.fiveWOneH);
  const posterVersions = posterVersionPaths(row, revisions).map((version) => ({
    posterUrl: publicUrl(client, version.path),
    createdAt: version.createdAt,
  }));
  // Metadata only — the article text of every version would be tens of kilobytes on a poll
  // that runs every 2.5 s. /article-versions serves the text when it is actually wanted.
  const articleVersions = articleVersionsOf(row, revisions).map(
    ({ article: _article, factCheck: _factCheck, ...meta }) => meta,
  );
  return {
    id: row.id,
    status: row.status,
    step: (row.step as GenerationStep | null) ?? null,
    outputType: row.outputType,
    category: row.category,
    // Deployment-wide, not per row: the flag is read fresh on every job start, so reporting
    // the CURRENT mode is what the progress list needs. A finished run's list is never shown.
    articlePipeline: articleGenerationMode(),
    designMode: row.designMode,
    templateBrand: row.templateBrand,
    heading: row.heading,
    posterHeading: row.posterHeading,
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
    articleVersions,
    // The colour + composition this poster was assigned, flattened to one Marathi line for the
    // UI. Resolved server-side because the libraries live in @dgipr/content-engine and apps/web
    // must not import it (the same rule that moved tweetWeightedLength into @dgipr/schemas).
    posterStyleLabel: posterStyleLabel(row.posterStyle),
    publishedUrl: row.publishedUrl,
    publishedAt: row.publishedAt,
    error: row.error,
    // Translation runs beside the main job, so its state lives in the runner's
    // in-process registry rather than on the row (see startTranslateJob).
    translating: isTranslating(row.id),
    translatingLanguage: getTranslatingLanguage(row.id),
    translateError: getTranslateError(row.id),
    translateWarnings: getTranslateWarnings(row.id),
    // The पदनाम pairs this run was generated with (persisted, so a same-note re-run can carry
    // forward an override the officer did not save to the dictionary) and — from the same
    // in-process registry as translateWarnings — any that could not be applied.
    nameDesignations: nameDesignationsOf(row),
    designationWarnings: getDesignationWarnings(row.id),
    // Set when this poster's information held more items than any master template lays out.
    // Same in-process registry, for the same reason: the poster is on the row and was rendered
    // with every item, but only the officer can decide to split the note into two posters.
    posterCapacityWarning: getPosterCapacityWarning(row.id),
    lengthWarning: getLengthWarning(row.id),
    // Article revision can run beside the poster render (same registry pattern as
    // translation), so its liveness/failure also come from the runner, not the row.
    articleRevising: isRevisingArticle(row.id),
    articleReviseError: getReviseArticleError(row.id),
    // A social caption revision is likewise off the row's status (it edits a settled
    // run and may overlap a poster re-render), so it reports from the same registry.
    captionRevising: isRevisingCaption(row.id),
    captionReviseError: getCaptionReviseError(row.id),
    // An edit that failed over intact earlier output. The row was put back to `completed`
    // rather than marked failed, so this is the only thing that says the edit did not land.
    editFailure: getEditFailure(row.id),
    editRetryable: isEditRetryable(row.id),
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
    // library (referenceCategoryOf — social↔twitter, news/scheme↔article,
    // youtube↔youtube), and only for runs that actually render a poster.
    //
    // outputType 'article' says the run renders none — on the article lane (the poster
    // phase is skipped) and on the social lane (the कॅप्शन run) alike. Storing a pin
    // nothing will ever read is worse than saying so.
    const rendersPoster = body.outputType !== 'article';
    if (body.referenceImageId) {
      if (!rendersPoster) {
        return reply.code(400).send({
          error: {
            message:
              'A reference image cannot be pinned for a run that renders no poster.',
          },
        });
      }
      const image = await getReferenceImageRow(client, body.referenceImageId);
      const expectedCategory = referenceCategoryOf(body.category);
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
      if (!rendersPoster) {
        return reply.code(400).send({
          error: {
            message:
              'A reference type cannot be pinned for a run that renders no poster.',
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
    // Person → पदनाम pairs the officer approved in the pre-generation name check. Article runs
    // only: a social poster's headline is written by generatePosterCopy, a caption is not
    // the place for an official title, and a youtube thumbnail reproduces the officer's own
    // text verbatim — so accepting them on any other lane would silently do nothing.
    const designations = isArticleCategory(body.category)
      ? (body.designations ?? [])
      : [];
    // Ticked pairs go to the dictionary before the insert, so the next article about the same
    // person starts pre-filled even if this run later fails.
    await rememberDesignations(client, designations);

    const row = await insertGeneration(client, {
      note: body.note,
      outputType: body.outputType,
      category: body.category,
      designMode,
      templateBrand,
      heading: body.heading,
      // Stripped of the request-only `remember` flag; insertGeneration omits the column when
      // empty, so an un-applied 0033 disables the feature rather than every create.
      nameDesignations: designations.map((pair) => ({
        name: pair.name,
        designation: pair.designation,
      })),
      // Hand-typed poster text — article/poster runs only. A social poster's headline is
      // written by generatePosterCopy and has no equivalent lock, and a youtube thumbnail's
      // text IS the note, so accepting it on either would silently do nothing.
      posterHeading: isArticleCategory(body.category)
        ? body.posterHeading
        : undefined,
      referenceImageId: body.referenceImageId,
      referenceTypeId: body.referenceTypeId,
      sourceGenerationId: body.sourceGenerationId,
      threadRootId,
      // Media-room flow: the note is a finished article the runner should use
      // verbatim. Only meaningful on the article/poster path — inert for social.
      articleProvided:
        body.providedArticle && isArticleCategory(body.category)
          ? true
          : undefined,
      // Tier-1 style reference (migration 0035) — article runs that actually generate prose.
      // A social run writes no article, and a providedArticle run skips generation entirely,
      // so storing it on either would be dead data that a later reader could misread as
      // "this run was styled on that". insertGeneration omits the column when absent.
      styleReference:
        isArticleCategory(body.category) && !body.providedArticle
          ? body.styleReference
          : undefined,
      // The officer's direction for this article (migration 0041) — same scope as the style
      // reference above, and for the same reason: a social run writes no article and a
      // providedArticle run skips generation, so storing it on either would be dead data a
      // later reader could misread as "this run was written to that direction".
      instructions:
        isArticleCategory(body.category) && !body.providedArticle
          ? body.instructions
          : undefined,
      // The officer's own image prompt (migration 0045) — social runs that actually render a
      // poster. The schema already rejects it anywhere else with a message; this is the same
      // rule applied to what gets STORED, so a future caller that slips past the schema still
      // cannot leave a prompt on a row nothing will read. insertGeneration omits the column
      // when absent, so an un-applied 0045 costs this field rather than every create.
      imagePrompt:
        isSocialCategory(body.category) && rendersPoster
          ? body.imagePrompt
          : undefined,
    });
    // Twitter/Facebook → external n8n social-post job; news/scheme → in-process
    // article pipeline. A social run is poster-only unless the caller asked for a
    // caption; the flag rides as a job parameter (no column — a re-run infers it from
    // whether the source run ended up with a caption).
    if (isSocialCategory(row.category)) {
      startSocialPostJob(client, row.id, {
        generateCaption: body.generateCaption === true,
      });
    } else if (isYoutubeCategory(row.category)) {
      // One image and nothing else: no article, no caption, no n8n. See
      // startYoutubeThumbnailJob.
      startYoutubeThumbnailJob(client, row.id);
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

  // The article as it is being written, as Server-Sent Events. Two event types:
  //
  //   snapshot — REPLACE what you are showing with this text
  //   delta    — APPEND this text
  //   end      — nothing more is coming; close
  //
  // The snapshot/delta split is what makes reconnection safe. EventSource retries on its own
  // after any drop, and a reconnecting client is re-sent everything written so far; if that
  // replay were a delta the text would silently double. It is also how the run's LAST word is
  // delivered: the deltas carry the raw draft, and the final snapshot carries the article after
  // applyDesignations has inserted the officer's approved पदनामे.
  //
  // Deliberately SEPARATE from the 2.5 s detail poll rather than a field on it. A token-level
  // stream cannot be polled — a field would arrive in 2.5-second blocks — and pushing the
  // partial article into the payload would grow every poll of every client by the length of an
  // article for the whole run.
  //
  // Nothing here is a source of truth. The article lands on the row exactly as before, and a
  // client that gets no stream at all (a restarted API, a second instance, a proxy that will
  // not pass an event stream) simply sees its ordinary progress steps and then the finished
  // article. That is why this route never fails a run — its worst case is a lost animation.
  app.get<{ Params: { id: string } }>(
    '/generations/:id/article/stream',
    async (request, reply) => {
      const row = await getGeneration(client, request.params.id);
      if (!row) {
        return reply
          .code(404)
          .send({ error: { message: 'Generation not found.' } });
      }

      const stream = new PassThrough();
      const send = (event: string, data: unknown): void => {
        if (stream.writableEnded) return;
        // JSON on one line: SSE frames are newline-delimited, and a Marathi article is
        // full of newlines.
        stream.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      reply
        .header('content-type', 'text/event-stream; charset=utf-8')
        .header('cache-control', 'no-cache, no-transform')
        .header('connection', 'keep-alive')
        // Reverse proxies buffer a proxied response by default, which would hold every delta
        // back until the run finished — precisely what this route exists to avoid.
        .header('x-accel-buffering', 'no');

      // Already written: serve it whole and close. This is what a reload after completion
      // gets, and what keeps a reconnecting EventSource from retrying forever.
      if (row.article) {
        send('snapshot', row.article);
        send('end', {});
        stream.end();
        return reply.send(stream);
      }

      const { unsubscribe, live } = subscribeArticleStream(
        request.params.id,
        (event) => {
          if (event.type === 'end') {
            send('end', {});
            stream.end();
            return;
          }
          send(event.type, event.text);
        },
      );

      // Nothing to watch — this run is not being drafted in this process (it failed, it never
      // generates an article, or the API restarted). Say so and close; the client's poll is
      // already following the row.
      if (!live) {
        if (!stream.writableEnded) {
          send('end', {});
          stream.end();
        }
        return reply.send(stream);
      }

      // A high reasoning effort means real minutes can pass before the first token, so the
      // connection has to be kept visibly alive. An SSE comment is ignored by the client.
      const heartbeat = setInterval(() => {
        if (!stream.writableEnded) stream.write(': ping\n\n');
      }, 15_000);
      const cleanup = (): void => {
        clearInterval(heartbeat);
        unsubscribe();
      };
      request.raw.on('close', cleanup);
      stream.on('close', cleanup);

      return reply.send(stream);
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

  // Write the FIRST caption for a social run that has none — the run was created
  // poster-only (the create form's caption toggle is off by default) and the officer has
  // now asked for one. Separate from the feedback route above, which revises an existing
  // caption; here there is nothing to revise. Like that route the job owns no status/step,
  // so the finished poster stays on screen while the caption is written.
  app.post<{ Params: { id: string } }>(
    '/generations/:id/caption/generate',
    async (request, reply) => {
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
      // The run must have settled: its own job writes the same column, and a caption
      // written mid-render would be overwritten (or overwrite) without warning.
      if (row.status !== 'completed') {
        return reply
          .code(409)
          .send({ error: { message: 'The run has not completed yet.' } });
      }
      if (row.article) {
        return reply.code(409).send({
          error: {
            message:
              'This post already has a caption — use feedback to change it.',
          },
        });
      }
      if (isRevisingCaption(row.id)) {
        return reply.code(409).send({
          error: { message: 'A caption job is already running.' },
        });
      }
      startGenerateCaptionJob(client, row.id);
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
      // A poster-only run legitimately has no caption yet — typing one is how the
      // officer adds it. Only an unfinished run is rejected: its own job writes this
      // very column.
      if (!row.article && row.status !== 'completed') {
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
      const cost = createCostAccumulator();
      const result = await runInCostScope(cost, () =>
        runInCostTask('translation_name_extraction', () =>
          prepareTranslationTerms(client, row.article!),
        ),
      );
      recordTasksFromCost(client, 'translate', cost);
      return result;
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
      if (!isArticleCategory(row.category)) {
        return reply.code(400).send({
          error: {
            message:
              'Only a news/scheme run can be given an article poster (a social post and a YouTube thumbnail have their own).',
          },
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

  // Regenerate a run's poster as a brand-new, differently-designed version (fully-AI path:
  // re-select avoiding the recent master, rewrite copy, fresh palette + composition
  // assignment). Serves two buttons: the plain redo — the text-legibility escape hatch, since
  // the image model paints Devanagari and can garble it — and `recolour: true`, which
  // additionally bars the run's CURRENT colour family so the redo cannot come back in the
  // colours the officer just rejected. Writes a new poster version either way.
  //
  // Serves BOTH lanes: social runs re-classify as well, article runs re-derive their copy and
  // re-run the named-subject check from the stored article (so a redo after an article edit
  // picks up the change). An article run therefore also needs its article to still be there.
  //
  // An article run may also carry `posterHeading` — the third button: print EXACTLY this text.
  // It is persisted by the job so later redos keep it; '' clears it back to automatic.
  app.post<{ Params: { id: string } }>(
    '/generations/:id/poster/regenerate',
    async (request, reply) => {
      const body = RegeneratePosterRequestSchema.parse(request.body ?? {});
      const row = await getGeneration(client, request.params.id);
      if (!row) {
        return reply
          .code(404)
          .send({ error: { message: 'Generation not found.' } });
      }
      if (
        body.posterHeading !== undefined &&
        !isArticleCategory(row.category)
      ) {
        return reply.code(400).send({
          error: {
            message:
              'पोस्टरवरील मजकूर फक्त लेख-पोस्टरसाठी बदलता येतो (सोशल पोस्ट किंवा यूट्यूब थंबनेलसाठी नाही).',
          },
        });
      }
      // A thumbnail is regenerated from the note, like a social poster — only the article
      // lane re-derives its poster copy from the finished article.
      if (isArticleCategory(row.category) && !row.article) {
        return reply
          .code(409)
          .send({
            error: { message: 'No article to regenerate the poster from.' },
          });
      }
      if (isJobRunning(row.id)) {
        return reply
          .code(409)
          .send({ error: { message: 'A job is already running.' } });
      }
      if (!row.posterPath) {
        return reply
          .code(409)
          .send({ error: { message: 'No poster to regenerate yet.' } });
      }

      // Flip BEFORE returning so the first client poll cannot observe a stale completed
      // row and stop before the new poster is stored (same race note as image-feedback).
      await updateGeneration(client, row.id, {
        status: 'running',
        step: null,
        error: null,
      });
      startPosterRegenerateJob(client, row.id, {
        recolour: body.recolour === true,
        // Forwarded only when the request actually carried it — `undefined` means "leave the
        // row's heading alone", which is not the same as "clear it".
        ...(body.posterHeading === undefined
          ? {}
          : { posterHeading: body.posterHeading }),
      });
      return reply.code(202).send({});
    },
  );

  // Every wording the article has had, WITH the text. Its own route rather than a field on the
  // detail payload for the reason the source-file list is: the detail poll runs every 2.5 s
  // and an article is thousands of characters, so the history would be re-shipped hundreds of
  // times over a run to serve a control the officer may never touch. The metadata is on the
  // payload (`articleVersions`), which is what decides whether the control is drawn at all;
  // this is fetched once, when they actually move between versions.
  app.get<{ Params: { id: string } }>(
    '/generations/:id/article-versions',
    async (request, reply) => {
      const row = await getGeneration(client, request.params.id);
      if (!row) {
        return reply
          .code(404)
          .send({ error: { message: 'Generation not found.' } });
      }
      const revisions = await listRevisions(client, row.id);
      return reply.send({ versions: articleVersionsOf(row, revisions) });
    },
  );

  // Bring an older wording back as the current article, so every path that reads
  // `row.article` — the page, the PDF export, translation, poster copy, the next feedback
  // round — continues from THAT text instead of the latest. They all read the one column and
  // needed no change: this route moves it.
  //
  // ONE column update and nothing else: no revision row, no model call, no spend. Selecting a
  // version is not an edit and must not look like one, or the strip would grow an entry every
  // time an officer looked around it (the poster restore route's finding, and the same
  // reasoning). It is safe precisely because the log is append-only: the wording being
  // replaced is still a row in it, so nothing is lost and switching back is the same move.
  app.post<{ Params: { id: string } }>(
    '/generations/:id/article/restore',
    async (request, reply) => {
      const body = RestoreArticleVersionRequestSchema.parse(request.body);
      const row = await getGeneration(client, request.params.id);
      if (!row) {
        return reply
          .code(404)
          .send({ error: { message: 'Generation not found.' } });
      }
      // A revision in flight is about to overwrite the very column this writes, and the
      // article feedback jobs report through the registry rather than the row's status — so
      // both have to be asked.
      if (isJobRunning(row.id) || isRevisingArticle(row.id)) {
        return reply.code(409).send({
          error: { message: 'या बातमीवर सध्या काम सुरू आहे. थोडे थांबा.' },
        });
      }

      const revisions = await listRevisions(client, row.id);
      const versions = articleVersionsOf(row, revisions);
      const chosen = versions[body.version - 1];
      if (!chosen) {
        return reply.code(400).send({
          error: {
            message: `या बातमीच्या ${versions.length} आवृत्त्या आहेत; ${body.version} क्रमांकाची आवृत्ती नाही.`,
          },
        });
      }
      if (chosen.current) {
        return reply.code(409).send({
          error: { message: 'हीच आवृत्ती सध्या वापरात आहे.' },
        });
      }

      // factCheck moves with the article: the traceability appendix belongs to one wording,
      // and leaving the previous version's appendix under a restored article would trace it
      // against sentences it no longer contains.
      await updateGeneration(client, row.id, {
        article: chosen.article,
        factCheck: chosen.factCheck,
      });

      return reply.send({ article: chosen.article });
    },
  );

  // Bring an older poster render back as the current one, so every edit path — image
  // feedback, marker feedback, redesign, publish, download — continues from THAT poster
  // instead of the latest. They all read `row.posterPath` and needed no change: this route
  // simply moves it.
  //
  // It is ONE column update and nothing else — no storage read, no upload, no revision row,
  // no model call, no n8n, no spend. It used to copy the chosen bytes forward as a new
  // version, which cost a ~6 MB download + upload per click (seconds of waiting on a
  // pointer move) and, because the strip is derived from the poster-bearing revisions,
  // ADDED a duplicate thumbnail every time an officer switched. Selecting a version is not
  // an edit and must not look like one.
  //
  // Repointing is safe precisely because the versioned objects are immutable: nothing is
  // lost, the strip keeps its exact contents, and switching back is the same one-line move.
  // The next real render still appends, since it names itself off the revision count.
  app.post<{ Params: { id: string } }>(
    '/generations/:id/poster/restore',
    async (request, reply) => {
      const body = RestorePosterVersionRequestSchema.parse(request.body);
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
          .send({ error: { message: 'No poster to restore yet.' } });
      }

      const revisions = await listRevisions(client, row.id);
      const versions = posterVersionPaths(row, revisions);
      const chosen = versions[body.version - 1];
      if (!chosen) {
        return reply.code(400).send({
          error: {
            message: `या कामाला ${versions.length} पोस्टर आवृत्त्या आहेत; ${body.version} क्रमांकाची आवृत्ती नाही.`,
          },
        });
      }
      if (chosen.path === row.posterPath) {
        return reply.code(409).send({
          error: { message: 'हीच आवृत्ती सध्या वापरात आहे.' },
        });
      }

      await updateGeneration(client, row.id, { posterPath: chosen.path });

      return reply.send({ posterUrl: publicUrl(client, chosen.path) });
    },
  );

  // Retry what failed, on THIS row — never as a new generation. THREE shapes, and the
  // caller does not have to know which applies:
  //
  //   - This process still holds the failed job's arguments (the normal case): re-run that
  //     exact step. 202, and the row goes back to running.
  //   - It does not — the API restarted, or the row was marked `failed` by an older build that
  //     had no recovery (which is how a run could lose its whole result view to one bad edit).
  //     Then clear the failure and put the row back to `completed`, which is all such a row
  //     needs: its poster, every immutable version and its article were never touched. 200,
  //     and the officer re-sends whatever they wanted from the poster card.
  //   - The run produced NOTHING at all (the initial render failed, whatever the cause): run
  //     the SAME row again from its stored inputs. 202. See the branch below for why this is
  //     the one shape that spends.
  //
  // The spend gate is the point of the split: recovery is a column write and costs nothing,
  // and an EDIT is re-run only where the failed step's own inputs are still known — this route
  // never re-derives an edit, and never renders one nobody asked for.
  app.post<{ Params: { id: string } }>(
    '/generations/:id/retry',
    async (request, reply) => {
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
      // A run that produced NOTHING has no edit to go back to and nothing to recover, so
      // retrying it means running it again from the row’s own stored inputs — note, category,
      // output type, reference pin, poster heading, image prompt, style reference,
      // instructions. Every job re-reads all of that from the row (which is why those columns
      // are insert-only), so this reproduces the officer’s original request exactly. Same row:
      // the note keeps ONE entry in history and the failed attempt is simply replaced, where a
      // fresh generation from पुढील पाऊल leaves a dead row behind it.
      //
      // This is the one branch of this route that SPENDS, and deliberately so: the render
      // failed, the officer is looking at the failure, and asking for it again is the only
      // thing they can want. Every error reaches it — a moderation refusal, a provider 5xx, a
      // timeout — because none of them are distinguishable here and all of them are worth
      // one more attempt.
      if (!row.posterPath && !row.article) {
        if (row.status !== 'failed') {
          return reply.code(409).send({
            error: {
              message:
                'या कामातून अद्याप काहीच तयार झालेले नाही; ते पूर्ण होण्याची वाट पाहा.',
            },
          });
        }
        // Flipped BEFORE the 202 (the same stale-poll race as /poster/feedback): the client
        // refreshes the instant this answers, and a row still reading `failed` would stop
        // polling and sit on the failure card through the whole re-run.
        await updateGeneration(client, row.id, {
          status: 'queued',
          step: null,
          error: null,
        });
        clearEditFailure(row.id);
        if (isSocialCategory(row.category)) {
          startSocialPostJob(client, row.id, {
            // The caption preference is a job parameter, not a column, so it cannot be read
            // back off a run that produced nothing. Caption-only (outputType ‘article’ on a
            // social row = renders no poster) MUST have it or the re-run would produce nothing
            // at all; a poster run gets the same `article !== null` inference every other
            // re-run path uses, which on this row is false. A poster run that also wanted a
            // caption gets one from the on-demand button, exactly as a poster-only run does.
            generateCaption:
              row.outputType === 'article' || row.article !== null,
          });
        } else if (isYoutubeCategory(row.category)) {
          startYoutubeThumbnailJob(client, row.id);
        } else {
          startGenerationJob(client, row.id);
        }
        return reply.code(202).send({ retried: true });
      }

      if (retryFailedEdit(row.id)) {
        return reply.code(202).send({ retried: true });
      }

      clearEditFailure(row.id);
      if (row.status !== 'completed') {
        await updateGeneration(client, row.id, {
          status: 'completed',
          step: 'done',
          error: null,
        });
      }
      return reply.send({ retried: false });
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
      // A download is the moment a poster actually leaves the platform, and it leaves no
      // trace on the row. Counted per category so the analytics page can say which lane the
      // department is really shipping (0043).
      recordUsageEvent(client, {
        feature: isSocialCategory(row.category) ? 'social' : 'article',
        action: 'poster_download',
        detail: { category: row.category },
      });
      return reply
        .header('content-type', 'image/png')
        .header(
          'content-disposition',
          `attachment; filename="dgipr-poster-${row.id}.png"`,
        )
        .send(png);
    },
  );

  // ---------- the source files this run was generated from ----------
  //
  // A run made on /dlo carries `dlo_intake_id` (0018), and that intake still holds the
  // officer's own uploads in the private dlo-uploads bucket. These two routes hand them back
  // so the article's मूळ टिपणी fold can list them and open each one, which is what makes the
  // assembled note checkable against the scan or recording it was transcribed from.
  //
  // Deliberately NOT folded into the detail payload: the intake's `files` jsonb carries every
  // transcript and every OCR'd page, so reading it would re-ship a whole meeting on each tick
  // of the 2.5 s detail poll. It is fetched once, when the fold is opened.
  app.get<{ Params: { id: string } }>(
    '/generations/:id/source-files',
    async (request, reply) => {
      const row = await getGeneration(client, request.params.id);
      if (!row) {
        return reply
          .code(404)
          .send({ error: { message: 'Generation not found.' } });
      }
      // A media-room run has no intake behind it (its uploaded document is read by the
      // shared ephemeral service and never archived), and neither does an intake that has
      // since been deleted. Both are an empty list, not an error: the fold simply shows the
      // note on its own, exactly as it does today.
      const intake = row.dloIntakeId
        ? await getDloIntake(client, row.dloIntakeId)
        : null;
      const files: GenerationSourceFile[] = (intake?.files ?? []).flatMap(
        (entry, index) =>
          // Listed only when there is something to open. A document whose ephemeral upload
          // job had expired by the time the intake was created has its text but not its
          // bytes (see DloIntakeFileEntry.storagePath), and offering a link that can only
          // 404 is worse than not offering one.
          entry.storagePath !== undefined || entry.sourceUrl !== undefined
            ? [
                {
                  index,
                  name: entry.name,
                  kind: entry.kind,
                  externalUrl: entry.sourceUrl ?? null,
                },
              ]
            : [],
      );
      return reply.send({ files });
    },
  );

  // One of those originals, served back as bytes.
  //
  // A proxy rather than a URL for the reason the /dlo review card's photograph is one:
  // dlo-uploads is PRIVATE, and an officer's meeting material must not become a public
  // object just so a link can be clicked. Addressed by INDEX, so no storage key is ever
  // handed to the browser.
  //
  // Inline (no content-disposition), because the ask is to OPEN it in a new tab — a PDF, a
  // photograph and a recording all render in the browser, and anything it cannot render it
  // downloads on its own. `nosniff` because these are officer-uploaded bytes: the extension
  // decides the type and the browser may not go looking for a better guess.
  app.get<{ Params: { id: string; index: string } }>(
    '/generations/:id/source-files/:index',
    async (request, reply) => {
      const row = await getGeneration(client, request.params.id);
      const intake = row?.dloIntakeId
        ? await getDloIntake(client, row.dloIntakeId)
        : null;
      const index = Number(request.params.index);
      const entry = Number.isInteger(index) ? intake?.files[index] : undefined;
      // One 404 for "no such run", "no such file" and "nothing archived" alike: the tab has
      // nothing to do with the distinction, and the list above only ever offers a link for a
      // file that has bytes.
      if (!entry?.storagePath) {
        return reply
          .code(404)
          .send({ error: { message: 'फाईल सापडली नाही.' } });
      }
      reply
        .header('content-type', intakeFileMimeForFileName(entry.name))
        .header('x-content-type-options', 'nosniff')
        // The object is immutable — an intake's uploads are written once — so the browser
        // may keep it. Private, because the bucket is: no shared cache should hold it.
        .header('cache-control', 'private, max-age=3600');
      // A meeting recording can be hundreds of megabytes, and buffering one whole is the
      // exact shape that OOM-killed this container on the upload path (2026-08-30). Where
      // the size is recorded — every recording streamed to storage since then — it is
      // forwarded a part at a time instead, so peak memory is one part however long the
      // file is. Documents and photographs, which have no `bytes` and are small by
      // construction, take the plain buffered read.
      if (entry.bytes === undefined) {
        return reply.send(
          await downloadFile(client, DLO_UPLOADS_BUCKET, entry.storagePath),
        );
      }
      const total = entry.bytes;
      const path = entry.storagePath;
      const stream = new PassThrough();
      // A reader that goes away — a closed tab, a cancelled load — destroys the stream, and
      // the loop below must notice: `drain` would never arrive after that, and the remaining
      // parts would be fetched for nobody.
      const gone = new AbortController();
      stream.once('close', () => gone.abort());
      void (async () => {
        try {
          for (let start = 0; start < total; start += SOURCE_FILE_PART_BYTES) {
            if (gone.signal.aborted) return;
            const end = Math.min(start + SOURCE_FILE_PART_BYTES, total) - 1;
            const part = await downloadFileRange(
              client,
              DLO_UPLOADS_BUCKET,
              path,
              start,
              end,
            );
            if (!stream.write(part)) {
              await once(stream, 'drain', { signal: gone.signal });
            }
          }
          stream.end();
        } catch (error) {
          // The response has already begun, so there is no status left to change: destroy
          // the stream and let the client see a truncated transfer rather than a file that
          // silently ends early and looks complete. Already destroyed (the reader left) is
          // a no-op.
          stream.destroy(error instanceof Error ? error : new Error('failed'));
        }
      })();
      // Declared up front so the browser can show real progress on a long recording; the
      // size is what the upload counted as it streamed the bytes to storage.
      return reply.header('content-length', String(total)).send(stream);
    },
  );

  // The article as a printable A4 PDF (DGIPR letterhead, Chromium-typeset Devanagari),
  // rendered on demand and streamed — nothing is stored, since a saved copy would go stale
  // the moment the article is revised.
  //
  // GET, like poster.png above and for the same reason: `content-disposition: attachment`
  // is the only way to force a cross-origin download, so the frontend is a plain <a href>.
  // Because this IS a plain navigation, the error bodies below are what the officer SEES in
  // the tab — hence Marathi, unlike the fetch-backed routes.
  app.get<{ Params: { id: string }; Querystring: { lang?: string } }>(
    '/generations/:id/article.pdf',
    // Fastify auto-exposes HEAD for a GET; without this a HEAD would launch Chromium and
    // throw the PDF away.
    { exposeHeadRoute: false },
    async (request, reply) => {
      const lang = request.query.lang ?? 'mr';
      if (lang !== 'mr' && lang !== 'en' && lang !== 'hi') {
        // Hand-checked rather than Zod-parsed: the global error handler serialises a whole
        // ZodError, which is unreadable as a raw browser body.
        return reply.code(400).send({ error: { message: 'अवैध भाषा.' } });
      }

      const row = await getGeneration(client, request.params.id);
      if (!row) {
        return reply
          .code(404)
          .send({ error: { message: 'हे काम सापडले नाही.' } });
      }
      // A social run's `article` column holds the CAPTION, not an article — a letterhead PDF
      // of a tweet is wrong — and a youtube run has no text at all. Asked positively, so a
      // future lane cannot slip through the way a `=== 'twitter'` check let facebook.
      if (!isArticleCategory(row.category)) {
        return reply
          .code(400)
          .send({ error: { message: 'या प्रकारासाठी PDF उपलब्ध नाही.' } });
      }

      // The gate is the TEXT, not row.status. The article is final long before the poster is
      // (ArticleView is on screen while the poster still renders — the reason translating/
      // articleRevising live off status), so a status === 'completed' check would break the
      // main case. A queued/running row simply has no article and lands in the same 404;
      // a FAILED row that did produce one can still be exported, which is deliberate — the
      // officer keeps text that was already paid for.
      const text =
        lang === 'mr'
          ? row.article
          : lang === 'en'
            ? row.articleEnglish
            : row.articleHindi;
      if (!text || text.trim() === '') {
        return reply.code(404).send({
          error: {
            message:
              lang === 'mr'
                ? 'या कामाचा लेख अद्याप तयार नाही.'
                : lang === 'en'
                  ? 'या लेखाचे इंग्रजी भाषांतर अद्याप तयार नाही.'
                  : 'या लेखाचे हिंदी भाषांतर अद्याप तयार नाही.',
          },
        });
      }

      try {
        const pdf = await generateArticlePdf({
          article: text,
          heading: row.heading,
          createdAt: row.createdAt,
          language: lang,
        });
        // Recorded only once the PDF actually rendered — a Chromium failure below must not
        // count as an export. Language only; the article itself is never recorded (0043).
        recordUsageEvent(client, {
          feature: 'article',
          action: 'article_pdf',
          charCount: text.length,
          detail: { language: lang },
        });
        return (
          reply
            .header('content-type', 'application/pdf')
            .header(
              'content-disposition',
              `attachment; filename="dgipr-lekh-${row.id}-${lang}.pdf"`,
            )
            // The article is revisable, so a cached PDF would go stale behind a re-render.
            .header('cache-control', 'no-store')
            .send(pdf)
        );
      } catch (error) {
        // deploy/api.Dockerfile installs Chromium for this route; if that layer is ever
        // missing, this must read as a setup problem, not a 500 in a blank tab.
        if (error instanceof ChromiumUnavailableError) {
          request.log.error(
            { err: error },
            'article pdf: chromium unavailable',
          );
          return reply.code(503).send({
            error: {
              message:
                'PDF सेवा सध्या या सर्व्हरवर उपलब्ध नाही. कृपया प्रशासकाशी संपर्क साधा.',
            },
          });
        }
        throw error;
      }
    },
  );

  // Post the poster + caption to an official account — X or the Facebook Page, named by
  // the request's `platform` and falling back to the run's own category. Synchronous — a
  // publish is one media upload + one create (~3-10s). The latest live post URL is
  // persisted on the row (migration 0021), so publishing the same poster to the second
  // platform overwrites the first one's link; the posts themselves are both live, and one
  // column cannot hold two. Re-publishing after a poster re-render overwrites it too.
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
      const parsedPublish = PublishRequestSchema.safeParse(request.body ?? {});
      if (!parsedPublish.success) {
        return reply.code(400).send({
          error: { message: 'Unknown publish platform.' },
        });
      }
      if (publishing.has(row.id)) {
        return reply
          .code(409)
          .send({ error: { message: 'प्रकाशन आधीच सुरू आहे.' } });
      }
      // These three used to be unreachable from the UI — the publish button was gated on a
      // settled row with a caption. It is not any more (the officer decides when a post is
      // ready), so these messages are now read by officers and are Marathi like the
      // 409/503/422 guards below.
      if (isJobRunning(row.id)) {
        return reply.code(409).send({
          error: { message: 'या पोस्टवर एक काम आधीच सुरू आहे.' },
        });
      }
      if (row.status !== 'completed') {
        return reply.code(409).send({
          error: { message: 'काम अद्याप पूर्ण झालेले नाही.' },
        });
      }
      // The कॅप्शन lane renders no poster, and both platforms need one (X uploads the
      // poster bytes as media, the Page endpoint is /photos) — so this is permanent, not
      // "yet". The UI never offers the button here (SocialPostView requires posterUrl);
      // this is the backstop, hence Marathi like the 503/422 guards below.
      if (row.outputType === 'article') {
        return reply.code(409).send({
          error: {
            message:
              'ही फक्त कॅप्शन आहे — पोस्टरशिवाय पोस्ट प्रकाशित करता येत नाही.',
          },
        });
      }
      if (!row.posterPath || !row.article) {
        return reply.code(409).send({
          error: {
            message:
              'पोस्टर आणि कॅप्शन दोन्ही तयार झाल्यावरच पोस्ट प्रकाशित करता येईल.',
          },
        });
      }
      // Within-social platform branch — the legitimate divergence point the
      // isSocialCategory() rule funnels toward (it guards social-vs-article
      // routing; X and the Facebook Page genuinely need different APIs here).
      const platform: 'twitter' | 'facebook' =
        parsedPublish.data.platform ??
        (row.category === 'facebook' ? 'facebook' : 'twitter');
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
      // No length gate on the caption. A twitter and a facebook caption are written the
      // same way here, so holding one of them to X's 280 weighted characters refused a
      // caption the officer had already approved, for a reason the product no longer has.
      // X's own API is the authority if it ever rejects one; that error surfaces below.
      // The weighted-length helpers stay in @dgipr/schemas for that day.

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
