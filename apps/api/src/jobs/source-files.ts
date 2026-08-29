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
import type { SourceFileRef } from '@dgipr/content-engine';

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
  const intakeId = row.dloIntakeId;
  if (!intakeId) return [];
  try {
    const intake = await getDloIntake(client, intakeId);
    if (!intake) return [];
    return intake.files.flatMap((file): SourceFileRef[] =>
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
  } catch (error) {
    console.warn(
      `[source-files] could not read intake ${intakeId}; writing from text alone:`,
      error,
    );
    return [];
  }
}
