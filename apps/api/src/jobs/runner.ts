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
  extractGlossaryCandidates,
  generateArticle,
  generateCopy,
  reviseArticle,
  reviseCopy,
  reviseSceneBrief,
  translateArticleToEnglish,
} from '@dgipr/content-engine';
import {
  buildArticleScenePrompt,
  generateImage,
  generateArticlePoster,
  headStrings,
} from '@dgipr/poster-renderer';
import {
  findGlossaryTermsInText,
  getGeneration,
  insertGlossaryCandidates,
  insertRevision,
  listRevisions,
  updateGeneration,
  uploadPng,
  downloadPng,
  type GenerationRow,
  type SupabaseClient,
} from '@dgipr/database';
import { CopySchema, type Copy } from '@dgipr/schemas';

const running = new Set<string>();

export function isJobRunning(id: string): boolean {
  return running.has(id);
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

// Wrap a job body with the shared bookkeeping: claim the id, flip the row to
// running, persist completed/failed, always release the id.
function runJob(
  client: SupabaseClient,
  id: string,
  job: () => Promise<void>,
): void {
  running.add(id);
  void (async () => {
    try {
      await job();
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
  throw new Error(`Article pipeline received unsupported category: ${category}`);
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
    //            including the single Marathi headline, by editing the master-article
    //            template. No local scene image / HTML+Chromium render, so no scenePath
    //            is written (poster feedback + manual copy-edit, which require
    //            row.scenePath, are unavailable in this mode — accepted trade-off).
    //   'html' — the original local image + HTML/Playwright path, kept as a fallback.
    if (process.env.ARTICLE_POSTER_MODE === 'html') {
      await updateGeneration(client, id, { step: 'scene' });
      const scenePrompt = buildArticleScenePrompt(copy);
      const sceneImage = await generateImage(scenePrompt);

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
    const posterPng = await renderArticlePosterViaN8n(id, copy);

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
// AGENTS.md — so we send only the resolved { headline, scene_brief } and n8n *only
// renders*: its image model paints the whole poster (including the single Marathi
// headline) by editing the master-article template. headline is resolved here via
// headStrings so n8n stays dumb. Mirrors startSocialPostJob's fetch/timeout/error
// handling; returns the decoded poster PNG.
async function renderArticlePosterViaN8n(id: string, copy: Copy): Promise<Buffer> {
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
  return Buffer.from(result.poster_png_base64, 'base64');
}

// Shape n8n's social-post-v2-api workflow returns from its Respond-to-Webhook node.
type SocialPostResult = {
  post_type?: string;
  title?: string;
  caption?: string;
  poster_png_base64?: string;
};

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

    const posterPng = Buffer.from(result.poster_png_base64, 'base64');
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

// On-demand English translation of a completed article. Runs the glossary-locked
// Sarvam translation (verified proper-noun mappings present in this article are
// passed as LOCKED TERMS so a known name is never mistranslated) and persists the
// result to articleEnglish. The Marathi article is never mutated. Candidate mining
// grows the review queue but must never fail the translation.
export function startTranslateJob(client: SupabaseClient, id: string): void {
  runJob(client, id, async () => {
    const row = await getGeneration(client, id);
    if (!row) throw new Error(`Generation ${id} not found.`);
    if (!row.article) throw new Error(`Generation ${id} has no article yet.`);

    await updateGeneration(client, id, {
      status: 'running',
      step: 'translate',
      error: null,
    });

    // Verified glossary terms whose Marathi form appears in this article become the
    // LOCKED TERMS table the translator must reuse verbatim.
    const terms = await findGlossaryTermsInText(client, row.article);
    const glossary = terms.map((t) => ({
      marathi: t.marathi,
      english: t.english,
    }));

    const english = await translateArticleToEnglish(row.article, glossary);
    await updateGeneration(client, id, { articleEnglish: english });

    // Grow the review queue: auto-mine proper nouns → unverified candidates. The
    // upsert ignores duplicates, so verified/human-edited rows are never clobbered.
    // Best-effort — a mining failure must not fail an already-persisted translation.
    try {
      const candidates = await extractGlossaryCandidates(row.article);
      await insertGlossaryCandidates(
        client,
        candidates.map((c) => ({ ...c, source: 'auto' as const, verified: false })),
      );
    } catch (error) {
      console.error(`[translate ${id}] candidate mining failed:`, error);
    }
  });
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
