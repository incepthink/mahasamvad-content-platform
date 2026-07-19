// In-process job runner for generation + feedback work. Sequencing and persistence
// only — all LLM/render logic lives in @dgipr/content-engine and
// @dgipr/poster-renderer (per AGENTS.md, business logic stays in packages).
//
// Job state of record is the generations row in Supabase (status/step/error updated
// at every transition), so polling clients survive page refreshes. The in-memory
// `running` set only (a) prevents two jobs on the same generation at once and
// (b) lets the detail route detect rows orphaned by a server restart mid-job.

import {
  FACT_CHECK_DELIMITER,
  buildTwitterCatalog,
  createCostAccumulator,
  extractGlossaryCandidates,
  generateArticle,
  generateCopy,
  interpretImageFeedback,
  pickArticlePosterTheme,
  pickArticleReference,
  recordImageCost,
  resolvePinnedReference,
  resolvePinnedTypeReference,
  reviseArticle,
  reviseCopy,
  reviseSceneBrief,
  runInCostScope,
  translateArticleToEnglish,
  type ArticlePosterTheme,
  type ImageQuality,
  type PinnedReference,
  type ReferenceLayoutSpec,
} from '@dgipr/content-engine';
import {
  annotateFeedbackRegions,
  buildArticleScenePrompt,
  generateImage,
  generateArticlePoster,
  headStrings,
  overlayArticleChrome,
  overlayTwitterChrome,
} from '@dgipr/poster-renderer';
import {
  addGenerationCost,
  findGlossaryTermsInText,
  getGeneration,
  insertGlossaryCandidates,
  insertRevision,
  listRevisions,
  publicUrl,
  updateGeneration,
  uploadPng,
  downloadPng,
  upsertGlossaryTerm,
  type GenerationCostIncrement,
  type GenerationRow,
  type SupabaseClient,
} from '@dgipr/database';
import {
  CopySchema,
  type Copy,
  type PosterImageFeedbackRequest,
  type TranslationTermInput,
} from '@dgipr/schemas';

const running = new Set<string>();

// Translation is the one job that may run *alongside* another job on the same
// generation: the article is final and persisted before the poster phase starts, so
// the user can ask for English while the poster is still rendering. It therefore
// cannot use the row's status/step/error — those belong to the main job — and keeps
// its liveness + last failure here instead. The detail route reports both to the UI.
const translating = new Set<string>();
const translateErrors = new Map<string, string>();

// Article revision may likewise run *alongside* the poster render: the article is
// final and persisted before the poster phase starts, so the user can refine it
// without waiting out the ~1-2 min render. Like translation it therefore cannot use
// the row's status/step/error (those belong to the main job) and keeps its liveness +
// last failure here. The settled-run article revision still goes through the
// status-owning startArticleFeedbackJob; this pair is only for the concurrent path.
const revisingArticle = new Set<string>();
const reviseArticleErrors = new Map<string, string>();

export function isJobRunning(id: string): boolean {
  return running.has(id);
}

export function isTranslating(id: string): boolean {
  return translating.has(id);
}

export function getTranslateError(id: string): string | null {
  return translateErrors.get(id) ?? null;
}

export function isRevisingArticle(id: string): boolean {
  return revisingArticle.has(id);
}

export function getReviseArticleError(id: string): string | null {
  return reviseArticleErrors.get(id) ?? null;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. ` +
        'Copy .env.example to .env and fill it in (see repo README).',
    );
  }
  return value;
}

// Storage paths are versioned per render: public bucket URLs are CDN-cached, so a
// path must never be reused. Version n = revision count + 2 (v1 was the original).
function scenePath(id: string, version: number): string {
  return `generations/${id}/scene-v${version}.png`;
}
function posterPath(id: string, version: number): string {
  return `generations/${id}/poster-v${version}.png`;
}

async function nextVersion(
  client: SupabaseClient,
  generationId: string,
): Promise<number> {
  const revisions = await listRevisions(client, generationId);
  return revisions.length + 2;
}

function requireCopy(row: GenerationRow): Copy {
  const parsed = CopySchema.safeParse(row.copy);
  if (!parsed.success) {
    throw new Error(`Generation ${row.id} has no valid poster copy.`);
  }
  return parsed.data;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Quality the image renders run at — must stay in sync with OPENAI_IMAGE_QUALITY
// (openai-image.ts) and the two n8n workflow JSONs. Used only to attribute the fixed
// per-render image cost; image usage itself is not measurable (the render runs in n8n).
function imageQuality(): ImageQuality {
  const q = process.env.OPENAI_IMAGE_QUALITY;
  return q === 'high' || q === 'low' ? q : 'medium';
}

// addGenerationCost is a read-modify-write on cost_usd/cost_breakdown. A translate
// job can finish at the same moment as the main job it runs beside, so chain the
// writers per generation to keep the additive total from losing an update.
const costChain = new Map<string, Promise<void>>();

async function persistCost(
  client: SupabaseClient,
  id: string,
  cost: GenerationCostIncrement,
): Promise<void> {
  const previous = costChain.get(id) ?? Promise.resolve();
  const write = previous
    .catch(() => undefined)
    .then(() => addGenerationCost(client, id, cost));
  const guarded = write.catch(() => undefined);
  costChain.set(id, guarded);
  try {
    await write;
  } finally {
    // Drop the entry once nothing else has queued behind this write.
    if (costChain.get(id) === guarded) costChain.delete(id);
  }
}

// Wrap a job body with the shared bookkeeping: claim the id, flip the row to
// running, persist completed/failed, always release the id.
function runJob(
  client: SupabaseClient,
  id: string,
  job: () => Promise<void>,
): void {
  running.add(id);
  void (async () => {
    // Meter every OpenAI text call this job makes (chatComplete records into the ambient
    // accumulator) plus the fixed image-render cost the job records explicitly.
    const cost = createCostAccumulator();
    try {
      await runInCostScope(cost, job);
      await updateGeneration(client, id, {
        status: 'completed',
        step: 'done',
        error: null,
      });
    } catch (error) {
      console.error(`[job ${id}] failed:`, error);
      try {
        await updateGeneration(client, id, {
          status: 'failed',
          error: errorMessage(error),
        });
      } catch (updateError) {
        console.error(`[job ${id}] could not persist failure:`, updateError);
      }
    } finally {
      // Persist the cost this job accrued, additively (initial run + every feedback job),
      // even on failure — a failed run still spent tokens. Best-effort: a cost-write
      // failure must not mask the job's own outcome.
      try {
        await persistCost(client, id, cost);
      } catch (costError) {
        console.error(`[job ${id}] could not persist cost:`, costError);
      }
      running.delete(id);
    }
  })();
}

// The article pipeline only handles 'news'/'scheme'; 'twitter' rows are dispatched
// to startSocialPostJob (see routes/generations.ts), so a twitter category never
// reaches the article jobs. Narrow the widened Category for the article engine and
// hard-fail if that routing invariant is ever violated.
function articleCategoryOf(
  category: GenerationRow['category'],
): 'news' | 'scheme' {
  if (category === 'news' || category === 'scheme') return category;
  throw new Error(
    `Article pipeline received unsupported category: ${category}`,
  );
}

// Full pipeline for a new generation: article (always — poster copy derives its
// facts from the verified article even in poster-only mode), then optionally
// copy -> scene image -> typeset poster.
export function startGenerationJob(client: SupabaseClient, id: string): void {
  runJob(client, id, async () => {
    const row = await getGeneration(client, id);
    if (!row) throw new Error(`Generation ${id} not found.`);

    await updateGeneration(client, id, {
      status: 'running',
      step: 'retrieve',
      error: null,
    });

    const result = await generateArticle(row.note, {
      category: articleCategoryOf(row.category),
      heading: row.heading ?? undefined,
      onProgress: (phase) => {
        void updateGeneration(client, id, { step: phase }).catch((error) => {
          console.error(`[job ${id}] progress update failed:`, error);
        });
      },
    });
    // Log the derived editorial angle for observability; the brief itself is not
    // persisted yet (that is a later, optional phase).
    if (result.brief) {
      console.log(`[job ${id}] editorial angle: ${result.brief.angle}`);
    }
    await updateGeneration(client, id, {
      article: result.article,
      factCheck: result.factCheck,
      referenceTitle: result.reference?.title ?? null,
      referenceUrl: result.reference?.url ?? null,
      // 5W1H is extracted from the note before drafting (see generateArticle);
      // persist it so the detail page can show the at-a-glance fact scaffold.
      fiveWOneH: result.fiveWOneH,
    });

    if (row.outputType === 'article') return;

    await updateGeneration(client, id, { step: 'copy' });
    const copy = await generateCopy(result.article);

    // ARTICLE_POSTER_MODE selects the poster renderer (default 'n8n'):
    //   'n8n'  — the external article-poster-v1-api workflow paints the whole poster,
    //            including the single Marathi headline, by editing the master template
    //            whose library URL we send as reference_url. No local scene image /
    //            HTML+Chromium render, so no scenePath is written (poster feedback +
    //            manual copy-edit, which require row.scenePath, are unavailable in
    //            this mode — accepted trade-off).
    //   'html' — the original local image + HTML/Playwright path, kept as a fallback.
    if (process.env.ARTICLE_POSTER_MODE === 'html') {
      await updateGeneration(client, id, { step: 'scene' });
      const scenePrompt = buildArticleScenePrompt(copy);
      const sceneImage = await generateImage(scenePrompt);
      recordImageCost('article', imageQuality());

      await updateGeneration(client, id, { step: 'render' });
      const poster = await generateArticlePoster({ copy, sceneImage });

      const sceneObjectPath = scenePath(id, 1);
      const posterObjectPath = posterPath(id, 1);
      await uploadPng(client, sceneObjectPath, sceneImage);
      await uploadPng(client, posterObjectPath, poster.png);

      await updateGeneration(client, id, {
        copy,
        scenePrompt,
        scenePath: sceneObjectPath,
        posterPath: posterObjectPath,
      });
      return;
    }

    await updateGeneration(client, id, { step: 'render' });
    // The master the workflow edits: the pinned image if the run has one (honored
    // even if meanwhile disabled; a deleted pin falls back), else a random pick
    // among the enabled article masters.
    const pinned = row.referenceImageId
      ? await resolvePinnedReference(client, row.referenceImageId)
      : null;
    const reference = pinned ?? (await pickArticleReference(client));
    // Rotate the headline-panel color per render so posters stop always being orange.
    // The workflow applies it conditionally (only masters that actually have a solid
    // headline panel are recoloured — the library is a mix of layouts); the
    // logo/footer chrome is code-stamped after the render (overlayArticleChrome).
    const theme = pickArticlePosterTheme();
    console.log(
      `[job ${id}] article poster reference: ${JSON.stringify({ id, referenceImageId: row.referenceImageId, pinned: Boolean(pinned), referenceUrl: reference.url, analyzed: Boolean(reference.layoutSpec), theme: theme.name })}`,
    );
    const posterPng = await renderArticlePosterViaN8n(
      id,
      copy,
      reference.url,
      '',
      theme,
      reference.layoutSpec,
    );
    // Image is painted inside n8n (gpt-image-2 @ 1536x1024); attribute the fixed tier price.
    recordImageCost('article', imageQuality());

    const posterObjectPath = posterPath(id, 1);
    await uploadPng(client, posterObjectPath, posterPng);

    await updateGeneration(client, id, {
      copy,
      posterPath: posterObjectPath,
    });
  });
}

// Shape n8n's article-poster-v1-api workflow returns from its Respond-to-Webhook node.
type ArticlePosterResult = {
  poster_png_base64?: string;
};

// Render an article poster via the external n8n `article-poster-v1-api` workflow
// (the ARTICLE_POSTER_MODE=n8n path). The verified article and its Copy are still
// produced locally by @dgipr/content-engine — facts stay source-of-truth per
// AGENTS.md — so we send only the resolved { headline, scene_brief } plus the
// immutable library URL of the master to edit (referenceUrl), and n8n *only
// renders*: its image model paints the poster body (panel, headline, photo) by
// editing that master, leaving the logo/footer reserved zones as plain background.
// The crisp brand chrome (महासंवाद logo top-left + department footer strip) is then
// composited here in code (overlayArticleChrome) — the image model can't render
// those Devanagari lockups reliably. headline is resolved here via headStrings so
// n8n stays dumb. Mirrors startSocialPostJob's fetch/timeout/error handling;
// returns the chrome-stamped poster PNG.
async function renderArticlePosterViaN8n(
  id: string,
  copy: Copy,
  referenceUrl: string,
  imageFeedback = '',
  theme?: ArticlePosterTheme,
  // The picked master's vision-derived layout (migration 0016). null on
  // un-analyzed masters AND on feedback edits (which edit the latest poster,
  // not a master) — the workflow then falls back to its generic layout-agnostic
  // prompt instead of asserting structure the master may not have.
  layoutSpec: ReferenceLayoutSpec | null = null,
  // > 0 only on annotated feedback edits: the referenced image then carries that
  // many numbered marker boxes and the workflow prompt switches to marker
  // semantics (apply each numbered change at its marker, then erase the marks).
  markerCount = 0,
): Promise<Buffer> {
  const webhookUrl = requireEnv('N8N_ARTICLE_POSTER_WEBHOOK_URL');
  const webhookSecret = process.env.N8N_WEBHOOK_SECRET;

  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (webhookSecret) headers['x-n8n-webhook-secret'] = webhookSecret;

  const { headline } = headStrings(copy);

  // Generous timeout to outlast the workflow's ~1-2 min gpt-image-2 edit stage.
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      headline,
      scene_brief: copy.scene_brief,
      generation_id: id,
      reference_url: referenceUrl,
      image_feedback: imageFeedback,
      marker_count: markerCount,
      // Panel/headline color for this render (initial renders only). Empty on the
      // image-feedback edit path so the workflow preserves the current poster's
      // colors; empty also makes the workflow fall back to its original orange.
      panel_color: theme?.panelHex ?? '',
      panel_color_name: theme?.name ?? '',
      headline_color: theme?.headlineHex ?? '',
      // The master's own structure, so the workflow prompt describes THIS master
      // instead of a hardcoded anatomy. Flattened to strings (the workflow's Set
      // node stays all-primitive); has_photo_zone is tri-state 'true'/'false'/''
      // where '' = unknown (un-analyzed master or feedback edit).
      layout_summary: layoutSpec?.layoutSummary ?? '',
      has_photo_zone: layoutSpec ? String(layoutSpec.hasPhotoZone) : '',
    }),
    signal: AbortSignal.timeout(420_000),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(
      `n8n article-poster webhook failed (${response.status}): ${detail.slice(0, 500)}`,
    );
  }

  const result = (await response.json()) as ArticlePosterResult;
  if (!result.poster_png_base64) {
    throw new Error('n8n article-poster webhook returned no poster.');
  }
  // Stamp the static logo/footer PNGs over their reserved zones. Also runs on the
  // image-feedback path (the input poster already carries the chrome; re-stamping
  // heals any drift the edit introduced).
  return overlayArticleChrome(Buffer.from(result.poster_png_base64, 'base64'));
}

// Shape n8n's social-post-v2-api workflow returns from its Respond-to-Webhook node.
type SocialPostResult = {
  post_type?: string;
  title?: string;
  caption?: string;
  poster_png_base64?: string;
};

// Re-edit a completed Twitter poster without rerunning classify/copy/caption.
// The workflow's dedicated feedback branch accepts only the latest poster URL
// plus the user's requested visual change and returns a replacement PNG.
async function renderSocialPosterFeedbackViaN8n(
  id: string,
  currentPosterUrl: string,
  feedback: string,
  // > 0 when currentPosterUrl carries numbered marker boxes (see the article
  // renderer's note above).
  markerCount = 0,
): Promise<Buffer> {
  const webhookUrl = requireEnv('N8N_SOCIAL_POST_WEBHOOK_URL');
  const webhookSecret = process.env.N8N_WEBHOOK_SECRET;

  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (webhookSecret) headers['x-n8n-webhook-secret'] = webhookSecret;

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      generation_id: id,
      image_feedback: feedback,
      current_poster_url: currentPosterUrl,
      marker_count: markerCount,
      // Always-present placeholders keep the shared Set node deterministic;
      // the feedback branch bypasses every consumer of these initial-run fields.
      meeting_notes: '',
      design_mode: 'onbrand',
      progress_url: '',
      types: [],
      forced_type: '',
      forced_reference_url: '',
    }),
    signal: AbortSignal.timeout(420_000),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(
      `n8n social-poster feedback webhook failed (${response.status}): ${detail.slice(0, 500)}`,
    );
  }

  const result = (await response.json()) as SocialPostResult;
  if (!result.poster_png_base64) {
    throw new Error('n8n social-poster feedback webhook returned no poster.');
  }
  // The workflow leaves the emblem/footer reserved zones untouched; re-stamp the
  // chrome so any drift from the edit is corrected (mirrors the article path).
  return overlayTwitterChrome(Buffer.from(result.poster_png_base64, 'base64'));
}

// Twitter pipeline: the heavy lifting (classify → copy → image → caption) runs in the
// external n8n `social-post-v2-api` workflow. This job is a thin orchestrator — it
// POSTs the note to the webhook, awaits the JSON result, then uploads the returned PNG
// to Supabase Storage (Supabase creds stay in the API, never in n8n, per AGENTS.md).
// n8n reports stage progress out-of-band via the /progress endpoint (progress_url),
// so this function only sets the initial running state and persists the final result.
export function startSocialPostJob(client: SupabaseClient, id: string): void {
  runJob(client, id, async () => {
    const row = await getGeneration(client, id);
    if (!row) throw new Error(`Generation ${id} not found.`);

    const webhookUrl = requireEnv('N8N_SOCIAL_POST_WEBHOOK_URL');
    const apiPublicUrl = requireEnv('API_PUBLIC_URL');
    const webhookSecret = process.env.N8N_WEBHOOK_SECRET;

    await updateGeneration(client, id, {
      status: 'running',
      step: null,
      error: null,
    });

    // The type catalog the workflow's classify/copy/image nodes run on. Sent even
    // in 'fresh' mode (classification still needs the type descriptions; the
    // reference URLs just go unused) so the empty-catalog failure applies
    // uniformly. A pin forces the type + master and skips classification.
    const pinned: PinnedReference | null = row.referenceImageId
      ? await resolvePinnedReference(client, row.referenceImageId)
      : row.referenceTypeId
        ? await resolvePinnedTypeReference(client, row.referenceTypeId)
        : null;
    const types = await buildTwitterCatalog(client, pinned ?? undefined);
    const forcedType = pinned?.subtype ?? '';
    const forcedReferenceUrl = pinned?.url ?? '';
    console.log(
      `[job ${id}] social poster reference: ${JSON.stringify({ id, referenceImageId: row.referenceImageId, referenceTypeId: row.referenceTypeId, forced_type: forcedType, forced_reference_url: forcedReferenceUrl })}`,
    );

    const headers: Record<string, string> = {
      'content-type': 'application/json',
    };
    if (webhookSecret) headers['x-n8n-webhook-secret'] = webhookSecret;

    // Generous timeout to outlast the workflow's ~6-min image generation stage.
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        meeting_notes: row.note,
        design_mode: row.designMode ?? 'onbrand',
        generation_id: id,
        progress_url: `${apiPublicUrl}/api/generations/${id}/progress`,
        types,
        // Always-present strings (empty = not pinned) so the workflow's IF node
        // sees a definite value.
        forced_type: forcedType,
        forced_reference_url: forcedReferenceUrl,
        // Markers only exist on annotated feedback edits; keep the Set node's
        // number field deterministic on initial runs too.
        marker_count: 0,
      }),
      signal: AbortSignal.timeout(420_000),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(
        `n8n social-post webhook failed (${response.status}): ${detail.slice(0, 500)}`,
      );
    }

    const result = (await response.json()) as SocialPostResult;
    if (!result.caption || !result.poster_png_base64) {
      throw new Error('n8n social-post webhook returned no caption or poster.');
    }
    // The whole twitter pipeline (classify/copy/caption text + image) runs inside n8n;
    // only the image (gpt-image-2 @ 1280x1600) is attributed here. The gpt-4o-mini text
    // is external and not measured (negligible, <$0.001), so the stored cost is image-only.
    recordImageCost('twitter', imageQuality());

    // The workflow paints the poster body only (the prompt erases the master's
    // emblem/footer and reserves those zones); the crisp brand chrome is stamped
    // here in code, exactly like the article path's overlayArticleChrome.
    const posterPng = await overlayTwitterChrome(
      Buffer.from(result.poster_png_base64, 'base64'),
    );
    const posterObjectPath = posterPath(id, 1);
    await uploadPng(client, posterObjectPath, posterPng);

    // Caption → article column; classifier title → referenceTitle (surfaced in UI).
    await updateGeneration(client, id, {
      article: result.caption,
      referenceTitle: result.title ?? null,
      posterPath: posterObjectPath,
    });
  });
}

// Feedback loop for the article: revise under the original guardrails (note stays
// the sole fact source) and snapshot the result in the revision log. 5W1H is NOT
// re-derived here — it's extracted from the immutable note, so it never goes stale
// on revision; leave the persisted fiveWOneH untouched.
export function startArticleFeedbackJob(
  client: SupabaseClient,
  id: string,
  feedback: string,
): void {
  runJob(client, id, async () => {
    const row = await getGeneration(client, id);
    if (!row) throw new Error(`Generation ${id} not found.`);
    if (!row.article) throw new Error(`Generation ${id} has no article yet.`);

    await updateGeneration(client, id, {
      status: 'running',
      step: 'revise_article',
      error: null,
    });

    const currentContent = row.factCheck
      ? `${row.article}\n\n${FACT_CHECK_DELIMITER}\n${row.factCheck}`
      : row.article;
    const revised = await reviseArticle(
      row.note,
      currentContent,
      feedback,
      articleCategoryOf(row.category),
      row.heading ?? undefined,
    );

    await updateGeneration(client, id, {
      article: revised.article,
      factCheck: revised.factCheck,
    });
    await insertRevision(client, {
      generationId: id,
      target: 'article',
      feedback,
      article: revised.article,
      factCheck: revised.factCheck,
    });
  });
}

// Article feedback that runs *beside* the still-in-flight poster render, so the user
// can refine the article without waiting out the ~1-2 min render (the route dispatches
// here only while the initial job is in its poster phase; the settled case uses
// startArticleFeedbackJob above). Deliberately NOT wrapped in runJob: it must not claim
// `running` (the poster job holds it) nor write status/step/error — flipping the row to
// completed/failed would derail the poster run's polling. It writes only the disjoint
// article/factCheck columns (updateGeneration is a partial update) + the revision log,
// and reports its liveness/last-failure through revisingArticle/reviseArticleErrors.
// The in-flight poster is unaffected: generateCopy already ran on the in-memory
// pre-revision article, so it keeps the old copy (an accepted trade-off — the user can
// re-render the poster afterward).
export function startConcurrentArticleFeedbackJob(
  client: SupabaseClient,
  id: string,
  feedback: string,
): void {
  revisingArticle.add(id);
  reviseArticleErrors.delete(id);
  void (async () => {
    const cost = createCostAccumulator();
    try {
      await runInCostScope(cost, async () => {
        const row = await getGeneration(client, id);
        if (!row) throw new Error(`Generation ${id} not found.`);
        if (!row.article)
          throw new Error(`Generation ${id} has no article yet.`);

        const currentContent = row.factCheck
          ? `${row.article}\n\n${FACT_CHECK_DELIMITER}\n${row.factCheck}`
          : row.article;
        const revised = await reviseArticle(
          row.note,
          currentContent,
          feedback,
          articleCategoryOf(row.category),
          row.heading ?? undefined,
        );

        await updateGeneration(client, id, {
          article: revised.article,
          factCheck: revised.factCheck,
        });
        await insertRevision(client, {
          generationId: id,
          target: 'article',
          feedback,
          article: revised.article,
          factCheck: revised.factCheck,
        });
      });
    } catch (error) {
      console.error(`[revise-article ${id}] failed:`, error);
      reviseArticleErrors.set(id, errorMessage(error));
    } finally {
      try {
        await persistCost(client, id, cost);
      } catch (costError) {
        console.error(
          `[revise-article ${id}] could not persist cost:`,
          costError,
        );
      }
      revisingArticle.delete(id);
    }
  })();
}

// On-demand English translation of an article. Runs the glossary-locked Sarvam
// translation (verified proper-noun mappings present in this article are passed as
// LOCKED TERMS so a known name is never mistranslated) and persists the result to
// articleEnglish. The Marathi article is never mutated.
//
// `confirmedTerms` is the user-reviewed name list from the pre-translation check
// (prepareTranslationTerms → the web review card). When present, each mapping is
// saved as a VERIFIED glossary row before translating — so the confirmed spellings
// lock into THIS run, not just future ones — and the post-translation candidate
// mining is skipped (the same extraction already ran at prepare time; re-mining
// would only double the spend). Without it (older client), the legacy path mines
// unverified candidates into the review queue after the fact.
//
// Deliberately NOT wrapped in runJob: this is the one job that may run beside
// another (the poster render, which is still in flight when the article first
// appears on screen), so it must not claim `running` or write status/step/error —
// setting status='completed' here would end the poster run's polling, and
// status='failed' would erase a perfectly good poster job. It reports itself
// through the `translating` set + `translateErrors` map instead.
export function startTranslateJob(
  client: SupabaseClient,
  id: string,
  confirmedTerms?: readonly TranslationTermInput[],
): void {
  translating.add(id);
  translateErrors.delete(id);
  void (async () => {
    const cost = createCostAccumulator();
    try {
      await runInCostScope(cost, async () => {
        const row = await getGeneration(client, id);
        if (!row) throw new Error(`Generation ${id} not found.`);
        if (!row.article)
          throw new Error(`Generation ${id} has no article yet.`);

        // Persist the user-confirmed names first: a human just asserted these exact
        // spellings, so they overwrite any existing row (upsert by Marathi key) and
        // are verified — findGlossaryTermsInText below then picks them up. Saved
        // before translating so a translation failure never loses the review work.
        if (confirmedTerms) {
          for (const term of confirmedTerms) {
            await upsertGlossaryTerm(client, {
              marathi: term.marathi,
              english: term.english,
              termType: term.termType ?? 'other',
              verified: true,
              source: 'manual',
            });
          }
        }

        // Verified glossary terms whose Marathi form appears in this article become
        // the LOCKED TERMS table the translator must reuse verbatim.
        const terms = await findGlossaryTermsInText(client, row.article);
        const glossary = terms.map((t) => ({
          marathi: t.marathi,
          english: t.english,
        }));

        const english = await translateArticleToEnglish(row.article, glossary);
        await updateGeneration(client, id, { articleEnglish: english });

        // Legacy path only: grow the review queue by mining proper nouns →
        // unverified candidates. The upsert ignores duplicates, so verified/
        // human-edited rows are never clobbered. Best-effort — a mining failure
        // must not fail an already-persisted translation.
        if (!confirmedTerms) {
          try {
            const candidates = await extractGlossaryCandidates(row.article);
            await insertGlossaryCandidates(
              client,
              candidates.map((c) => ({
                ...c,
                source: 'auto' as const,
                verified: false,
              })),
            );
          } catch (error) {
            console.error(`[translate ${id}] candidate mining failed:`, error);
          }
        }
      });
    } catch (error) {
      console.error(`[translate ${id}] failed:`, error);
      translateErrors.set(id, errorMessage(error));
    } finally {
      try {
        await persistCost(client, id, cost);
      } catch (costError) {
        console.error(`[translate ${id}] could not persist cost:`, costError);
      }
      translating.delete(id);
    }
  })();
}

// Feedback loop for the poster. target 'copy' revises the Marathi text and
// re-renders with the CACHED scene (cheap, no image-gen call); target 'scene'
// generates a new background image from a revised scene brief, then re-renders.
export function startPosterFeedbackJob(
  client: SupabaseClient,
  id: string,
  target: 'copy' | 'scene',
  feedback: string,
): void {
  runJob(client, id, async () => {
    const row = await getGeneration(client, id);
    if (!row) throw new Error(`Generation ${id} not found.`);
    const copy = requireCopy(row);
    if (!row.scenePath) throw new Error(`Generation ${id} has no poster yet.`);

    await updateGeneration(client, id, {
      status: 'running',
      step: target === 'copy' ? 'revise_copy' : 'revise_scene',
      error: null,
    });

    const version = await nextVersion(client, id);

    if (target === 'copy') {
      if (!row.article) throw new Error(`Generation ${id} has no article.`);
      const revisedCopy = await reviseCopy(copy, feedback, row.article);

      await updateGeneration(client, id, { step: 'render' });
      const sceneImage = await downloadPng(client, row.scenePath);
      const poster = await generateArticlePoster({
        copy: revisedCopy,
        sceneImage,
      });

      const posterObjectPath = posterPath(id, version);
      await uploadPng(client, posterObjectPath, poster.png);
      await updateGeneration(client, id, {
        copy: revisedCopy,
        posterPath: posterObjectPath,
      });
      await insertRevision(client, {
        generationId: id,
        target: 'poster_copy',
        feedback,
        copy: revisedCopy,
        posterPath: posterObjectPath,
      });
      return;
    }

    const sceneBrief = await reviseSceneBrief(copy.scene_brief, feedback);
    const revisedCopy: Copy = { ...copy, scene_brief: sceneBrief };

    await updateGeneration(client, id, { step: 'scene' });
    const scenePrompt = buildArticleScenePrompt(revisedCopy);
    const sceneImage = await generateImage(scenePrompt);
    recordImageCost('article', imageQuality());

    await updateGeneration(client, id, { step: 'render' });
    const poster = await generateArticlePoster({
      copy: revisedCopy,
      sceneImage,
    });

    const sceneObjectPath = scenePath(id, version);
    const posterObjectPath = posterPath(id, version);
    await uploadPng(client, sceneObjectPath, sceneImage);
    await uploadPng(client, posterObjectPath, poster.png);

    await updateGeneration(client, id, {
      copy: revisedCopy,
      scenePrompt,
      scenePath: sceneObjectPath,
      posterPath: posterObjectPath,
    });
    await insertRevision(client, {
      generationId: id,
      target: 'poster_scene',
      feedback,
      copy: revisedCopy,
      scenePrompt,
      scenePath: sceneObjectPath,
      posterPath: posterObjectPath,
    });
  });
}

// Pixel-level poster feedback for the default n8n render paths. Each request
// edits the latest persisted poster, so multiple revisions build on one another.
// The caption/article and structured copy remain unchanged.
//
// With marker annotations, the edit gets a location signal the plain text path
// never had: the current poster is re-uploaded with numbered marker boxes drawn
// on (annotateFeedbackRegions), a vision pass turns the marks + notes into one
// element-aware instruction (interpretImageFeedback, raw notes on failure), and
// n8n edits the MARKED image under marker-count prompt semantics. Without
// annotations every value below equals the old behaviour byte-for-byte.
export function startPosterImageFeedbackJob(
  client: SupabaseClient,
  id: string,
  input: PosterImageFeedbackRequest,
): void {
  runJob(client, id, async () => {
    const row = await getGeneration(client, id);
    if (!row) throw new Error(`Generation ${id} not found.`);
    if (!row.posterPath) {
      throw new Error(`Generation ${id} has no poster yet.`);
    }

    await updateGeneration(client, id, {
      status: 'running',
      step: 'revise_image',
      error: null,
    });

    const annotations = input.annotations ?? [];
    const version = await nextVersion(client, id);
    let inputUrl = publicUrl(client, row.posterPath);
    let feedbackText = input.feedback ?? '';
    // Revision history keeps the user's own words, never the machine text.
    let historyFeedback = feedbackText;

    if (annotations.length > 0) {
      const cleanPoster = await downloadPng(client, row.posterPath);
      const marked = await annotateFeedbackRegions(
        cleanPoster,
        annotations.map((a) => a.region),
      );
      // Throwaway n8n input — never a posterPath / revision snapshot, so it
      // can't enter the version strip. The version counter only advances when
      // the round succeeds (insertRevision runs last), so a failed round
      // orphans this object and a retry recomputes the SAME version; the
      // timestamp makes each attempt's path unique. upsert is not an option:
      // the public bucket is CDN-cached and paths must never be reused (n8n
      // could fetch the stale cached image).
      const markedPath = `generations/${id}/feedback-marked-v${version}-${Date.now()}.png`;
      await uploadPng(client, markedPath, marked);
      inputUrl = publicUrl(client, markedPath);

      const interpreted = await interpretImageFeedback({
        markedPosterPng: marked,
        annotations: annotations.map((a, i) => ({
          index: i + 1,
          note: a.note,
          region: a.region,
        })),
        overallNote: input.feedback,
        posterKind: row.category === 'twitter' ? 'twitter' : 'article',
      });
      console.log(
        `[job ${id}] marker feedback (${interpreted.source}): ${interpreted.instruction}`,
      );
      feedbackText = interpreted.instruction;
      historyFeedback = [
        ...annotations.map((a, i) => `[${i + 1}] ${a.note}`),
        ...(input.feedback ? [input.feedback] : []),
      ].join('\n');
    }

    let posterPng: Buffer;
    if (row.category === 'twitter') {
      posterPng = await renderSocialPosterFeedbackViaN8n(
        id,
        inputUrl,
        feedbackText,
        annotations.length,
      );
      recordImageCost('twitter', imageQuality());
    } else {
      const copy = requireCopy(row);
      posterPng = await renderArticlePosterViaN8n(
        id,
        copy,
        inputUrl,
        feedbackText,
        undefined,
        null,
        annotations.length,
      );
      recordImageCost('article', imageQuality());
    }

    const posterObjectPath = posterPath(id, version);
    await uploadPng(client, posterObjectPath, posterPng);
    await updateGeneration(client, id, { posterPath: posterObjectPath });
    await insertRevision(client, {
      generationId: id,
      target: 'poster_image',
      feedback: historyFeedback,
      posterPath: posterObjectPath,
    });
  });
}
