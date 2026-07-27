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
  buildArticleFeedbackPrompt,
  buildArticlePosterPrompt,
  buildFeedbackPrompt,
  buildPosterPrompt,
  classifyPosterType,
  createCostAccumulator,
  extractGlossaryCandidates,
  generateArtDirection,
  applyDesignations,
  generateArticle,
  generateArticleSimple,
  generateCopy,
  generatePosterCopy,
  generateSocialCaption,
  interpretImageFeedback,
  listSocialTypes,
  buildPosterStyle,
  familyHonoured,
  parsePosterStyle,
  pickArticleLayout,
  pickArticleReference,
  pickLayout,
  pickPalette,
  resolvePosterSubject,
  toStyleHistory,
  recordImageCost,
  resolveCmoReference,
  resolvePinnedImage,
  resolvePinnedType,
  selectMaster,
  reviseArticle,
  reviseCaption,
  reviseCopy,
  reviseSceneBrief,
  runInCostScope,
  translateArticle,
  type ArticleDesignMode,
  type ImageQuality,
  type PaletteFamily,
  type PosterDesignMode,
  type PosterStyle,
  type PosterSubject,
  type ResolvedReference,
  type StyleHistory,
} from '@dgipr/content-engine';
import {
  annotateFeedbackRegions,
  buildArticleScenePrompt,
  buildCmoCirclePhotoPrompt,
  generateImage,
  generateArticlePoster,
  headStrings,
  measurePosterColours,
  overlayArticleChrome,
  overlayCmoChrome,
  overlayTwitterChrome,
} from '@dgipr/poster-renderer';
import {
  addGenerationCost,
  findGlossaryTermsInText,
  getGeneration,
  insertGlossaryCandidates,
  insertRevision,
  listRecentPosterStyles,
  listRevisions,
  publicUrl,
  updateGeneration,
  uploadPng,
  downloadPng,
  upsertGlossaryTerm,
  type GenerationCostIncrement,
  type GenerationRow,
  type SupabaseClient,
  type TemplateBrand,
} from '@dgipr/database';
import {
  AttributedStatementsSchema,
  CopySchema,
  NameDesignationsSchema,
  SelectedFactsSchema,
  TWEET_MAX_LENGTH,
  isSocialCategory,
  type Copy,
  type AttributedStatement,
  type DesignationWarning,
  type NameDesignation,
  type SelectedFact,
  type PosterImageFeedbackRequest,
  type TranslationLanguage,
  type TranslationTermInput,
} from '@dgipr/schemas';
import { listKnownDesignations } from './translation-terms.js';

const running = new Set<string>();

// Translation is the one job that may run *alongside* another job on the same
// generation: the article is final and persisted before the poster phase starts, so
// the user can ask for English (or Hindi) while the poster is still rendering. It
// therefore cannot use the row's status/step/error — those belong to the main job —
// and keeps its liveness + last failure here instead. The detail route reports both
// to the UI. The map's VALUE is the language in flight, so a client that reloads
// mid-run can still label the spinner; membership alone means "a translation is
// running" — still one at a time per row, whichever language.
const translating = new Map<string, TranslationLanguage>();
const translateErrors = new Map<string, string>();
// Locked names the last Hindi translation could not preserve. Transient like
// translateErrors (in-process, reset on restart) because the doubt is worth raising when
// the officer reads the fresh output, not forever: the translation itself is on the row.
// A [] entry means "translated, nothing to flag"; absent means no translation this session.
const translateWarnings = new Map<string, string[]>();

// Approved पदनामे the article could not carry as approved — the full name never appeared, or a
// different title was found in front of it and replaced. Transient for exactly the reason
// translateWarnings is: the article is on the row, this is a "look at this" prompt that matters
// while the officer is reading the fresh output. A [] entry means every designation applied
// cleanly; absent means this run predates the session (or approved none).
const designationWarnings = new Map<string, DesignationWarning[]>();

// Article revision may likewise run *alongside* the poster render: the article is
// final and persisted before the poster phase starts, so the user can refine it
// without waiting out the ~1-2 min render. Like translation it therefore cannot use
// the row's status/step/error (those belong to the main job) and keeps its liveness +
// last failure here. The settled-run article revision still goes through the
// status-owning startArticleFeedbackJob; this pair is only for the concurrent path.
const revisingArticle = new Set<string>();
const reviseArticleErrors = new Map<string, string>();

// A social run's caption work — an AI revision, or writing the first caption for a run
// created poster-only — reports itself the same way, for the same reason: the caption
// lives on a *settled* row (status 'completed'), and flipping that row to running would
// swap the finished poster + caption for a progress bar in the UI. Keeping it out of
// status/step also lets a caption edit run beside a poster re-render — the two write
// disjoint columns (article vs posterPath). One caption job at a time per row, either kind.
const revisingCaption = new Set<string>();
const captionReviseErrors = new Map<string, string>();

export function isJobRunning(id: string): boolean {
  return running.has(id);
}

export function isTranslating(id: string): boolean {
  return translating.has(id);
}

// Which language the in-flight translation targets (null when none is running).
export function getTranslatingLanguage(id: string): TranslationLanguage | null {
  return translating.get(id) ?? null;
}

export function getTranslateError(id: string): string | null {
  return translateErrors.get(id) ?? null;
}

// Names the last Hindi translation could not preserve (null when none ran this session).
export function getTranslateWarnings(id: string): string[] | null {
  return translateWarnings.get(id) ?? null;
}

// Approved designations the latest article/revision could not apply as approved.
export function getDesignationWarnings(id: string): DesignationWarning[] {
  return designationWarnings.get(id) ?? [];
}

export function isRevisingArticle(id: string): boolean {
  return revisingArticle.has(id);
}

export function getReviseArticleError(id: string): string | null {
  return reviseArticleErrors.get(id) ?? null;
}

export function isRevisingCaption(id: string): boolean {
  return revisingCaption.has(id);
}

export function getCaptionReviseError(id: string): string | null {
  return captionReviseErrors.get(id) ?? null;
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
// The CMO poster's single circle photograph, generated + composited in code. Unversioned
// and stable: the photo never changes across feedback rounds (a text/layout edit must not
// swap it), so it is written once on the initial render and re-read on every feedback
// re-composite. It is an intermediate asset (never served to end users directly), so the
// CDN "never reuse a path" rule — which guards against stale cached content — does not apply.
function cmoPhotoPath(id: string): string {
  return `generations/${id}/cmo-photo.png`;
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

// The article pipeline only handles 'news'/'scheme'; the social categories
// ('twitter'/'facebook') are dispatched to startSocialPostJob (see
// routes/generations.ts), so they never reach the article jobs. Narrow the widened
// Category for the article engine and hard-fail if that routing invariant is ever
// violated — this is the backstop for a missed isSocialCategory branch.
function articleCategoryOf(
  category: GenerationRow['category'],
): 'news' | 'scheme' {
  if (category === 'news' || category === 'scheme') return category;
  throw new Error(
    `Article pipeline received unsupported category: ${category}`,
  );
}

// The row's approved person → पदनाम pairs (migration 0033). Stored as jsonb, so the shape is
// validated here rather than trusted: a malformed or pre-0033 value degrades to "no
// designations", which is exactly the article the note would have produced anyway.
// Which article pipeline runs. 'simple' (the unset default) is the single-call baseline: one
// style reference, one model call on ARTICLE_MODEL, one article — no editorial brief, no
// coverage-revision loop, no faithfulness repair, no traceability appendix. 'full' restores the
// multi-stage pipeline exactly as it was; generate-article.ts and every stage module it calls
// are untouched, so rollback is this one env line plus a restart.
//
// Read here rather than inside the engine, beside the ARTICLE_POSTER_MODE precedent: apps/api
// sequences and chooses, the engine computes.
function articleGenerationMode(): 'simple' | 'full' {
  return process.env.ARTICLE_GENERATION_MODE === 'full' ? 'full' : 'simple';
}

// Whether this row's article carries a traceability appendix, and therefore whether a revision
// should rebuild one. Keyed off the STORED article rather than the current mode, deliberately:
// a row generated before the flag was flipped either way must keep behaving like itself, and a
// simple-mode article must not silently sprout a तथ्य-तपासणी fold (plus an extra model pass) on
// its first feedback round. News never had an appendix, so this only ever matters for scheme.
function rowHasFactCheck(row: GenerationRow): boolean {
  return (row.factCheck ?? '').trim().length > 0;
}

export function nameDesignationsOf(row: GenerationRow): NameDesignation[] {
  const parsed = NameDesignationsSchema.safeParse(row.nameDesignations ?? []);
  return parsed.success ? [...parsed.data] : [];
}

// LEGACY ROWS ONLY — do not delete. /dlo's Pointers step became a read-only summary, so no
// new run stores an approved inventory and both of these return [] for a fresh generation
// (which then takes the pre-0034 raw-note path). They stay because the row is re-read on
// EVERY run: a retry or an article-feedback round on any pre-change generation still needs
// its stored contract, and a `null` column safe-parses to [] rather than throwing.
export function selectedFactsOf(row: GenerationRow): SelectedFact[] {
  const parsed = SelectedFactsSchema.safeParse(row.selectedFacts ?? []);
  return parsed.success ? [...parsed.data] : [];
}

export function statementsOf(row: GenerationRow): AttributedStatement[] {
  const parsed = AttributedStatementsSchema.safeParse(row.statements ?? []);
  return parsed.success ? [...parsed.data] : [];
}

// Everything the article pipeline needs to apply designations: the approved pairs plus the
// dictionary's other titles, which are used ONLY to recognise a wrong one the model wrote in
// front of an approved name. The known-title lookup is best-effort — losing it costs the
// "replace a wrong title" repair, never the designation itself.
async function designationContext(
  client: SupabaseClient,
  row: GenerationRow,
): Promise<{
  designations: NameDesignation[];
  knownDesignations: string[];
}> {
  const designations = nameDesignationsOf(row);
  if (designations.length === 0) {
    return { designations, knownDesignations: [] };
  }
  try {
    return {
      designations,
      knownDesignations: await listKnownDesignations(client),
    };
  } catch (error) {
    console.warn(
      `[designations] could not load known designations; continuing:`,
      error,
    );
    return { designations, knownDesignations: [] };
  }
}

// Full pipeline for a new generation: article (always — poster copy derives its
// facts from the verified article even in poster-only mode), then optionally
// copy -> scene image -> typeset poster.
export function startGenerationJob(client: SupabaseClient, id: string): void {
  runJob(client, id, async () => {
    const row = await getGeneration(client, id);
    if (!row) throw new Error(`Generation ${id} not found.`);

    // Media-room flow: the note IS the finished article. Skip retrieval + article
    // generation entirely — persist the note verbatim as the article and derive the
    // poster copy straight from it. (No factCheck/5W1H/brief is produced; those
    // columns stay null and the detail page treats them as optional.)
    if (row.articleProvided) {
      // Designations still apply here, even though nothing is generated: the officer pasted an
      // article and approved "this person is named with this title", so the same deterministic
      // pass normalises the first mention. There is no prompt half on this path — the pass IS
      // the feature — and with no approved pairs it returns the pasted text unchanged.
      const provided = await designationContext(client, row);
      const providedResult = applyDesignations(
        row.note,
        provided.designations,
        { knownDesignations: provided.knownDesignations },
      );
      designationWarnings.set(id, [...providedResult.issues]);
      const providedArticle = providedResult.text;

      await updateGeneration(client, id, {
        status: 'running',
        step: 'copy',
        article: providedArticle,
        error: null,
      });
      // Defensive — the media-room page never sends outputType 'article', but if
      // it did there is no poster to render.
      if (row.outputType === 'article') return;
      await runArticlePosterPhase(
        client,
        id,
        providedArticle,
        row.referenceImageId,
        {
          note: providedArticle,
          posterHeading: row.posterHeading,
        },
      );
      return;
    }

    await updateGeneration(client, id, {
      status: 'running',
      step: 'retrieve',
      error: null,
    });

    // Person → पदनाम pairs the officer approved before generating (migration 0033), plus the
    // dictionary's other titles so a wrong one in front of an approved name can be corrected.
    const { designations, knownDesignations } = await designationContext(
      client,
      row,
    );

    const progress = (phase: string): void => {
      void updateGeneration(client, id, { step: phase }).catch((error) => {
        console.error(`[job ${id}] progress update failed:`, error);
      });
    };
    // Facts the officer deselected in the /dlo Pointers step (migration 0030). Threaded into
    // drafting so a dropped fact is not re-added. Null on every non-DLO run, which both
    // pipelines treat as "exclude nothing".
    const shared = {
      category: articleCategoryOf(row.category),
      heading: row.heading ?? undefined,
      excludeFacts: row.excludedFacts ?? undefined,
      includeFacts: selectedFactsOf(row),
      statements: statementsOf(row),
      designations,
      knownDesignations,
    } as const;

    const mode = articleGenerationMode();
    const result =
      mode === 'simple'
        ? await (async () => {
            const simple = await generateArticleSimple(row.note, {
              ...shared,
              // Tier 1 of the style-reference hierarchy (migration 0035). Read off the ROW, so
              // a retry reproduces the same reference rather than silently re-styling.
              styleReference: row.styleReference,
              // location/date are deliberately not supplied: nothing in the product collects
              // them from trusted input yet, and no call is added to infer them. The prompt
              // omits the dateline entirely rather than inventing one.
              onProgress: progress,
            });
            return {
              article: simple.article,
              factCheck: simple.factCheck,
              referenceTitle: simple.styleReference.title,
              referenceUrl: simple.styleReference.url,
              fiveWOneH: simple.fiveWOneH,
              designationIssues: simple.designationIssues,
              styleReferenceMeta: simple.styleReferenceMeta as unknown,
            };
          })()
        : await (async () => {
            const full = await generateArticle(row.note, {
              ...shared,
              onProgress: progress,
            });
            // Log the derived editorial angle for observability; the brief itself is not
            // persisted (that is a later, optional phase).
            if (full.brief) {
              console.log(`[job ${id}] editorial angle: ${full.brief.angle}`);
            }
            return {
              article: full.article,
              factCheck: full.factCheck,
              referenceTitle: full.reference?.title ?? null,
              referenceUrl: full.reference?.url ?? null,
              fiveWOneH: full.fiveWOneH as unknown,
              designationIssues: full.designationIssues,
              styleReferenceMeta: null,
            };
          })();

    // Report, never fail: the article is about to be persisted either way, and an officer who
    // can see "this designation did not apply" can fix it — one who cannot, cannot.
    designationWarnings.set(id, [...result.designationIssues]);
    await updateGeneration(client, id, {
      article: result.article,
      factCheck: result.factCheck,
      referenceTitle: result.referenceTitle,
      referenceUrl: result.referenceUrl,
      // The 5W1H fact scaffold, so the detail page can show the at-a-glance card. In simple
      // mode this is the officer's approved pointer inventory, or NULL when there is none —
      // null rather than an empty scaffold, because the card is gated on truthiness and an
      // all-empty object would render six "टिपणीत नाही" placeholder rows.
      fiveWOneH: result.fiveWOneH,
    });

    // Which style reference the run actually used (migration 0035). A SEPARATE best-effort
    // update after the article write, for the reason 0028's poster_style write is separate:
    // bundling them would mean that on a database without 0035 the whole update fails and the
    // already-generated article never lands on the row. Losing the telemetry for one run is
    // acceptable; losing the article is not.
    if (result.styleReferenceMeta) {
      await updateGeneration(client, id, {
        styleReferenceMeta: result.styleReferenceMeta,
      }).catch((error) => {
        console.warn(
          `[job ${id}] could not persist style_reference_meta (is 0035 applied?):`,
          error,
        );
      });
    }

    if (row.outputType === 'article') return;

    await runArticlePosterPhase(
      client,
      id,
      result.article,
      row.referenceImageId,
      { note: row.note, posterHeading: row.posterHeading },
    );
  });
}

// Poster phase shared by the initial 'poster'/'both' run and the attach-poster
// job (startArticlePosterJob): copy from the (already final) article, render,
// upload poster-v1, persist { copy, posterPath }. Callers own status; this
// writes only step + content fields.
//
// The v1 uploads pass upsert:true — not because v1 is ever legitimately
// re-rendered, but because a crash between upload and the posterPath row-write
// would otherwise brick every attach-poster retry on "already exists". Safe:
// the v1 URL is never served before posterPath is set, so no CDN cache entry
// can hold a stale copy.
async function runArticlePosterPhase(
  client: SupabaseClient,
  id: string,
  article: string,
  pinnedReferenceImageId: string | null,
  // The officer's original note and hand-typed poster text. The note is where the poster's
  // named subject is read from (it holds the authoritative spelling of every name; the article
  // may have reworded it), and a non-empty heading skips that resolution entirely. On a
  // media-room run the note IS the article, so passing both costs nothing.
  source: Readonly<{ note: string; posterHeading: string | null }>,
): Promise<void> {
  // ARTICLE_POSTER_MODE selects the poster renderer:
  //   'fresh'   — DEFAULT. The API builds the whole prompt and generates the poster from
  //               scratch (gpt-image-2 @ 1536x1024, no n8n). The selected master is loose
  //               STRUCTURE inspiration only, its colours stripped; a rotated palette +
  //               landscape composition decide how the poster looks.
  //   'n8n'     — the legacy path: the external article-poster-v1-api workflow edits the
  //               picked master in place. Kept as a one-env-line rollback.
  //   'html'    — the original local image + HTML/Playwright path.
  // Neither n8n mode writes a scenePath, so poster feedback + manual copy-edit (which
  // require row.scenePath) stay unavailable outside 'html' — accepted trade-off.
  const mode = process.env.ARTICLE_POSTER_MODE ?? 'fresh';

  if (mode === 'html') {
    await updateGeneration(client, id, { step: 'copy' });
    const copy = await generateCopy(article);

    await updateGeneration(client, id, { step: 'scene' });
    const scenePrompt = buildArticleScenePrompt(copy);
    const sceneImage = await generateImage(scenePrompt);
    recordImageCost('article', imageQuality());

    await updateGeneration(client, id, { step: 'render' });
    const poster = await generateArticlePoster({ copy, sceneImage });

    const sceneObjectPath = scenePath(id, 1);
    const posterObjectPath = posterPath(id, 1);
    await uploadPng(client, sceneObjectPath, sceneImage, true);
    await uploadPng(client, posterObjectPath, poster.png, true);

    await updateGeneration(client, id, {
      copy,
      scenePrompt,
      scenePath: sceneObjectPath,
      posterPath: posterObjectPath,
    });
    return;
  }

  await renderAndStoreArticlePoster(client, id, article, {
    designMode: mode === 'n8n' ? 'onbrand' : 'fresh',
    pinnedReferenceImageId,
    version: 1,
    seed: id,
    upsert: true,
    note: source.note,
    posterHeading: source.posterHeading,
  });
}

// Render ONE article poster and store it at posterPath(id, version), persisting { copy,
// posterPath } and (best-effort) the assigned style. Shared by the initial run, the
// attach-poster job and the regenerate action — the article twin of
// renderAndStoreSocialPoster, and deliberately built the same way.
//
// The DEFAULT path GENERATES the poster from scratch: the selected master contributes only a
// colour-stripped structure hint, never pixels. Two independent rotations decide how it looks —
// a colour palette (shared with the social path, poster-palettes.ts) and a LANDSCAPE composition
// archetype (article-poster-layouts.ts) — each assigned per run and spread away from what the
// last few ARTICLE runs used. The art director then designs within both; it chooses neither.
async function renderAndStoreArticlePoster(
  client: SupabaseClient,
  id: string,
  article: string,
  options: Readonly<{
    designMode: ArticleDesignMode;
    pinnedReferenceImageId: string | null;
    version: number;
    // Diversifies the assignment per run: the id on a first render, `${id}:v${n}` on a
    // regenerate, so a redo looks new rather than repeating the previous poster.
    seed: string;
    // Extra colour families this render must avoid, on top of the recent history — set by the
    // "different colours" redo so the new version cannot land back in the rejected family.
    avoidFamilies?: readonly PaletteFamily[];
    // Only the v1 write upserts (see the note above renderArticlePosterPhase).
    upsert?: boolean;
    // The officer's original note: the authoritative spelling of every name and what the
    // subject is read from. Equal to `article` on a media-room run.
    note: string;
    // Hand-typed poster text (generations.poster_heading, migration 0029). Non-empty ⇒ it IS
    // the poster's text, verbatim, and no subject-resolution call is made.
    posterHeading: string | null;
  }>,
): Promise<void> {
  const { designMode, version, seed } = options;

  // 1. Copy. The article poster shows ONE headline, but generateCopy also yields the
  //    scene_brief the imagery is painted from, so the whole object is still produced (and
  //    persisted, so a later manual copy-edit in 'html' mode still has something to edit).
  await updateGeneration(client, id, { step: 'copy' });
  const copy = await generateCopy(article);
  const editorialHeadline = headStrings(copy).headline;

  // 2. What text goes on the poster? Three sources, in strict order of authority.
  //
  //    a) A HAND-TYPED heading wins outright and costs nothing — the officer has said exactly
  //       what the poster must say, so neither a model call nor a validation is appropriate.
  //    b) Otherwise: does this news have a NAMED SUBJECT (a scheme, award, campaign, service,
  //       portal, project)? If so the poster's entire text becomes that name in full — a
  //       truncated or paraphrased official name on a government poster is a factual error, and
  //       the editorial headline is a paraphrase by construction. The name is read from the
  //       NOTE (the officer's own spelling; the article may have reworded it) and must be
  //       accountable in note ∪ article. The verified glossary rows present in either are
  //       handed over so a nominated truncation can be deterministically expanded: the model
  //       only nominates, code decides.
  //    c) Otherwise the editorial headline generateCopy just wrote.
  const typedHeading = (options.posterHeading ?? '').trim();
  const note = options.note.trim();
  let subject: PosterSubject | null = null;
  if (typedHeading.length === 0) {
    const glossarySource =
      note && note !== article ? `${note}\n\n${article}` : article;
    const glossaryTerms = await findGlossaryTermsInText(client, glossarySource);
    const knownSchemeNames = glossaryTerms
      .filter((t) => t.termType === 'scheme' || t.termType === 'org')
      .map((t) => t.marathi);
    subject = await resolvePosterSubject({
      note: note || article,
      article,
      knownSchemeNames,
    });
  }

  const headline = typedHeading || subject?.name || editorialHeadline;
  // A typed heading and a resolved name are both reproduced character for character (the
  // prompt's TEXT LOCK block); an editorial headline is a designed line the model may set as
  // it sees fit.
  const textLocked = typedHeading.length > 0 || subject !== null;
  if (typedHeading) {
    console.log(
      `[job ${id}] poster text typed by the officer: «${typedHeading}» — editorial headline «${editorialHeadline}» dropped`,
    );
  } else if (subject) {
    console.log(
      `[job ${id}] poster subject ${subject.kind} (${subject.source}): «${subject.name}» — poster text is that name, editorial headline «${editorialHeadline}» dropped`,
    );
  }

  // 3. The reference master: the pinned image if the run has one (honored even if meanwhile
  //    disabled; a deleted pin falls back), else a content-aware pick among the enabled
  //    article masters. In 'fresh' mode this only ever contributes its layoutSummary.
  await updateGeneration(client, id, { step: 'render' });
  const pinned = options.pinnedReferenceImageId
    ? await resolvePinnedImage(client, options.pinnedReferenceImageId, seed)
    : null;
  const reference = pinned
    ? pinned.master
    : await pickArticleReference(client, seed, article);
  const referenceHasPhoto = reference.layoutSpec?.hasPhotoZone !== false;

  // 4. The two rotations. Only the from-scratch path uses them — an 'onbrand' edit repaints a
  //    master whose own colours are the point, so assigning it a palette it cannot honour would
  //    just be noise. The avoid set includes the hue families recent renders were MEASURED to
  //    be, not only the ones they were assigned: if the image model ignores a spec, avoiding
  //    intentions achieves nothing.
  const isFresh = designMode === 'fresh';
  // A fresh article poster must contain meaningful subject imagery. Previously a selected
  // text-only master set this false, which admitted the `art_type_field` archetype and produced
  // the empty colour-field poster officers consistently replaced with "वेगळी रचना तयार करा".
  // Fresh mode does not edit the master's pixels, so its lack of a photo zone is not a real
  // constraint. The legacy on-brand edit still honours the physical zone in its master.
  const hasPhoto = isFresh || referenceHasPhoto;
  const history = isFresh
    ? await recentStyleHistory(client, ARTICLE_STYLE_CATEGORIES)
    : undefined;
  const assignedPalette = isFresh
    ? pickPalette(seed, {
        ids: history?.paletteIds,
        families: [
          ...(history?.families ?? []),
          ...(options.avoidFamilies ?? []),
        ],
      })
    : undefined;
  const assignedLayout = isFresh
    ? pickArticleLayout(
        seed,
        { hasPhoto },
        { ids: history?.layoutIds, coverages: history?.coverages },
      )
    : undefined;

  // 5. Art direction — how the assigned colours and composition are handled. Best-effort:
  //    null renders from the assignment alone, which carries the colours and the layout and is
  //    deliberately sufficient.
  const artDirection = isFresh
    ? await generateArtDirection({
        note: article,
        copyStyle: 'article',
        // Colour words are stripped from this hint inside the prompt builder; the art director
        // gets the raw summary but is told the palette is not its call. A text-only master's
        // summary is omitted entirely because fresh article posters now require a photograph.
        referenceHint:
          !referenceHasPhoto && isFresh
            ? undefined
            : reference.layoutSpec?.layoutSummary,
        seed,
        assignedPalette,
        assignedLayout,
        recentTreatments: history?.treatments,
      })
    : null;

  console.log(
    `[job ${id}] article poster: ${JSON.stringify({
      mode: designMode,
      pinned: Boolean(pinned),
      referenceUrl: reference.url,
      analyzed: Boolean(reference.layoutSpec),
      referenceHasPhoto,
      hasPhoto,
      textLocked,
      headlineSource: typedHeading
        ? 'typed'
        : subject
          ? subject.kind
          : 'editorial',
      palette: assignedPalette
        ? `${assignedPalette.id} (${assignedPalette.family})`
        : null,
      layout: assignedLayout
        ? `${assignedLayout.id} (${assignedLayout.coverage})`
        : null,
      avoidedFamilies: [
        ...(history?.families ?? []),
        ...(options.avoidFamilies ?? []),
      ],
      measuredBuckets: history?.measuredBuckets ?? [],
      directed: Boolean(artDirection),
    })}`,
  );

  // 6. Prompt (pure string assembly, no model call) → render.
  const prompt = buildArticlePosterPrompt({
    headline,
    sceneBrief:
      typeof copy.scene_brief === 'string' ? copy.scene_brief : undefined,
    designMode,
    masterUrl: reference.url,
    // A text-only master's structure is actively misleading on the from-scratch path now that
    // every fresh poster requires imagery. The assigned photo composition is sufficient.
    layoutSummary:
      isFresh && !referenceHasPhoto
        ? undefined
        : reference.layoutSpec?.layoutSummary,
    hasPhoto,
    assignedPalette,
    assignedLayout,
    artDirection: artDirection ?? undefined,
    textLocked,
  });

  const rawPoster = isFresh
    ? await generateImage(prompt, { size: '1536x1024' })
    : await renderArticlePosterEditViaN8n(id, reference.url, prompt);
  // gpt-image-2 @ 1536x1024 — attribute the fixed tier price (image usage isn't measurable
  // whether it ran in n8n or the direct call).
  recordImageCost('article', imageQuality());

  // 7. Measure what the render ACTUALLY came out as, BEFORE the chrome is stamped — the footer
  //    band and logo are identical on every poster, so measuring after them biases every
  //    measurement the same way and makes the comparison across runs worthless. A mismatch is
  //    logged, never retried: a re-render is another paid image call.
  let posterStyle: PosterStyle | undefined;
  if (assignedPalette && assignedLayout) {
    let measured;
    try {
      measured = await measurePosterColours(rawPoster);
    } catch (error) {
      console.warn(`[job ${id}] could not measure poster colours:`, error);
    }
    posterStyle = buildPosterStyle(assignedPalette, assignedLayout, measured);
    if (measured) {
      const complied = familyHonoured(
        assignedPalette.family,
        measured.hueBucket,
      );
      console.log(
        `[job ${id}] measured: ground=${measured.groundHex}${measured.groundIsWarm ? ' (warm cream)' : ''}` +
          ` dominant=${measured.dominantHex} bucket=${measured.hueBucket}` +
          `${complied ? '' : ` — MISMATCH, assigned ${assignedPalette.family}`}`,
      );
    }
  }

  // 8. Chrome: the crisp महासंवाद logo + department footer, which the image model cannot render
  //    (the prompt leaves those zones quiet).
  const posterPng = await overlayArticleChrome(rawPoster);
  const posterObjectPath = posterPath(id, version);
  await uploadPng(client, posterObjectPath, posterPng, options.upsert ?? false);

  await updateGeneration(client, id, { copy, posterPath: posterObjectPath });

  // 9. The assigned style is written SEPARATELY and best-effort, deliberately not bundled into
  //    the write above. It targets a column added by migration 0028, and bundling them would
  //    mean that on a database where 0028 has not been applied the whole update fails and the
  //    already-paid poster never lands on the row. Losing the rotation memory for one run is a
  //    cost worth paying; losing the render is not.
  if (posterStyle) {
    try {
      await updateGeneration(client, id, { posterStyle });
    } catch (error) {
      console.warn(
        `[job ${id}] could not persist poster style (is migration 0028 applied?):`,
        error,
      );
    }
  }
}

// Attach a poster to a settled article run on the SAME row: article-only and DLO
// runs (outputType 'article' — the route flips it to 'both'), plus the retry
// after a poster-phase failure. Reuses the stored (possibly feedback-revised)
// article — no article regeneration. The pin travels as a parameter, not the
// row: referenceImageId is insert-only in the DB layer (same pattern as
// startPosterFeedbackJob's params); absent, the row's original pin applies.
export function startArticlePosterJob(
  client: SupabaseClient,
  id: string,
  referenceImageId?: string,
): void {
  runJob(client, id, async () => {
    const row = await getGeneration(client, id);
    if (!row) throw new Error(`Generation ${id} not found.`);
    if (!row.article) throw new Error(`Generation ${id} has no article yet.`);
    if (row.posterPath) {
      throw new Error(`Generation ${id} already has a poster.`);
    }

    await updateGeneration(client, id, {
      status: 'running',
      step: 'copy',
      error: null,
    });
    await runArticlePosterPhase(
      client,
      id,
      row.article,
      referenceImageId ?? row.referenceImageId,
      { note: row.note, posterHeading: row.posterHeading },
    );
  });
}

// Shape n8n's article-poster-v1-api workflow returns from its Respond-to-Webhook node.
type ArticlePosterResult = {
  poster_png_base64?: string;
};

// POST an already-built image-edit request to the thin n8n `article-poster-v1-api` workflow:
// it fetches `imageUrl`, edits it with `prompt` at 1536x1024, and returns the poster PNG. The
// exact twin of renderSocialPosterViaN8n, and used for the same two things: the pixel/marker
// FEEDBACK re-render (edit the current poster) and the legacy ARTICLE_POSTER_MODE=n8n initial
// render (edit the chosen master). The default 'fresh' path never comes here at all.
//
// The prompt is built in the API now (build-article-poster-prompt.ts) rather than in the
// workflow's Code node, so the reserved-zone geometry lives beside the chrome overlay it must
// stay in sync with. The crisp brand chrome (महासंवाद logo top-left + department footer strip)
// is composited here in code — the image model can't render those Devanagari lockups reliably.
//
// LEGACY FIELDS: `reference_url` / `image_feedback` / `marker_count` are still sent, duplicating
// `image_url`, purely so a newly-deployed API talking to a not-yet-pushed workflow degrades to
// the OLD in-workflow prompt instead of throwing "No reference_url received". They can be
// dropped once every instance is on the 5-node workflow.
async function renderArticlePosterEditViaN8n(
  id: string,
  imageUrl: string,
  prompt: string,
  legacy: Readonly<{ imageFeedback?: string; markerCount?: number }> = {},
): Promise<Buffer> {
  const webhookUrl = requireEnv('N8N_ARTICLE_POSTER_WEBHOOK_URL');
  const webhookSecret = process.env.N8N_WEBHOOK_SECRET;

  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (webhookSecret) headers['x-n8n-webhook-secret'] = webhookSecret;

  // Generous timeout to outlast the workflow's ~1-2 min gpt-image-2 edit stage.
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      generation_id: id,
      image_url: imageUrl,
      prompt,
      quality: imageQuality(),
      // --- legacy compatibility, see the note above ---
      reference_url: imageUrl,
      image_feedback: legacy.imageFeedback ?? '',
      marker_count: legacy.markerCount ?? 0,
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

// Shape the thin social-post-v2-api workflow returns from its Respond-to-Webhook node.
// The workflow now ONLY edits an image with an API-built prompt — classify/copy/prompt all
// run in the API — so the response carries just the rendered poster.
type SocialPostResult = {
  poster_png_base64?: string;
};

// POST an already-built image-edit request to the thin n8n workflow: it fetches `imageUrl`,
// edits it with `prompt` at `quality`, and returns the poster PNG. Used by BOTH the initial
// render (edit the chosen master) and the pixel-feedback render (edit the current poster) —
// they differ only in which image and which prompt. Chrome is stamped by the caller.
async function renderSocialPosterViaN8n(
  id: string,
  imageUrl: string,
  prompt: string,
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
      image_url: imageUrl,
      prompt,
      quality: imageQuality(),
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
  if (!result.poster_png_base64) {
    throw new Error('n8n social-post webhook returned no poster.');
  }
  return Buffer.from(result.poster_png_base64, 'base64');
}

// Which caption rule the platform imposes. X caps a post at 280 weighted characters;
// a Facebook post has no comparable limit. (A within-social branch, like the publish
// route's — not an isSocialCategory() violation.)
function captionMaxLength(
  category: GenerationRow['category'],
): number | undefined {
  return category === 'twitter' ? TWEET_MAX_LENGTH : undefined;
}

// The social lane the caption is being written for. The row's category already is one
// of the two, but the runner's GenerationRow['category'] is the widened union.
function socialPlatformOf(
  category: GenerationRow['category'],
): 'twitter' | 'facebook' {
  if (category === 'twitter' || category === 'facebook') return category;
  throw new Error(`Caption requested for non-social category: ${category}`);
}

// Re-edit a completed poster without rerunning classify/copy. The feedback PROMPT is now
// built in the API (buildFeedbackPrompt) and the thin workflow just edits the current poster
// with it — the same render path as the initial run, differing only in image + prompt.
async function renderSocialPosterFeedbackViaN8n(
  id: string,
  currentPosterUrl: string,
  feedback: string,
  // > 0 when currentPosterUrl carries numbered marker boxes (see the article
  // renderer's note above).
  markerCount = 0,
  // The run's template brand, so the feedback prompt keeps the right reserved zones and the
  // re-stamp uses the matching chrome.
  brand: TemplateBrand = 'dgipr',
  // CMO only: the cached circle photograph (cmoPhotoPath), re-composited so a text/layout
  // feedback edit never changes the photo. Required when brand === 'cmo'.
  cmoPhoto?: Buffer,
): Promise<Buffer> {
  const prompt = buildFeedbackPrompt({
    imageFeedback: feedback,
    brand,
    markerCount,
  });
  const rawPoster = await renderSocialPosterViaN8n(
    id,
    currentPosterUrl,
    prompt,
  );
  // The workflow leaves the reserved chrome zones untouched; re-stamp the chrome so
  // any drift from the edit is corrected (mirrors the article path). CMO re-stamps
  // its full-width leader header + the DGIPR footer, and re-composites the SAME cached
  // circle photograph (the workflow leaves the circle zone quiet on feedback too).
  if (brand === 'cmo') {
    if (!cmoPhoto) {
      throw new Error(
        'CMO feedback re-render requires the cached circle photo.',
      );
    }
    return overlayCmoChrome(rawPoster, cmoPhoto);
  }
  return overlayTwitterChrome(rawPoster);
}

// In-process recency ring: the master ids the last few DGIPR runs of a given type used, so
// selectMaster can avoid landing on the same template again (across-run variety). Keyed by
// `dgipr:${typeSlug}`, capped small. Deliberately in-process — social renders are serial (one
// n8n workflow / one busy gate) in a single API process, so consecutive runs reliably see it;
// it degrades to today's behaviour on restart. Matches the in-flight / translateWarnings
// registries rather than persisting a per-run selection column.
const SOCIAL_MASTER_RECENCY_CAP = 3;
const socialMasterRecency = new Map<string, string[]>();
function recentMasters(key: string): readonly string[] {
  return socialMasterRecency.get(key) ?? [];
}
function rememberMaster(
  key: string,
  masterId: string,
  enabledCount: number,
): void {
  // Never avoid so many that the band could empty; leave at least one template pickable.
  const cap = Math.max(
    0,
    Math.min(SOCIAL_MASTER_RECENCY_CAP, enabledCount - 1),
  );
  if (cap === 0) return;
  const prior = socialMasterRecency.get(key) ?? [];
  socialMasterRecency.set(
    key,
    [masterId, ...prior.filter((mid) => mid !== masterId)].slice(0, cap),
  );
}

// What the last few posters looked like — colour family, composition, and what their renders
// actually MEASURED — read from generations.poster_style (migration 0028).
//
// This used to be an in-process Map, which was the wrong place for it. Social renders are serial,
// so a Map looked sufficient, but it reset on every API restart (constant under `tsx watch`) and
// a second process could not see it — so after any restart a run could be assigned the same
// colour family as the one before it, which is precisely the failure the rotation exists to
// prevent. One small indexed query per run buys a spread that actually holds.
//
// The history is SCOPED to one poster kind. Social and article runs share the column but draw
// their compositions from different libraries (portrait vs landscape archetypes), so an unscoped
// read would spread each rotation against coverages the other cannot produce.
//
// Best-effort: a failure here degrades to "no history", which is exactly the pre-0028 behaviour,
// and must never sink a paid render.
const STYLE_HISTORY_DEPTH = 8;
const SOCIAL_STYLE_CATEGORIES = ['twitter', 'facebook'] as const;
const ARTICLE_STYLE_CATEGORIES = ['news', 'scheme'] as const;

async function recentStyleHistory(
  client: SupabaseClient,
  categories: readonly string[],
): Promise<StyleHistory> {
  try {
    return toStyleHistory(
      await listRecentPosterStyles(client, STYLE_HISTORY_DEPTH, categories),
    );
  } catch (error) {
    console.warn(
      '[job] could not read recent poster styles (rendering unspread):',
      error,
    );
    return toStyleHistory([]);
  }
}

// Resolve which poster type + master template a social run uses, and (for a normal run)
// classify the note. The precedence is exactly the old workflow's: an exact-image pin wins,
// then a type pin, then the CMO brand — all three FORCE the type and skip classification.
// Only an ordinary DGIPR run classifies, then picks the best-fit master within the chosen
// type (content-aware selection replaces the old random roll). A deleted pin falls through
// to the next rule, matching the previous nullable-pin behaviour. `id` is the selection seed.
async function resolveSocialReference(
  client: SupabaseClient,
  id: string,
  row: GenerationRow,
  brand: TemplateBrand,
  // On a from-scratch render the master contributes STRUCTURE only and the palette is assigned
  // separately, so colour must play no part in choosing it — the master library is
  // overwhelmingly saffron/maroon/cream, and ranking on colour theme is one of the ways the
  // house look kept re-entering a poster that was supposed to be in a different family.
  ignoreColour = false,
): Promise<ResolvedReference> {
  if (row.referenceImageId) {
    const pinned = await resolvePinnedImage(client, row.referenceImageId, id);
    if (pinned) return pinned;
  }
  if (row.referenceTypeId) {
    const pinned = await resolvePinnedType(
      client,
      row.referenceTypeId,
      id,
      row.note,
    );
    if (pinned) return pinned;
  }
  if (brand === 'cmo') {
    return resolveCmoReference(client, id, row.note);
  }

  // Ordinary run: classify the note against the DGIPR type catalog (which excludes CMO), then
  // select the best-fit master within the chosen type.
  const types = await listSocialTypes(client, 'dgipr');
  const classification = await classifyPosterType(
    row.note,
    types.map((t) => ({ slug: t.slug, description: t.description })),
  );
  const type =
    types.find((t) => t.slug === classification.postType) ??
    (types[0] as (typeof types)[number]);
  const recencyKey = `dgipr:${type.slug}`;
  const master = await selectMaster(
    client,
    type.images,
    {
      points: classification.pointCount,
      wantsPhoto: classification.wantsPhoto,
    },
    id,
    row.note,
    recentMasters(recencyKey),
    { ignoreColour },
  );
  rememberMaster(recencyKey, master.id, type.images.length);
  return {
    type: {
      slug: type.slug,
      label: type.label,
      description: type.description,
      copyStyle: type.copyStyle,
      brand: type.brand,
    },
    master,
    forced: false,
    title: classification.title,
  };
}

// Render ONE social poster and store it at posterPath(id, version), updating referenceTitle +
// posterPath. Shared by the initial job (version 1) and the regenerate action (next version).
//
// The default DGIPR path GENERATES the poster from scratch: the selected master is used only as a
// loose STRUCTURAL idea, never as pixels to clone. Two independent rotations decide how it looks —
// a colour palette (poster-palettes.ts) and a composition archetype (poster-layouts.ts), each
// assigned per run and each spread away from what the last few runs used. The art director then
// designs WITHIN both; it chooses neither. The legacy edit modes ('onbrand'/'adaptive') still edit
// the master via the thin n8n workflow; CMO keeps its own template-following render.
async function renderAndStoreSocialPoster(
  client: SupabaseClient,
  id: string,
  row: GenerationRow,
  brand: TemplateBrand,
  designMode: PosterDesignMode,
  version: number,
  // Diversifies the assignment per run (id on a first render, `${id}:v${n}` on a regenerate, so a
  // redo looks new rather than repeating the previous poster).
  seed: string,
  // Extra colour families this render must avoid, on top of the recent history — set by the
  // "different colours" redo so the new version cannot land back in the family being rejected.
  avoidFamilies: readonly PaletteFamily[] = [],
): Promise<{ postType: string; title: string | null }> {
  // 1. Resolve the poster type + the master. A pin (image or type) or the CMO brand forces the
  //    type and skips classification; otherwise classify the note and pick the best-fit master
  //    within the chosen type (content-aware, seeded, recency-spread across runs).
  await updateGeneration(client, id, { step: 'classify' });
  const resolved = await resolveSocialReference(
    client,
    id,
    row,
    brand,
    brand !== 'cmo' && designMode === 'fresh',
  );

  console.log(
    `[job ${id}] social poster reference: ${JSON.stringify({
      id,
      brand,
      forced: resolved.forced,
      type: resolved.type.slug,
      analyzed: Boolean(resolved.master.layoutSpec),
      pick: resolved.master.reason,
    })}`,
  );

  // 2. Scheme-name lock source: verified glossary scheme/org names present in the note.
  //    These must survive in the copy in full (lock-scheme-names). Free — a substring
  //    match over the small verified set, no model call.
  const glossaryTerms = await findGlossaryTermsInText(client, row.note);
  const lockedSchemeNames = glossaryTerms
    .filter((t) => t.termType === 'scheme' || t.termType === 'org')
    .map((t) => t.marathi);

  // 3. Copy (gpt-5.6-luna, metered inside this job's cost scope).
  await updateGeneration(client, id, { step: 'copy' });
  const copyResult = await generatePosterCopy({
    note: row.note,
    postType: resolved.type.slug,
    copyStyle: resolved.type.copyStyle,
    description: resolved.type.description,
    brand,
    layoutSpec: resolved.master.layoutSpec,
    lockedSchemeNames,
  });

  // 3a. Colour palette + composition — only the fully-AI-generated DGIPR path uses them. Both are
  //     rotated per run away from what the last few runs used (families and coverages first, then
  //     exact ids), so consecutive posters differ in hue AND in shape. The avoid set includes the
  //     hue families the last few renders were MEASURED to be, not only the ones they were
  //     assigned — if the image model ignores a spec, avoiding intentions would achieve nothing.
  //     Seeded, so a retry reproduces the same assignment rather than redesigning.
  const isFresh = brand !== 'cmo' && designMode === 'fresh';
  const history = isFresh
    ? await recentStyleHistory(client, SOCIAL_STYLE_CATEGORIES)
    : undefined;
  const assignedPalette = isFresh
    ? pickPalette(seed, {
        ids: history?.paletteIds,
        families: [...(history?.families ?? []), ...avoidFamilies],
      })
    : undefined;
  const assignedLayout = isFresh
    ? pickLayout(
        seed,
        { hasPhoto: copyResult.hasPhoto, copyStyle: copyResult.copyStyle },
        { ids: history?.layoutIds, coverages: history?.coverages },
      )
    : undefined;

  // 3b. Art direction — only the fully-AI-generated DGIPR path consumes it; edit modes and CMO
  //     ignore it, so don't spend the call there. It describes HOW the assigned colours and
  //     composition are used and chooses neither. Best-effort: null → render from the assignment
  //     alone, which carries the colours and the layout and is deliberately sufficient.
  const artDirection = isFresh
    ? await generateArtDirection({
        note: row.note,
        copyStyle: copyResult.copyStyle,
        // Colour words are stripped from this hint inside buildPosterPrompt; the art director
        // gets the raw summary but is told the palette is not its call.
        referenceHint: resolved.master.layoutSpec?.layoutSummary,
        seed,
        assignedPalette,
        assignedLayout,
        recentTreatments: history?.treatments,
      })
    : null;
  if (assignedPalette && assignedLayout) {
    console.log(
      `[job ${id}] style: palette=${assignedPalette.id} (${assignedPalette.family}) layout=${assignedLayout.id} (${assignedLayout.coverage})` +
        ` | avoided families=[${(history?.families ?? []).join(',')}${avoidFamilies.length ? `+${avoidFamilies.join(',')}` : ''}]` +
        ` measured=[${(history?.measuredBuckets ?? []).join(',')}]` +
        `${artDirection ? '' : ' (undirected)'}`,
    );
  }

  // 4. Image prompt (pure string assembly, no model call).
  const prompt = buildPosterPrompt({
    copy: copyResult.copy,
    copyStyle: copyResult.copyStyle,
    designMode,
    brand,
    masterUrl: resolved.master.url,
    layoutSummary: resolved.master.layoutSpec?.layoutSummary,
    hasPhoto: copyResult.hasPhoto,
    artDirection: artDirection ?? undefined,
    assignedPalette,
    assignedLayout,
  });

  // 5. Render. 'fresh' generates from scratch (the master is only inspiration in the prompt)
  //    via the direct image call; the edit modes edit the chosen master through n8n.
  await updateGeneration(client, id, { step: 'image' });
  const rawPoster =
    designMode === 'fresh' && brand !== 'cmo'
      ? await generateImage(prompt, { size: '1280x1600' })
      : await renderSocialPosterViaN8n(id, resolved.master.url, prompt);
  // gpt-image-2 @ 1280x1600 — attribute the fixed tier price (image usage isn't measurable
  // whether it ran in n8n or the direct call). The copy above is metered by chatComplete.
  recordImageCost('twitter', imageQuality());

  // 5a. Measure what the render ACTUALLY came out as, BEFORE the chrome is stamped — the footer
  //     band and emblem are the same colours on every poster, so measuring after them biases
  //     every measurement identically and makes the comparison across runs worthless.
  //
  //     A mismatch against the assignment is logged, never retried: a re-render is another paid
  //     image call, and the honest fix for systematic non-compliance is a better prompt. What the
  //     measurement is FOR is the next run's avoid set (see recentStyleHistory).
  let posterStyle: PosterStyle | undefined;
  if (assignedPalette && assignedLayout) {
    let measured;
    try {
      measured = await measurePosterColours(rawPoster);
    } catch (error) {
      console.warn(`[job ${id}] could not measure poster colours:`, error);
    }
    posterStyle = buildPosterStyle(assignedPalette, assignedLayout, measured);
    if (measured) {
      const complied = familyHonoured(
        assignedPalette.family,
        measured.hueBucket,
      );
      console.log(
        `[job ${id}] measured: ground=${measured.groundHex}${measured.groundIsWarm ? ' (warm cream)' : ''}` +
          ` dominant=${measured.dominantHex} bucket=${measured.hueBucket}` +
          `${complied ? '' : ` — MISMATCH, assigned ${assignedPalette.family}`}`,
      );
    }
  }

  // 6. Chrome (+ the CMO circle photo). The workflow/prompt leaves the reserved zones quiet;
  //    the crisp brand chrome is stamped here. CMO also GENERATES its single circle photograph
  //    (a clean crop the model could never paint reliably), caches it for feedback, composites.
  let posterPng: Buffer;
  if (brand === 'cmo') {
    const sceneBrief =
      (typeof copyResult.copy.scene_brief === 'string'
        ? copyResult.copy.scene_brief.trim()
        : '') || row.note;
    const photo = await generateImage(buildCmoCirclePhotoPrompt(sceneBrief), {
      size: '1024x1024',
    });
    recordImageCost('twitter', imageQuality());
    await uploadPng(client, cmoPhotoPath(id), photo, true);
    posterPng = await overlayCmoChrome(rawPoster, photo);
  } else {
    posterPng = await overlayTwitterChrome(rawPoster);
  }
  const posterObjectPath = posterPath(id, version);
  await uploadPng(client, posterObjectPath, posterPng);

  // Working title → referenceTitle (surfaced in UI). Persisted with the poster so a later
  // caption failure never loses the paid render.
  await updateGeneration(client, id, {
    referenceTitle: resolved.title ?? null,
    posterPath: posterObjectPath,
  });

  // The assigned style is written SEPARATELY and best-effort, deliberately not bundled into the
  // write above. It targets a column added by migration 0028, and bundling them would mean that
  // on a database where 0028 has not been applied the whole update fails and the already-paid
  // poster never lands on the row. Losing the rotation memory for one run is a cost worth paying;
  // losing the render is not. Same ordering principle as the caption step.
  if (posterStyle) {
    try {
      await updateGeneration(client, id, { posterStyle });
    } catch (error) {
      console.warn(
        `[job ${id}] could not persist poster style (is migration 0028 applied?):`,
        error,
      );
    }
  }

  return { postType: resolved.type.slug, title: resolved.title ?? null };
}

// Social pipeline (twitter + facebook, identical today). The POSTER pipeline — classify →
// select master → copy → art direction → generate — now runs HERE in the API (per AGENTS.md's
// package boundary). By default the poster is generated from scratch (design_mode 'fresh'); the
// selected master steers the concept, not the pixels. Progress is written directly to the row at
// each stage. The row's category rides along as the caption's platform.
//
// The CAPTION is written here, only when the run asked for one (`options.generateCaption`) —
// a social run is poster-only by default — and a run that skipped it can be given a caption
// later without re-rendering (startGenerateCaptionJob). Ordering matters: the poster is
// persisted BEFORE the caption call, so a caption failure fails the run with the already-paid
// poster safely on the row rather than costing a re-render.
//
// The कॅप्शन lane (media room, outputType 'article') inverts that: NO poster is rendered at
// all and the caption is the run's entire output. That is terminal for posters by design —
// /generations/:id/poster rejects social runs and /poster/regenerate needs an existing
// posterPath — because the intended route to a poster is a fresh run from the same note
// (NextActions' cross-format fold). Do not "fix" those guards.
export function startSocialPostJob(
  client: SupabaseClient,
  id: string,
  options: Readonly<{ generateCaption?: boolean }> = {},
): void {
  runJob(client, id, async () => {
    const row = await getGeneration(client, id);
    if (!row) throw new Error(`Generation ${id} not found.`);

    await updateGeneration(client, id, {
      status: 'running',
      step: null,
      error: null,
    });

    // outputType 'article' means "this run renders no poster" on BOTH lanes — the article
    // pipeline already reads it that way. Taken off the ROW rather than a job option
    // (unlike generateCaption, which a re-run can infer from `article !== null`): there is
    // no sound inference for caption-only, since a null posterPath cannot distinguish
    // "never wanted a poster" from "the render failed". The row is the state of record, so
    // a retry and an edit-note rerun both stay caption-only with no poster spend.
    const captionOnly = row.outputType === 'article';

    let postType: string | undefined;
    if (!captionOnly) {
      const brand = row.templateBrand;
      // Default is now 'fresh' — a unique, AI-designed poster each run. 'onbrand'/'adaptive'
      // remain available for a run that explicitly wants to follow a template.
      const designMode = (row.designMode ?? 'fresh') as PosterDesignMode;

      ({ postType } = await renderAndStoreSocialPoster(
        client,
        id,
        row,
        brand,
        designMode,
        1,
        id,
      ));

      if (!options.generateCaption) return;
    }

    // Caption → article column (the social lane's convention). The note stays the sole
    // fact source; the poster copy is not fed in, exactly as the retired n8n node had it
    // ("base the caption on the notes, not the poster copy"). `postType` is undefined on
    // the caption-only path — nothing classified the note, and it is only a tone steer
    // (startGenerateCaptionJob has always omitted it).
    await updateGeneration(client, id, { step: 'caption' });
    const caption = await generateSocialCaption({
      note: row.note,
      platform: socialPlatformOf(row.category),
      postType,
      maxLength: captionMaxLength(row.category),
    });
    await updateGeneration(client, id, { article: caption });
  });
}

// Regenerate a completed run's poster as a brand-new, differently-designed version. On the
// fully-AI path this re-selects (avoiding the recently-used master), rewrites the copy and
// invents a FRESH art direction seeded on this version, so the redo does not resemble the
// previous poster. This is the text-legibility escape hatch: the image model paints Devanagari,
// which occasionally garbles, and one click gets a clean, distinct alternative. Like poster
// image-feedback it goes through runJob (a re-render legitimately shows progress) and writes a
// new immutable poster version; the caption is NOT touched (it is about the note, not this
// poster). Logged as a poster_image revision to avoid a new revision-target migration.
//
// Serves BOTH lanes. A social run re-classifies as well; an article run re-derives its copy from
// the stored (possibly feedback-revised) article and re-runs the named-subject check, so a redo
// after an article edit picks up the change.
//
// `posterHeading` (article lane) is how a wrong poster heading is actually FIXED — the officer
// only finds out the automatic text is wrong once the poster exists. It is PERSISTED before the
// render, not merely passed down, so every later redo keeps it too; an empty string clears it and
// returns the run to automatic resolution.
export function startPosterRegenerateJob(
  client: SupabaseClient,
  id: string,
  options: Readonly<{ recolour?: boolean; posterHeading?: string }> = {},
): void {
  runJob(client, id, async () => {
    const row = await getGeneration(client, id);
    if (!row) throw new Error(`Generation ${id} not found.`);
    if (!row.posterPath) throw new Error(`Generation ${id} has no poster yet.`);

    await updateGeneration(client, id, {
      status: 'running',
      step: null,
      error: null,
    });

    const version = await nextVersion(client, id);

    // A "different colours" redo bars THIS run's current family outright, on top of the usual
    // recent-history spread. Without it the new seed could legitimately re-pick the very family
    // the officer just rejected — the recency ring only knows about other runs, and a redo of
    // this row is not yet in it.
    const current = options.recolour ? parsePosterStyle(row.posterStyle) : null;
    const avoidFamilies: PaletteFamily[] = current ? [current.family] : [];

    if (!isSocialCategory(row.category)) {
      // Article lane. 'html' mode has its own copy/scene feedback loop and no assignment to
      // re-roll, so a redo there would be a plain re-render at a new version — refuse instead of
      // silently doing something else.
      const mode = process.env.ARTICLE_POSTER_MODE ?? 'fresh';
      if (mode === 'html') {
        throw new Error(
          'ARTICLE_POSTER_MODE=html posters are revised through poster feedback, not regenerated.',
        );
      }
      if (!row.article) throw new Error(`Generation ${id} has no article yet.`);

      // Persist a corrected heading BEFORE rendering, so it survives every later redo — and so
      // that if the render then fails, the officer's typed text is not lost with it. An empty
      // string means "go back to automatic"; `undefined` means the request said nothing about
      // the heading, so whatever the row already holds stands.
      const posterHeading =
        options.posterHeading === undefined
          ? row.posterHeading
          : options.posterHeading.trim() || null;
      if (options.posterHeading !== undefined) {
        await updateGeneration(client, id, { posterHeading });
      }

      await renderAndStoreArticlePoster(client, id, row.article, {
        designMode: mode === 'n8n' ? 'onbrand' : 'fresh',
        pinnedReferenceImageId: row.referenceImageId,
        version,
        seed: `${id}:v${version}`,
        avoidFamilies,
        note: row.note,
        posterHeading,
      });

      await insertRevision(client, {
        generationId: id,
        target: 'poster_image',
        // Only a request that actually CARRIED a heading is logged as a text change — a plain
        // redo of a run that already had one must not read as an edit.
        feedback:
          options.posterHeading !== undefined
            ? `पोस्टरवरील मजकूर: ${posterHeading ?? 'आपोआप'}`
            : options.recolour
              ? 'पुन्हा तयार केले (वेगळे रंग)'
              : 'पुन्हा तयार केले (नवीन रचना)',
        posterPath: posterPath(id, version),
      });
      return;
    }

    const brand = row.templateBrand;
    const designMode = (row.designMode ?? 'fresh') as PosterDesignMode;

    await renderAndStoreSocialPoster(
      client,
      id,
      row,
      brand,
      designMode,
      version,
      `${id}:v${version}`,
      avoidFamilies,
    );

    await insertRevision(client, {
      generationId: id,
      target: 'poster_image',
      feedback: options.recolour
        ? 'पुन्हा तयार केले (वेगळे रंग)'
        : 'पुन्हा तयार केले (नवीन रचना)',
      posterPath: posterPath(id, version),
    });
  });
}

// Write a caption for a settled social run that has none — the run was created
// poster-only (the create form's toggle is off by default) and the officer has now asked
// for one on the detail page. Same non-runJob shape as startCaptionFeedbackJob and for
// the same reason: the row is already 'completed', so flipping it to running would swap
// the finished post for a progress bar, and staying off status lets this run beside a
// poster re-render (disjoint columns).
//
// No revision row is inserted: nothing was revised, and an extra revision would advance
// nextVersion() and misnumber the next poster render.
export function startGenerateCaptionJob(
  client: SupabaseClient,
  id: string,
): void {
  revisingCaption.add(id);
  captionReviseErrors.delete(id);
  void (async () => {
    const cost = createCostAccumulator();
    try {
      await runInCostScope(cost, async () => {
        const row = await getGeneration(client, id);
        if (!row) throw new Error(`Generation ${id} not found.`);

        const caption = await generateSocialCaption({
          note: row.note,
          platform: socialPlatformOf(row.category),
          maxLength: captionMaxLength(row.category),
        });
        await updateGeneration(client, id, { article: caption });
      });
    } catch (error) {
      console.error(`[generate-caption ${id}] failed:`, error);
      captionReviseErrors.set(id, errorMessage(error));
    } finally {
      try {
        await persistCost(client, id, cost);
      } catch (costError) {
        console.error(
          `[generate-caption ${id}] could not persist cost:`,
          costError,
        );
      }
      revisingCaption.delete(id);
    }
  })();
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
    // The run's approved designations, re-read from the row: a feedback revision that lost a
    // पदनाम would silently undo the officer's review, so the same pairs steer the revision AND
    // are re-applied deterministically at the end of it.
    const revisionDesignations = await designationContext(client, row);
    const revised = await reviseArticle(
      row.note,
      currentContent,
      feedback,
      articleCategoryOf(row.category),
      row.heading ?? undefined,
      revisionDesignations.designations,
      revisionDesignations.knownDesignations,
      selectedFactsOf(row),
      statementsOf(row),
      row.excludedFacts ?? [],
      rowHasFactCheck(row),
    );
    designationWarnings.set(id, [...revised.designationIssues]);

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
        // Same reasoning as the status-owning path above: the designations must survive a
        // revision, so they steer it and are re-applied at the end.
        const revisionDesignations = await designationContext(client, row);
        const revised = await reviseArticle(
          row.note,
          currentContent,
          feedback,
          articleCategoryOf(row.category),
          row.heading ?? undefined,
          revisionDesignations.designations,
          revisionDesignations.knownDesignations,
          selectedFactsOf(row),
          statementsOf(row),
          row.excludedFacts ?? [],
          rowHasFactCheck(row),
        );
        designationWarnings.set(id, [...revised.designationIssues]);

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

// Feedback loop for a social post's caption (twitter/facebook — the caption is stored in
// the row's `article` column). The article feedback jobs above cannot serve it: they run
// reviseArticle, whose category argument goes through articleCategoryOf and hard-fails on
// a social category. This one calls the caption editor instead, under the same guardrail
// (the note stays the sole fact source) — and the poster, copy and published state are
// untouched.
//
// Deliberately NOT wrapped in runJob, for the reasons on `revisingCaption` above: it never
// claims `running` and never writes status/step/error, so the finished post stays on
// screen and a poster re-render can proceed in parallel. Liveness + last failure are
// reported through revisingCaption / captionReviseErrors.
export function startCaptionFeedbackJob(
  client: SupabaseClient,
  id: string,
  feedback: string,
): void {
  revisingCaption.add(id);
  captionReviseErrors.delete(id);
  void (async () => {
    const cost = createCostAccumulator();
    try {
      await runInCostScope(cost, async () => {
        const row = await getGeneration(client, id);
        if (!row) throw new Error(`Generation ${id} not found.`);
        if (!row.article)
          throw new Error(`Generation ${id} has no caption yet.`);

        const revised = await reviseCaption({
          caption: row.article,
          feedback,
          note: row.note,
          maxLength: captionMaxLength(row.category),
        });

        await updateGeneration(client, id, { article: revised });
        await insertRevision(client, {
          generationId: id,
          target: 'caption',
          feedback,
          article: revised,
        });
      });
    } catch (error) {
      console.error(`[revise-caption ${id}] failed:`, error);
      captionReviseErrors.set(id, errorMessage(error));
    } finally {
      try {
        await persistCost(client, id, cost);
      } catch (costError) {
        console.error(
          `[revise-caption ${id}] could not persist cost:`,
          costError,
        );
      }
      revisingCaption.delete(id);
    }
  })();
}

// On-demand translation of an article into English or Hindi. Runs the glossary-locked
// Sarvam translation (verified proper-noun mappings present in this article are passed
// as LOCKED TERMS so a known name is never mistranslated — for Hindi the same rows lock
// the Marathi Devanagari form verbatim instead, see translate-article.ts) and persists
// the result to articleEnglish or articleHindi. The Marathi article is never mutated,
// and neither is the other language's translation.
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
  language: TranslationLanguage,
  confirmedTerms?: readonly TranslationTermInput[],
): void {
  translating.set(id, language);
  translateErrors.delete(id);
  translateWarnings.delete(id);
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
              // english is NOT NULL; a Hindi-only extra carries no English, so fall
              // back to the Marathi form rather than reject the row.
              english: term.english?.trim() || term.marathi,
              hindi: term.hindi?.trim() || term.marathi,
              termType: term.termType ?? 'other',
              verified: true,
              source: 'manual',
            });
          }
        }

        // Verified glossary terms whose Marathi form appears in this article become
        // the locked-name table the translator must reuse verbatim (as English
        // spellings for 'en', as frozen Devanagari forms for 'hi' — the stored Hindi
        // spelling, defaulting to the Marathi form).
        const terms = await findGlossaryTermsInText(client, row.article);
        const glossary = terms.map((t) => ({
          marathi: t.marathi,
          english: t.english,
          hindi: t.hindi ?? undefined,
          // Hindi freezes only true proper nouns; the type is what tells them apart.
          termType: t.termType,
        }));

        const { text: translated, unpreservedNames } = await translateArticle(
          row.article,
          glossary,
          language,
        );
        await updateGeneration(
          client,
          id,
          language === 'hi'
            ? { articleHindi: translated }
            : { articleEnglish: translated },
        );
        // Record which locked names (if any) the Hindi output could not carry, so the
        // detail page can flag them beside the fresh translation. Set even when empty:
        // an empty array is the honest "translated, nothing to flag" signal, distinct
        // from "no translation ran this session".
        translateWarnings.set(id, [...unpreservedNames]);

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
        posterKind: isSocialCategory(row.category) ? 'twitter' : 'article',
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
    if (isSocialCategory(row.category)) {
      // CMO re-composites the SAME cached circle photo so a visual/text edit never swaps
      // the photograph (the workflow leaves the circle zone quiet on feedback too).
      const cmoPhoto =
        row.templateBrand === 'cmo'
          ? await downloadPng(client, cmoPhotoPath(id))
          : undefined;
      posterPng = await renderSocialPosterFeedbackViaN8n(
        id,
        inputUrl,
        feedbackText,
        annotations.length,
        row.templateBrand,
        cmoPhoto,
      );
      recordImageCost('twitter', imageQuality());
    } else {
      // The article poster's feedback prompt is built here too now (it used to live in the
      // workflow's Code node). It edits the CURRENT poster, so it carries no palette or
      // composition — the assignment belongs to the render that produced this poster, and a
      // feedback edit must change only what was asked for.
      const prompt = buildArticleFeedbackPrompt({
        imageFeedback: feedbackText,
        markerCount: annotations.length,
      });
      posterPng = await renderArticlePosterEditViaN8n(id, inputUrl, prompt, {
        imageFeedback: feedbackText,
        markerCount: annotations.length,
      });
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
