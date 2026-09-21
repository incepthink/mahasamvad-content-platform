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

import {
  DLO_UPLOADS_BUCKET,
  downloadFile,
  getDloIntake,
  type SupabaseClient,
} from '@dgipr/database';
import { parseDloReviewState } from '@dgipr/schemas';
import {
  articleProvider,
  type SourceDocument,
  type SourceFileRef,
} from '@dgipr/content-engine';

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
  // The SAME sources as bytes, for a provider that has no file store to reference them in.
  // Populated ONLY when ARTICLE_PROVIDER names such a provider — downloading a meeting's
  // worth of scans on every run to hand them to OpenAI, which already holds them, would be
  // pure waste. Empty on the OpenAI lane, always.
  documents: SourceDocument[];
  // '' when the name step has not run, when the intake predates it, or on a database without
  // 0036. The caller then builds its dictionary from the note alone, exactly as before.
  nameContext: string;
}>;

/** Which intake file kinds are documents a vision model can be handed. Audio is transcribed. */
function documentKind(kind: string): SourceDocument['kind'] | null {
  switch (kind) {
    case 'pdf':
    case 'image':
    case 'docx':
    case 'txt':
      return kind;
    default:
      return null;
  }
}

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
  const empty: GenerationSourceContext = {
    files: [],
    documents: [],
    nameContext: '',
  };
  if (!intakeId) return empty;
  try {
    const intake = await getDloIntake(client, intakeId);
    if (!intake) return empty;
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
    // Bytes, for a provider that cannot be handed a file id. Downloaded from the PRIVATE
    // bucket the create route archived every upload to before it ever reached OpenAI, which
    // is what makes this possible with no new column and no second upload from the browser.
    //
    // Best-effort PER FILE, deliberately: one unreadable object must not sink an article
    // whose other sources are fine. The officer sees the article and the sources it names;
    // a source that contributed nothing is a warning in the log, not a failed run.
    const documents: SourceDocument[] = [];
    if (articleProvider() === 'gemma') {
      for (const file of intake.files) {
        const kind = documentKind(file.kind);
        if (!kind || file.status !== 'done' || !file.storagePath) continue;
        try {
          documents.push({
            name: file.name,
            kind,
            data: await downloadFile(
              client,
              DLO_UPLOADS_BUCKET,
              file.storagePath,
            ),
          });
        } catch (error) {
          console.warn(
            `[source-files] could not read ${file.name} from storage; the article will ` +
              'be written without it:',
            error,
          );
        }
      }
    }

    return {
      files,
      documents,
      nameContext:
        parseDloReviewState(intake.reviewState)?.nameContext?.trim() ?? '',
    };
  } catch (error) {
    console.warn(
      `[source-files] could not read intake ${intakeId}; writing from text alone:`,
      error,
    );
    return empty;
  }
}
