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
  buildCustomPosterPrompt,
  buildPosterPrompt,
  buildYoutubeThumbnailPrompt,
  buildYoutubeFeedbackPrompt,
  resolveYoutubeReference,
  classifyPosterType,
  createCostAccumulator,
  extractGlossaryCandidates,
  generateArtDirection,
  applyDesignations,
  generateArticle,
  generateArticleSimple,
  generateArticleFromSources,
  type SimpleGenerateArticleOptions,
  currentArticleDateline,
  ensureArticleDateline,
  type ArticleNameEntry,
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
  pickPlacement,
  placementById,
  posterCopyItemCount,
  extractPosterPoints,
  resolvePosterSubject,
  resolveThumbnailPeople,
  toStyleHistory,
  recordImageCost,
  resolveCmoReference,
  resolvePinnedImage,
  resolvePinnedType,
  resolveSocialReferenceByInformation,
  selectMaster,
  reviseArticle,
  reviseCaption,
  reviseCopy,
  reviseSceneBrief,
  runInCostScope,
  runInCostTask,
  translateArticle,
  type ArticleDesignMode,
  type ImageQuality,
  type PaletteFamily,
  type PlacementFamily,
  type PosterDesignMode,
  type PosterStyle,
  type PosterSubject,
  type ResolvedReference,
  type StyleHistory,
} from '@dgipr/content-engine';
import {
  annotateFeedbackRegions,
  CLEAR_REGION_LETTERS,
  formatClearRegionReport,
  measureClearedRegions,
  buildArticleScenePrompt,
  buildCmoCirclePhotoPrompt,
  CMO_POSTER_SIZE,
  SOCIAL_ARTWORK_SIZE,
  YOUTUBE_ARTWORK_SIZE,
  editImage,
  fitToYoutubeThumbnail,
  overlayYoutubeChrome,
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
  mapDesignationsToPersons,
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
  isSocialCategory,
  isYoutubeCategory,
  type Copy,
  type AttributedStatement,
  type DesignationWarning,
  type LengthWarning,
  type NameDesignation,
  type SelectedFact,
  type PosterClearAction,
  type PosterImageFeedbackRequest,
  type TranslationLanguage,
  type TranslationTermInput,
} from '@dgipr/schemas';
import { recordTasksFromCost } from './service-usage.js';
import { sourceFilesForGeneration } from './source-files.js';
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

// A social poster whose information held MORE items than any master template can lay out. The
// render still happens — the image prompt is told to extend the reference's item pattern rather
// than drop anything — but the officer is the one who can act on it, by splitting the note into
// two posters. Transient for the same reason the two registries above are: the poster is on the
// row, and this is a "check this one" prompt that matters while the fresh render is on screen.
// Absent means the run fitted, or predates this session.
const posterCapacityWarnings = new Map<
  string,
  { needed: number; available: number }
>();

// The officer asked for an article of a given length (in तुमची विनंती or in the feedback box)
// and the run could not reach it. The article is delivered regardless — a length is reached by
// covering the supplied information more fully, so a source that does not carry enough leaves
// an honest shortfall rather than filler. Transient for the same reason as the registries
// above: the article is on the row, and this is a "the note did not have this much in it"
// prompt that matters while the officer is reading the fresh output.
const lengthWarnings = new Map<string, LengthWarning | null>();

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

// An EDIT of an already-produced run that failed — a poster re-render, a marker round, a
// redesign, an article revision. Such a failure must NOT mark the row `failed`: the previous
// poster, every immutable poster version and the article are all still on the row, and a
// `failed` row hides the whole result view, which is how one bad edit used to swallow a run's
// entire history. So `runJob` restores the row to `completed` and reports the failure here
// instead — the stance translateWarnings/captionReviseErrors already take, for the same reason:
// the work is on the row, this is a "that one edit did not land" prompt for whoever is looking
// at it now.
//
// `retry` is the failed job re-armed with its own arguments, so the officer's button re-runs
// the exact step that failed rather than starting a new run. It is in-process and therefore
// lost on restart — the recovery itself is not (the row is `completed` again), so a restart
// costs the one-click retry, never the run. A row that failed BEFORE producing anything is
// untouched by all of this and still reports `failed`: there is nothing to go back to.
type EditFailure = { message: string; retry: (() => void) | null };
const editFailures = new Map<string, EditFailure>();

// How an edit job declares itself one: it arms its own re-run immediately before calling
// runJob, which picks the thunk up on the way in. A job with nothing armed is an ordinary
// run and still fails the row.
const pendingEditRetries = new Map<string, () => void>();

function armEditRetry(id: string, retry: () => void): void {
  pendingEditRetries.set(id, retry);
}

// The article as it is being written, so the officer reads it appearing rather than watching
// a spinner for minutes. In-process and transient for the same reason translateWarnings is:
// the article on the row is the state of record, and this is only the view of it while it is
// still being produced. Losing it to a restart costs the live view of one run, never the run.
//
// It is a REGISTRY rather than a column because it is written token by token: persisting each
// delta would be thousands of row writes per article, and a poll could not render it smoothly
// anyway. The SSE route below is what turns it back into something a browser can watch.
//
// This is also why the API must stay a single process (the constraint the /dlo detail route's
// orphan reaper already imposes): instance B cannot stream a draft instance A is writing. A
// client that connects to the wrong instance simply sees no live text and falls back to the
// ordinary poll, so the failure is a lost animation, not a lost article.
export type ArticleStreamEvent =
  | { type: 'snapshot'; text: string }
  | { type: 'delta'; text: string }
  | { type: 'end' };

type ArticleStream = {
  // Everything emitted so far, replayed to any client that connects (or reconnects) mid-run.
  text: string;
  done: boolean;
  listeners: Set<(event: ArticleStreamEvent) => void>;
};

const articleStreams = new Map<string, ArticleStream>();

// How long a finished stream stays replayable. Only covers the gap between the last delta and
// the row-write the poll picks up; past that the article is on the row and the route serves it
// from there instead.
const ARTICLE_STREAM_TTL_MS = 120_000;

// Called synchronously when the article job starts, BEFORE any await — a client connecting the
// instant its POST returns must find a live (empty) stream rather than an absent one, or it
// would be told there is nothing to watch and give up before the first token exists.
function beginArticleStream(id: string): void {
  articleStreams.set(id, { text: '', done: false, listeners: new Set() });
}

function pushArticleDelta(id: string, chunk: string): void {
  const stream = articleStreams.get(id);
  if (!stream || stream.done) return;
  stream.text += chunk;
  for (const listener of stream.listeners) {
    listener({ type: 'delta', text: chunk });
  }
}

// Close the stream on the finished, authoritative article. The deltas were the RAW draft;
// applyDesignations has since rewritten first mentions, so a watcher left holding the
// concatenated deltas would be showing an article that is subtly not the one on the row.
// One replacing snapshot settles that before anyone can notice the difference.
function finishArticleStream(id: string, article: string): void {
  const stream = articleStreams.get(id);
  if (!stream || stream.done) return;
  if (article !== stream.text) {
    stream.text = article;
    for (const listener of stream.listeners) {
      listener({ type: 'snapshot', text: article });
    }
  }
  endArticleStream(id);
}

function endArticleStream(id: string): void {
  const stream = articleStreams.get(id);
  if (!stream || stream.done) return;
  stream.done = true;
  for (const listener of stream.listeners) listener({ type: 'end' });
  stream.listeners.clear();
  const timer = setTimeout(
    () => articleStreams.delete(id),
    ARTICLE_STREAM_TTL_MS,
  );
  // Never hold the process open for a cleanup timer.
  timer.unref?.();
}

// Watch one run's article being written. The buffered text is delivered synchronously as a
// `snapshot` before the listener is registered, so no delta can slip through the gap — and a
// reconnecting client REPLACES rather than appends, which is what keeps an EventSource retry
// from doubling the text.
//
// `live: false` means there is nothing to watch (no such run in this process, or it already
// finished): the caller should close and let the ordinary poll deliver the result.
export function subscribeArticleStream(
  id: string,
  listener: (event: ArticleStreamEvent) => void,
): { unsubscribe: () => void; live: boolean } {
  const stream = articleStreams.get(id);
  if (!stream) return { unsubscribe: () => {}, live: false };
  if (stream.text) listener({ type: 'snapshot', text: stream.text });
  if (stream.done) {
    listener({ type: 'end' });
    return { unsubscribe: () => {}, live: false };
  }
  stream.listeners.add(listener);
  return { unsubscribe: () => stream.listeners.delete(listener), live: true };
}

// Streaming the draft is a display nicety over a paid call, so it has its own kill switch
// independent of ARTICLE_GENERATION_MODE: unset it and the draft call reverts to the exact
// non-streaming request it made before, with the UI falling back to its progress steps.
function articleStreamingEnabled(): boolean {
  return process.env.ARTICLE_STREAMING !== '0';
}

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

// Set when the officer's requested article length was not reached (null when it was, when they
// asked for none, or when no article ran this session).
export function getLengthWarning(id: string): LengthWarning | null {
  return lengthWarnings.get(id) ?? null;
}

// Set when the latest social poster carried more items than any master can lay out (null when
// it fitted, or when no render happened this session).
export function getPosterCapacityWarning(
  id: string,
): { needed: number; available: number } | null {
  return posterCapacityWarnings.get(id) ?? null;
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

// The last edit of this run that failed while its earlier output stayed intact (null when the
// run is clean, or when the failure predates this process). The row itself reads `completed`.
export function getEditFailure(id: string): string | null {
  return editFailures.get(id)?.message ?? null;
}

// Whether that failed edit can be re-run by this process (false once a restart has dropped the
// armed thunk — the run is still usable, it just cannot be retried in one click).
export function isEditRetryable(id: string): boolean {
  return editFailures.get(id)?.retry != null;
}

// Re-run the failed edit with the arguments it was given. Returns false when there is nothing
// armed — a different process ran it, or the run was already recovered — and the caller then
// simply clears the failure, which is all a legacy `failed` row needs to become usable again.
export function retryFailedEdit(id: string): boolean {
  const failure = editFailures.get(id);
  if (!failure?.retry) return false;
  editFailures.delete(id);
  failure.retry();
  return true;
}

export function clearEditFailure(id: string): void {
  editFailures.delete(id);
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

// An edit job's failure is survivable when the run still carries what it produced before the
// edit: the poster (with every immutable version behind it) or the article. Put the row back to
// `completed` and report the failure through the transient registry instead, so a poster that
// exists is never hidden by an edit that did not land. Returns false when there is nothing to
// go back to — that failure is real and belongs on the row.
async function recoverEditFailure(
  client: SupabaseClient,
  id: string,
  error: unknown,
  retry: () => void,
): Promise<boolean> {
  try {
    const row = await getGeneration(client, id);
    if (!row || (!row.posterPath && !row.article)) return false;
    await updateGeneration(client, id, {
      status: 'completed',
      step: 'done',
      error: null,
    });
    editFailures.set(id, { message: errorMessage(error), retry });
    return true;
  } catch (recoverError) {
    // Falling through to the normal failed write is the safe outcome: the officer sees a
    // failure either way, and the row is never left claiming to be running.
    console.error(`[job ${id}] could not recover edit failure:`, recoverError);
    return false;
  }
}

// Wrap a job body with the shared bookkeeping: claim the id, flip the row to
// running, persist completed/failed, always release the id.
//
// A retry armed by `armEditRetry` marks the body as an EDIT of an already-produced run (see
// `editFailures`): its failure restores the row instead of failing it, and the thunk re-arms
// this same job with the same arguments for the officer's retry button.
function runJob(
  client: SupabaseClient,
  id: string,
  task: string,
  job: () => Promise<void>,
): void {
  // Claimed synchronously, so it belongs to THIS attempt and cannot be inherited by the next
  // job to run on the row.
  const retry = pendingEditRetries.get(id) ?? null;
  pendingEditRetries.delete(id);
  running.add(id);
  // A new attempt supersedes whatever the last one reported.
  editFailures.delete(id);
  void (async () => {
    // Meter every OpenAI text call this job makes (chatComplete records into the ambient
    // accumulator) plus the fixed image-render cost the job records explicitly.
    const cost = createCostAccumulator();
    try {
      await runInCostScope(cost, () => runInCostTask(task, job));
      await updateGeneration(client, id, {
        status: 'completed',
        step: 'done',
        error: null,
      });
    } catch (error) {
      console.error(`[job ${id}] failed:`, error);
      const recovered = retry
        ? await recoverEditFailure(client, id, error, retry)
        : false;
      if (!recovered) {
        try {
          await updateGeneration(client, id, {
            status: 'failed',
            error: errorMessage(error),
          });
        } catch (updateError) {
          console.error(`[job ${id}] could not persist failure:`, updateError);
        }
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
      try {
        const row = await getGeneration(client, id);
        if (row) {
          const creativeTask =
            task === 'article_poster_creation' ||
            task === 'social_post_creation' ||
            task === 'youtube_thumbnail_creation' ||
            task === 'poster_regeneration' ||
            task === 'poster_content_revision' ||
            task === 'poster_image_revision';
          recordTasksFromCost(
            client,
            creativeTask ? 'social' : row.dloIntakeId ? 'article' : 'social',
            cost,
          );
        }
      } catch (usageError) {
        console.error(`[job ${id}] could not record task usage:`, usageError);
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
// Exported so the detail payload can tell the web WHICH phases a run walks. Without it the
// progress list can only guess, and it guessed the full pipeline: a simple-mode run showed six
// steps of which one ever became active, so a multi-minute single call read as frozen.
export function articleGenerationMode(): 'simple' | 'full' {
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

// The verified glossary rows whose Marathi form occurs in the note, as the article prompt wants
// them. BOTH prompt variants read them as of simple-v4: neither specification states name rules
// any more, so each is handed the spellings themselves — the dictionary reaching the article as
// SPELLING rather than only as designations.
//
// Best-effort by construction: a failure logs and returns [], because an unreachable dictionary
// must cost the spelling hints, never the article. applyDesignations() remains the structural
// guarantee, and it runs off the officer-approved pairs regardless of what this returns.
async function articleNameDictionary(
  client: SupabaseClient,
  note: string,
): Promise<ArticleNameEntry[]> {
  try {
    const terms = await findGlossaryTermsInText(client, note);
    return terms.map((term) => ({
      marathi: term.marathi,
      termType: term.termType,
      designation: term.designation ?? null,
    }));
  } catch (error) {
    console.warn(
      '[article] could not load the name dictionary; continuing without it:',
      error,
    );
    return [];
  }
}

// Full pipeline for a new generation: article (always — poster copy derives its
// facts from the verified article even in poster-only mode), then optionally
// copy -> scene image -> typeset poster.
export function startGenerationJob(client: SupabaseClient, id: string): void {
  // Registered here, synchronously, rather than beside the draft call it feeds: the browser
  // opens its stream the moment this job's POST answers, and a run that has not yet reached
  // the draft would otherwise report "nothing to watch" and stop asking.
  if (articleStreamingEnabled()) beginArticleStream(id);
  const job = async (): Promise<void> => {
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
    const dateline = currentArticleDateline(shared.category);

    // /dlo's post-name-review prompt is an explicit product contract, not an experiment behind
    // ARTICLE_GENERATION_MODE. Keep it on the single-call path even when another article surface
    // opts back into the legacy full pipeline.
    const dloArticle = Boolean(row.dloIntakeId);
    const mode = dloArticle ? 'simple' : articleGenerationMode();
    const result =
      mode === 'simple'
        ? await (async () => {
            // The new /dlo lane's sources, if this run has any: documents and photographs
            // the article call reads for itself. Empty for every other run, and the two
            // generators take the same options and return the same shape — so this is the
            // only line that differs between the lanes, and everything below (the dateline,
            // the warnings, the style-reference write, posters, translation) is shared.
            const sourceFiles = await sourceFilesForGeneration(client, row);
            const writeArticle =
              sourceFiles.length > 0
                ? (note: string, options: SimpleGenerateArticleOptions) =>
                    generateArticleFromSources(note, {
                      ...options,
                      files: sourceFiles,
                    })
                : generateArticleSimple;
            const simple = await writeArticle(row.note, {
              ...shared,
              promptMode: dloArticle ? 'dlo' : 'default',
              // Tier 1 of the style-reference hierarchy (migration 0035). Read off the ROW, so
              // a retry reproduces the same reference rather than silently re-styling.
              styleReference: row.styleReference,
              // The officer's own direction for this article (migration 0041). Read off the
              // ROW for the same reason as the style reference: a retry must reproduce the
              // same article rather than a differently-directed one. The `full` pipeline does
              // not take it — it is the legacy opt-out, deliberately left byte-for-byte.
              instructions: row.instructions,
              // The verified dictionary rows this note actually mentions. Read by both prompt
              // variants: neither spells out name rules, both are handed the spellings.
              names: await articleNameDictionary(client, row.note),
              // Every DGIPR news copy starts with the configured publication place and today's
              // India-local date. The model receives it for flow; ensureArticleDateline below
              // enforces it deterministically on the final text.
              location: dateline?.location,
              date: dateline?.date,
              onProgress: progress,
              // Publish the draft as it is written, so the officer reads it appearing rather
              // than watching a progress bar for minutes. Display only — the authoritative
              // article is the returned one, which the row-write below and the poll deliver.
              ...(articleStreamingEnabled()
                ? {
                    onDelta: (chunk: string) => pushArticleDelta(id, chunk),
                  }
                : {}),
            });
            return {
              article: simple.article,
              factCheck: simple.factCheck,
              referenceTitle: simple.styleReference.title,
              referenceUrl: simple.styleReference.url,
              fiveWOneH: simple.fiveWOneH,
              designationIssues: simple.designationIssues,
              lengthWarning: simple.lengthWarning,
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
              // The full pipeline has its own coverage loop and takes no length request; a
              // length asked for there is honoured by the prompt alone, not measured.
              lengthWarning: null as LengthWarning | null,
              styleReferenceMeta: null,
            };
          })();
    const finalArticle = ensureArticleDateline(result.article, shared.category);

    // The article is final; anything still watching should stop here rather than hold a
    // connection open through the 1-2 minute poster render. Sending the AUTHORITATIVE text as
    // one last snapshot matters: the deltas carried the raw draft, and applyDesignations has
    // since inserted the officer's approved पदनामे into it.
    finishArticleStream(id, finalArticle);

    // Report, never fail: the article is about to be persisted either way, and an officer who
    // can see "this designation did not apply" can fix it — one who cannot, cannot.
    designationWarnings.set(id, [...result.designationIssues]);
    lengthWarnings.set(id, result.lengthWarning);
    await updateGeneration(client, id, {
      article: finalArticle,
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
      finalArticle,
      row.referenceImageId,
      { note: row.note, posterHeading: row.posterHeading },
    );
  };

  runJob(client, id, 'article_generation', async () => {
    try {
      await job();
    } finally {
      // Whatever happened — finished, failed, poster-only, or a pasted article that was never
      // drafted at all — no more text is coming, so release every watcher instead of leaving
      // it on the heartbeat. Idempotent: the normal path already closed on the final article.
      endArticleStream(id);
    }
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
  runJob(client, id, 'article_poster_creation', async () => {
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
//
// `size` is the render size, and it is per-BRAND because the two brands finish differently:
// DGIPR's band is JOINED BELOW the artwork (so the model paints SOCIAL_ARTWORK_SIZE and the
// officer receives 1280x1600), while CMO's chrome is OVERLAID (so what the model paints is
// already the finished poster, CMO_POSTER_SIZE). It travels in the payload rather than being
// pinned in the workflow, which is also what keeps the deploy safe in both directions: the
// workflow defaults the field to '1280x1600', so an old API against the new workflow renders
// exactly as it does today, and a new API against the old workflow is ignored rather than
// broken.
async function renderSocialPosterViaN8n(
  id: string,
  imageUrl: string,
  prompt: string,
  size: string,
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
      size,
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
  // The blue clear-space rectangles carried on currentPosterUrl, in draw order, and
  // — for a displace, which re-lays the poster out — the checklist of what must
  // survive it. One object rather than two more positionals.
  clear: {
    actions?: readonly PosterClearAction[];
    inventory?: readonly string[];
  } = {},
): Promise<Buffer> {
  const prompt = buildFeedbackPrompt({
    imageFeedback: feedback,
    brand,
    markerCount,
    clearActions: clear.actions ?? [],
    contentInventory: clear.inventory ?? [],
  });
  // Same per-brand sizes as the initial render: a DGIPR feedback round edits the finished
  // 1280x1600 poster, the model erases the branding it can see (stampedChromeRule) and returns
  // artwork, and overlayTwitterChrome joins a fresh band back on — so the poster stays exactly
  // 4:5 through any number of rounds rather than growing or shrinking.
  const rawPoster = await renderSocialPosterViaN8n(
    id,
    currentPosterUrl,
    prompt,
    brand === 'cmo' ? CMO_POSTER_SIZE : SOCIAL_ARTWORK_SIZE,
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

// How an ordinary (unpinned, non-CMO) social run picks its reference.
//
//   'information' (default) — raw note → the reference whose subject + information structure
//     fits it best, across the WHOLE enabled library; the poster type is then read off the
//     chosen reference. Nothing about the note is predicted first.
//   'classify' — the previous flow: classify the note into a post type, read point_count +
//     wants_photo off the same call, then score masters WITHIN that type. Kept as the
//     one-line rollback; every module it needs is still exported.
//
// Read here rather than in content-engine, beside the ARTICLE_GENERATION_MODE /
// ARTICLE_POSTER_MODE precedent: the flag selects between orchestration paths, and the engine
// modules stay ignorant of which one is live.
function socialReferenceMode(): 'information' | 'classify' {
  return process.env.SOCIAL_REFERENCE_MODE === 'classify'
    ? 'classify'
    : 'information';
}

// Resolve which poster type + master template a social run uses. The precedence is exactly the
// old workflow's: an exact-image pin wins, then a type pin, then the CMO brand — all three
// FORCE the type and skip selection over the library. Only an ordinary DGIPR run chooses from
// the library, information-first (see socialReferenceMode). A deleted pin falls through to the
// next rule, matching the previous nullable-pin behaviour. `id` is the selection seed.
async function resolveSocialReference(
  client: SupabaseClient,
  id: string,
  row: GenerationRow,
  brand: TemplateBrand,
  // The text this reference is being chosen FOR. On the AI-copy lanes it is the CURATED poster
  // content (extract-poster-points.ts), not the raw note — the whole point of curating before
  // resolving is that capacity is matched to what the poster will actually carry. Defaults to
  // the note, which is what every verbatim lane passes and what this always used to read.
  information: string,
): Promise<ResolvedReference> {
  // NO per-design-mode options, and there is nothing left to add one for. This function is now
  // only ever called for a mode that renders INTO the reference it returns, so every caller
  // wants the same answer for the same note. The `ignoreColour` flag that used to arrive here
  // existed for the fully-AI path, which no longer resolves a reference at all.
  if (row.referenceImageId) {
    const pinned = await resolvePinnedImage(client, row.referenceImageId, id);
    if (pinned) return pinned;
  }
  if (row.referenceTypeId) {
    const pinned = await resolvePinnedType(
      client,
      row.referenceTypeId,
      id,
      information,
    );
    if (pinned) return pinned;
  }
  if (brand === 'cmo') {
    return resolveCmoReference(client, id, information);
  }

  // Ordinary run, information-first: compare the raw note against every enabled master of the
  // brand and let the winning reference decide the type. The recency ring is keyed by BRAND
  // rather than by type here — the pool is the whole library, so spreading within one type
  // would no longer describe what the last few runs actually used.
  if (socialReferenceMode() === 'information') {
    const recencyKey = `${brand}:library`;
    // No per-design-mode options: every ordinary DGIPR social run — fresh or template, pinned
    // or not — reaches this call with identical arguments, so the reference is picked by one
    // process for all of them.
    const resolved = await resolveSocialReferenceByInformation(
      client,
      brand,
      id,
      information,
      recentMasters(recencyKey),
    );
    rememberMaster(recencyKey, resolved.master.id, resolved.poolSize ?? 1);
    return resolved;
  }

  // LEGACY (SOCIAL_REFERENCE_MODE=classify): classify the note against the DGIPR type catalog
  // (which excludes CMO), then select the best-fit master within the chosen type.
  const types = await listSocialTypes(client, 'dgipr');
  const classification = await classifyPosterType(
    information,
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
    information,
    recentMasters(recencyKey),
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

// The copy registry a fully-AI run writes into. 'generic' is headline + subhead + 3-6 supporting
// points — a shape the copy model bounds for itself, where every other registry exists to fill a
// particular template's slots. It is also generate-poster-copy's own fallback for an unknown
// copy_style, so this is not a new code path, just the one a reference-free run names explicitly.
const FRESH_COPY_STYLE = 'generic';

// A fresh run has no reference ranker, so nothing hands it the Marathi working title that
// becomes generations.reference_title. The poster's own headline is the best available answer and
// costs nothing — it is already written by the time this is needed. null only if the copy step
// produced no headline at all, which is the same as the pre-existing "no title" case.
function freshWorkingTitle(
  copy: Record<string, unknown> | undefined,
): string | null {
  const headline = copy?.headline;
  if (typeof headline !== 'string') return null;
  const trimmed = headline.trim();
  return trimmed === '' ? null : trimmed;
}

// The same job for a VERBATIM run, which has no copy object to take a headline from: the officer's
// own opening line is the best answer available and costs nothing. Without this a fresh_verbatim
// run would go into history untitled — the case freshWorkingTitle above exists to prevent.
const VERBATIM_TITLE_MAX_CHARS = 120;
function verbatimWorkingTitle(note: string): string | null {
  const first = note
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!first) return null;
  return first.length > VERBATIM_TITLE_MAX_CHARS
    ? `${first.slice(0, VERBATIM_TITLE_MAX_CHARS).trimEnd()}…`
    : first;
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
  // What this render must avoid ON TOP of the recent history, set by the redo buttons so a new
  // version cannot reproduce the one the officer just rejected. The recency ring only knows about
  // OTHER runs — a redo of this row is not in it yet — so without this a fresh seed could
  // legitimately land back on exactly what it was asked to replace.
  //
  //   families   — colour, and ONLY on the "different colours" redo: a plain redo is not a
  //                complaint about the palette.
  //   placement* — the ARRANGEMENT, on EVERY redo, which is what makes the reload button
  //                structurally guarantee a different-shaped poster rather than hope for one.
  avoid: Readonly<{
    families?: readonly PaletteFamily[] | undefined;
    placementIds?: readonly string[] | undefined;
    placementFamilies?: readonly PlacementFamily[] | undefined;
  }> = {},
): Promise<{ postType: string; title: string | null }> {
  // A fully-AI poster: designed from scratch, with NO reference of any kind. TWO modes land here,
  // differing only in where the poster's words come from — 'fresh' has generatePosterCopy write
  // them out of the note, 'fresh_verbatim' typesets the officer's own text unchanged. Design and
  // content are independent questions on the create form and are independent here too.
  const isFresh =
    brand !== 'cmo' &&
    (designMode === 'fresh' || designMode === 'fresh_verbatim');
  // The officer's text IS the poster's content: no copy call, and the raw note goes to the image
  // model. Same contract as the fixed-template lane below, minus the template.
  const isFreshVerbatim = isFresh && designMode === 'fresh_verbatim';

  // THE OFFICER WROTE THE PROMPT (migration 0045). Everything this function assembles for the
  // image model is then skipped — see buildCustomPosterPrompt for what is sent instead, and why
  // the reserved-zone blocks are the one thing that still travels.
  //
  // It does NOT change which of the two RENDER paths runs, and that is deliberate: a pinned
  // template still puts designMode on onbrand/adaptive, so the resolved reference IS that pin
  // and the master is edited through the thin workflow with the officer's brief as its only
  // instruction; with no pin the lane is fresh/fresh_verbatim and the poster is generated from
  // scratch. The officer answers that question by pinning or not pinning, exactly as today.
  //
  // Read off the ROW rather than taken as a job option: startPosterRegenerateJob and the retry
  // path both re-read the row, and a prompt held only in the create request would be silently
  // dropped by the first पुन्हा तयार करा — which would then re-render with the built prompt and
  // look like the feature failing at random.
  const customPrompt =
    brand === 'cmo' ? null : (row.imagePrompt?.trim() ?? '') || null;

  // ABOUT THE REFERENCE RESOLUTION BELOW (step 1) — FOR THE TEMPLATE MODES ONLY.
  //
  //    A 'fresh' run now resolves NOTHING (2026-08-07). It used to resolve one anyway and use it
  //    "headlessly": no pixels reached the image model, but the picked master still decided the
  //    copy registry, pinned the body-point count to its slot count, decided photo-vs-text-only
  //    and supplied a STRUCTURE INSPIRATION line. That is a template deciding the shape of a
  //    poster the officer asked to be designed freely — and it is what produced the twelve
  //    cramped numbered rows on generation 63511b51. The library is described by layout
  //    structure, so selecting on it can only ever return a structure; asking for a poster with
  //    no reference and then handing the copy model a reference's slot count is not that.
  //
  //    What replaces it, all of it already existing behaviour for an un-analysed master:
  //      - copyStyle  -> 'generic', whose registry self-bounds to a sensible 3-6 points rather
  //                      than filling a template's slots.
  //      - layoutSpec -> null, so nothing pins the point count and hasPhoto defaults true.
  //      - structure  -> the assigned COMPOSITION archetype alone (poster-layouts.ts), which
  //                      already OUTRANKED the master's hint whenever both were present.
  //    A fresh run therefore also has no capacity ceiling, so it can never report a shortfall:
  //    there is no template to overflow.
  //
  //    For the template modes the precedence is unchanged — a pin (image or type) or the CMO
  //    brand forces the type and skips selection; otherwise the note is compared against the
  //    whole enabled library, capacity-first, by ONE process for every template mode.
  await updateGeneration(client, id, { step: 'classify' });

  // 0. WHAT GOES ON THE POSTER — decided BEFORE the template is chosen.
  //
  //    Which lane this run is on has to be known here rather than after resolution, because the
  //    curation has to happen first; it is derivable already, since `resolved` is non-null for
  //    exactly the modes that are not fresh.
  //
  //    The fixed-template mode ("ठरलेले टेम्पलेट") deliberately gives the image model only the
  //    unchanged reference image and the officer's information, with two chrome exclusions. It
  //    therefore skips poster-copy generation entirely: generated structured copy would be
  //    hidden editorial work — and, worse, generatePosterCopy condenses the information to the
  //    master's slot count, which is exactly the content loss that path must not have.
  //
  //    BOTH social categories take that branch. It was 'twitter'-only, which silently gave a
  //    Facebook run the copy pipeline instead — the same ठरलेले टेम्पलेट choice producing a
  //    different poster depending on the platform. isSocialCategory is the repo's standing rule
  //    for exactly this class of bug.
  const isSimpleTemplateEdit =
    !isFresh &&
    isSocialCategory(row.category) &&
    brand === 'dgipr' &&
    designMode === 'onbrand';
  // 'fresh_verbatim' skips the copy call for the SAME reason, one lane over: generated
  // structured copy would be hidden editorial work over text the officer wrote to be printed.
  // customPrompt skips it for the third time over — on that lane they have opted out of the
  // platform's opinions about the poster altogether.
  const usesVerbatimText =
    isSimpleTemplateEdit || isFreshVerbatim || customPrompt !== null;

  //    On every OTHER lane — fresh, adaptive and CMO, i.e. exactly where जसाच्या तसा मजकूर is
  //    unticked — the officer's whole input now goes to one editorial call that decides what
  //    belongs on a poster at all, and everything downstream works from THAT instead of the raw
  //    note. Before this, nothing in the lane ever asked the question: the point count fell out
  //    of analyzeInformationShape counting every sentence, enforceSourceStructure then finding a
  //    master big enough to hold all of them, and generatePosterCopy being pinned to that
  //    master's slot count — so a ten-sentence press note deterministically became a ten-row
  //    poster nobody can read.
  //
  //    It runs BEFORE resolveSocialReference and not inside the copy step, and that ordering is
  //    the load-bearing part: curate afterwards and the template has already been chosen for ten
  //    items, leaving the image model to invent filler for the empty rows — the exact failure
  //    enforceSourceStructure exists to prevent.
  //
  //    Best-effort: any failure returns the raw note, so the worst case is the behaviour that
  //    shipped yesterday. Kept under the 'classify' step rather than given one of its own, so
  //    the officer's progress list still runs classify → copy → image in order.
  //
  //    NOTE ON THE OFFICER'S BRIEF: `customPrompt` is wired through as context (labelled, and
  //    explicitly not a source of facts — see extract-poster-points.ts), but a run carrying an
  //    AI प्रॉम्प्ट is verbatim by definition of `usesVerbatimText` above, so today it is always
  //    null here. Letting that lane curate its content while the brief governs its design is one
  //    line — dropping `customPrompt !== null` from `usesVerbatimText`.
  const posterSource = usesVerbatimText
    ? null
    : await extractPosterPoints({
        note: row.note,
        officerPrompt: customPrompt ?? undefined,
      });
  const posterNote = posterSource?.curated ? posterSource.text : row.note;
  if (posterSource) {
    console.log(
      `[job ${id}] poster content: ${JSON.stringify({
        curated: posterSource.curated,
        points: posterSource.points.length,
        headline: posterSource.headline,
        leftOut: posterSource.leftOut,
      })}`,
    );
  }

  // 1. Resolve the poster type + the master, from the CURATED content on an AI-copy lane and
  //    from the officer's own text on a verbatim one.
  const resolved = isFresh
    ? null
    : await resolveSocialReference(client, id, row, brand, posterNote);

  console.log(
    `[job ${id}] social poster reference: ${JSON.stringify(
      resolved
        ? {
            id,
            brand,
            forced: resolved.forced,
            type: resolved.type.slug,
            analyzed: Boolean(resolved.master.layoutSpec),
            pick: resolved.master.reason,
          }
        : { id, brand, reference: 'none (fully-AI render)' },
    )}`,
  );

  // Record the capacity shortfall (if any) so the detail payload can warn the officer that this
  // poster is carrying more items than any template is built to lay out. A fresh run has no
  // template and therefore no ceiling, so it always clears the warning.
  if (resolved?.shortfall) {
    posterCapacityWarnings.set(id, { ...resolved.shortfall });
  } else {
    posterCapacityWarnings.delete(id);
  }

  let copyResult: Awaited<ReturnType<typeof generatePosterCopy>> | null = null;
  if (!usesVerbatimText) {
    // 2. Scheme-name lock source: verified glossary scheme/org names present in the CURATED
    //    content. These must survive in the copy in full (lock-scheme-names). Free — a
    //    substring match over the small verified set, no model call. Read off the curated text
    //    rather than the whole note on purpose: a scheme named only in a paragraph the poster
    //    is not carrying is not a name the copy has to preserve, and demanding it would push
    //    the copy back toward the material that was just deselected.
    const glossaryTerms = await findGlossaryTermsInText(client, posterNote);
    const lockedSchemeNames = glossaryTerms
      .filter((t) => t.termType === 'scheme' || t.termType === 'org')
      .map((t) => t.marathi);

    // 3. Copy (gpt-5.6-luna, metered inside this job's cost scope), written from the CURATED
    //    content rather than the raw note — so the master's slot pin below is now a pin to a
    //    number of points a poster can actually carry, and `contentLed`'s no-ceiling rule on
    //    the fresh lane has already-selected material to work from.
    //    On a fresh run there is no resolved type, so the copy runs on the 'generic' registry
    //    (headline + 3-6 supporting points) with a null layoutSpec — no slot pin, no operator
    //    type description steering the tone toward a template's purpose.
    await updateGeneration(client, id, { step: 'copy' });
    copyResult = await generatePosterCopy({
      note: posterNote,
      postType: resolved?.type.slug ?? FRESH_COPY_STYLE,
      copyStyle: resolved?.type.copyStyle ?? FRESH_COPY_STYLE,
      description: resolved?.type.description,
      brand,
      layoutSpec: resolved?.master.layoutSpec ?? null,
      lockedSchemeNames,
      // CONTENT-LED on the fully-AI lane only. A fresh run has no master and no slot count, so
      // the registry's own floors ('3 to 6 points') and its mandatory kicker/subhead were the
      // only things deciding how much copy a poster carried — which meant every fresh poster
      // started life as the same three-to-six-row stack whatever the note said, and a one-
      // announcement note got a supporting line invented to fill the slot. The template lanes
      // keep the floors: there the master really does have rows to fill.
      contentLed: isFresh,
    });
  }

  // 3a. Colour palette + composition — only the fully-AI-generated DGIPR path uses them. Both are
  //     rotated per run away from what the last few runs used (families and coverages first, then
  //     exact ids), so consecutive posters differ in hue AND in shape. The avoid set includes the
  //     hue families the last few renders were MEASURED to be, not only the ones they were
  //     assigned — if the image model ignores a spec, avoiding intentions would achieve nothing.
  //     Seeded, so a retry reproduces the same assignment rather than redesigning. With no
  //     master to take a structure hint from, the assigned archetype is now the ONLY structural
  //     instruction a fresh poster gets — which it effectively already was, since COMPOSITION
  //     was documented to outrank the master's hint wherever the two disagreed.
  const history = isFresh
    ? await recentStyleHistory(client, SOCIAL_STYLE_CATEGORIES)
    : undefined;
  const assignedPalette = isFresh
    ? pickPalette(seed, {
        ids: history?.paletteIds,
        families: [...(history?.families ?? []), ...(avoid.families ?? [])],
      })
    : undefined;
  const assignedLayout = isFresh
    ? pickLayout(
        seed,
        // A verbatim run made no copy call, so there is nothing to read a shape off. The defaults
        // are the un-analysed-master defaults used everywhere else in this file: photo allowed,
        // generic registry. Neither reaches the image model any more (the assignment is recorded
        // for poster_style and nothing else) — but pickLayout still has to be given an answer, and
        // `copyResult!` here was a live null-dereference the moment a second copy-less mode existed.
        {
          hasPhoto: copyResult?.hasPhoto ?? true,
          copyStyle: copyResult?.copyStyle ?? FRESH_COPY_STYLE,
        },
        { ids: history?.layoutIds, coverages: history?.coverages },
      )
    : undefined;

  // 3a-ii. THE ARRANGEMENT — the one assignment above that actually reaches the image model
  //     (2026-08-14). The palette and the layout beside it are recorded for poster_style and
  //     nothing else, retired from the prompt on 2026-08-10; this one is emitted, because handing
  //     the composition over entirely did not produce varied compositions. It produced gpt-image's
  //     two habits — a band over rows, or a picture down one side and text down the other — on run
  //     after run, which is exactly what the officer reported.
  //
  //     WHY IT IS SAFE TO STATE FIRMLY, which is the objection it has to answer: the anchor is
  //     filtered against what this poster actually contains BEFORE it can be picked, so an
  //     arrangement the content cannot carry is never assigned. Both inputs are deterministic and
  //     free — no model call decides eligibility:
  //
  //       hasImagery — the copy's own verdict. On a fresh run layoutSpec is null so this is
  //                    true, and the model invents the imagery; the flag is here for the
  //                    text-only case rather than as decoration.
  //       itemCount  — read off the WRITTEN COPY, not the note. The generic registry self-bounds
  //                    to 3-6 points, so a twelve-sentence note yields six items; counting the
  //                    note would have excluded every capacity-capped anchor for no reason. The
  //                    verbatim lane makes no copy call, so it passes 0 = unknown, which bars
  //                    nothing and leaves the whole library eligible.
  const assignedPlacement = isFresh
    ? pickPlacement(
        seed,
        {
          hasImagery: copyResult?.hasPhoto ?? true,
          itemCount: copyResult ? posterCopyItemCount(copyResult.copy) : 0,
        },
        {
          ids: [
            ...(history?.placementIds ?? []),
            ...(avoid.placementIds ?? []),
          ],
          families: [
            ...(history?.placementFamilies ?? []),
            ...(avoid.placementFamilies ?? []),
          ],
        },
      )
    : undefined;

  // 3b. Art direction — RETIRED (2026-08-10). It designed a treatment WITHIN an assigned palette
  //     and an assigned composition, and buildPosterPrompt no longer emits any of the three: the
  //     fresh brief names the client and hands the whole design over to the image model. A paid
  //     call whose output is dropped on the floor is worse than no call, so it is not made.
  //     generateArtDirection itself is left in place — restoring the specification is re-adding
  //     this block and the prompt's COLOUR SPECIFICATION / ART DIRECTION / COMPOSITION blocks.
  const artDirection = null;
  if (assignedPalette && assignedLayout) {
    console.log(
      `[job ${id}] style: palette=${assignedPalette.id} (${assignedPalette.family}) layout=${assignedLayout.id} (${assignedLayout.coverage})` +
        // The arrangement is logged separately from the two beside it BECAUSE it is the only one
        // that reached the prompt — when a poster comes back the wrong shape, this line is what
        // says whether it was assigned the wrong anchor or ignored the right one.
        ` placement=${assignedPlacement?.id ?? 'none'} (${assignedPlacement?.family ?? '-'})` +
        ` | avoided families=[${(history?.families ?? []).join(',')}${(avoid.families ?? []).length ? `+${(avoid.families ?? []).join(',')}` : ''}]` +
        ` placements=[${(history?.placementIds ?? []).join(',')}${(avoid.placementIds ?? []).length ? `+${(avoid.placementIds ?? []).join(',')}` : ''}]` +
        ` measured=[${(history?.measuredBuckets ?? []).join(',')}]` +
        `${artDirection ? '' : ' (undirected)'}`,
    );
  }

  // 4. Image prompt (pure string assembly, no model call).
  const prompt = customPrompt
    ? buildCustomPosterPrompt({
        imagePrompt: customPrompt,
        information: row.note,
        // A resolved reference on this lane can only be the officer's own pin (a fresh run
        // resolves nothing at all), so this is exactly "is the model editing an image?".
        editsReference: resolved !== null,
      })
    : buildPosterPrompt({
        copy: copyResult?.copy ?? {},
        // The officer's text, on both verbatim lanes — printed onto the chosen template
        // (isSimpleTemplateEdit) or typeset onto a from-scratch design (isFreshVerbatim).
        information: usesVerbatimText ? row.note : undefined,
        // Only reaches the fixed-template branch, which is the one that must show every item —
        // each of them exactly once. The shortfall is deliberately NOT passed any more: it used to
        // tell the image model to repeat the reference's rows, and "repeat" is the wrong word to
        // put anywhere near a prompt that must reproduce the officer's text unchanged. It still
        // warns the officer through posterCapacityWarnings above.
        // `isSimpleTemplateEdit` implies a resolved reference (it requires !isFresh), but that
        // is now derived before resolution so the optional chain is what tells the compiler.
        itemCount: isSimpleTemplateEdit ? resolved?.itemCount : undefined,
        copyStyle:
          copyResult?.copyStyle ?? resolved?.type.copyStyle ?? FRESH_COPY_STYLE,
        designMode,
        brand,
        // Both empty on a fresh run. buildPosterPrompt only demands a master URL for the modes that
        // EDIT one, and it omits the STRUCTURE INSPIRATION block entirely when there is no summary —
        // so a fresh prompt now carries the assigned palette and composition and nothing borrowed.
        masterUrl: resolved?.master.url,
        layoutSummary: resolved?.master.layoutSpec?.layoutSummary,
        hasPhoto: copyResult?.hasPhoto ?? false,
        artDirection: artDirection ?? undefined,
        assignedPalette,
        assignedLayout,
        // The only one of these four the prompt actually emits — see the assignment above.
        assignedPlacement,
      });

  // 5. Render. 'fresh' paints from scratch via the direct image call — no master, and no n8n;
  //    the template modes edit the chosen master through the thin workflow.
  await updateGeneration(client, id, { step: 'image' });
  //
  //    The size is the ARTWORK, not the finished poster: overlayTwitterChrome joins the
  //    branding band onto a strip below it, and artwork + strip is exactly 1280x1600 (4:5) so
  //    the officer's Canva/Instagram/Facebook portrait frame is filled with no gap. CMO is the
  //    exception — its chrome is overlaid, so its render IS the finished poster. `isFresh` is
  //    false for CMO by construction, so the direct call never needs that branch.
  const rawPoster = isFresh
    ? await generateImage(prompt, { size: SOCIAL_ARTWORK_SIZE })
    : await renderSocialPosterViaN8n(
        id,
        resolved!.master.url,
        prompt,
        brand === 'cmo' ? CMO_POSTER_SIZE : SOCIAL_ARTWORK_SIZE,
      );
  // gpt-image-2 on the social canvas — attribute the fixed tier price (image usage isn't measurable
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
    // The arrangement rides along in the same jsonb value (no migration — 0028's column has no
    // column schema). Persisting it is what lets a redo bar this exact shape, and what lets the
    // next few runs spread away from it.
    posterStyle = buildPosterStyle(
      assignedPalette,
      assignedLayout,
      measured,
      assignedPlacement,
    );
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
      (typeof copyResult?.copy.scene_brief === 'string'
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
  // caption failure never loses the paid render. A fresh run has no reference ranker to name it,
  // so the poster's own headline stands in — a run must not go into history untitled just
  // because nothing was selected for it.
  const workingTitle =
    resolved?.title ??
    (isFreshVerbatim
      ? verbatimWorkingTitle(row.note)
      : freshWorkingTitle(copyResult?.copy));
  await updateGeneration(client, id, {
    referenceTitle: workingTitle,
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

  return {
    postType: resolved?.type.slug ?? FRESH_COPY_STYLE,
    title: workingTitle,
  };
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
  runJob(client, id, 'social_post_creation', async () => {
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

    if (!captionOnly) {
      const brand = row.templateBrand;
      // Default is now 'fresh' — a unique, AI-designed poster each run. 'onbrand'/'adaptive'
      // remain available for a run that explicitly wants to follow a template.
      const designMode = (row.designMode ?? 'fresh') as PosterDesignMode;

      await renderAndStoreSocialPoster(
        client,
        id,
        row,
        brand,
        designMode,
        1,
        id,
      );

      if (!options.generateCaption) return;
    }

    // Caption → article column (the social lane's convention). The supplied note is sent
    // directly to the deliberately simple caption prompt; poster copy is not included.
    await updateGeneration(client, id, { step: 'caption' });
    const caption = await runInCostTask('social_caption_creation', () =>
      generateSocialCaption({
        note: row.note,
        platform: socialPlatformOf(row.category),
      }),
    );
    await updateGeneration(client, id, { article: caption });
  });
}

// --- YouTube thumbnails (migration 0042) ------------------------------------------------
//
// The lane in one line: pick the reference that can hold the officer's information, edit it
// with a prompt built here, fit the result to 1280x720, stamp the chrome, upload. No
// article, no caption, no classification, no n8n, no publishing — one paid image call per
// render and nothing else.
//
// It reuses the social lane's capacity-first selection (resolveYoutubeReference →
// selectReferenceByInformation) rather than a second algorithm, because the problem is the
// same one: the reference's content slots must be able to show every item the officer wrote.
// What it does NOT reuse is renderAndStoreSocialPoster, and deliberately — that function
// carries the palette rotation, the composition rotation, art direction, colour measurement,
// poster copy, CMO circle photos and the n8n edit call, every one of which is either a
// 4:5-poster concept or a thing this lane has decided not to do. Threading a fifth mode
// through it would have made both harder to read.
//
// The edit is a DIRECT call (editImage) rather than the n8n round-trip the social/article
// lanes make: the workflows exist because those prompts used to live inside them, and there
// is no reason to add a third.
const YOUTUBE_RECENCY_KEY = 'youtube:library';

async function renderAndStoreYoutubeThumbnail(
  client: SupabaseClient,
  id: string,
  row: GenerationRow,
  version: number,
  // Diversifies selection per run (id on a first render, `${id}:v${n}` on a redo).
  seed: string,
): Promise<{ title: string | null }> {
  // 1. Which reference. A pinned exact image wins outright (resolvePinnedImage is
  //    category-agnostic and resolves the type off the image itself); otherwise the whole
  //    enabled youtube library is ranked against the officer's information.
  await updateGeneration(client, id, { step: 'classify' });
  //    A pin from another library is rejected at create time (referenceCategoryOf), so it
  //    is not re-checked here.
  let resolved: ResolvedReference | null = row.referenceImageId
    ? await resolvePinnedImage(client, row.referenceImageId, seed)
    : null;
  if (!resolved) {
    resolved = await resolveYoutubeReference(
      client,
      seed,
      row.note,
      recentMasters(YOUTUBE_RECENCY_KEY),
    );
    rememberMaster(
      YOUTUBE_RECENCY_KEY,
      resolved.master.id,
      resolved.poolSize ?? 1,
    );
  }

  console.log(
    `[job ${id}] youtube thumbnail reference: ${JSON.stringify({
      forced: resolved.forced,
      type: resolved.type.slug,
      analyzed: Boolean(resolved.master.layoutSpec),
      pick: resolved.master.reason,
    })}`,
  );

  // Same warning channel as the poster lanes: the officer is told when their information has
  // more items than any template lays out, so they can split it into two thumbnails.
  if (resolved.shortfall) {
    posterCapacityWarnings.set(id, { ...resolved.shortfall });
  } else {
    posterCapacityWarnings.delete(id);
  }

  // 2. WHOSE FACE. One cheap text call, and it guards the paid image call below.
  //
  //    The templates in the library are finished posters carrying a cut-out portrait of
  //    whichever official THAT post was about. Nothing used to tell the model who the NEW
  //    thumbnail is about, and the prompt went further — it called the attached template "the
  //    attached minister's photo" and said to preserve that face exactly — so a thumbnail
  //    about the Chief Minister shipped with a stranger's face. The identity now comes from
  //    the officer's own text and the reference supplies only the arrangement.
  //
  //    The verified dictionary is passed in so a note naming only the OFFICE
  //    ("मुख्यमंत्र्यांच्या हस्ते") still resolves to a person — the same designation → holder
  //    map prepareDesignations uses (migration 0032). Best-effort: the map failing (or an
  //    un-applied 0032) costs an office-only resolution, never the render.
  const officeHolders = await mapDesignationsToPersons(client).catch(
    (error: unknown) => {
      console.warn(`[job ${id}] designation map unavailable:`, error);
      return new Map<string, string[]>();
    },
  );
  //    Never throws — no face is the correct failure here, a wrong face is not.
  const people = await resolveThumbnailPeople({
    information: row.note,
    officeHolders,
  });

  // 3. Prompt (pure string assembly, no model call). The officer's note IS the content.
  const prompt = buildYoutubeThumbnailPrompt({
    information: row.note,
    itemCount: resolved.itemCount,
    slotShortfall: resolved.shortfall,
    people,
  });

  // 4. Render: edit the chosen reference. The reference is fetched here rather than handed to
  //    a workflow as a URL, so the only thing that can fail is a fetch we control.
  //    The size asked for is the ARTWORK, not the finished thumbnail: the department band is
  //    joined onto a strip BELOW it (overlayYoutubeChrome), so nothing the model paints can be
  //    covered by branding. Sending '1280x720' here is what buried the officer's own text.
  await updateGeneration(client, id, { step: 'image' });
  const reference = await fetchReferencePng(resolved.master.url);
  const edited = await editImage(reference, prompt, {
    size: YOUTUBE_ARTWORK_SIZE,
  });
  recordImageCost('youtube', imageQuality());

  // 5. Fit + chrome. fitToYoutubeThumbnail is normally a no-op; it exists so a model that
  //    answers in another aspect cannot be mistaken for the OTHER canonical shape by the
  //    footer join, putting the band at the wrong height silently.
  const thumbnailPng = await overlayYoutubeChrome(
    await fitToYoutubeThumbnail(edited),
  );
  const objectPath = posterPath(id, version);
  await uploadPng(client, objectPath, thumbnailPng);

  await updateGeneration(client, id, {
    referenceTitle: resolved.title ?? null,
    posterPath: objectPath,
  });
  return { title: resolved.title ?? null };
}

// Fetch a library master over its public Storage URL. Small and explicit rather than routed
// through downloadPng: SelectedMaster carries a URL (what the n8n lanes are handed), not a
// storage path.
async function fetchReferencePng(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Could not fetch the reference template (${response.status}).`,
    );
  }
  return Buffer.from(await response.arrayBuffer());
}

// The YouTube-thumbnail pipeline. One image, nothing else.
export function startYoutubeThumbnailJob(
  client: SupabaseClient,
  id: string,
): void {
  runJob(client, id, 'youtube_thumbnail_creation', async () => {
    const row = await getGeneration(client, id);
    if (!row) throw new Error(`Generation ${id} not found.`);

    await updateGeneration(client, id, {
      status: 'running',
      step: null,
      error: null,
    });

    await renderAndStoreYoutubeThumbnail(client, id, row, 1, id);
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
  // A redesign that fails leaves the previous poster and every earlier version in place, so
  // it is recovered rather than failed — and re-arming it needs only these options.
  armEditRetry(id, () => startPosterRegenerateJob(client, id, options));
  runJob(client, id, 'poster_regeneration', async () => {
    const row = await getGeneration(client, id);
    if (!row) throw new Error(`Generation ${id} not found.`);
    if (!row.posterPath) throw new Error(`Generation ${id} has no poster yet.`);

    await updateGeneration(client, id, {
      status: 'running',
      step: null,
      error: null,
    });

    const version = await nextVersion(client, id);

    // What this redo must not reproduce. The recency ring only knows about OTHER runs — a redo of
    // this row is not in it yet — so without barring the current version explicitly, a fresh seed
    // could land straight back on what the officer just pressed the button to replace.
    //
    // The row is parsed UNCONDITIONALLY now, where it used to be read only on the recolour path,
    // because the two axes are barred on different terms:
    //
    //   colour      — only on "वेगळ्या रंगात तयार करा". A plain redo is not a complaint about the
    //                 palette, and barring a family nobody objected to narrows the rotation for
    //                 nothing.
    //   arrangement — on EVERY redo, both buttons. "Give me another one" means another SHAPE
    //                 first of all; that is the whole of what the officer reported when a reload
    //                 returned the same poster with different wording. Barring the id and its
    //                 family is what makes that a guarantee rather than a new roll of the dice
    //                 (poster-placements.ts's harness asserts it at every version and anchor).
    const current = parsePosterStyle(row.posterStyle);
    const avoidFamilies: PaletteFamily[] =
      options.recolour && current ? [current.family] : [];
    // Resolved through the library rather than trusted from the row, so an anchor removed from
    // the library since the last render simply bars nothing instead of poisoning the pool.
    const currentPlacement = placementById(current?.placementId);
    const avoidPlacement = {
      placementIds: currentPlacement ? [currentPlacement.id] : [],
      placementFamilies: currentPlacement ? [currentPlacement.family] : [],
    };

    // Thumbnail lane. There is no palette or composition assignment to re-roll here (the
    // reference and the message decide the look), so a redo is a fresh selection + render at
    // a new seed — which is exactly what the officer wants from it: a different template's
    // arrangement of the same information, or a clean retry after garbled Devanagari.
    // `recolour` is accepted and ignored rather than refused: the web offers one redo button
    // on this lane, and failing a request that means "give me another one" would be perverse.
    if (isYoutubeCategory(row.category)) {
      await renderAndStoreYoutubeThumbnail(
        client,
        id,
        row,
        version,
        `${id}:v${version}`,
      );
      await insertRevision(client, {
        generationId: id,
        target: 'poster_image',
        feedback: 'पुन्हा तयार केले (नवीन रचना)',
        posterPath: posterPath(id, version),
      });
      return;
    }

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
      { families: avoidFamilies, ...avoidPlacement },
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
      await runInCostScope(cost, () =>
        runInCostTask('social_caption_creation', async () => {
          const row = await getGeneration(client, id);
          if (!row) throw new Error(`Generation ${id} not found.`);

          const caption = await generateSocialCaption({
            note: row.note,
            platform: socialPlatformOf(row.category),
          });
          await updateGeneration(client, id, { article: caption });
        }),
      );
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
      recordTasksFromCost(client, 'social', cost);
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
  // The article being revised is still on the row, so a failed revision is recovered with
  // the same feedback re-armed.
  armEditRetry(id, () => startArticleFeedbackJob(client, id, feedback));
  runJob(client, id, 'article_revision', async () => {
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
      row.instructions ?? undefined,
    );
    designationWarnings.set(id, [...revised.designationIssues]);
    lengthWarnings.set(id, revised.lengthWarning);
    const revisedArticle = ensureArticleDateline(
      revised.article,
      articleCategoryOf(row.category),
    );

    await updateGeneration(client, id, {
      article: revisedArticle,
      factCheck: revised.factCheck,
    });
    await insertRevision(client, {
      generationId: id,
      target: 'article',
      feedback,
      article: revisedArticle,
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
      await runInCostScope(cost, () =>
        runInCostTask('article_revision', async () => {
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
            row.instructions ?? undefined,
          );
          designationWarnings.set(id, [...revised.designationIssues]);
          lengthWarnings.set(id, revised.lengthWarning);
          const revisedArticle = ensureArticleDateline(
            revised.article,
            articleCategoryOf(row.category),
          );

          await updateGeneration(client, id, {
            article: revisedArticle,
            factCheck: revised.factCheck,
          });
          await insertRevision(client, {
            generationId: id,
            target: 'article',
            feedback,
            article: revisedArticle,
            factCheck: revised.factCheck,
          });
        }),
      );
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
      const usageRow = await getGeneration(client, id).catch(() => null);
      if (usageRow) {
        recordTasksFromCost(
          client,
          usageRow.dloIntakeId ? 'article' : 'social',
          cost,
        );
      }
      revisingArticle.delete(id);
    }
  })();
}

// Feedback loop for a social post's caption (twitter/facebook — the caption is stored in
// the row's `article` column). The article feedback jobs above cannot serve it: they run
// reviseArticle, whose category argument goes through articleCategoryOf and hard-fails on
// a social category. This one calls the deliberately simple caption editor instead; the
// poster, copy and published state are untouched.
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
      await runInCostScope(cost, () =>
        runInCostTask('social_caption_revision', async () => {
          const row = await getGeneration(client, id);
          if (!row) throw new Error(`Generation ${id} not found.`);
          if (!row.article)
            throw new Error(`Generation ${id} has no caption yet.`);

          const revised = await reviseCaption({
            caption: row.article,
            feedback,
          });

          await updateGeneration(client, id, { article: revised });
          await insertRevision(client, {
            generationId: id,
            target: 'caption',
            feedback,
            article: revised,
          });
        }),
      );
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
      recordTasksFromCost(client, 'social', cost);
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
      await runInCostScope(cost, () =>
        runInCostTask(
          language === 'hi' ? 'hindi_translation' : 'english_translation',
          async () => {
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

            const { text: translated, unpreservedNames } =
              await translateArticle(row.article, glossary, language);
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
                console.error(
                  `[translate ${id}] candidate mining failed:`,
                  error,
                );
              }
            }
          },
        ),
      );
    } catch (error) {
      console.error(`[translate ${id}] failed:`, error);
      translateErrors.set(id, errorMessage(error));
    } finally {
      try {
        await persistCost(client, id, cost);
      } catch (costError) {
        console.error(`[translate ${id}] could not persist cost:`, costError);
      }
      // Sarvam's translation spend is the one thing persistCost cannot carry:
      // GenerationCostBreakdown holds chat+image only, and Sarvam is neither. Attributed
      // to भाषांतर rather than to the run's own lane, because that is the feature the
      // officer used — the same reason ad-hoc /translate work is counted there.
      // Best-effort and outside the try above: the translation is already saved.
      recordTasksFromCost(client, 'translate', cost);
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
  armEditRetry(id, () => startPosterFeedbackJob(client, id, target, feedback));
  runJob(client, id, 'poster_content_revision', async () => {
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
//
// `clearRegions` are the second gesture: BLUE lettered rectangles saying "free
// this space", so the officer can place their own logo or photograph there
// afterwards. Each carries an `action`, and the two are genuinely different edits:
// 'remove' DELETES what is inside and moves nothing else, 'displace' keeps that
// content on the poster and licenses a re-layout to fit it elsewhere. They ride the
// SAME round as the red markers (one paid render carries both) and take the same
// route: drawn on the poster, named by the vision pass, and governed by a fixed rule
// appended in the prompt builders, where a model cannot paraphrase it away.
//
// A displace additionally asks the vision pass for the poster's content inventory —
// the checklist a re-layout must not lose. Without it a model told to rearrange a
// dense poster silently drops rows.
// What a clear-space gesture reads as in the revision history. The note beside a
// blue box is optional, so without this such a round would be logged blank — and
// the history is the officer's record of what they asked for, including WHICH of
// the two gestures they used.
const STR_CLEAR_SPACE_HISTORY: Record<PosterClearAction, string> = {
  displace: 'ही जागा मोकळी करा — आतील मजकूर दुसरीकडे हलवा',
  remove: 'ही जागा मोकळी करा — आतील मजकूर काढून टाका',
};

export function startPosterImageFeedbackJob(
  client: SupabaseClient,
  id: string,
  input: PosterImageFeedbackRequest,
): void {
  // The round the officer drew is re-armed exactly as sent — markers, clear-space boxes and
  // notes alike — so a failed edit costs a click, not the whole marking pass.
  armEditRetry(id, () => startPosterImageFeedbackJob(client, id, input));
  runJob(client, id, 'poster_image_revision', async () => {
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
    const clearRegions = input.clearRegions ?? [];
    // Draw order, which is the order annotateFeedbackRegions paints the A/B badges,
    // so the letters in the prompt and the letters in the image always agree.
    const clearActions: readonly PosterClearAction[] = clearRegions.map(
      (c) => c.action,
    );
    const version = await nextVersion(client, id);
    let inputUrl = publicUrl(client, row.posterPath);
    let feedbackText = input.feedback ?? '';
    // Revision history keeps the user's own words, never the machine text.
    let historyFeedback = feedbackText;
    // Only a displace produces one (see interpretImageFeedback); best-effort either way.
    let contentInventory: readonly string[] = [];

    if (annotations.length > 0 || clearRegions.length > 0) {
      const cleanPoster = await downloadPng(client, row.posterPath);
      const marked = await annotateFeedbackRegions(
        cleanPoster,
        annotations.map((a) => a.region),
        clearRegions.map((c) => c.region),
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
        clearRegions: clearRegions.map((c, i) => ({
          letter: CLEAR_REGION_LETTERS[i] ?? String(i + 1),
          note: c.note,
          action: c.action,
          region: c.region,
        })),
        overallNote: input.feedback,
        // The interpreter only needs to know the canvas it is looking at. A thumbnail is
        // landscape like the article poster, so it reads that way.
        posterKind: isSocialCategory(row.category) ? 'twitter' : 'article',
      });
      contentInventory = interpreted.contentInventory;
      console.log(
        `[job ${id}] marker feedback (${interpreted.source}; clear=${
          clearActions.join('+') || 'none'
        }; inventory=${contentInventory.length}): ${interpreted.instruction}`,
      );
      feedbackText = interpreted.instruction;
      historyFeedback = [
        ...annotations.map((a, i) => `[${i + 1}] ${a.note}`),
        // A clear box may carry no note at all, so the gesture itself is what is
        // recorded — otherwise the history row for such a round would be empty.
        ...clearRegions.map(
          (c, i) =>
            `[${CLEAR_REGION_LETTERS[i] ?? i + 1}] ${STR_CLEAR_SPACE_HISTORY[c.action]}` +
            (c.note ? ` — ${c.note}` : ''),
        ),
        ...(input.feedback ? [input.feedback] : []),
      ].join('\n');
    }

    let posterPng: Buffer;
    if (isYoutubeCategory(row.category)) {
      // Thumbnail lane: edit the CURRENT thumbnail directly (no n8n). The marker and
      // clear-space semantics are the shared ones — clearSpaceRule is the same block
      // all three lanes get — so a gesture the officer drew means the same thing here.
      const prompt = buildYoutubeFeedbackPrompt({
        imageFeedback: feedbackText,
        markerCount: annotations.length,
        clearActions,
        contentInventory,
      });
      // The input is the poster ALREADY carrying the chrome (or the marked-up copy of it),
      // and the chrome is re-stamped after the edit — which is what keeps it crisp through
      // repeated rounds, exactly as the two poster lanes do. So this asks for the FINISHED
      // 1280x720 frame, not the artwork canvas an initial render is asked for:
      // overlayYoutubeChrome recognises it by aspect and re-stamps the band in place rather
      // than joining a second strip on.
      const current = await fetchReferencePng(inputUrl);
      const edited = await editImage(current, prompt, { size: '1280x720' });
      recordImageCost('youtube', imageQuality());
      posterPng = await overlayYoutubeChrome(
        await fitToYoutubeThumbnail(edited),
      );
    } else if (isSocialCategory(row.category)) {
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
        { actions: clearActions, inventory: contentInventory },
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
        clearActions,
        contentInventory,
      });
      posterPng = await renderArticlePosterEditViaN8n(id, inputUrl, prompt, {
        imageFeedback: feedbackText,
        markerCount: annotations.length,
      });
      recordImageCost('article', imageQuality());
    }

    // Did the edit actually free the space? READ-ONLY and log-only: it measures the
    // returned poster and prints, and never alters it. A code-composited fill was
    // rejected — the background behind a freed area is often photographic, so a
    // sampled patch shows a seam on exactly the posters that need it most. Wrapped
    // because a diagnostic must never be able to fail an already-paid render; the
    // numbers here are what a future officer-facing warning would be calibrated on.
    if (clearRegions.length > 0) {
      try {
        const measured = await measureClearedRegions(
          posterPng,
          clearRegions.map((c) => c.region),
        );
        console.log(
          `[job ${id}] clear-space check: ${formatClearRegionReport(measured)}`,
        );
      } catch (error) {
        console.warn(
          `[job ${id}] clear-space check failed: ${(error as Error).message}`,
        );
      }
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
