// Live traces for jobs on a `generations` row: every creative lane (poster, caption, carousel,
// Dynamic Poster, YouTube thumbnail, article poster), the /dlo article, and every follow-up on
// those rows (feedback rounds, redos, recolours, marker and exact-text edits, caption edits,
// translations, retries).
//
// The row is described with the SAME builders the reconstructed traces use
// (evals/reconstruct/generation-common.ts), so a Track A and a Track B trace of one run carry the
// same input/output keys and one Braintrust view can filter both by `metadata.feature`.
//
// Everything here is best-effort and off the job's critical path: openGenerationTrace is
// synchronous and reads nothing, and the media (attached pictures, source files, the finished
// poster) is resolved into Attachments in the background. finishGenerationTrace is meant to be
// called WITHOUT await.

import {
  getDloIntake,
  getGeneration,
  DLO_UPLOADS_BUCKET,
  type GenerationRow,
  type SupabaseClient,
} from '@dgipr/database';
import {
  creativeLane,
  generationInput,
  generationMetadata,
  generationOutput,
} from '../evals/reconstruct/generation-common.js';
import { resolveMediaRefs } from '../evals/braintrust-upload.js';
import { compact, storageMedia } from '../evals/trace.js';
import { jobTracingEnabled, openJobTrace, type JobTrace } from './job-trace.js';

const MAX_ATTACHMENT_BYTES = Number(
  process.env.BRAINTRUST_TRACE_MAX_ATTACHMENT_BYTES ?? 25 * 1024 * 1024,
);

// The jobs that CREATE a row's first output. Every other task on a generation is a follow-up.
const CREATION_TASKS = new Set([
  'article_generation',
  'social_post_creation',
  'youtube_thumbnail_creation',
  'carousel_creation',
  'dynamic_poster_creation',
]);

// A creation job starts seconds after its row is inserted. A retry of a failed creation runs
// the same task on the same row later; it must get its own trace rather than overwrite the
// original's root, so "original" is: a creation task, on a young row, not yet traced in this
// process.
const ORIGINAL_MAX_AGE_MS = 2 * 60 * 1000;
const originalsOpened = new Set<string>();

export function generationFeature(
  row: Pick<GenerationRow, 'dloIntakeId'>,
  task: string,
): string {
  if (task.endsWith('_translation')) return 'translate';
  return row.dloIntakeId ? 'dlo' : 'creative';
}

// The settings that change how a run behaves, read where the runner reads them. Recorded so a
// failure can be attributed to a configuration rather than to a memory of what was set that day.
function behaviourSettings(): Record<string, unknown> {
  return compact({
    ARTICLE_GENERATION_MODE: process.env.ARTICLE_GENERATION_MODE ?? 'simple',
    ARTICLE_PROVIDER: process.env.ARTICLE_PROVIDER ?? 'openai',
    ARTICLE_POSTER_MODE: process.env.ARTICLE_POSTER_MODE ?? 'fresh',
    SOCIAL_REFERENCE_MODE: process.env.SOCIAL_REFERENCE_MODE ?? 'information',
    ARTICLE_PROMPT_VARIANT: process.env.ARTICLE_PROMPT_VARIANT,
    ARTICLE_STYLE_REFERENCES_ENABLED:
      process.env.ARTICLE_STYLE_REFERENCES_ENABLED,
    SOCIAL_POSTER_DESIGN_DIRECTION: process.env.SOCIAL_POSTER_DESIGN_DIRECTION,
    OPENAI_IMAGE_QUALITY: process.env.OPENAI_IMAGE_QUALITY,
  });
}

// The /dlo intake's own sources (uploaded recordings, documents, photographs, links) — what the
// officer actually supplied, beside the reviewed note the article was written from.
async function dloSources(
  client: SupabaseClient,
  intakeId: string,
): Promise<unknown> {
  const intake = await getDloIntake(client, intakeId);
  if (!intake) return null;
  return intake.files.map((file) =>
    compact({
      name: file.name,
      kind: file.kind,
      status: file.status,
      error: file.error,
      sourceUrl: (file as { sourceUrl?: string }).sourceUrl,
      file:
        file.kind !== 'youtube' && file.storagePath
          ? storageMedia(DLO_UPLOADS_BUCKET, file.storagePath, {
              filename: file.name,
            })
          : null,
    }),
  );
}

export type GenerationTrace = Readonly<{
  trace: JobTrace;
  // Resolves when the background input (with attachments) has been logged.
  inputReady: Promise<void>;
}>;

const NOOP: GenerationTrace = {
  trace: {
    rootSpanId: '',
    run: (fn) => fn(),
    setInput: () => undefined,
    annotate: () => undefined,
    finish: () => undefined,
  },
  inputReady: Promise.resolve(),
};

// Open the trace for one job on a generation row. `row` is the row as the job found it; when it
// is not to hand, pass null and only the ids are recorded up front.
export function openGenerationTrace(
  client: SupabaseClient,
  id: string,
  task: string,
  row: GenerationRow | null,
): GenerationTrace {
  if (!jobTracingEnabled()) return NOOP;
  try {
    const young =
      row !== null &&
      Date.now() - Date.parse(row.createdAt) < ORIGINAL_MAX_AGE_MS;
    const original =
      CREATION_TASKS.has(task) && young && !originalsOpened.has(id);
    if (original) originalsOpened.add(id);
    const input = row ? generationInput(row) : {};
    const trace = openJobTrace({
      feature: row ? generationFeature(row, task) : 'creative',
      task,
      rowKind: 'generation',
      rowId: id,
      original,
      name: `${row ? generationFeature(row, task) : 'generation'}: ${task}`,
      input,
      metadata: compact({
        generationId: id,
        lane: row && !row.dloIntakeId ? creativeLane(row) : null,
        category: row?.category,
        threadRootId: row?.threadRootId,
        sourceGenerationId: row?.sourceGenerationId,
        dloIntakeId: row?.dloIntakeId,
        settings: behaviourSettings(),
      }),
    });
    // Pictures and source files become Attachments off the critical path.
    const inputReady = (async () => {
      try {
        const full: Record<string, unknown> = { ...input };
        if (row?.dloIntakeId) {
          full.dloSources = await dloSources(client, row.dloIntakeId);
        }
        trace.setInput(
          (await resolveMediaRefs(
            full,
            client,
            MAX_ATTACHMENT_BYTES,
          )) as Record<string, unknown>,
        );
      } catch (error) {
        console.warn('[trace] could not attach the job input:', error);
      }
    })();
    return { trace, inputReady };
  } catch (error) {
    console.warn('[trace] could not open a generation trace:', error);
    return NOOP;
  }
}

// Log the final artifact and close the trace. Call WITHOUT await: it re-reads the row and
// downloads the poster for the attachment, none of which the job should wait for. Never throws.
export async function finishGenerationTrace(
  client: SupabaseClient,
  id: string,
  handle: GenerationTrace,
  result: Readonly<{
    error?: unknown;
    // Warnings the officer was shown (length, numeral, designation, capacity, …) and anything
    // else the runner holds in memory only.
    metadata?: Readonly<Record<string, unknown>>;
  }>,
): Promise<void> {
  if (handle === NOOP) return;
  try {
    await handle.inputReady;
    const row = await getGeneration(client, id);
    const output = row
      ? ((await resolveMediaRefs(
          generationOutput(row),
          client,
          MAX_ATTACHMENT_BYTES,
        )) as Record<string, unknown>)
      : {};
    handle.trace.finish({
      output,
      metadata: {
        ...(row ? generationMetadata(row) : {}),
        ...(result.metadata ?? {}),
      },
      ...(result.error !== undefined ? { error: result.error } : {}),
    });
  } catch (error) {
    console.warn('[trace] could not finish a generation trace:', error);
    handle.trace.finish({
      ...(result.error !== undefined ? { error: result.error } : {}),
    });
  }
}
