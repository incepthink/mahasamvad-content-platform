// The carousel lane (कॅरोसेल, migration 0059): one note → a cover slide plus two or three
// detail slides, all 4:5, all in one look.
//
// THE SEQUENCE, and why it is this order:
//   1. PLAN once (planCarousel — one text call): which facts go on which slide, the series title
//      every header band repeats. The image model never sees the note, only the plan.
//   2. ONE colour plan is assigned for the whole post (pickSocialPalette, stored as
//      `carousel.paletteId`) — for HISTORY only since 2026-09-25: like the fresh social poster,
//      the prompts carry no palette and the model chooses the colours.
//   3. The COVER renders first — generated from scratch, or edited from a pinned master.
//   4. Every DETAIL slide is a NEW poster with its own planned picture (`slide.visual`), its own
//      assigned body layout (carousel-layouts.ts) and the same series frame the cover was given.
//      Since 2026-09-25 the raw cover is attached as a CONTEXT image (editImage) with
//      SERIES_REFERENCE_RULE — keep its frame, never its photograph or body — because a slide
//      that cannot see slide 1 can only stay consistent by following the frame text literally,
//      which is what made every slide the same shape. This is NOT the old edit-from-cover path:
//      that one told the model to keep the cover's background, and the cover's photograph and
//      layout survived onto every slide (generation 4b18548a). CAROUSEL_SERIES_REFERENCE=off
//      restores blind generation (generateImage) with the same prompt minus the reference.
//   5. Every slide is finished by overlayTwitterChrome (badge + appended footer → 1280x1600), the
//      same chrome a social poster gets.
//   6. Optionally, the caption — AFTER the slides, so a caption failure never costs a paid render.
//
// EACH SLIDE IS PERSISTED THE MOMENT IT LANDS (the /video resume doctrine), so a retry after a
// mid-render failure renders ONLY the missing slides. The whole lane's state is one jsonb column,
// `generations.carousel`; `poster_path` carries the current cover, which is what keeps history
// cards, the tasks panel and the gallery working with no change.
//
// It lives in its own module and goes through runner.ts's `runJob`, the dynamic-poster.ts shape:
// status/step, the cost scope, the usage meter and the edit-failure recovery are inherited.

import {
  buildCarouselCoverPrompt,
  buildCarouselDetailPrompt,
  generateSocialCaption,
  interpretImageFeedback,
  paletteById,
  pickSocialPalette,
  planCarousel,
  recordImageCost,
  resolvePinnedImage,
  resolvePinnedType,
  runInCostTask,
  type PosterPalette,
} from '@dgipr/content-engine';
import {
  downloadPng,
  findGlossaryTermsInText,
  getGeneration,
  publicUrl,
  updateGeneration,
  uploadPng,
  type GenerationPatch,
  type GenerationRow,
  type SupabaseClient,
} from '@dgipr/database';
import {
  CLEAR_REGION_LETTERS,
  SOCIAL_ARTWORK_SIZE,
  annotateFeedbackRegions,
  editImage,
  generateImage,
  overlayTwitterChrome,
} from '@dgipr/poster-renderer';
import {
  CarouselStateSchema,
  isCarouselCategory,
  type CarouselSlideDetail,
  type CarouselState,
  type PosterClearAction,
  type PosterImageFeedbackRequest,
} from '@dgipr/schemas';
import {
  STR_CLEAR_SPACE_HISTORY,
  armEditRetry,
  fetchReferencePng,
  imageQuality,
  recentStyleHistory,
  renderSocialPosterFeedbackEdit,
  runJob,
} from './runner.js';

// Detail slides render concurrently, but only a couple at a time: every one is a paid image
// call and the provider rate-limits image edits far below text.
const DETAIL_CONCURRENCY = 2;

// Whether detail slides see slide 1 as a context image. Read in ONE place; default on, and
// `off` is the one-line rollback to blind generation.
export function carouselSeriesReferenceEnabled(): boolean {
  const value = (process.env.CAROUSEL_SERIES_REFERENCE ?? '')
    .trim()
    .toLowerCase();
  return value !== 'off' && value !== 'false' && value !== '0';
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

// The row's carousel state, PARSED rather than cast: it names the objects later edits read, so a
// hand-edited row must not put an arbitrary path into a paid render. A missing or unreadable
// value is a fresh carousel that has not been planned yet.
export function carouselStateOf(row: GenerationRow): CarouselState {
  const parsed = CarouselStateSchema.safeParse(row.carousel ?? {});
  if (parsed.success) return parsed.data;
  console.warn(
    `[job ${row.id}] ignoring an unreadable carousel state:`,
    parsed.error.issues,
  );
  return CarouselStateSchema.parse({});
}

// The initial state written at insert: only the officer's slide count.
export function initialCarouselState(
  requestedSlides: CarouselState['requestedSlides'] | undefined,
): CarouselState {
  return CarouselStateSchema.parse({
    requestedSlides: requestedSlides ?? 'auto',
  });
}

// Detail slides land concurrently and each one rewrites the WHOLE jsonb value, so two writes in
// flight would race and the slower would erase the faster one's slide. The job holds the one
// authoritative copy in memory (only one job runs per row — runJob's `running` set) and writes go
// out one at a time per generation, each carrying everything that has landed so far.
const writeChains = new Map<string, Promise<void>>();

async function saveState(
  client: SupabaseClient,
  id: string,
  state: CarouselState,
  extra: GenerationPatch = {},
): Promise<void> {
  const previous = writeChains.get(id) ?? Promise.resolve();
  // Snapshot NOW, so a write queued behind a slower one still records this moment's slides.
  const snapshot = JSON.parse(JSON.stringify(state)) as CarouselState;
  const write = previous
    .catch(() => undefined)
    .then(() => updateGeneration(client, id, { ...extra, carousel: snapshot }));
  const guarded = write.catch(() => undefined);
  writeChains.set(id, guarded);
  try {
    await write;
  } finally {
    if (writeChains.get(id) === guarded) writeChains.delete(id);
  }
}

// Which slides (1-based) are rendering RIGHT NOW, for the detail payload — a one-slide redo shows
// its spinner on that slide rather than over the strip. In-process, like every other transient
// registry in runner.ts.
const busySlides = new Map<string, Set<number>>();

export function getCarouselBusySlides(id: string): number[] {
  return [...(busySlides.get(id) ?? [])].sort((a, b) => a - b);
}

function markBusy(id: string, slide: number): void {
  const set = busySlides.get(id) ?? new Set<number>();
  set.add(slide);
  busySlides.set(id, set);
}

function clearBusy(id: string, slide?: number): void {
  const set = busySlides.get(id);
  if (!set) return;
  if (slide === undefined) set.clear();
  else set.delete(slide);
  if (set.size === 0) busySlides.delete(id);
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

// Versioned per render, because the public bucket is CDN-cached and a path must never be reused.
// `k` is 1-based — the number the officer sees.
function slidePath(id: string, k: number, version: number): string {
  return `generations/${id}/slide-${k}-v${version}.png`;
}
function slidePlainPath(id: string, k: number, version: number): string {
  return `generations/${id}/slide-${k}-v${version}-plain.png`;
}

// Write one finished slide as its next version and persist it.
//
// UPSERT is safe here, and needed: a version is only recorded AFTER its upload, so an object at
// the next version's path can only be an orphan from an attempt whose row write never landed —
// which means its URL was never served and no CDN entry can hold a stale copy. Without it that
// orphan would make the slide permanently unrenderable ("object already exists" on every retry).
async function storeSlide(
  client: SupabaseClient,
  id: string,
  state: CarouselState,
  index: number,
  raw: Buffer,
  finished: Buffer | null,
  feedback: string | null,
): Promise<void> {
  const slide = state.slides[index];
  if (!slide) throw new Error(`Carousel slide ${index + 1} does not exist.`);
  const version = slide.version + 1;
  const path = slidePath(id, index + 1, version);
  await uploadPng(
    client,
    path,
    finished ?? (await overlayTwitterChrome(raw)),
    true,
  );

  // The un-chromed copy is the plain-download convenience, so it is best-effort. (It used to be
  // REQUIRED for the cover, when every detail slide was edited from it; slides are now each
  // generated fresh.)
  let plainPath: string | null = slidePlainPath(id, index + 1, version);
  try {
    await uploadPng(client, plainPath, raw, true);
  } catch (error) {
    console.warn(
      `[job ${id}] could not store slide ${index + 1}'s plain copy:`,
      error,
    );
    plainPath = null;
  }

  state.slides[index] = {
    ...slide,
    path,
    plainPath,
    version,
    versions: [
      ...slide.versions,
      { path, plainPath, createdAt: new Date().toISOString(), feedback },
    ],
  };
  // The cover IS the run's poster everywhere a single image is shown.
  await saveState(client, id, state, index === 0 ? { posterPath: path } : {});
}

// ---------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------

// The post's ONE colour plan, kept for HISTORY only: since 2026-09-25 no palette reaches the
// prompts (the model chooses colours, as on the fresh social poster), but the id is still stored
// so the social lane's recency spread and "सर्व स्लाइड पुन्हा" have something to move away from.
function carouselPalette(state: CarouselState): PosterPalette | null {
  return paletteById(state.paletteId);
}

// Assign a new colour plan: spread against the social lane's recent posters (the fresh social
// poster's own picker and history), and — on a whole-post redo — away from the post's current
// family, so "सर्व स्लाइड पुन्हा" is a different look rather than the same hexes re-sent.
async function assignPalette(
  client: SupabaseClient,
  state: CarouselState,
  seed: string,
): Promise<PosterPalette> {
  const history = await recentStyleHistory(client, ['twitter', 'facebook']);
  const current = carouselPalette(state);
  const palette = pickSocialPalette(seed, {
    ids: [...history.paletteIds, ...(current ? [current.id] : [])],
    families: [...history.families, ...(current ? [current.family] : [])],
    recentDominantHexes: history.measuredDominantHexes,
    recentGroundHexes: history.measuredGroundHexes,
  });
  state.paletteId = palette.id;
  return palette;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

// The cover, raw (no chrome). A pinned master is the edit canvas, exactly as on the social
// fixed-template lanes; otherwise the cover is generated from scratch. Either way it is given the
// post's series frame. `seed` diversifies a redo's template roll.
async function renderCoverRaw(
  client: SupabaseClient,
  row: GenerationRow,
  state: CarouselState,
  seed: string,
): Promise<Buffer> {
  const plan = state.plan;
  if (!plan) throw new Error(`Carousel ${row.id} has no plan.`);

  const pinned = row.referenceImageId
    ? await resolvePinnedImage(client, row.referenceImageId, seed)
    : row.referenceTypeId
      ? await resolvePinnedType(client, row.referenceTypeId, seed, row.note)
      : null;

  // The pinned master is a LAYOUT reference only. No palette reaches the prompt (the model
  // chooses colours, as on the fresh social poster); `paletteId` is logged for history.
  let raw: Buffer;
  if (pinned) {
    const prompt = buildCarouselCoverPrompt({ plan, editsReference: true });
    raw = await editImage(await fetchReferencePng(pinned.master.url), prompt, {
      size: SOCIAL_ARTWORK_SIZE,
    });
    console.log(
      `[job ${row.id}] carousel cover edited from pinned master ${pinned.master.id} (palette ${state.paletteId ?? 'none'})`,
    );
  } else {
    raw = await generateImage(buildCarouselCoverPrompt({ plan }), {
      size: SOCIAL_ARTWORK_SIZE,
    });
    console.log(
      `[job ${row.id}] carousel cover generated (palette ${state.paletteId ?? 'none'})`,
    );
  }
  recordImageCost('twitter', imageQuality());
  return raw;
}

// Slide 1's raw render, for the detail slides' series reference, from its stored plain copy.
// Best-effort: without it a detail slide is generated blind, which is the pre-reference
// behaviour rather than a failure.
async function loadCoverRaw(
  client: SupabaseClient,
  id: string,
  state: CarouselState,
): Promise<Buffer | null> {
  if (!carouselSeriesReferenceEnabled()) return null;
  const plainPath = state.slides[0]?.plainPath;
  if (!plainPath) return null;
  try {
    return await downloadPng(client, plainPath);
  } catch (error) {
    console.warn(
      `[job ${id}] could not load slide 1 as the series reference; detail slides render without it:`,
      error,
    );
    return null;
  }
}

// A detail slide, raw: its own planned picture and assigned layout inside the post's shared
// series frame, with slide 1 attached as context when there is one (see the header).
async function renderDetailRaw(
  state: CarouselState,
  index: number,
  coverRaw: Buffer | null,
): Promise<Buffer> {
  const plan = state.plan;
  if (!plan) throw new Error('Carousel has no plan.');
  const prompt = buildCarouselDetailPrompt({
    plan,
    index,
    seriesReference: coverRaw !== null,
  });
  const raw = coverRaw
    ? await editImage(coverRaw, prompt, { size: SOCIAL_ARTWORK_SIZE })
    : await generateImage(prompt, { size: SOCIAL_ARTWORK_SIZE });
  recordImageCost('twitter', imageQuality());
  return raw;
}

// Run `work` over `items` a few at a time and let every one FINISH before reporting a failure:
// a slide that rendered is paid for and persisted, so one failing slide must not abandon the
// others mid-flight. The first error is rethrown once all have settled.
async function inPool<T>(
  items: readonly T[],
  size: number,
  work: (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items];
  const errors: unknown[] = [];
  const workers = Array.from(
    { length: Math.min(size, queue.length) },
    async () => {
      for (let item = queue.shift(); item !== undefined; item = queue.shift()) {
        try {
          await work(item);
        } catch (error) {
          errors.push(error);
        }
      }
    },
  );
  await Promise.all(workers);
  if (errors.length > 0) throw errors[0];
}

async function renderDetails(
  client: SupabaseClient,
  id: string,
  state: CarouselState,
  indexes: readonly number[],
  feedback: string | null,
  coverRaw: Buffer | null,
): Promise<void> {
  await inPool(indexes, DETAIL_CONCURRENCY, async (index) => {
    markBusy(id, index + 1);
    try {
      const raw = await renderDetailRaw(state, index, coverRaw);
      await storeSlide(client, id, state, index, raw, null, feedback);
    } finally {
      clearBusy(id, index + 1);
    }
  });
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

// The initial run — and the retry of a failed one, which lands here too and picks up exactly
// where the failure left off: the plan is not re-bought if it exists, and only slides with no
// render are drawn.
export function startCarouselJob(
  client: SupabaseClient,
  id: string,
  options: Readonly<{ generateCaption?: boolean }> = {},
): void {
  runJob(client, id, 'carousel_creation', async () => {
    const row = await getGeneration(client, id);
    if (!row) throw new Error(`Generation ${id} not found.`);
    await updateGeneration(client, id, {
      status: 'running',
      step: null,
      error: null,
    });

    const state = carouselStateOf(row);
    try {
      if (!state.plan) {
        await updateGeneration(client, id, { step: 'carousel_plan' });
        // Verified scheme/org names in the note — free, and what lets the planner's output be
        // repaired to the full name deterministically (lock-scheme-names).
        const glossary = await findGlossaryTermsInText(client, row.note);
        const lockedSchemeNames = glossary
          .filter((t) => t.termType === 'scheme' || t.termType === 'org')
          .map((t) => t.marathi);
        const result = await runInCostTask('carousel_plan', () =>
          planCarousel({
            note: row.note,
            requestedSlides: state.requestedSlides,
            lockedSchemeNames,
          }),
        );
        state.plan = result.plan;
        state.slides = result.plan.slides.map((slide, index) => ({
          index,
          role: slide.role,
          title: slide.title,
          path: null,
          plainPath: null,
          version: 0,
          versions: [],
        }));
        console.log(
          `[job ${id}] carousel plan: ${state.slides.length} slides (asked ${state.requestedSlides}) — "${result.plan.seriesTitle}"`,
        );
        await saveState(client, id, state, {
          referenceTitle: result.plan.seriesTitle || null,
        });
      }

      await updateGeneration(client, id, { step: 'carousel_render' });
      // Mark every slide still to draw as busy up front, so the strip shows its placeholders as
      // "being made" from the first poll rather than one at a time.
      state.slides.forEach((slide, index) => {
        if (!slide.path) markBusy(id, index + 1);
      });
      await runInCostTask('carousel_slide', async () => {
        let coverRaw: Buffer | null = null;
        if (!state.slides[0]?.path) {
          // Assigned before the cover and never again on a retry (history only — the prompts
          // carry no palette; see the header).
          if (!state.paletteId) await assignPalette(client, state, id);
          const rendered = await renderCoverRaw(client, row, state, id);
          await storeSlide(client, id, state, 0, rendered, null, null);
          clearBusy(id, 1);
          if (carouselSeriesReferenceEnabled()) coverRaw = rendered;
        }
        const missing = state.slides
          .map((slide, index) => (slide.path ? -1 : index))
          .filter((index) => index > 0);
        if (missing.length === 0) return;
        coverRaw ??= await loadCoverRaw(client, id, state);
        await renderDetails(client, id, state, missing, null, coverRaw);
      });
    } finally {
      clearBusy(id);
    }

    // The caption goes last, for the social lane's reason: the slides are already paid for and on
    // the row, so a caption failure costs a caption. A retry does not re-write one that exists.
    if (options.generateCaption && !row.article) {
      await updateGeneration(client, id, { step: 'caption' });
      const caption = await runInCostTask('social_caption_creation', () =>
        generateSocialCaption({ note: row.note, platform: 'facebook' }),
      );
      await updateGeneration(client, id, { article: caption });
    }
  });
}

// "हा स्लाइड पुन्हा तयार करा" (one slide, 1-based) or "सर्व स्लाइड पुन्हा" ('all').
//
// A DETAIL slide is re-generated with the post's series frame (and slide 1 as context), so it
// stays in the post's look. The
// COVER on its own re-renders the cover only. 'all' assigns a new (history-only) palette id and
// redraws every slide — a new look.
export function startCarouselSlideRegenerateJob(
  client: SupabaseClient,
  id: string,
  target: number | 'all',
): void {
  armEditRetry(id, () => startCarouselSlideRegenerateJob(client, id, target));
  runJob(client, id, 'carousel_slide_regeneration', async () => {
    const row = await getGeneration(client, id);
    if (!row) throw new Error(`Generation ${id} not found.`);
    const state = carouselStateOf(row);
    if (!state.plan || state.slides.length === 0) {
      throw new Error(`Carousel ${id} has no slides to re-render.`);
    }
    if (target !== 'all' && !state.slides[target - 1]) {
      throw new Error(`Carousel ${id} has no slide ${target}.`);
    }
    await updateGeneration(client, id, {
      status: 'running',
      step: 'carousel_render',
      error: null,
    });

    const feedback =
      target === 'all'
        ? 'सर्व स्लाइड पुन्हा तयार केल्या'
        : 'स्लाइड पुन्हा तयार केली';
    if (target === 'all') state.slides.forEach((_, i) => markBusy(id, i + 1));
    else markBusy(id, target);
    try {
      await runInCostTask('carousel_slide', async () => {
        if (target === 'all' || target === 1) {
          // A new seed per cover version, so the redo is a different design rather than the same
          // prompt re-sent.
          const seed = `${id}:v${(state.slides[0]?.version ?? 0) + 1}`;
          if (target === 'all') await assignPalette(client, state, seed);
          const coverRaw = await renderCoverRaw(client, row, state, seed);
          await storeSlide(client, id, state, 0, coverRaw, null, feedback);
          clearBusy(id, 1);
          if (target === 'all') {
            await renderDetails(
              client,
              id,
              state,
              state.slides.map((_, i) => i).filter((i) => i > 0),
              feedback,
              carouselSeriesReferenceEnabled() ? coverRaw : null,
            );
          }
          return;
        }
        // One detail slide re-drawn against the CURRENT cover, so it rejoins the post's frame.
        await renderDetails(
          client,
          id,
          state,
          [target - 1],
          feedback,
          await loadCoverRaw(client, id, state),
        );
      });
    } finally {
      clearBusy(id);
    }
  });
}

// A marker round on ONE slide — the social poster's pixel feedback, unchanged: draw the numbered
// boxes on this slide, let the vision pass turn marks + notes into one instruction, edit the
// slide with the social feedback prompt, re-stamp the chrome. Only that slide changes.
export function startCarouselSlideFeedbackJob(
  client: SupabaseClient,
  id: string,
  slideNumber: number,
  input: PosterImageFeedbackRequest,
): void {
  armEditRetry(id, () =>
    startCarouselSlideFeedbackJob(client, id, slideNumber, input),
  );
  runJob(client, id, 'carousel_slide_revision', async () => {
    const row = await getGeneration(client, id);
    if (!row) throw new Error(`Generation ${id} not found.`);
    const state = carouselStateOf(row);
    const index = slideNumber - 1;
    const slide = state.slides[index];
    if (!slide?.path) {
      throw new Error(`Carousel ${id} has no rendered slide ${slideNumber}.`);
    }
    await updateGeneration(client, id, {
      status: 'running',
      step: 'revise_image',
      error: null,
    });
    markBusy(id, slideNumber);
    try {
      const annotations = input.annotations ?? [];
      const clearRegions = input.clearRegions ?? [];
      const clearActions: readonly PosterClearAction[] = clearRegions.map(
        (c) => c.action,
      );
      let inputUrl = publicUrl(client, slide.path);
      let feedbackText = input.feedback ?? '';
      let historyFeedback = feedbackText;
      let contentInventory: readonly string[] = [];

      if (annotations.length > 0 || clearRegions.length > 0) {
        const clean = await downloadPng(client, slide.path);
        const marked = await annotateFeedbackRegions(
          clean,
          annotations.map((a) => a.region),
          clearRegions.map((c) => c.region),
        );
        // A throwaway input for the edit, never a slide version; timestamped per attempt so a
        // failed round's resubmit never collides on the same path (the poster lane's rule).
        const markedPath = `generations/${id}/slide-${slideNumber}-feedback-marked-${Date.now()}.png`;
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
          posterKind: 'twitter',
        });
        contentInventory = interpreted.contentInventory;
        feedbackText = interpreted.instruction;
        historyFeedback = [
          ...annotations.map((a, i) => `[${i + 1}] ${a.note}`),
          ...clearRegions.map(
            (c, i) =>
              `[${CLEAR_REGION_LETTERS[i] ?? i + 1}] ${STR_CLEAR_SPACE_HISTORY[c.action]}` +
              (c.note ? ` — ${c.note}` : ''),
          ),
          ...(input.feedback ? [input.feedback] : []),
        ].join('\n');
        console.log(
          `[job ${id}] carousel slide ${slideNumber} marker feedback (${interpreted.source}): ${feedbackText}`,
        );
      }

      const rendered = await runInCostTask('carousel_slide', async () => {
        const result = await renderSocialPosterFeedbackEdit(
          inputUrl,
          feedbackText,
          annotations.length,
          'dgipr',
          undefined,
          { actions: clearActions, inventory: contentInventory },
        );
        recordImageCost('twitter', imageQuality());
        return result;
      });
      await storeSlide(
        client,
        id,
        state,
        index,
        rendered.raw,
        rendered.png,
        historyFeedback || null,
      );
    } finally {
      clearBusy(id);
    }
  });
}

// ---------------------------------------------------------------------------
// The detail payload
// ---------------------------------------------------------------------------

export function carouselSlidesOf(
  client: SupabaseClient,
  row: GenerationRow,
): CarouselSlideDetail[] {
  if (!isCarouselCategory(row.category)) return [];
  return carouselStateOf(row).slides.map((slide) => ({
    index: slide.index + 1,
    role: slide.role,
    title: slide.title,
    posterUrl: slide.path ? publicUrl(client, slide.path) : null,
    plainUrl: slide.plainPath ? publicUrl(client, slide.plainPath) : null,
    versions: slide.versions.map((version) => ({
      posterUrl: publicUrl(client, version.path),
      createdAt: version.createdAt,
      feedback: version.feedback,
    })),
  }));
}

// The storage paths behind slide `n` (1-based), for the download proxy.
export function carouselSlidePaths(
  row: GenerationRow,
  slideNumber: number,
): { path: string | null; plainPath: string | null } | null {
  const slide = carouselStateOf(row).slides[slideNumber - 1];
  return slide ? { path: slide.path, plainPath: slide.plainPath } : null;
}
