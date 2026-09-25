// Persistence for generation runs + their revision log (see
// supabase/migrations/0002_generations.sql).

import type { SupabaseClient } from '@supabase/supabase-js';

export const GENERATIONS_TABLE = 'generations';
export const GENERATION_REVISIONS_TABLE = 'generation_revisions';

export type OutputType = 'article' | 'poster' | 'both';
// 'youtube' is the 1280x720 thumbnail lane (migration 0042). Mirrors CategorySchema in
// @dgipr/schemas; kept structural here so this package stays dependency-free.
// 'dynamic_poster' is the motionised-poster lane (migration 0052); 'carousel' is the
// multi-slide social post (migration 0059).
export type Category =
  | 'news'
  | 'scheme'
  | 'twitter'
  | 'facebook'
  | 'youtube'
  | 'dynamic_poster'
  | 'carousel';
// Mirrors DesignModeSchema in @dgipr/schemas — a 2x2 of who DESIGNS the poster (a template, or
// the image model from scratch) x where its TEXT comes from (generatePosterCopy, or the officer's
// note verbatim). 'fresh_verbatim' is the from-scratch/verbatim cell. generations.design_mode is
// a plain text column with no CHECK constraint (0006_social_post.sql), so it needed no migration.
export type DesignMode = 'onbrand' | 'adaptive' | 'fresh' | 'fresh_verbatim';
// Template brand family (migration 0024); mirrors TemplateBrand in reference-types.ts.
export type TemplateBrand = 'dgipr' | 'cmo';
export type GenerationStatus = 'queued' | 'running' | 'completed' | 'failed';
// Mirrors RevisionTargetSchema in @dgipr/schemas and the generation_revisions CHECK
// constraint (latest: migration 0023). The 'caption'/'manual_caption' pair records
// edits to a social run's caption, which is stored in the `article` column.
export type RevisionTarget =
  | 'article'
  | 'poster_copy'
  | 'poster_scene'
  | 'manual_copy'
  | 'poster_image'
  | 'caption'
  | 'manual_caption'
  // One Dynamic Poster render (migration 0052) — the lane's version history.
  | 'motion';

// One row in generations. `copy` stays `unknown` here — the database package does
// not depend on the Copy schema; callers validate with CopySchema when needed.
export type GenerationRow = Readonly<{
  id: string;
  note: string;
  outputType: OutputType;
  category: Category;
  designMode: DesignMode | null;
  // Template brand the run was created with (migration 0024). 'dgipr' for every
  // non-social row and for social rows created before the CMO feature.
  templateBrand: TemplateBrand;
  heading: string | null;
  // The exact text to print on an ARTICLE poster, typed by the officer (migration 0029).
  // When set it wins outright over both the automatic named-subject resolution and the
  // editorial headline. Null/empty = resolve it automatically. Updatable, so a poster whose
  // heading came out wrong can be corrected and re-rendered.
  posterHeading: string | null;
  // The officer's OWN prompt for the image model on a social poster run (migration 0045).
  // When set, the platform's assembled poster prompt is not used at all — see
  // buildCustomPosterPrompt. Null/empty = build the prompt as usual. Insert-only: both
  // startGenerationJob and startPosterRegenerateJob re-read the row, so a retry or a redo
  // must reproduce the same prompt rather than quietly falling back to the built one.
  imagePrompt: string | null;
  // Optional pin: the exact reference image the run was asked to use (null =
  // automatic rotation; the FK sets null if the image is later deleted).
  referenceImageId: string | null;
  // Optional Twitter section pin: force this reference type while choosing one
  // of its enabled images at job start. The FK sets null if the type is deleted.
  referenceTypeId: string | null;
  // Lineage: the run this one was spawned from (detail-page "next step" actions
  // + failed-run retry) and the thread's first run, denormalized so membership
  // is one query. Both null on thread roots and pre-feature rows.
  sourceGenerationId: string | null;
  threadRootId: string | null;
  // Lineage/audit: the DLO intake this run's note came from (null = home form
  // or detail-page follow-up). Insert-only, like the pins.
  dloIntakeId: string | null;
  // Facts the officer deselected in the /dlo Pointers step (migration 0030). Each is one
  // AI-summarized 5W1H bullet the article must leave out; the runner passes them to
  // generateArticle, which threads them into drafting + the coverage checkers. Insert-only;
  // null on every non-DLO run and on rows created before 0030.
  excludedFacts: string[] | null;
  // Officer-approved pointer inventory + attributed statements (migration 0034). Both stay
  // `unknown` here because their schemas belong to @dgipr/schemas; the API runner validates
  // them before passing them to content-engine.
  selectedFacts: unknown;
  statements: unknown;
  // Person → पदनाम pairs the officer approved before generating (migration 0033), shape
  // [{ name, designation }] with both sides Marathi. The runner passes them to generateArticle
  // AND back into reviseArticle, so a feedback revision cannot drop a designation. `unknown`
  // for the same reason as `copy`/`posterStyle`: the database package does not own the shape.
  // Insert-only; null on rows created before 0033 and on runs where none were approved.
  nameDesignations: unknown;
  // A published article the officer pasted as the STYLE model for this run (migration 0035) —
  // tier 1 of the simplified generator's reference hierarchy, above vector retrieval. Style and
  // structure only; never a factual source. Insert-only, because a retry re-reads the row and
  // must reproduce the same reference. Null when the officer pasted nothing and on pre-0035 rows.
  styleReference: string | null;
  // The officer's trusted request for this article (migration 0041): writing direction plus
  // facts or corrections supplied directly here. Insert-only for the same reason as
  // styleReference: a retry re-reads the row and must write the same article.
  // Null when nothing was typed and on pre-0041 rows.
  instructions: string | null;
  // Which style reference the run ACTUALLY used (migration 0035): the officer's paste, a
  // retrieved Mahasamvad article above the similarity floor, or none — plus the similarity and
  // the prompt version. `unknown` for the same reason as `copy`/`posterStyle`: the database
  // package does not own the shape. Written after generation, so it is patchable.
  styleReferenceMeta: unknown;
  // The media-room flow (migration 0027): the note IS a finished article, so the
  // runner uses it verbatim and skips generateArticle. false for every ordinary
  // run and for rows created before this feature.
  articleProvided: boolean;
  // The visual style this social poster run was assigned, plus what its render actually
  // measured (migration 0028). `unknown` here for the same reason as `copy`: the database
  // package does not depend on the shape, and the runner validates it. null on every
  // non-social run and on rows created before 0028.
  posterStyle: unknown;
  status: GenerationStatus;
  step: string | null;
  error: string | null;
  article: string | null;
  // On-demand translations of `article` (Sarvam + locked glossary); each null until
  // the user requests it. Plain nullable text, like `article`, and independent of
  // each other — translating to one language never touches the other.
  articleEnglish: string | null;
  articleHindi: string | null;
  factCheck: string | null;
  referenceTitle: string | null;
  referenceUrl: string | null;
  copy: unknown;
  // 5W1H fact scaffold extracted from the note; stays `unknown` like `copy` —
  // callers validate with FiveWOneHSchema when needed.
  fiveWOneH: unknown;
  scenePrompt: string | null;
  scenePath: string | null;
  posterPath: string | null;
  // Pictures the officer attached to this run for the IMAGE MODEL to see (migration 0056),
  // as storage paths in the public posters bucket under PROMPT_IMAGE_PREFIX. NOT the
  // reference-template library — `referenceImageId` above pins a MASTER and decides a
  // poster's structure, while these decide no layout and are simply shown to the model.
  //
  // `unknown`, like every other jsonb column here, and PARSED by the reader rather than
  // cast: these paths point a paid render at objects, so a hand-edited row must not be able
  // to put an arbitrary string into one. Null on a run that carried no pictures, which is
  // every run made before the control existed.
  promptImagePaths: unknown;
  // ---------- Dynamic Poster (migration 0052) ----------
  // The still poster the officer uploaded, and the clip made from it. All null on every
  // other lane. `motionInteractionId` is THE CHAIN POINT: the Gemini interaction a follow-up
  // continues from, advanced only by a render that actually produced a clip.
  sourceImagePath: string | null;
  motionPath: string | null;
  motionGifPath: string | null;
  motionPrompt: string | null;
  motionInteractionId: string | null;
  // The clip's aspect ratio, 'source' | '9:16' | '16:9' (migration 0053). Null on every other
  // lane, and on a Dynamic Poster created before the control existed — the job reads it as
  // 'source', the poster's own shape, so null is a value rather than a gap. Plain text with
  // no CHECK, which is why a third value needed no migration; the job PARSES it rather than
  // casting, so a hand-edited row cannot put an arbitrary string into a paid render's prompt.
  motionAspect: string | null;
  // Dynamic Poster only (migration 0055): the part of the poster allowed to MOVE, as
  // {x, y, width, height} fractions of its own size. Everything outside it is composited back
  // from the uploaded poster after the render, so the officer's Devanagari is their own glyphs
  // rather than a video model's redrawing of them.
  //
  // `unknown`, like every other jsonb column here, and PARSED at the job rather than cast: this
  // one field points a paid render's encode at a rectangle, so a hand-edited row must not be
  // able to put an arbitrary object into it. Null on every other lane and on every Dynamic
  // Poster made before the control existed, where it means "no restore" — see the column
  // comment in 0055 for why there is no defensible default.
  motionRegion: unknown;
  // Carousel only (migration 0059): the slide plan, every slide's current render and its
  // version history, plus the slide count the officer asked for. `unknown` like every jsonb
  // column here — the API parses it with CarouselStateSchema. Null on every other lane.
  carousel: unknown;
  // Total USD this generation has cost so far (text measured from OpenAI usage + a fixed
  // per-render image tier price), accumulated across the initial run and any feedback
  // jobs. Null for pre-feature rows. `costBreakdown` holds the token/split audit detail.
  costUsd: number | null;
  costBreakdown: unknown;
  // Latest live social post of this run (twitter/facebook categories only);
  // re-publishing overwrites both. Null = never published. Migration 0021.
  publishedUrl: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}>;

// Structured audit detail stored in cost_breakdown (jsonb). `runs` counts how many jobs
// (initial + feedback) have contributed to the totals.
export type GenerationCostBreakdown = Readonly<{
  chatCalls: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  textCostUsd: number;
  imageCount: number;
  imageCostUsd: number;
  runs: number;
}>;

// One job's contribution to a generation's cost (matches the engine's CostAccumulator).
export type GenerationCostIncrement = Readonly<{
  chatCalls: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  textCostUsd: number;
  imageCount: number;
  imageCostUsd: number;
}>;

// Shape returned by selects (snake_case column names).
type GenerationDbRow = {
  id: string;
  note: string;
  output_type: OutputType;
  category: Category;
  design_mode: string | null;
  template_brand: string | null;
  heading: string | null;
  poster_heading: string | null;
  image_prompt: string | null;
  reference_image_id: string | null;
  reference_type_id: string | null;
  source_generation_id: string | null;
  thread_root_id: string | null;
  dlo_intake_id: string | null;
  excluded_facts: unknown;
  selected_facts: unknown;
  statements: unknown;
  name_designations: unknown;
  style_reference: string | null;
  style_reference_meta: unknown;
  instructions: string | null;
  article_provided: boolean | null;
  poster_style: unknown;
  status: GenerationStatus;
  step: string | null;
  error: string | null;
  article: string | null;
  article_english: string | null;
  article_hindi: string | null;
  fact_check: string | null;
  reference_title: string | null;
  reference_url: string | null;
  copy: unknown;
  five_w_one_h: unknown;
  scene_prompt: string | null;
  scene_path: string | null;
  poster_path: string | null;
  prompt_image_paths: unknown;
  source_image_path: string | null;
  motion_path: string | null;
  motion_gif_path: string | null;
  motion_prompt: string | null;
  motion_interaction_id: string | null;
  motion_aspect: string | null;
  motion_region: unknown;
  carousel: unknown;
  // PostgREST may serialise numeric as a string; fromDbRow coerces to number.
  cost_usd: number | string | null;
  cost_breakdown: unknown;
  published_url: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

function fromDbRow(row: GenerationDbRow): GenerationRow {
  return {
    id: row.id,
    note: row.note,
    outputType: row.output_type,
    category: row.category,
    designMode: row.design_mode as DesignMode | null,
    // ?? 'dgipr': pre-0024 databases have no such column (undefined).
    templateBrand: (row.template_brand as TemplateBrand | null) ?? 'dgipr',
    heading: row.heading,
    // ?? null: a pre-0029 database has no such column (undefined), which every reader
    // already treats as "resolve the heading automatically".
    posterHeading: row.poster_heading ?? null,
    // ?? null: a pre-0045 database has no such column (undefined), which every reader already
    // treats as "no officer prompt — build the poster prompt as usual".
    imagePrompt: row.image_prompt ?? null,
    referenceImageId: row.reference_image_id,
    referenceTypeId: row.reference_type_id,
    sourceGenerationId: row.source_generation_id,
    threadRootId: row.thread_root_id,
    dloIntakeId: row.dlo_intake_id,
    // ?? null: a pre-0030 database returns no such column (undefined), and jsonb round-trips
    // as an array; anything else (a legacy null, a stray shape) collapses to null so readers
    // always see "no exclusions" rather than a malformed value.
    excludedFacts: Array.isArray(row.excluded_facts)
      ? (row.excluded_facts as string[])
      : null,
    selectedFacts: Array.isArray(row.selected_facts)
      ? row.selected_facts
      : null,
    statements: Array.isArray(row.statements) ? row.statements : null,
    // ?? null for the same reason as excluded_facts above: a pre-0033 database returns no
    // such column. The runner validates the shape before using it.
    nameDesignations: Array.isArray(row.name_designations)
      ? row.name_designations
      : null,
    // ?? null: a pre-0035 database returns no such columns (undefined), which every reader
    // already treats as "no officer reference / nothing recorded".
    styleReference: row.style_reference ?? null,
    styleReferenceMeta: row.style_reference_meta ?? null,
    // ?? null on a pre-0041 database for the same reason: "the officer typed no direction".
    instructions: row.instructions ?? null,
    // ?? false: a pre-0027 database returns no such column (undefined), and an
    // ordinary run is not article-provided anyway.
    articleProvided: row.article_provided ?? false,
    // ?? null: a pre-0028 database returns no such column (undefined), which callers
    // must see as "no assigned style" rather than as undefined.
    posterStyle: row.poster_style ?? null,
    status: row.status,
    step: row.step,
    error: row.error,
    article: row.article,
    articleEnglish: row.article_english,
    // ?? null for the same reason as the 0021 columns below: a pre-0022 database
    // returns no such column (undefined), which JSON.stringify would drop from the
    // detail payload and fail the web's Zod parse.
    articleHindi: row.article_hindi ?? null,
    factCheck: row.fact_check,
    referenceTitle: row.reference_title,
    referenceUrl: row.reference_url,
    copy: row.copy,
    fiveWOneH: row.five_w_one_h,
    scenePrompt: row.scene_prompt,
    scenePath: row.scene_path,
    posterPath: row.poster_path,
    // ?? null for the 0052 reason one line down: a database without 0056 returns no such
    // column, and an undefined here would be DROPPED by JSON.stringify rather than reported
    // as absent.
    promptImagePaths: row.prompt_image_paths ?? null,
    // ?? null: a pre-0052 database returns no such columns (undefined), which JSON.stringify
    // would DROP from the detail payload and fail the web's Zod parse — the 0021 finding.
    sourceImagePath: row.source_image_path ?? null,
    motionPath: row.motion_path ?? null,
    motionGifPath: row.motion_gif_path ?? null,
    motionPrompt: row.motion_prompt ?? null,
    motionInteractionId: row.motion_interaction_id ?? null,
    // ?? null for the 0052 reason one line up: a database without 0053 returns no such
    // column, and an undefined here would be dropped from the detail payload.
    motionAspect: row.motion_aspect ?? null,
    // ?? null for the same reason: a database without 0055 returns no such column, and an
    // undefined here would be dropped from the detail payload rather than reported as absent.
    motionRegion: row.motion_region ?? null,
    // ?? null for the same reason: a database without 0059 returns no such column.
    carousel: row.carousel ?? null,
    costUsd:
      row.cost_usd === null || row.cost_usd === undefined
        ? null
        : Number(row.cost_usd),
    costBreakdown: row.cost_breakdown,
    // ?? null: pre-0021 databases return no such columns (undefined), which
    // JSON.stringify would silently DROP from the detail payload — failing the
    // web's Zod parse on every detail fetch. Coalescing keeps the API usable
    // until the migration is applied.
    publishedUrl: row.published_url ?? null,
    publishedAt: row.published_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Fields a caller may update after creation (everything except id/note/created_at).
export type GenerationPatch = Partial<
  Pick<
    GenerationRow,
    | 'outputType'
    | 'status'
    | 'step'
    | 'error'
    | 'article'
    | 'articleEnglish'
    | 'articleHindi'
    | 'factCheck'
    | 'referenceTitle'
    | 'referenceUrl'
    | 'copy'
    | 'fiveWOneH'
    | 'scenePrompt'
    | 'scenePath'
    | 'posterPath'
    // Dynamic Poster (0052). Every one of these is written by a render, so unlike the
    // insert-only officer inputs they belong here.
    | 'motionPath'
    | 'motionGifPath'
    | 'motionPrompt'
    | 'motionInteractionId'
    // Carousel (0059): rewritten by the job as each slide lands.
    | 'carousel'
    | 'posterStyle'
    | 'posterHeading'
    | 'styleReferenceMeta'
    | 'publishedUrl'
    | 'publishedAt'
  >
>;

function patchToDbRow(patch: GenerationPatch): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (patch.outputType !== undefined) row.output_type = patch.outputType;
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.step !== undefined) row.step = patch.step;
  if (patch.error !== undefined) row.error = patch.error;
  if (patch.article !== undefined) row.article = patch.article;
  if (patch.articleEnglish !== undefined)
    row.article_english = patch.articleEnglish;
  if (patch.articleHindi !== undefined) row.article_hindi = patch.articleHindi;
  if (patch.factCheck !== undefined) row.fact_check = patch.factCheck;
  if (patch.referenceTitle !== undefined)
    row.reference_title = patch.referenceTitle;
  if (patch.referenceUrl !== undefined) row.reference_url = patch.referenceUrl;
  if (patch.copy !== undefined) row.copy = patch.copy;
  if (patch.fiveWOneH !== undefined) row.five_w_one_h = patch.fiveWOneH;
  if (patch.scenePrompt !== undefined) row.scene_prompt = patch.scenePrompt;
  if (patch.scenePath !== undefined) row.scene_path = patch.scenePath;
  if (patch.posterPath !== undefined) row.poster_path = patch.posterPath;
  if (patch.motionPath !== undefined) row.motion_path = patch.motionPath;
  if (patch.motionGifPath !== undefined)
    row.motion_gif_path = patch.motionGifPath;
  if (patch.motionPrompt !== undefined) row.motion_prompt = patch.motionPrompt;
  if (patch.motionInteractionId !== undefined)
    row.motion_interaction_id = patch.motionInteractionId;
  if (patch.carousel !== undefined) row.carousel = patch.carousel;
  if (patch.posterStyle !== undefined) row.poster_style = patch.posterStyle;
  if (patch.posterHeading !== undefined)
    row.poster_heading = patch.posterHeading;
  if (patch.styleReferenceMeta !== undefined)
    row.style_reference_meta = patch.styleReferenceMeta;
  if (patch.publishedUrl !== undefined) row.published_url = patch.publishedUrl;
  if (patch.publishedAt !== undefined) row.published_at = patch.publishedAt;
  return row;
}

export async function insertGeneration(
  client: SupabaseClient,
  input: Readonly<{
    note: string;
    outputType: OutputType;
    category: Category;
    designMode?: DesignMode | undefined;
    // Insert-only (like designMode): absent ⇒ 'dgipr'. Set to 'cmo' by a
    // विभाग = CMO social run.
    templateBrand?: TemplateBrand | undefined;
    heading?: string | undefined;
    // The hand-typed article-poster text. Unlike the pins this IS updatable (it is in
    // GenerationPatch too) — the officer usually discovers the heading is wrong only after
    // seeing the poster, and fixes it from the detail page.
    posterHeading?: string | undefined;
    // Insert-only (migration 0045): the officer's own image prompt. Deliberately NOT in
    // GenerationPatch — a redo must render the poster the officer asked for, and rewriting
    // the brief is a new run.
    imagePrompt?: string | undefined;
    // Insert-only (not in GenerationPatch): a pin never changes after creation.
    referenceImageId?: string | undefined;
    referenceTypeId?: string | undefined;
    // Insert-only lineage: immutable after creation, like the pins.
    sourceGenerationId?: string | undefined;
    threadRootId?: string | undefined;
    dloIntakeId?: string | undefined;
    // Insert-only (migration 0030): facts the officer deselected in the /dlo Pointers step.
    // Consumed once at draft time, never edited — so, unlike posterHeading, not in GenerationPatch.
    excludedFacts?: readonly string[] | undefined;
    // Insert-only (migration 0034): every pointer the officer kept, with its 5W1H
    // dimension, and the attributed statements selected beside them.
    selectedFacts?:
      | readonly Readonly<{ dimension: string; text: string }>[]
      | undefined;
    statements?:
      | readonly Readonly<{
          speaker: string;
          designation: string;
          venue: string;
          claim: string;
        }>[]
      | undefined;
    // Insert-only (migration 0033): person → पदनाम pairs approved in the pre-generation name
    // check. Read again by the feedback path, so it must live on the row rather than in the
    // create request alone — a retry or a revision would otherwise lose the designations.
    nameDesignations?:
      | readonly Readonly<{ name: string; designation: string }>[]
      | undefined;
    // Insert-only (migration 0035): a published article the officer pasted as the STYLE model.
    // Read again on every retry, which is why it lives on the row rather than in the create
    // request alone.
    styleReference?: string | undefined;
    // Insert-only (migration 0041): the officer's trusted request for this article.
    instructions?: string | undefined;
    // Insert-only (migration 0056): the pictures the officer attached for the image model.
    // Insert-only for the reason imagePrompt is — the retry path and the poster regenerate
    // both rebuild the job by re-reading the row, so pictures held only in the create request
    // would be dropped on the first redo.
    promptImagePaths?: readonly string[] | undefined;
    // Insert-only (migration 0052): the poster the officer uploaded for a Dynamic Poster
    // run. Insert-only for the reason imagePrompt is — a retry and every follow-up re-read
    // the row, so the source must be the same object every time.
    sourceImagePath?: string | undefined;
    // Insert-only (migration 0053): the clip's aspect ratio. Same reason again — the
    // follow-up path regenerates the motion prompt, so the shape must be on the row.
    // Pass it ONLY when it is not the default; see the insert below.
    motionAspect?: string | undefined;
    // Insert-only (migration 0055): the moving region. Same reason a third time — the
    // follow-up path re-reads the row and regenerates the motion prompt, so a region held only
    // in the create request would be lost on the first follow-up, and the retry button could
    // not reproduce the same hole after a failed render.
    motionRegion?: unknown;
    // Carousel runs only (migration 0059): the initial state, carrying the slide count the
    // officer asked for. Written at insert so a retry reproduces it; the job fills in the rest.
    carousel?: unknown;
    // Insert-only: the note is a finished article; the runner skips generation.
    articleProvided?: boolean | undefined;
  }>,
): Promise<GenerationRow> {
  const { data, error } = await client
    .from(GENERATIONS_TABLE)
    .insert({
      note: input.note,
      output_type: input.outputType,
      category: input.category,
      design_mode: input.designMode ?? null,
      template_brand: input.templateBrand ?? 'dgipr',
      heading: input.heading ?? null,
      // Sent ONLY when a heading was actually typed. PostgREST rejects an insert naming a
      // column the table does not have, so writing `poster_heading: null` unconditionally
      // would make EVERY generation fail on a database where 0029 has not been applied yet.
      // Omitting it keeps ordinary runs working there and confines the migration's blast
      // radius to the one feature that needs it — the same reasoning that keeps 0028's style
      // write in its own best-effort update.
      ...(input.posterHeading ? { poster_heading: input.posterHeading } : {}),
      // Same omit-unless-typed treatment (migration 0045), so an un-applied 0045 costs this
      // one field rather than every create.
      ...(input.imagePrompt ? { image_prompt: input.imagePrompt } : {}),
      reference_image_id: input.referenceImageId ?? null,
      reference_type_id: input.referenceTypeId ?? null,
      source_generation_id: input.sourceGenerationId ?? null,
      thread_root_id: input.threadRootId ?? null,
      dlo_intake_id: input.dloIntakeId ?? null,
      // Sent ONLY when facts were actually deselected — same reasoning as poster_heading above:
      // naming excluded_facts unconditionally would fail EVERY insert on a database where 0030
      // has not been applied. Omitting it confines the migration's blast radius to this feature.
      ...(input.excludedFacts && input.excludedFacts.length > 0
        ? { excluded_facts: input.excludedFacts }
        : {}),
      // Omit both columns unless the inventory exists. This keeps every non-DLO create
      // working against a database where 0034 has not yet been applied.
      ...(input.selectedFacts && input.selectedFacts.length > 0
        ? { selected_facts: input.selectedFacts }
        : {}),
      ...(input.statements && input.statements.length > 0
        ? { statements: input.statements }
        : {}),
      // Sent ONLY when designations were actually approved — same reasoning again, so an
      // un-applied 0033 costs this feature rather than every create.
      ...(input.nameDesignations && input.nameDesignations.length > 0
        ? { name_designations: input.nameDesignations }
        : {}),
      // Sent ONLY when the officer actually pasted a style reference — same reasoning again,
      // so an un-applied 0035 costs the officer-reference tier (retrieval still runs) rather
      // than failing every create.
      ...(input.styleReference
        ? { style_reference: input.styleReference }
        : {}),
      // Same omit-unless-typed treatment (migration 0041), so an un-applied 0041 costs this
      // one field rather than every create.
      ...(input.instructions ? { instructions: input.instructions } : {}),
      // Same omit-unless-attached treatment (migration 0056), so an un-applied 0056 costs a
      // create that actually carries pictures rather than every create on every lane.
      ...(input.promptImagePaths && input.promptImagePaths.length > 0
        ? { prompt_image_paths: input.promptImagePaths }
        : {}),
      // Same again (migration 0052). This one cannot save the run it belongs to — a Dynamic
      // Poster with no source is not a run — but it keeps every OTHER create working on a
      // database where 0052 has not been applied.
      ...(input.sourceImagePath
        ? { source_image_path: input.sourceImagePath }
        : {}),
      // Same again (migration 0053), and the caller passes this only for the NON-default
      // ratio — which is what confines an un-applied 0053 to landscape requests instead of
      // failing every Dynamic Poster create. The job reads null as the portrait default.
      ...(input.motionAspect ? { motion_aspect: input.motionAspect } : {}),
      // MANDATORY SPREAD, not an unconditional null (migration 0055). PostgREST refuses an
      // insert that NAMES a column the database does not have, so writing motion_region
      // unconditionally would fail EVERY create on EVERY lane on a database without 0055 —
      // where omitting it confines the damage to a Dynamic Poster create that actually carries
      // a region. The 0028 principle, and the reason every column above it is spread too.
      ...(input.motionRegion ? { motion_region: input.motionRegion } : {}),
      // Same spread again (migration 0059), so an un-applied 0059 costs a carousel create — which
      // the category CHECK would refuse anyway — rather than every create on every lane.
      ...(input.carousel ? { carousel: input.carousel } : {}),
      article_provided: input.articleProvided ?? false,
    })
    .select()
    .single();
  if (error) {
    throw new Error(`Failed to insert generation: ${error.message}`);
  }
  return fromDbRow(data as GenerationDbRow);
}

export async function updateGeneration(
  client: SupabaseClient,
  id: string,
  patch: GenerationPatch,
): Promise<void> {
  const row = patchToDbRow(patch);
  row.updated_at = new Date().toISOString();
  const { error } = await client
    .from(GENERATIONS_TABLE)
    .update(row)
    .eq('id', id);
  if (error) {
    throw new Error(`Failed to update generation ${id}: ${error.message}`);
  }
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

// Add one job's cost to a generation's running totals. Read-modify-write (jobs for a
// given generation run one at a time, so no lost-update race in practice): reads the
// current cost_usd/cost_breakdown, folds in the increment, and writes both back — so
// cost is additive across the initial run and every later feedback/revision job. A
// genuinely zero increment is a no-op (no needless write / run bump).
export async function addGenerationCost(
  client: SupabaseClient,
  id: string,
  increment: GenerationCostIncrement,
): Promise<void> {
  const isZero =
    increment.chatCalls === 0 &&
    increment.imageCount === 0 &&
    increment.textCostUsd === 0 &&
    increment.imageCostUsd === 0;
  if (isZero) return;

  const { data, error } = await client
    .from(GENERATIONS_TABLE)
    .select('cost_breakdown')
    .eq('id', id)
    .maybeSingle();
  if (error) {
    throw new Error(
      `Failed to read cost for generation ${id}: ${error.message}`,
    );
  }
  const prev = (data?.cost_breakdown ??
    null) as Partial<GenerationCostBreakdown> | null;

  const merged: GenerationCostBreakdown = {
    chatCalls: (prev?.chatCalls ?? 0) + increment.chatCalls,
    inputTokens: (prev?.inputTokens ?? 0) + increment.inputTokens,
    cachedInputTokens:
      (prev?.cachedInputTokens ?? 0) + increment.cachedInputTokens,
    outputTokens: (prev?.outputTokens ?? 0) + increment.outputTokens,
    textCostUsd: round((prev?.textCostUsd ?? 0) + increment.textCostUsd, 6),
    imageCount: (prev?.imageCount ?? 0) + increment.imageCount,
    imageCostUsd: round((prev?.imageCostUsd ?? 0) + increment.imageCostUsd, 6),
    runs: (prev?.runs ?? 0) + 1,
  };
  const totalUsd = round(merged.textCostUsd + merged.imageCostUsd, 4);

  const { error: updateError } = await client
    .from(GENERATIONS_TABLE)
    .update({
      cost_usd: totalUsd,
      cost_breakdown: merged,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (updateError) {
    throw new Error(
      `Failed to persist cost for generation ${id}: ${updateError.message}`,
    );
  }
}

export async function getGeneration(
  client: SupabaseClient,
  id: string,
): Promise<GenerationRow | null> {
  const { data, error } = await client
    .from(GENERATIONS_TABLE)
    .select()
    .eq('id', id)
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to fetch generation ${id}: ${error.message}`);
  }
  return data ? fromDbRow(data as GenerationDbRow) : null;
}

// Which articles came out of these DLO intakes. Lineage is one-way — generations point at
// their intake via dlo_intake_id (0018) and nothing points back — so this is how the /dlo list
// and detail learn that an intake has already produced an article.
//
// Deliberately NOT a reverse dlo_intakes.generation_id column: that would be a best-effort
// write which, when it silently failed, would leave an officer free to pay for a second
// article from the same source. The forward lineage answers the question authoritatively, and
// one batched `.in()` answers it for a whole page rather than N+1.
export type DloIntakeGenerationRow = Readonly<{
  id: string;
  dloIntakeId: string;
  status: GenerationStatus;
  createdAt: string;
}>;

export async function listGenerationsForDloIntakes(
  client: SupabaseClient,
  intakeIds: readonly string[],
): Promise<DloIntakeGenerationRow[]> {
  // `.in()` with an empty array is a query that can only return nothing — skip the round trip.
  if (intakeIds.length === 0) return [];
  const { data, error } = await client
    .from(GENERATIONS_TABLE)
    .select('id,dlo_intake_id,status,created_at')
    .in('dlo_intake_id', [...intakeIds])
    .order('created_at', { ascending: false });
  if (error) {
    throw new Error(
      `Failed to list generations for DLO intakes: ${error.message}`,
    );
  }
  return ((data ?? []) as unknown as Array<{
    id: string;
    dlo_intake_id: string | null;
    status: GenerationStatus;
    created_at: string;
  }>)
    .filter((row) => row.dlo_intake_id !== null)
    .map((row) => ({
      id: row.id,
      dloIntakeId: row.dlo_intake_id as string,
      status: row.status,
      createdAt: row.created_at,
    }));
}

// WHOLE rows — every column, including the note, the article, both translations and every
// jsonb blob. It has no caller left: the history list is `listGenerationsPage` below, which
// reads the twelve columns a card actually draws. Do not reach for this one to build a list
// view; it is here for a caller that genuinely needs complete rows.
export async function listGenerations(
  client: SupabaseClient,
  limit = 50,
): Promise<GenerationRow[]> {
  const { data, error } = await client
    .from(GENERATIONS_TABLE)
    .select()
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    throw new Error(`Failed to list generations: ${error.message}`);
  }
  return ((data ?? []) as GenerationDbRow[]).map(fromDbRow);
}

// The visual styles the most recent poster runs were assigned, newest first (migration 0028).
// Feeds the palette/composition recency rings so consecutive posters differ — replacing the
// in-process Map that reset on every API restart and could not be seen by a second process.
//
// `categories` scopes the history to one poster KIND, and callers should always pass it. The
// social and article paths draw their compositions from two different libraries (portrait
// archetypes in poster-layouts.ts, landscape ones in article-poster-layouts.ts), so an
// unscoped read would let a social `cards` coverage bar an article pick and vice versa —
// spreading each rotation against a vocabulary the other cannot even produce. Colour families
// are shared, but scoping those too is the right call: each kind should spread against its own
// recent output, which is what an officer actually sees side by side in that lane.
//
// Returns the raw jsonb values; the caller validates and reads what it needs. Rows without a
// style (pre-0028, or a run whose render failed) are excluded by the query rather than
// returned as nulls, so `limit` always means "the last N styles that exist".
export async function listRecentPosterStyles(
  client: SupabaseClient,
  limit = 8,
  categories?: readonly string[],
): Promise<unknown[]> {
  let query = client
    .from(GENERATIONS_TABLE)
    .select('poster_style')
    .not('poster_style', 'is', null);
  if (categories && categories.length > 0) {
    query = query.in('category', [...categories]);
  }
  const { data, error } = await query
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    throw new Error(`Failed to list recent poster styles: ${error.message}`);
  }
  return ((data ?? []) as Array<{ poster_style: unknown }>).map((r) => r.poster_style);
}

// All members of a thread (the root itself + every follow-up), oldest first.
// rootId must come from a fetched row (threadRootId ?? id), never raw input.
export async function listThreadGenerations(
  client: SupabaseClient,
  rootId: string,
): Promise<GenerationRow[]> {
  const { data, error } = await client
    .from(GENERATIONS_TABLE)
    .select()
    .or(`id.eq.${rootId},thread_root_id.eq.${rootId}`)
    .order('created_at', { ascending: true });
  if (error) {
    throw new Error(`Failed to list thread ${rootId}: ${error.message}`);
  }
  return ((data ?? []) as GenerationDbRow[]).map(fromDbRow);
}

// One row in generation_revisions: the feedback that drove a revision plus
// snapshots of whatever it changed.
export type RevisionRow = Readonly<{
  id: string;
  generationId: string;
  target: RevisionTarget;
  feedback: string | null;
  article: string | null;
  factCheck: string | null;
  copy: unknown;
  scenePrompt: string | null;
  scenePath: string | null;
  posterPath: string | null;
  // One Dynamic Poster render (target 'motion', migration 0052). Its own columns rather than
  // poster_path, which every poster reader in the API treats as a PNG — an .mp4 sitting in it
  // would be listed as a poster version by posterVersionPaths.
  motionPath: string | null;
  motionGifPath: string | null;
  createdAt: string;
}>;

export type NewRevision = Readonly<{
  generationId: string;
  target: RevisionTarget;
  feedback?: string | null;
  article?: string | null;
  factCheck?: string | null;
  copy?: unknown;
  scenePrompt?: string | null;
  scenePath?: string | null;
  posterPath?: string | null;
  motionPath?: string | null;
  motionGifPath?: string | null;
}>;

type RevisionDbRow = {
  id: string;
  generation_id: string;
  target: RevisionTarget;
  feedback: string | null;
  article: string | null;
  fact_check: string | null;
  copy: unknown;
  scene_prompt: string | null;
  scene_path: string | null;
  poster_path: string | null;
  motion_path: string | null;
  motion_gif_path: string | null;
  created_at: string;
};

export async function insertRevision(
  client: SupabaseClient,
  revision: NewRevision,
): Promise<void> {
  const { error } = await client.from(GENERATION_REVISIONS_TABLE).insert({
    generation_id: revision.generationId,
    target: revision.target,
    feedback: revision.feedback ?? null,
    article: revision.article ?? null,
    fact_check: revision.factCheck ?? null,
    copy: revision.copy ?? null,
    scene_prompt: revision.scenePrompt ?? null,
    scene_path: revision.scenePath ?? null,
    poster_path: revision.posterPath ?? null,
    // Omitted unless this revision actually is a motion render, so an un-applied 0052 costs
    // the Dynamic Poster lane rather than every article/poster revision ever logged.
    ...(revision.motionPath ? { motion_path: revision.motionPath } : {}),
    ...(revision.motionGifPath
      ? { motion_gif_path: revision.motionGifPath }
      : {}),
  });
  if (error) {
    throw new Error(`Failed to insert revision: ${error.message}`);
  }
}

export async function listRevisions(
  client: SupabaseClient,
  generationId: string,
): Promise<RevisionRow[]> {
  const { data, error } = await client
    .from(GENERATION_REVISIONS_TABLE)
    .select()
    .eq('generation_id', generationId)
    .order('created_at', { ascending: true });
  if (error) {
    throw new Error(
      `Failed to list revisions for ${generationId}: ${error.message}`,
    );
  }
  return ((data ?? []) as RevisionDbRow[]).map((row) => ({
    id: row.id,
    generationId: row.generation_id,
    target: row.target,
    feedback: row.feedback,
    article: row.article,
    factCheck: row.fact_check,
    copy: row.copy,
    scenePrompt: row.scene_prompt,
    scenePath: row.scene_path,
    posterPath: row.poster_path,
    motionPath: row.motion_path ?? null,
    motionGifPath: row.motion_gif_path ?? null,
    createdAt: row.created_at,
  }));
}

// ---------------------------------------------------------------------------
// The history list, paged and filtered in the DATABASE.
//
// `listGenerations` above selects EVERY column, which for this table means `note` (up to
// 60,000 characters), `article`, both translations, `fact_check`, `style_reference` and a
// dozen jsonb blobs — while a history card draws eight fields. At the 100-row cap the old
// list endpoint used, that was megabytes on the wire to render nine cards, and it is also
// why the history page could only ever reach 100 runs: filtering and paging both happened
// in the browser over whatever that one request returned.
//
// This is the lean counterpart. Two rules it must keep:
//
//   * NEVER widen the select to `*`. The whole point is the columns that are absent.
//     `note` and `article` are here only because a card shows an excerpt of one and the
//     first line of the other, and PostgREST cannot substring — bounded instead by the page
//     size, which is what makes that affordable.
//   * The count is `exact` and comes back in the SAME round trip as the rows (PostgREST's
//     Content-Range header), so paging costs one query, not two.
// ---------------------------------------------------------------------------

// Exactly the columns `toSummary` reads. Adding one here is a deliberate act.
const GENERATION_CARD_COLUMNS =
  'id,created_at,output_type,category,status,step,note,article,copy,poster_path,source_image_path,cost_usd';

export type GenerationCardRow = Readonly<{
  id: string;
  createdAt: string;
  outputType: OutputType;
  category: Category;
  status: GenerationStatus;
  step: string | null;
  note: string;
  article: string | null;
  copy: unknown;
  posterPath: string | null;
  sourceImagePath: string | null;
  costUsd: number | null;
}>;

export type GenerationListFilter = Readonly<{
  // Restrict to these categories (OR'd). Undefined = every category.
  categories?: readonly Category[] | undefined;
  // Restrict to these output types (OR'd). Undefined = every output type. Paired with
  // `categories` this is what separates a caption-only social run from a poster one.
  outputTypes?: readonly OutputType[] | undefined;
  // ...and what EXCLUDES the caption lane from a poster format, which `outputTypes` cannot
  // express on its own (a poster run may be 'poster' or 'both').
  excludeOutputTypes?: readonly OutputType[] | undefined;
  statuses?: readonly GenerationStatus[] | undefined;
  // ISO timestamp; rows created strictly before it are dropped.
  createdAfter?: string | undefined;
  // Case-insensitive substring over the note and the article. Already sanitised by the
  // caller for PostgREST's `or` grammar — see `escapeForPostgrestOr`.
  search?: string | undefined;
}>;

// PostgREST parses `or=(a.ilike.*x*,b.ilike.*y*)` as a grammar, so a comma, parenthesis or
// backslash typed into the search box would not merely fail to match — it would change the
// shape of the filter, and a malformed one is a 400 on an ordinary keystroke. Marathi search
// terms carry none of these, so dropping them costs nothing real; escaping them would mean
// reimplementing that grammar's quoting rules against a moving target.
export function escapeForPostgrestOr(term: string): string {
  return term.replace(/[,()\\%*"']/g, ' ').trim();
}

function applyGenerationFilter<T>(query: T, filter: GenerationListFilter): T {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = query as any;
  if (filter.categories && filter.categories.length > 0) {
    q = q.in('category', [...filter.categories]);
  }
  if (filter.outputTypes && filter.outputTypes.length > 0) {
    q = q.in('output_type', [...filter.outputTypes]);
  }
  if (filter.excludeOutputTypes && filter.excludeOutputTypes.length > 0) {
    q = q.not('output_type', 'in', `(${filter.excludeOutputTypes.join(',')})`);
  }
  if (filter.statuses && filter.statuses.length > 0) {
    q = q.in('status', [...filter.statuses]);
  }
  if (filter.createdAfter) {
    q = q.gte('created_at', filter.createdAfter);
  }
  const search = filter.search ? escapeForPostgrestOr(filter.search) : '';
  if (search) {
    q = q.or(`note.ilike.%${search}%,article.ilike.%${search}%`);
  }
  return q as T;
}

// PostgREST's 416 body names the size of the set it could not satisfy, e.g.
// "an offset of 600 was requested, but there are only 87 rows". Read rather than re-queried:
// the count is already in hand, and a second round trip to learn it would be the same work
// the failed request had already done.
function rangeTotal(error: { message?: string; details?: string }): number | null {
  const text = `${error.details ?? ''} ${error.message ?? ''}`;
  const match = /there are only (\d+) rows/.exec(text);
  return match ? Number(match[1]) : null;
}

export async function listGenerationsPage(
  client: SupabaseClient,
  options: GenerationListFilter & {
    offset: number;
    limit: number;
    ascending?: boolean;
  },
): Promise<{ rows: GenerationCardRow[]; total: number }> {
  const query = applyGenerationFilter(
    client
      .from(GENERATIONS_TABLE)
      .select(GENERATION_CARD_COLUMNS, { count: 'exact' }),
    options,
  )
    .order('created_at', { ascending: options.ascending ?? false })
    // Ties on created_at would otherwise be ordered arbitrarily per request, which can
    // duplicate a row onto two pages and drop another entirely.
    .order('id', { ascending: options.ascending ?? false })
    .range(options.offset, options.offset + options.limit - 1);

  const { data, error, count } = await query;
  if (error) {
    // PostgREST answers a range that starts past the end of the result set with 416
    // `Requested range not satisfiable` rather than an empty page. That is reachable from
    // an ordinary stale link — a bookmarked page 40 of a list that has since been filtered
    // down — so it is an EMPTY PAGE here, not a 500. The caller still gets the true count,
    // which is what lets it clamp the pager back into range.
    if (error.code === 'PGRST103') {
      return { rows: [], total: rangeTotal(error) ?? 0 };
    }
    throw new Error(`Failed to list generations: ${error.message}`);
  }
  const rows = ((data ?? []) as unknown as Array<{
    id: string;
    created_at: string;
    output_type: OutputType;
    category: Category;
    status: GenerationStatus;
    step: string | null;
    note: string | null;
    article: string | null;
    copy: unknown;
    poster_path: string | null;
    source_image_path: string | null;
    cost_usd: number | string | null;
  }>).map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    outputType: row.output_type,
    category: row.category,
    status: row.status,
    step: row.step,
    note: row.note ?? '',
    article: row.article,
    copy: row.copy,
    posterPath: row.poster_path,
    sourceImagePath: row.source_image_path,
    costUsd: row.cost_usd === null ? null : Number(row.cost_usd),
  }));
  return { rows, total: count ?? rows.length };
}

// How many rows match, with NO row returned — PostgREST answers a `head` request from the
// Content-Range header alone. This is what makes the facet counts exact at any table size:
// the alternative, scanning every row into the API to tally them, gets slower as the
// department does more work, which is the opposite of the point.
export async function countGenerations(
  client: SupabaseClient,
  filter: GenerationListFilter = {},
): Promise<number> {
  const { count, error } = await applyGenerationFilter(
    client
      .from(GENERATIONS_TABLE)
      .select('id', { count: 'exact', head: true }),
    filter,
  );
  if (error) {
    throw new Error(`Failed to count generations: ${error.message}`);
  }
  return count ?? 0;
}
