// Which uploaded sources an article run should read for itself.
//
// The new /dlo lane (/new-dlo) does not transcribe a document before writing the article —
// the file goes to the article call as an `input_file` part. Those uploads live on the
// INTAKE row, not on the generation, and that is deliberate rather than an omission: a
// generation already carries `dlo_intake_id` (migration 0018), so the ids are reachable with
// no new column and NO MIGRATION, and they stay reachable for every later run from the same
// intake — a retry, a second article, a poster attached afterwards.
//
// Everything here is best-effort. A run whose intake cannot be read, or whose sources were
// uploaded the old way, simply returns no files and the caller writes the article from
// `row.note` exactly as it always has. That is the correct degradation: the old lane is not
// broken, it is just the other lane.

import { getDloIntake, type SupabaseClient } from '@dgipr/database';
import { parseDloReviewState } from '@dgipr/schemas';
import type { SourceFileRef } from '@dgipr/content-engine';

/**
 * What an article run can read of its intake: the files the model opens for itself, and the
 * verbatim name-bearing sentences the name step already read out of them.
 *
 * The digest is here rather than in a second lookup because both come off the same row, and
 * a generation job that fetched the intake twice for two fields of it would be paying for
 * the same read twice.
 */
export type GenerationSourceContext = Readonly<{
  files: SourceFileRef[];
  // '' when the name step has not run, when the intake predates it, or on a database without
  // 0036. The caller then builds its dictionary from the note alone, exactly as before.
  nameContext: string;
}>;

/**
 * The OpenAI file handles attached to this generation's intake, in upload order.
 *
 * Empty for every non-DLO run, every old-lane DLO run, and any intake whose uploads failed —
 * so a caller can treat a non-empty result as "this run reads its own sources" without
 * knowing anything about which lane created it.
 */
export async function sourceFilesForGeneration(
  client: SupabaseClient,
  row: Readonly<{ dloIntakeId?: string | null }>,
): Promise<SourceFileRef[]> {
  return (await sourceContextForGeneration(client, row)).files;
}

/**
 * The same lookup, plus the stored name digest — what the article job wants.
 *
 * THE DIGEST IS WHY THIS EXISTS. On the file lane a document is never transcribed, so the
 * generation's own `note` holds the typed context and the audio transcripts and nothing
 * else. Scanning that for verified glossary rows finds none of the names, places,
 * organisations or scheme names that occur inside an attached PDF, and the article was being
 * written with an empty NAME DICTIONARY as a result. The name step's digest is the only text
 * this lane produces about its documents, so it is what the dictionary must be built from.
 */
export async function sourceContextForGeneration(
  client: SupabaseClient,
  row: Readonly<{ dloIntakeId?: string | null }>,
): Promise<GenerationSourceContext> {
  const intakeId = row.dloIntakeId;
  if (!intakeId) return { files: [], nameContext: '' };
  try {
    const intake = await getDloIntake(client, intakeId);
    if (!intake) return { files: [], nameContext: '' };
    const files = intake.files.flatMap((file): SourceFileRef[] =>
      file.openaiFileId && file.status === 'done'
        ? [
            {
              fileId: file.openaiFileId,
              // A photograph becomes an `input_image` part and everything else an
              // `input_file` one. Decided here, from the kind the intake already stores,
              // rather than re-derived from the file name downstream.
              kind: file.kind === 'image' ? 'image' : 'document',
              name: file.name,
            },
          ]
        : [],
    );
    return {
      files,
      nameContext:
        parseDloReviewState(intake.reviewState)?.nameContext?.trim() ?? '',
    };
  } catch (error) {
    console.warn(
      `[source-files] could not read intake ${intakeId}; writing from text alone:`,
      error,
    );
    return { files: [], nameContext: '' };
  }
}
