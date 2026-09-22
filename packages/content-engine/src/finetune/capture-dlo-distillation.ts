// Phase 1 of the Gemma distillation plan: capture teacher–student training pairs.
//
// The student is `google/gemma-4-31B-it`. The teacher is the OpenAI article model under the
// SAME `dlo-rag-v2` prompt production sends. This harness pairs one officer-reviewed source
// with one freshly written teacher article, one file per row, resumably.
//
// THE GOVERNING RULE: THE TRAINING INPUT IS PRODUCED BY THE PRODUCTION BUILDER, NEVER
// RECONSTRUCTED. Every prompt here comes out of `buildDloArticleMessages` /
// `buildDloArticleUserPrompt` — the same two functions `generateArticleSimple` and
// `generateArticleFromSources` call. Nothing in this file writes a heading, a framing
// sentence or a section of its own.
//
// That is not fastidiousness; it is the difference between this file and
// `export-dlo-generation.ts`, which is deliberately left alone. That exporter reconstructs a
// user message with its own `Original officer note` / `SAVED REVIEWED SOURCE` framing that
// production never emits, and hard-refuses native-file runs. It answers a different question
// (audit: what did this run contain?) and remains the right tool for it. An adapter trained on
// its framing would be trained to expect a prompt no officer will ever send.
//
// WHY THE TARGET IS REGENERATED RATHER THAN READ OFF THE ROW. `generations.article` is
// whatever model wrote it on the day — the pool survey found the recent window is 37 OpenAI
// articles and 1 gemma one, and the all-time text lane spans eight prompt versions back to
// `simple-v1`. Training on that mixture would distil the AVERAGE of the platform's history.
// Regenerating every target under one model, one prompt version and one reasoning effort is
// what makes the dataset a single voice, and it is also why the historical provenance of a
// row does not matter: only its INPUTS are used.
//
// WHAT IS DELIBERATELY NOT RETRIEVED: style exemplars. `buildDloArticleMessages` takes
// `styleReferences` and this harness always passes none, so no `### MAHASAMVAD STYLE
// REFERENCES` block appears in either half of any pair. Phase 0.2 settled that with evidence,
// and the figure is worth carrying: of the 77 rows ever written under `dlo-rag-v2`, 75
// recorded `source: 'none'`, `articleCount: 0` and 2 recorded three retrieved exemplars. So
// the pool is mixed — barely, but mixed — even on the CURRENT prompt version, and uniformity
// has to be IMPOSED rather than inherited. Passing none reproduces what production sends in
// 97% of runs and normalises the tail away instead of teaching it as noise.
// Doing it by never calling `selectStyleReference` makes it structural: there is no env var
// to forget and no retrieval floor to drift. `ARTICLE_STYLE_REFERENCES_ENABLED` is still read
// once, and a deployment that has it on gets a loud warning plus a sidecar note, because in
// that case the captured prompt is not the one production currently sends.
//
// WHAT IS GIVEN UP, said plainly: the officer's pasted `style_reference` (migration 0035) is
// dropped, exactly as production drops it while the flag is off — it reaches the prompt only
// through `selectStyleReference`. Rows that carried one are counted in the report and flagged
// in their sidecar, so the decision is visible rather than silent.
//
// TRANSPORT: every teacher call goes through `respondWithSources`, including the rows that
// attach nothing. Production reaches those two lanes through two transports — a text-lane row
// goes to `chatComplete` and a file-lane row to Responses — and one teacher across the whole
// dataset matters more here than matching each lane's transport, because a target is a STYLE
// ceiling rather than a production replay. `buildSourcesRequest` with no files is asserted by
// its own harness to be byte-identical to a plain text call, so the prompt is unchanged; what
// differs is that the system message travels as `instructions` rather than as a `system` turn.

import { mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import {
  DLO_UPLOADS_BUCKET,
  createServiceRoleClient,
  downloadFile,
  getDloIntake,
  getGeneration,
  type DloIntakeFileEntry,
  type DloIntakeRow,
  type GenerationRow,
  type SupabaseClient,
} from '@dgipr/database';
import {
  NameDesignationsSchema,
  intakeFileMimeForFileName,
} from '@dgipr/schemas';
import {
  createCostAccumulator,
  runInCostScope,
  totalCostUsd,
  type CostAccumulator,
} from '../cost/cost-meter.js';
import type { DesignationPair } from '../generation/category-prompt.js';
import {
  DGIPR_EDITORIAL_SYSTEM_PROMPT,
  DLO_ARTICLE_PROMPT_VERSION,
  DLO_SOURCE_FILES_MARKER,
  buildDloArticleMessages,
} from '../generation/dlo-article-prompt.js';
import {
  FACT_CHECK_DELIMITER,
  splitContent,
} from '../generation/generate-article.js';
import {
  ARTICLE_BODY_MAX_TOKENS,
  ARTICLE_MODEL,
  type ChatMessage,
} from '../generation/openai-chat.js';
import { articleStyleReferencesEnabled } from '../generation/no-reference-article-prompt.js';
import { respondWithSources } from '../generation/responses-with-sources.js';
import { documentKindOf, extractDocument } from '../intake/document.js';
import {
  extractImageTextViaProvider,
  imageOcrProviderName,
  ocrProviderName,
} from '../intake/ocr-provider.js';
import {
  deleteSourceFile,
  uploadSourceFile,
  type SourceFileRef,
} from '../intake/openai-source-files.js';
import {
  classifyLane,
  fetchArticleRevisionIds,
  fetchDloArticleRows,
  fetchIntakeFiles,
  groupKeyOf,
  type Lane,
  type SurveyGenerationRow,
} from './survey-dlo-pool.js';

/** Pairs live beside the survey and the template probe, under the gitignored data dir. */
const DEFAULT_OUT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../data/finetune/distill/pairs',
);

export const CAPTURE_FORMAT_VERSION = 'dlo-distill-v1';

/**
 * A source shorter than this is not a row worth $0.30 of teacher.
 *
 * It is a floor on the SOURCE, never on the article: a genuinely short press note is a
 * perfectly good example, and DGIPR publishes plenty of them. What it excludes is the row
 * whose officer abandoned the intake — an empty note, a one-line test, a heading with nothing
 * under it — which pairs a near-empty input with a fluent article and teaches exactly the
 * invention the never-invent rule exists to prevent.
 */
export const DEFAULT_MIN_SOURCE_CHARS = 400;

/**
 * What one teacher article costs, for the dry run's estimate ONLY.
 *
 * MEASURED, not budgeted, and the difference matters to the decision this gate exists for.
 * The plan estimated $0.30–$0.60 per article on the assumption that `high` reasoning would
 * dominate. The first real capture — a 3,762-char source under `high` — billed **$0.038**:
 * 1,213 input tokens at $5/1M plus 1,077 output tokens at $30/1M, which reconciles to
 * gpt-5.6-sol's published rates to the cent. Output is indeed the dominant term, but reasoning
 * at this prompt size is a fraction of what the plan assumed.
 *
 * The band below spans a short news note at the bottom and a long scheme source at the top
 * (~8k input, ~2.5k output). So the whole 291-group pool is roughly $9–$45, not the plan's
 * $60–$180 — worth knowing before deciding how much of the pool to capture.
 *
 * It remains an estimate and the meter remains the truth: the run prints the RUNNING ACTUAL
 * spend after every row, so an over-run is visible at row three rather than at row 291.
 */
export const TEACHER_USD_PER_ARTICLE = { low: 0.03, high: 0.15 } as const;

/**
 * Which lanes to capture from.
 *
 * `text` is the default and is what Phase 0.3 chose: the all-time text lane carries its source
 * as characters already (`files[].text` / `files[].pages`, assembled into `generations.note`
 * before the run), so it needs no bucket download, no OCR and no OpenAI upload — 291
 * independent groups at zero reading cost. `native` is the /new-dlo file lane, where the
 * document was never transcribed and the student's source has to be read once, offline.
 */
export type CaptureLane = 'text' | 'native' | 'all';

/**
 * Which end of the pool a limited batch takes. `newest` is the default — see
 * `pickGroupRepresentatives`.
 */
export type CaptureOrder = 'newest' | 'oldest';

// ---------------------------------------------------------------------------
// Pure core — everything below is exercised by `--check` with no database, no network and
// no spend. These are the functions that decide what a training pair CONTAINS, which is the
// one thing about this harness that cannot be corrected after the teacher has been billed.
// ---------------------------------------------------------------------------

/** One document's text, as the student's SOURCE INFORMATION carries it. */
export type DocumentSection = Readonly<{
  name: string;
  /** Where the characters came from, for the sidecar's provenance record. */
  origin: 'intake-text' | 'ocr';
  text: string;
}>;

/**
 * The student's source information: the officer's own note plus any document read for it.
 *
 * On the text lane the second argument is EMPTY and this returns `note` unchanged, which is
 * the whole point — `generations.note` on that lane already IS the assembled source, built by
 * the officer's review step through `combineIntakeSources` and sent to the generate route as
 * one string. Reassembling it here from `files[]` would be reconstruction, and would silently
 * re-include pages the officer unticked.
 *
 * The `=== स्रोत: NAME ===` header is `combineIntakeSources`'s own, and the same one
 * `filePartsFor` labels a Responses attachment with, so a document reads identically whether
 * it arrived as characters or as a file. The note is NOT re-wrapped in `=== टिपणी ===`: on the
 * native lane it has already been through `combineIntakeSources` once (notes plus audio
 * transcripts), and wrapping it again would nest one source header inside another.
 */
export function appendDocumentSources(
  note: string,
  sections: readonly DocumentSection[],
): string {
  const parts: string[] = [];
  const trimmedNote = note.trim();
  if (trimmedNote) parts.push(trimmedNote);
  for (const section of sections) {
    const text = section.text.trim();
    // A document that read as nothing contributes nothing. Emitting a bare header would tell
    // the model a source exists and then show it an empty one, which is the shape that makes
    // a model fill the gap.
    if (!text) continue;
    parts.push(`=== स्रोत: ${section.name} ===\n${text}`);
  }
  return parts.join('\n\n');
}

export type CapturePromptInputs = Readonly<{
  /** The student's complete source information — note plus any document text. */
  studentSource: string;
  /**
   * The teacher's source information. Identical to `studentSource` on the text lane. On the
   * native lane it is the note alone, because the documents ride as file parts instead.
   */
  teacherSource: string;
  /** How many files the teacher call will attach. Zero on the text lane. */
  attachedFileCount: number;
  designations: readonly DesignationPair[];
  heading: string | null;
  officerInstructions: string | null;
}>;

/**
 * The two prompts one row produces.
 *
 * They are built from ONE builder with two argument sets rather than assembled separately,
 * which is what makes it impossible for the teacher and the student to drift apart in
 * anything except the deliberate difference: whether the documents arrive as attachments or
 * as characters. On the text lane there is no difference at all and the two are byte-identical
 * — asserted in `--check`, because that identity is the property the whole text-lane decision
 * rests on.
 */
export function buildCapturePrompts(inputs: CapturePromptInputs): Readonly<{
  teacher: ChatMessage[];
  student: ChatMessage[];
}> {
  const shared = {
    // Never retrieved, never passed. See the header: uniformity is structural here.
    styleReferences: [],
    designations: inputs.designations,
    heading: inputs.heading,
    officerInstructions: inputs.officerInstructions,
  } as const;
  return {
    teacher: buildDloArticleMessages({
      ...shared,
      sourceInformation: inputs.teacherSource,
      // The marker the Responses transport splices the file parts into. Emitted only when
      // there is something to splice — a marker with no parts would send a NUL sentinel to
      // the model as literal text, which is the live bug Phase 0.1 fixed on the gemma lane.
      attachedSourceFiles: inputs.attachedFileCount > 0,
    }),
    student: buildDloArticleMessages({
      ...shared,
      sourceInformation: inputs.studentSource,
      // The student is trained on text and attaches nothing, so it must never carry the
      // marker. Guarded again below, because a NUL baked into an adapter is unrecoverable
      // without a re-capture.
      attachedSourceFiles: false,
    }),
  };
}

export type CapturePair = Readonly<{ messages: ChatMessage[] }>;

/**
 * The JSONL line: system, user, assistant.
 *
 * The system message is taken from the builder's own output rather than written out again
 * here, so the string the student is trained under cannot drift from the one production
 * sends. Phase 0.4 confirmed the Gemma 4 template keeps a `system` turn rather than folding
 * it into the first user turn, which is what makes a three-message conversational example the
 * right shape.
 */
export function buildCapturePair(
  student: readonly ChatMessage[],
  article: string,
): CapturePair {
  const system = student.find((message) => message.role === 'system');
  const user = student.find((message) => message.role === 'user');
  if (!system || !user) {
    throw new Error(
      'The student prompt is missing a system or user turn; refusing to write a pair.',
    );
  }
  const body = article.trim();
  if (!body) throw new Error('The teacher returned an empty article.');
  assertNoMarker(user.content, 'student user turn');
  return {
    messages: [
      { role: 'system', content: system.content },
      { role: 'user', content: user.content },
      { role: 'assistant', content: body },
    ],
  };
}

/**
 * Refuses a NUL sentinel anywhere in text that is about to be written or sent as text.
 *
 * The 0.1 lesson, made structural: the marker is an internal transport token, and the failure
 * mode when it escapes is silent — it reads as an invisible character in a log and trains as
 * a token the model learns to expect.
 */
export function assertNoMarker(text: string, where: string): void {
  if (text.includes(DLO_SOURCE_FILES_MARKER)) {
    throw new Error(
      `The source-file marker survived into the ${where}. It is a transport token and must ` +
        'never reach the model as text.',
    );
  }
  if (text.includes('\u0000')) {
    throw new Error(`A NUL byte survived into the ${where}.`);
  }
}

/** Counts the marker, so the teacher prompt can be checked to carry exactly one. */
export function markerCount(text: string): number {
  let count = 0;
  let at = text.indexOf(DLO_SOURCE_FILES_MARKER);
  while (at !== -1) {
    count += 1;
    at = text.indexOf(DLO_SOURCE_FILES_MARKER, at + 1);
  }
  return count;
}

/**
 * One row per independent group.
 *
 * A generation UUID is not an independent example: a thread's re-runs and feedback rounds are
 * the same source material seen several times, so capturing all of them pays the teacher
 * repeatedly for near-duplicate pairs AND — the part that actually costs something — hands
 * Phase 2 correlated rows it then has to split on the group anyway.
 *
 * The NEWEST row in a group is the representative because its inputs are the officer's latest
 * intent: a re-run usually follows an edited heading, a corrected designation or a new
 * instruction, and the earlier row's inputs are the ones that were rejected. Ties break on the
 * id so the choice is reproducible across runs.
 *
 * WHICH END OF THE POOL A LIMITED BATCH TAKES IS A SEPARATE QUESTION, and it is `order`'s.
 * `fetchDloArticleRows` returns `created_at` ASCENDING, so returning the representatives in
 * input order means `--limit N` captures the N OLDEST groups — which is what happened on the
 * first real batch, and is the wrong end of a pool that spans two months and eight prompt
 * versions. Recent rows are the ones written under today's `dlo-rag-v2` prompt, by officers
 * working the way they work now, so `newest` is the default and a limited batch is a batch of
 * the most recent work. `oldest` is kept because a FULL capture should walk the pool in a
 * stable order that does not shift every time a DLO publishes.
 */
export function pickGroupRepresentatives<
  T extends {
    id: string;
    created_at: string;
    dlo_intake_id: string | null;
    thread_root_id: string | null;
  },
>(
  rows: readonly T[],
  options?: Readonly<{ allRows?: boolean; order?: CaptureOrder }>,
): T[] {
  // Ascending is the canonical comparison; `newest` reverses it rather than writing a second
  // one, so the two orders can never disagree about a tie.
  const ascending = (a: T, b: T): number =>
    a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id);
  const sort = (list: T[]): T[] =>
    options?.order === 'oldest'
      ? list.sort(ascending)
      : list.sort((a, b) => -ascending(a, b));

  if (options?.allRows) return sort([...rows]);

  const best = new Map<string, T>();
  for (const row of rows) {
    const key = groupKeyOf(row);
    const held = best.get(key);
    if (
      !held ||
      row.created_at > held.created_at ||
      (row.created_at === held.created_at && row.id > held.id)
    ) {
      best.set(key, row);
    }
  }
  return sort([...best.values()]);
}

/** Whether a lane is in scope for this run. */
export function laneSelected(lane: Lane, selection: CaptureLane): boolean {
  if (selection === 'all') return lane !== 'unknown';
  if (selection === 'native') return lane === 'native' || lane === 'mixed';
  // The text selection deliberately includes `notes-only`: a run with no files at all carries
  // its whole source as characters, which is what this lane means. It excludes `mixed`, whose
  // native half would need the OCR step the text lane exists to avoid.
  return lane === 'text' || lane === 'notes-only';
}

export function estimateTeacherSpendUsd(
  count: number,
): Readonly<{ low: number; high: number }> {
  return {
    low: count * TEACHER_USD_PER_ARTICLE.low,
    high: count * TEACHER_USD_PER_ARTICLE.high,
  };
}

// ---------------------------------------------------------------------------
// Reads — the database and, on the native lane only, the private bucket.
// ---------------------------------------------------------------------------

/**
 * Whether this row already has a pair on disk.
 *
 * EITHER file counts, and that asymmetry is deliberate. The teacher call is the only thing
 * here that costs money, and it happens between the two writes; a crash in that window leaves
 * one file behind. Treating either as "already captured" guarantees a resumed batch can never
 * re-bill a row, at the cost of a half-written pair the report names explicitly so it can be
 * deleted by hand. The reverse trade — re-capture on a missing sidecar — would silently
 * re-bill every row whose sidecar write failed.
 */
async function existingCapture(
  stem: string,
): Promise<'none' | 'complete' | 'partial'> {
  const [pair, review] = await Promise.all([
    stat(`${stem}.jsonl`).then(
      () => true,
      () => false,
    ),
    stat(`${stem}.review.json`).then(
      () => true,
      () => false,
    ),
  ]);
  if (pair && review) return 'complete';
  if (pair || review) return 'partial';
  return 'none';
}

/** Which intake files are documents the student's source has to be read out of. */
function readableDocuments(
  files: readonly DloIntakeFileEntry[],
): DloIntakeFileEntry[] {
  return files.filter(
    (file) =>
      file.status === 'done' &&
      Boolean(file.storagePath) &&
      (file.kind === 'pdf' ||
        file.kind === 'docx' ||
        file.kind === 'txt' ||
        file.kind === 'image'),
  );
}

/**
 * Reads the native lane's documents ONCE, offline, so the student has characters to train on.
 *
 * DELIBERATELY NOT GEMMA. The plan is explicit and the reason is the whole risk of a text-only
 * distillation: a misread digit paired with a correct teacher article trains the model to
 * state a number its input does not contain — the exact `५०० कोटी → ४०० कोटी` failure the
 * tiling in `gemma-sources.ts` was built for. This goes through the ordinary intake stack, on
 * whatever `OCR_PROVIDER` names, so the student's source is read by the same backend an
 * officer's own review step would have used.
 *
 * Per-file best-effort, the `sourceContextForGeneration` stance: one unreadable document must
 * not discard a row whose other sources are fine. The warning travels into the sidecar.
 */
async function readDocumentSections(
  client: SupabaseClient,
  files: readonly DloIntakeFileEntry[],
  warnings: string[],
): Promise<DocumentSection[]> {
  const sections: DocumentSection[] = [];
  for (const file of readableDocuments(files)) {
    // Free first: a text-lane entry already carries its characters, and re-reading it would
    // pay Sarvam for text the intake is holding.
    const stored =
      file.text?.trim() ||
      (file.pages ?? [])
        .map((page) => page.text)
        .join('\n\n')
        .trim();
    if (stored) {
      sections.push({ name: file.name, origin: 'intake-text', text: stored });
      continue;
    }
    try {
      const data = await downloadFile(
        client,
        DLO_UPLOADS_BUCKET,
        file.storagePath!,
      );
      const text =
        file.kind === 'image'
          ? await extractImageTextViaProvider(file.name, data)
          : documentKindOf(file.name)
            ? (await extractDocument(file.name, data)).pages
                .map((page) => page.text)
                .join('\n\n')
            : '';
      if (!text.trim()) {
        warnings.push(
          `${file.name}: read as empty text; it contributes nothing.`,
        );
        continue;
      }
      sections.push({ name: file.name, origin: 'ocr', text });
    } catch (error) {
      warnings.push(
        `${file.name}: could not be read (${error instanceof Error ? error.message : String(error)}).`,
      );
    }
  }
  return sections;
}

/**
 * Uploads the native lane's documents for the TEACHER to read directly.
 *
 * The plan's decision, taken knowingly: the teacher sees the real PDF while the student is
 * trained on OCR'd text, so wherever the OCR misreads, the target states a fact the student's
 * input does not contain. The alternative — showing the teacher the same OCR text — was
 * considered and rejected, because the target is meant to be what production's best path
 * actually produces. The residual risk is why Phase 5's digit-fidelity gate exists, and why
 * the text lane is the default pool: it has no such gap at all.
 */
async function uploadTeacherFiles(
  client: SupabaseClient,
  files: readonly DloIntakeFileEntry[],
  warnings: string[],
): Promise<SourceFileRef[]> {
  const refs: SourceFileRef[] = [];
  for (const file of readableDocuments(files)) {
    try {
      const data = await downloadFile(
        client,
        DLO_UPLOADS_BUCKET,
        file.storagePath!,
      );
      const fileId = await uploadSourceFile(
        data,
        file.name,
        intakeFileMimeForFileName(file.name),
      );
      refs.push({
        fileId,
        kind: file.kind === 'image' ? 'image' : 'document',
        name: file.name,
      });
    } catch (error) {
      warnings.push(
        `${file.name}: could not be uploaded for the teacher (${
          error instanceof Error ? error.message : String(error)
        }).`,
      );
    }
  }
  return refs;
}

// ---------------------------------------------------------------------------
// Capture
// ---------------------------------------------------------------------------

export type CaptureOptions = Readonly<{
  out: string;
  reasoningEffort: 'none' | 'low' | 'medium' | 'high';
  minSourceChars: number;
}>;

export type CaptureOutcome = Readonly<{
  id: string;
  group: string;
  lane: Lane;
  status: 'captured' | 'skipped' | 'failed';
  reason?: string;
  sourceChars?: number;
  articleChars?: number;
  costUsd?: number;
}>;

/**
 * Captures one row: read the inputs, run the teacher, write the pair and its sidecar.
 *
 * Ordering is load-bearing. The pair is written BEFORE the sidecar because the pair holds the
 * thing that was paid for; a crash between them loses the record, not the article. Both use
 * `flag: 'wx'`, so a re-run can never overwrite a captured example with a differently-seeded
 * one.
 */
export async function captureOne(
  client: SupabaseClient,
  id: string,
  context: Readonly<{ lane: Lane; group: string; hasArticleRevision: boolean }>,
  options: CaptureOptions,
): Promise<CaptureOutcome> {
  const base = { id, group: context.group, lane: context.lane } as const;
  const row: GenerationRow | null = await getGeneration(client, id);
  if (!row) {
    return { ...base, status: 'failed', reason: 'generation not found' };
  }
  const intake: DloIntakeRow | null = row.dloIntakeId
    ? await getDloIntake(client, row.dloIntakeId)
    : null;

  const warnings: string[] = [];
  if (articleStyleReferencesEnabled()) {
    warnings.push(
      'ARTICLE_STYLE_REFERENCES_ENABLED is true in this environment, so production MAY ' +
        'retrieve exemplars. This capture passes none. Measured on the pool: of 77 ' +
        'dlo-rag-v2 rows, 75 received none and 2 received three — so the captured prompt ' +
        'is the one production sends in the overwhelming majority of runs, and the 2.6% ' +
        'tail is deliberately normalised away rather than learned as noise.',
    );
  }
  if (row.styleReference?.trim()) {
    warnings.push(
      'The officer pasted a style reference (migration 0035). It is dropped here, exactly as ' +
        'production drops it while style references are off — it reaches the prompt only ' +
        'through selectStyleReference.',
    );
  }

  const files = intake?.files ?? [];
  const native = context.lane === 'native' || context.lane === 'mixed';
  // Documents the student needs as characters. On the text lane these come back straight off
  // the intake entries and cost nothing; `generations.note` already contains them, so they are
  // read only to RECORD provenance and are not appended again below.
  const sections = native
    ? await readDocumentSections(client, files, warnings)
    : [];

  const studentSource = native
    ? appendDocumentSources(row.note, sections)
    : row.note;
  if (studentSource.trim().length < options.minSourceChars) {
    return {
      ...base,
      status: 'skipped',
      reason: `source is ${studentSource.trim().length} chars, under the ${options.minSourceChars} floor`,
      sourceChars: studentSource.trim().length,
    };
  }

  const designations = NameDesignationsSchema.parse(
    row.nameDesignations ?? [],
  ) as DesignationPair[];

  let teacherFiles: SourceFileRef[] = [];
  const accumulator: CostAccumulator = createCostAccumulator();
  try {
    if (native) {
      teacherFiles = await uploadTeacherFiles(client, files, warnings);
    }
    const prompts = buildCapturePrompts({
      studentSource,
      // On the native lane the documents ride as file parts, so the teacher's text carries the
      // note alone and the marker marks where they belong inside SOURCE INFORMATION.
      teacherSource: native ? row.note : studentSource,
      attachedFileCount: teacherFiles.length,
      designations,
      heading: row.heading,
      officerInstructions: row.instructions,
    });

    // Structural guards, before anything is billed. A teacher prompt that lost its marker
    // would put the officer's documents above the reviewed-name block instead of inside
    // SOURCE INFORMATION; one that carries two would be rejected by the transport after the
    // upload had already been paid for.
    const teacherUser = prompts.teacher.find((m) => m.role === 'user')!;
    const expected = teacherFiles.length > 0 ? 1 : 0;
    if (markerCount(teacherUser.content) !== expected) {
      throw new Error(
        `The teacher prompt carries ${markerCount(teacherUser.content)} source-file marker(s); ` +
          `${expected} was expected for ${teacherFiles.length} attached file(s).`,
      );
    }

    const raw = await runInCostScope(accumulator, () =>
      respondWithSources({
        label: `distillation teacher ${id.slice(0, 8)}`,
        messages: prompts.teacher,
        files: teacherFiles,
        model: ARTICLE_MODEL,
        maxOutputTokens: ARTICLE_BODY_MAX_TOKENS,
        reasoningEffort: options.reasoningEffort,
      }),
    );

    // THE TARGET IS THE RAW MODEL OUTPUT, and stopping here is the point. Production runs
    // applyDesignations, ensureArticleHeading and ensureArticleDateline over whatever the
    // model emits; the student's job is the MODEL's job, so training on post-processed text
    // would teach it to emit text those passes then re-apply — a designation inserted twice,
    // a dateline the deterministic pass then prefixes again.
    const { article, factCheck } = splitContent(raw.trim());
    if (factCheck !== null) {
      warnings.push(
        'The teacher emitted a fact-check appendix; the appendix half was discarded, as ' +
          'production discards it.',
      );
    }
    const pair = buildCapturePair(prompts.student, article);

    await mkdir(options.out, { recursive: true });
    const stem = resolve(options.out, id.toLowerCase());
    await writeFile(`${stem}.jsonl`, JSON.stringify(pair) + '\n', {
      encoding: 'utf8',
      flag: 'wx',
    });

    const costUsd = totalCostUsd(accumulator);
    const review = {
      formatVersion: CAPTURE_FORMAT_VERSION,
      capturedAt: new Date().toISOString(),
      // The ROW's own date, not the capture's. Phase 2 reports the dataset's date range from
      // it, and `--order newest` is only meaningful if the artifacts say which end they came
      // from. Additive: the first two sidecars predate it and Phase 2 reads it as unknown.
      rowCreatedAt: row.createdAt,
      generationId: row.id,
      dloIntakeId: row.dloIntakeId,
      threadRootId: row.threadRootId,
      sourceGenerationId: row.sourceGenerationId,
      groupKey: context.group,
      category: row.category,
      lane: context.lane,
      teacher: {
        model: ARTICLE_MODEL,
        reasoningEffort: options.reasoningEffort,
        maxOutputTokens: ARTICLE_BODY_MAX_TOKENS,
        transport: 'responses-with-sources',
        promptVersion: DLO_ARTICLE_PROMPT_VERSION,
        sawFiles: teacherFiles.map((file) => file.name),
      },
      studentPrompt: {
        promptVersion: DLO_ARTICLE_PROMPT_VERSION,
        attachedSourceFiles: false,
        sourceChars: studentSource.length,
        userChars: pair.messages[1]!.content.length,
      },
      styleReferences: {
        // Recorded so a later reader can tell a uniformly-empty dataset from one whose
        // exemplars simply failed to retrieve.
        passed: 0,
        deploymentFlag: articleStyleReferencesEnabled(),
        officerStyleReferenceChars: row.styleReference?.length ?? 0,
        note: 'No exemplars are ever retrieved by this harness; see the module header.',
      },
      officerInputs: {
        headingChars: row.heading?.length ?? 0,
        instructionsChars: row.instructions?.length ?? 0,
        designationCount: designations.length,
      },
      sourceProvenance: {
        noteChars: row.note.length,
        ocrProvider: native ? ocrProviderName() : null,
        imageOcrProvider: native ? imageOcrProviderName() : null,
        documents: sections.map((section) => ({
          name: section.name,
          origin: section.origin,
          chars: section.text.length,
        })),
        intakeFileCount: files.length,
        intakeUpdatedAt: intake?.updatedAt ?? null,
      },
      target: {
        articleChars: article.length,
        rawChars: raw.trim().length,
        postProcessing:
          'none — raw splitContent(raw).article, before applyDesignations / ' +
          'ensureArticleHeading / ensureArticleDateline',
      },
      usage: {
        chatCalls: accumulator.chatCalls,
        inputTokens: accumulator.inputTokens,
        cachedInputTokens: accumulator.cachedInputTokens,
        outputTokens: accumulator.outputTokens,
        costUsd,
        ocrPages: accumulator.ocrPages,
      },
      // The row's OWN saved article, recorded so a later decision to train on officer-edited
      // text can be made without a re-capture. It is NOT the target and is NOT an approval
      // signal — it is simply whatever model wrote it on the day, possibly edited afterwards.
      storedArticle: row.article,
      storedArticleChars: row.article?.length ?? 0,
      hasArticleRevision: context.hasArticleRevision,
      historicalStyleReferenceMeta: row.styleReferenceMeta,
      approvalStatus: 'needs-review',
      warnings,
    };
    await writeFile(
      `${stem}.review.json`,
      JSON.stringify(review, null, 2) + '\n',
      { encoding: 'utf8', flag: 'wx' },
    );

    return {
      ...base,
      status: 'captured',
      sourceChars: studentSource.length,
      articleChars: article.length,
      costUsd,
    };
  } finally {
    // Always, per the plan. These uploads exist only for this one call — unlike the intake's
    // own `openaiFileId`, which production must keep for retries and feedback rounds.
    for (const file of teacherFiles) await deleteSourceFile(file.fileId);
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

const USAGE = [
  'Usage: pnpm finetune:capture [--run] [--limit N] [--lane text|native|all]',
  '',
  'Phase 1 of the Gemma distillation plan: pair each officer-reviewed source with a freshly',
  'written teacher article. Resumable and idempotent — a row that already has a pair on disk',
  'is never re-billed.',
  '',
  'WITHOUT --run this is a DRY RUN: it lists the eligible rows and estimates the spend, calls',
  'no model and writes nothing.',
  '',
  '  --run                 actually call the teacher and write pairs',
  '  --limit N             capture at most N rows this batch',
  '  --lane L              text (default) | native | all',
  '  --days N              only rows newer than N days (default: all time)',
  '  --order O             newest (default) | oldest — which end a --limit batch takes',
  '  --all-rows            capture every row, not one per independent group',
  '  --effort E            teacher reasoning effort: none|low|medium|high (default high)',
  `  --min-source-chars N  skip a source shorter than this (default ${DEFAULT_MIN_SOURCE_CHARS})`,
  '  --max-intakes N       refuse above this many intakes (default 800)',
  '  --out <dir>           where pairs are written (default data/finetune/distill/pairs)',
  '  --check               run the offline assertions and exit — free, no database',
].join('\n');

export async function main(args = process.argv.slice(2)): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      run: { type: 'boolean' },
      limit: { type: 'string' },
      lane: { type: 'string' },
      days: { type: 'string' },
      'all-rows': { type: 'boolean' },
      order: { type: 'string' },
      effort: { type: 'string' },
      'min-source-chars': { type: 'string' },
      'max-intakes': { type: 'string' },
      out: { type: 'string' },
      check: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    console.log(USAGE);
    return;
  }
  if (values.check) {
    runChecks();
    return;
  }

  const lane = (values.lane ?? 'text') as CaptureLane;
  if (!['text', 'native', 'all'].includes(lane)) {
    throw new Error(`Unknown --lane "${lane}". Supported: text, native, all.`);
  }
  const order = (values.order ?? 'newest') as CaptureOrder;
  if (!['newest', 'oldest'].includes(order)) {
    throw new Error(`Unknown --order "${order}". Supported: newest, oldest.`);
  }
  const effort = (values.effort ?? 'high') as
    'none' | 'low' | 'medium' | 'high';
  if (!['none', 'low', 'medium', 'high'].includes(effort)) {
    throw new Error(`Unknown --effort "${effort}".`);
  }
  const limit = values.limit ? Number.parseInt(values.limit, 10) : Infinity;
  const minSourceChars = values['min-source-chars']
    ? Number.parseInt(values['min-source-chars'], 10)
    : DEFAULT_MIN_SOURCE_CHARS;
  const maxIntakes = values['max-intakes']
    ? Number.parseInt(values['max-intakes'], 10)
    : 800;
  const invocationDir = process.env.INIT_CWD ?? process.cwd();
  const out = values.out ? resolve(invocationDir, values.out) : DEFAULT_OUT;
  const since = values.days
    ? daysAgoIso(Number.parseInt(values.days, 10))
    : null;

  const client = createServiceRoleClient();

  // The SAME predicate the pool survey counts with, reused rather than re-expressed: a
  // capture that selected a different set from the one Phase 0.3 sized would make the group
  // count it decided on meaningless.
  const rows: SurveyGenerationRow[] = await fetchDloArticleRows(client, since);
  const intakeIds = [
    ...new Set(
      rows
        .map((row) => row.dlo_intake_id)
        .filter((id): id is string => id !== null),
    ),
  ];
  if (intakeIds.length > maxIntakes) {
    throw new Error(
      `${intakeIds.length} intakes are in range, above the --max-intakes ceiling of ${maxIntakes}.`,
    );
  }
  const [intakeFiles, revised] = await Promise.all([
    fetchIntakeFiles(client, intakeIds),
    fetchArticleRevisionIds(
      client,
      rows.map((row) => row.id),
    ),
  ]);

  const laneOf = new Map<string, Lane>();
  for (const row of rows) {
    laneOf.set(
      row.id,
      classifyLane(
        row.dlo_intake_id ? (intakeFiles.get(row.dlo_intake_id) ?? null) : null,
      ),
    );
  }
  const eligible = rows.filter((row) =>
    laneSelected(laneOf.get(row.id) ?? 'unknown', lane),
  );
  const representatives = pickGroupRepresentatives(eligible, {
    allRows: Boolean(values['all-rows']),
    order,
  });

  await mkdir(out, { recursive: true });
  const states = await Promise.all(
    representatives.map(async (row) => ({
      row,
      state: await existingCapture(resolve(out, row.id.toLowerCase())),
    })),
  );
  const partial = states.filter((entry) => entry.state === 'partial');
  const done = states.filter((entry) => entry.state === 'complete');
  const todo = states
    .filter((entry) => entry.state === 'none')
    .slice(0, Number.isFinite(limit) ? limit : undefined);

  const batchDates = todo
    .map((entry) => entry.row.created_at)
    .sort((a, b) => a.localeCompare(b));
  const estimate = estimateTeacherSpendUsd(todo.length);
  console.log('=== capture plan ===');
  console.log(`  lane selection:            ${lane}`);
  console.log(`  window:                    ${since ?? 'all time'}`);
  console.log(
    `  batch order:               ${order} first` +
      (Number.isFinite(limit)
        ? ''
        : '   (no --limit, so the whole pool is walked)'),
  );
  console.log(`  rows matching:             ${rows.length}`);
  console.log(`  rows in the lane:          ${eligible.length}`);
  console.log(
    `  independent groups:        ${representatives.length}` +
      (values['all-rows']
        ? '   (--all-rows: every row)'
        : '   (one row per group)'),
  );
  console.log(`  already captured:          ${done.length}`);
  console.log(`  to capture this batch:     ${todo.length}`);
  console.log(
    `  estimated teacher spend:   $${estimate.low.toFixed(2)} - $${estimate.high.toFixed(2)}` +
      `   (${ARTICLE_MODEL}, effort=${effort})`,
  );
  console.log(`  output directory:          ${out}`);
  if (batchDates.length > 0) {
    console.log(
      `  batch spans:               ${batchDates[0]!.slice(0, 10)} .. ` +
        `${batchDates[batchDates.length - 1]!.slice(0, 10)}`,
    );
  }
  if (partial.length > 0) {
    console.log('');
    console.log(
      `  ${partial.length} row(s) have exactly one of the two files. They are NOT re-billed.`,
    );
    console.log(
      '  Delete both files by hand to recapture, or keep the .jsonl and write the sidecar:',
    );
    for (const entry of partial.slice(0, 10)) {
      console.log(`    ${entry.row.id}`);
    }
  }
  if (articleStyleReferencesEnabled()) {
    console.log('');
    console.log(
      '  NOTE: ARTICLE_STYLE_REFERENCES_ENABLED is true, so production may retrieve',
    );
    console.log(
      '  exemplars. This harness never does. Measured: of 77 dlo-rag-v2 rows, 75 got none',
    );
    console.log(
      '  and 2 got three — the tail is normalised away. Every sidecar records this.',
    );
  }

  if (!values.run) {
    console.log('');
    console.log(
      'DRY RUN — no model was called and nothing was written. Re-run with --run to capture.',
    );
    return;
  }
  if (todo.length === 0) {
    console.log('');
    console.log('Nothing to capture.');
    return;
  }

  console.log('');
  console.log('=== capturing ===');
  let spent = 0;
  let captured = 0;
  let skipped = 0;
  let failed = 0;
  for (const [index, entry] of todo.entries()) {
    const row = entry.row;
    const position = `[${index + 1}/${todo.length}]`;
    try {
      const outcome = await captureOne(
        client,
        row.id,
        {
          lane: laneOf.get(row.id) ?? 'unknown',
          group: groupKeyOf(row),
          hasArticleRevision: revised.has(row.id),
        },
        { out, reasoningEffort: effort, minSourceChars },
      );
      if (outcome.status === 'captured') {
        captured += 1;
        spent += outcome.costUsd ?? 0;
        console.log(
          `${position} ${row.id.slice(0, 8)} ${outcome.lane.padEnd(11)} ` +
            `${outcome.sourceChars} chars -> ${outcome.articleChars} chars  ` +
            `$${(outcome.costUsd ?? 0).toFixed(4)}  (running $${spent.toFixed(2)})`,
        );
      } else {
        skipped += 1;
        console.log(
          `${position} ${row.id.slice(0, 8)} skipped: ${outcome.reason ?? 'no reason given'}`,
        );
      }
    } catch (error) {
      failed += 1;
      console.error(
        `${position} ${row.id.slice(0, 8)} FAILED: ` +
          (error instanceof Error ? error.message : String(error)),
      );
    }
  }

  console.log('');
  console.log('=== done ===');
  console.log(`  captured: ${captured}`);
  console.log(`  skipped:  ${skipped}`);
  console.log(`  failed:   ${failed}`);
  console.log(`  spent:    $${spent.toFixed(2)}`);
  console.log('');
  console.log(
    `  Re-run the same command to continue; captured rows are never re-billed.`,
  );
}

// ---------------------------------------------------------------------------
// Offline assertions — `--check`. Free: no database, no network, no spend.
//
// What they protect is the only thing about this harness that cannot be corrected after the
// fact: the CONTENT of a pair. A wrong split, a leaked marker or a drifted prompt is a
// re-capture at teacher prices.
// ---------------------------------------------------------------------------

export function runChecks(): void {
  const failures: string[] = [];
  const check = (ok: boolean, label: string): void => {
    if (!ok) failures.push(label);
  };

  // --- appendDocumentSources ---
  check(
    appendDocumentSources('टिपणी', []) === 'टिपणी',
    'a note with no documents was altered',
  );
  check(
    appendDocumentSources('  टिपणी  ', []) === 'टिपणी',
    'the note was not trimmed',
  );
  const appended = appendDocumentSources('टिपणी', [
    { name: 'gr.pdf', origin: 'ocr', text: 'मजकूर' },
  ]);
  check(
    appended === 'टिपणी\n\n=== स्रोत: gr.pdf ===\nमजकूर',
    `document section header is wrong: ${JSON.stringify(appended)}`,
  );
  check(
    !appendDocumentSources('टिपणी', [
      { name: 'blank.pdf', origin: 'ocr', text: '   ' },
    ]).includes('blank.pdf'),
    'an empty document still emitted its header',
  );
  check(
    appendDocumentSources('', [
      { name: 'a.pdf', origin: 'ocr', text: 'एक' },
    ]) === '=== स्रोत: a.pdf ===\nएक',
    'an empty note left a leading blank line',
  );
  check(
    !appendDocumentSources('टिपणी', []).includes('=== टिपणी ==='),
    'the note was re-wrapped in a source header it had already been through',
  );

  // --- buildCapturePrompts: the text lane ---
  const textLane = buildCapturePrompts({
    studentSource: 'स्रोत मजकूर',
    teacherSource: 'स्रोत मजकूर',
    attachedFileCount: 0,
    designations: [{ name: 'देवेंद्र फडणवीस', designation: 'मुख्यमंत्री' }],
    heading: 'शीर्षक',
    officerInstructions: 'सूचना',
  });
  check(
    JSON.stringify(textLane.teacher) === JSON.stringify(textLane.student),
    'teacher and student prompts differ on the text lane, where they must be identical',
  );
  const studentUser = textLane.student.find((m) => m.role === 'user')!.content;
  check(
    markerCount(studentUser) === 0,
    'the student prompt carries a source-file marker',
  );
  check(
    !studentUser.includes('\u0000'),
    'a NUL byte survived into the student prompt',
  );
  check(
    !studentUser.includes('MAHASAMVAD STYLE REFERENCES'),
    'a style-reference block reached the prompt; this harness must never emit one',
  );
  check(
    studentUser.includes('### SOURCE INFORMATION') &&
      studentUser.includes('स्रोत मजकूर'),
    'the source information block is missing',
  );
  check(
    studentUser.includes('### REVIEWED NAMES AND DESIGNATIONS') &&
      studentUser.includes('मुख्यमंत्री'),
    'the approved designations did not reach the prompt',
  );
  check(
    studentUser.includes('### HEADLINE / ANGLE') &&
      studentUser.includes('### OFFICER REQUEST'),
    "the officer's own inputs did not reach the prompt",
  );
  // Starts-with, and imported rather than written out: commit c97bbbb replaced the old
  // one-line system message with the five-rule editorial prompt and left this literal
  // asserting a string production no longer sends. Starts-with because a run under
  // EDITORIAL_PREFERENCE_PLACEMENT=system appends learned rules after the base five.
  check(
    (
      textLane.student.find((m) => m.role === 'system')?.content ?? ''
    ).startsWith(DGIPR_EDITORIAL_SYSTEM_PROMPT),
    "the system message does not open with the builder's own editorial rules",
  );

  // --- buildCapturePrompts: the native lane ---
  const nativeLane = buildCapturePrompts({
    studentSource: 'टिपणी\n\n=== स्रोत: gr.pdf ===\nमजकूर',
    teacherSource: 'टिपणी',
    attachedFileCount: 2,
    designations: [],
    heading: null,
    officerInstructions: null,
  });
  const nativeTeacher = nativeLane.teacher.find(
    (m) => m.role === 'user',
  )!.content;
  const nativeStudent = nativeLane.student.find(
    (m) => m.role === 'user',
  )!.content;
  check(
    markerCount(nativeTeacher) === 1,
    `the teacher prompt must carry exactly one marker, got ${markerCount(nativeTeacher)}`,
  );
  check(
    markerCount(nativeStudent) === 0,
    'the student prompt carries a marker even though it attaches nothing',
  );
  // The marker's POSITION is what puts the documents inside SOURCE INFORMATION rather than
  // above the reviewed-name block — the 0.1 bug, one layer up.
  check(
    nativeTeacher.indexOf(DLO_SOURCE_FILES_MARKER) >
      nativeTeacher.indexOf('### SOURCE INFORMATION'),
    'the marker is not inside SOURCE INFORMATION',
  );
  check(
    nativeStudent.includes('=== स्रोत: gr.pdf ==='),
    "the student's document text is missing from its source information",
  );
  check(
    !nativeLane.student.some((m) => m.content.includes('\u0000')),
    'a NUL byte survived into the native-lane student prompt',
  );

  // --- buildCapturePair ---
  const pair = buildCapturePair(textLane.student, '  लेख  ');
  check(pair.messages.length === 3, 'a pair must be exactly three turns');
  check(
    pair.messages[0]!.role === 'system' &&
      pair.messages[1]!.role === 'user' &&
      pair.messages[2]!.role === 'assistant',
    'the pair turns are in the wrong order or role',
  );
  check(
    pair.messages[2]!.content === 'लेख',
    'the article was not trimmed into the assistant turn',
  );
  check(
    pair.messages[0]!.content.startsWith(DGIPR_EDITORIAL_SYSTEM_PROMPT),
    "the pair did not carry the builder's system message",
  );
  let threw = false;
  try {
    buildCapturePair(textLane.student, '   ');
  } catch {
    threw = true;
  }
  check(threw, 'an empty article was accepted as a target');
  threw = false;
  try {
    buildCapturePair(
      [
        { role: 'system', content: 'S' },
        { role: 'user', content: `X${DLO_SOURCE_FILES_MARKER}Y` },
      ],
      'लेख',
    );
  } catch {
    threw = true;
  }
  check(threw, 'a student prompt carrying a marker was written to disk');

  // --- the raw-target rule ---
  // splitContent is what stops a traceability appendix being trained as part of the article.
  check(
    splitContent(`लेख\n\n${FACT_CHECK_DELIMITER}\nपरिशिष्ट`).article === 'लेख',
    'splitContent did not strip a fact-check appendix from the target',
  );

  // --- pickGroupRepresentatives ---
  const rows = [
    {
      id: 'a',
      created_at: '2026-01-01',
      dlo_intake_id: 'i1',
      thread_root_id: null,
    },
    {
      id: 'b',
      created_at: '2026-01-03',
      dlo_intake_id: 'i1',
      thread_root_id: null,
    },
    {
      id: 'c',
      created_at: '2026-01-02',
      dlo_intake_id: 'i2',
      thread_root_id: null,
    },
  ];
  const reps = pickGroupRepresentatives(rows);
  check(reps.length === 2, `expected 2 groups, got ${reps.length}`);
  check(
    reps.some((row) => row.id === 'b') && !reps.some((row) => row.id === 'a'),
    'the newest row in a group was not chosen as its representative',
  );
  check(
    pickGroupRepresentatives(rows, { allRows: true }).length === 3,
    '--all-rows did not keep every row',
  );
  // --- ordering: which end of the pool a --limit batch takes ---
  // `fetchDloArticleRows` returns ascending, so the default must REVERSE it or a limited
  // batch silently captures the oldest work in the pool. That is what the first real batch
  // did, and it is invisible in the output: the rows it picks are perfectly valid ones.
  check(
    pickGroupRepresentatives(rows)[0]!.id === 'b',
    'the default batch order is not newest-first',
  );
  check(
    pickGroupRepresentatives(rows, { order: 'oldest' })[0]!.id === 'c',
    'the oldest order did not start at the oldest group representative',
  );
  check(
    JSON.stringify(pickGroupRepresentatives(rows, { order: 'newest' })) ===
      JSON.stringify(
        [...pickGroupRepresentatives(rows, { order: 'oldest' })].reverse(),
      ),
    'the two orders are not reverses of each other, so a tie breaks differently in each',
  );
  check(
    pickGroupRepresentatives(rows, { allRows: true, order: 'newest' })[0]!
      .id === 'b',
    '--all-rows ignored the batch order',
  );
  check(
    JSON.stringify(pickGroupRepresentatives(rows, { order: 'newest' })) ===
      JSON.stringify(
        pickGroupRepresentatives([...rows].reverse(), { order: 'newest' }),
      ),
    'newest-first ordering is not deterministic under input order',
  );
  check(
    JSON.stringify(pickGroupRepresentatives(rows).map((r) => r.id)) ===
      JSON.stringify(
        pickGroupRepresentatives([...rows].reverse()).map((r) => r.id),
      ),
    'representative selection is not deterministic under input order',
  );
  // A row with no intake falls back to its thread root, then to its own id — never silently
  // collapsing two unrelated rows into one group.
  check(
    pickGroupRepresentatives([
      {
        id: 'x',
        created_at: '2026-01-01',
        dlo_intake_id: null,
        thread_root_id: 't',
      },
      {
        id: 'y',
        created_at: '2026-01-02',
        dlo_intake_id: null,
        thread_root_id: 't',
      },
      {
        id: 'z',
        created_at: '2026-01-02',
        dlo_intake_id: null,
        thread_root_id: null,
      },
    ]).length === 2,
    'thread-root grouping is wrong',
  );

  // --- laneSelected ---
  check(laneSelected('text', 'text'), 'the text lane excludes a text row');
  check(
    laneSelected('notes-only', 'text'),
    'the text lane excludes a notes-only row, which carries all its source as characters',
  );
  check(
    !laneSelected('native', 'text'),
    'the text lane admitted a native row, which would need OCR spend',
  );
  check(
    !laneSelected('mixed', 'text'),
    'the text lane admitted a mixed row, whose native half needs OCR',
  );
  check(
    laneSelected('native', 'native'),
    'the native lane excludes a native row',
  );
  check(
    laneSelected('mixed', 'native'),
    'the native lane excludes a mixed row',
  );
  check(laneSelected('text', 'all'), 'the all lane excludes a text row');
  check(
    !laneSelected('unknown', 'all'),
    'an unclassifiable row was admitted; its source cannot be located',
  );

  // --- estimateTeacherSpendUsd ---
  check(
    estimateTeacherSpendUsd(0).high === 0,
    'an empty batch estimated a non-zero spend',
  );
  check(
    estimateTeacherSpendUsd(10).low < estimateTeacherSpendUsd(10).high,
    'the spend estimate is not a band',
  );

  if (failures.length > 0) {
    console.error(`\n${failures.length} FAILURE(S):`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exitCode = 1;
  } else {
    console.log('All capture-dlo-distillation assertions passed.');
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Capture failed.');
    process.exitCode = 1;
  });
}
