// The new /dlo lane: upload → confirm the names → generate. Three routes, and each one is
// thin because the redesign removed the step that used to sit between them.
//
// The old lane's shape was upload → PROCESS (minutes: probe each PDF, ask which pages are
// worth OCR'ing, read them one model call per page) → review every page of transcribed text →
// generate. This lane has no processing stage for documents at all. A PDF, DOCX, TXT or
// photograph is uploaded to OpenAI the moment it is attached, and the article call reads it
// for itself (see intake/openai-source-files.ts and generate-article-from-sources.ts).
//
// WHAT IT REUSES, DELIBERATELY, rather than forking:
//   - the `dlo_intakes` row, its private archive bucket and its list/resume UI. An intake is
//     still the unit of work, so /dlo's work list, `dlo_intake_id` lineage and the analytics
//     lane split all keep working with no new table and no migration.
//   - `startDloIntakeJob`, unchanged. RECORDINGS still need transcribing, and that phase —
//     with its content-addressed cache (0031), its per-file failure handling and its cost
//     metering — is 120 lines nobody should own twice. Documents are stored `status: 'done'`
//     up front, and that job already skips a done entry, so it transcribes the audio and
//     leaves the files alone. An intake with no recordings simply passes straight through.
//   - `prepareDesignations`, unchanged. Step 2 gets it a text digest to scan (see
//     extract-name-context.ts) so the entire glossary/surname/पदनाम machinery, the review card
//     and the "यापुढेही हेच वापरा" write-back are the same code on both lanes.
//   - `startGenerationJob`, unchanged. The generation row is an ordinary one, so history,
//     posters, translation, the PDF export and feedback all work on a new-lane article.
//
// So what is genuinely new here is: uploading to OpenAI at attach time, and not asking the
// officer anything about pages.

import type { FastifyInstance } from 'fastify';
import {
  getDloIntake,
  insertDloIntake,
  insertGeneration,
  updateDloIntake,
  uploadFile,
  type DloIntakeFileEntry,
  type DloIntakeFileKind,
  type SupabaseClient,
} from '@dgipr/database';
import {
  audioMimeForFileName,
  imageMimeForFileName,
  AUDIO_FILE_EXTENSIONS,
  IMAGE_FILE_EXTENSIONS,
  DloCategorySchema,
  NewDloGenerateRequestSchema,
} from '@dgipr/schemas';
import {
  createCostAccumulator,
  deleteSourceFile,
  extractNameContextFromSources,
  runInCostScope,
  runInCostTask,
  uploadSourceFile,
  type SourceFileRef,
} from '@dgipr/content-engine';
import { startDloIntakeJob } from '../jobs/dlo-runner.js';
import { startGenerationJob } from '../jobs/runner.js';
import { rememberDesignations } from '../jobs/designation-writeback.js';
import { prepareDesignations } from '../jobs/translation-terms.js';
import { recordTasksFromCost } from '../jobs/service-usage.js';
import { sourceFilesForGeneration } from '../jobs/source-files.js';

const DLO_UPLOADS_BUCKET = 'dlo-uploads';

// No ceiling, exactly as the old lane has none. A two-hour recording and a photographed
// booklet both pass any round number, and refusing one at the door is the failure an officer
// can do nothing about. OpenAI's own 50 MB per-file limit is enforced where it applies —
// on the upload to OpenAI below, whose refusal fails that one file and not the intake.
const MAX_FILE_BYTES = Number.POSITIVE_INFINITY;
const MAX_FILES = Number.POSITIVE_INFINITY;
const MAX_FIELD_BYTES = 64 * 1024 * 1024;

type UploadedFileKind = Exclude<DloIntakeFileKind, 'youtube'>;

const KIND_BY_EXTENSION: Record<string, UploadedFileKind> = {
  ...Object.fromEntries(
    AUDIO_FILE_EXTENSIONS.map((ext) => [ext, 'audio' as const]),
  ),
  ...Object.fromEntries(
    IMAGE_FILE_EXTENSIONS.map((ext) => [ext, 'image' as const]),
  ),
  '.pdf': 'pdf',
  '.docx': 'docx',
  '.txt': 'txt',
};

const CONTENT_TYPE_BY_KIND: Record<UploadedFileKind, string> = {
  audio: 'audio/mpeg',
  image: 'image/jpeg',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain',
};

function kindOf(fileName: string): UploadedFileKind | null {
  const dot = fileName.lastIndexOf('.');
  if (dot === -1) return null;
  return KIND_BY_EXTENSION[fileName.slice(dot).toLowerCase()] ?? null;
}

// A recording is transcribed by the intake job; everything else is read by the article model
// itself. This is the one classification the whole lane turns on.
function isReadByModel(kind: UploadedFileKind): boolean {
  return kind !== 'audio';
}

function storagePathFor(intakeId: string, index: number, name: string): string {
  const safe = name.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `intakes/${intakeId}/${index}-${safe || 'file'}`;
}

function contentTypeFor(name: string, kind: UploadedFileKind): string {
  return (
    audioMimeForFileName(name) ??
    imageMimeForFileName(name) ??
    CONTENT_TYPE_BY_KIND[kind] ??
    'application/octet-stream'
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function registerNewDloRoutes(
  app: FastifyInstance,
  client: SupabaseClient,
): void {
  // ---------- step 1: upload ----------
  //
  // Two destinations per file, and both matter. The PRIVATE bucket is the archive — it is
  // what makes a re-read possible and what keeps the officer's source recoverable — and
  // OpenAI is what the article call reads. A file that reaches the bucket but not OpenAI is
  // stored `failed` with its reason: the source is safe, but nothing will read it, and
  // saying so now beats an article that silently omits a whole document.
  app.post('/new-dlo/intakes', async (request, reply) => {
    const uploads: Array<{
      name: string;
      kind: UploadedFileKind;
      data: Buffer;
    }> = [];
    let notes = '';
    let category = 'news';
    let heading = '';

    const parts = request.parts({
      limits: {
        fileSize: MAX_FILE_BYTES,
        fieldSize: MAX_FIELD_BYTES,
        files: MAX_FILES,
      },
    });
    for await (const part of parts) {
      if (part.type === 'field') {
        const value = typeof part.value === 'string' ? part.value : '';
        if (part.fieldname === 'notes') notes = value;
        if (part.fieldname === 'category') category = value;
        if (part.fieldname === 'heading') heading = value;
        continue;
      }
      const kind = kindOf(part.filename ?? '');
      if (!kind) {
        return reply.code(400).send({
          error: {
            message:
              'फक्त ध्वनिमुद्रण (MP3, AAC, M4A), प्रतिमा (JPG, PNG, WEBP), PDF, DOCX आणि TXT फाईल्स स्वीकारल्या जातात.',
          },
        });
      }
      uploads.push({
        name: part.filename ?? 'file',
        kind,
        data: await part.toBuffer(),
      });
    }

    const parsedCategory = DloCategorySchema.safeParse(category);
    if (!parsedCategory.success) {
      return reply.code(400).send({ error: { message: 'Unknown category.' } });
    }
    if (notes.trim().length === 0 && uploads.length === 0) {
      return reply.code(400).send({
        error: { message: 'टिपणी लिहा किंवा किमान एक फाईल जोडा.' },
      });
    }

    // Insert first — the storage paths need the row id — then archive, then upload to
    // OpenAI, then attach the entries and start the job, which reads everything off the row.
    const row = await insertDloIntake(client, {
      notes: notes.trim(),
      category: parsedCategory.data,
      heading: heading.trim() || undefined,
      files: [],
    });

    const entries: DloIntakeFileEntry[] = [];
    for (const [index, upload] of uploads.entries()) {
      const storagePath = storagePathFor(row.id, index, upload.name);
      await uploadFile(
        client,
        DLO_UPLOADS_BUCKET,
        storagePath,
        upload.data,
        contentTypeFor(upload.name, upload.kind),
      );

      if (!isReadByModel(upload.kind)) {
        // A recording. It waits `pending` for the intake job's transcribe phase, exactly as
        // it does on the old lane — nothing about audio changed.
        entries.push({
          name: upload.name,
          storagePath,
          kind: upload.kind,
          status: 'pending',
        });
        continue;
      }

      try {
        const fileId = await uploadSourceFile(
          upload.data,
          upload.name,
          contentTypeFor(upload.name, upload.kind),
        );
        // 'done' with no text, which is the shape this lane rests on: the intake job skips a
        // done entry, so the file is never probed, never OCR'd and never asked about.
        entries.push({
          name: upload.name,
          storagePath,
          kind: upload.kind,
          status: 'done',
          openaiFileId: fileId,
        });
      } catch (error) {
        entries.push({
          name: upload.name,
          storagePath,
          kind: upload.kind,
          status: 'failed',
          error: `ही फाईल वाचनासाठी पाठवता आली नाही: ${errorMessage(error)}`,
        });
      }
    }

    await updateDloIntake(client, row.id, { files: entries });
    startDloIntakeJob(client, row.id);
    return reply.code(202).send({ id: row.id });
  });

  // ---------- step 2: which people do the sources name? ----------
  //
  // One model call over the attached files produces a digest of the sentences that name
  // people, and `prepareDesignations` — the same function the old lane uses — does everything
  // after that. So the review card, the glossary matching, the surname resolution and the
  // dictionary write-back are shared code, not a second implementation.
  app.post<{ Params: { id: string } }>(
    '/new-dlo/intakes/:id/names',
    async (request, reply) => {
      const row = await getDloIntake(client, request.params.id);
      if (!row) {
        return reply
          .code(404)
          .send({ error: { message: 'Intake not found.' } });
      }
      // Recordings may still be transcribing, and a name that occurs only in a transcript
      // would be missed. Better to say "not yet" than to show a list that is quietly short.
      if (row.status !== 'ready') {
        return reply.code(409).send({
          error: { message: 'फाईल्सवर अजून प्रक्रिया सुरू आहे. थोडे थांबा.' },
        });
      }

      const files = await sourceFilesForGeneration(client, {
        dloIntakeId: row.id,
      });
      const cost = createCostAccumulator();
      const digest = await runInCostScope(cost, () =>
        runInCostTask('designation_extraction', () =>
          extractNameContextFromSources(row.combinedText ?? '', files),
        ),
      );
      const result = await runInCostScope(cost, () =>
        runInCostTask('designation_extraction', () =>
          prepareDesignations(client, digest),
        ),
      );
      recordTasksFromCost(client, 'article', cost);
      return result;
    },
  );

  // ---------- step 3: write the article ----------
  //
  // The note is taken off the ROW, never from the request. On the old lane the client sends
  // an assembled `combinedText` because the officer edited every page of it; here there is
  // nothing to edit, so letting the browser supply the source of a government article would
  // be a capability with no purpose.
  app.post<{ Params: { id: string } }>(
    '/new-dlo/intakes/:id/generate',
    async (request, reply) => {
      const body = NewDloGenerateRequestSchema.parse(request.body ?? {});
      const row = await getDloIntake(client, request.params.id);
      if (!row) {
        return reply
          .code(404)
          .send({ error: { message: 'Intake not found.' } });
      }
      if (row.status !== 'ready') {
        return reply.code(409).send({
          error: { message: 'फाईल्सवर अजून प्रक्रिया सुरू आहे. थोडे थांबा.' },
        });
      }

      const files = await sourceFilesForGeneration(client, {
        dloIntakeId: row.id,
      });
      const note = (row.combinedText ?? '').trim();
      // Nothing to write from: no readable file reached OpenAI AND nothing was typed or
      // transcribed. Refused here rather than left to the model, which would otherwise be
      // asked to write a government article out of an empty source.
      if (files.length === 0 && note.length === 0) {
        return reply.code(400).send({
          error: {
            message:
              'या कामात वाचता येईल असा कोणताही स्रोत नाही. फाईल पुन्हा जोडा किंवा टिपणी लिहा.',
          },
        });
      }

      // Saved BEFORE the insert, so the dictionary is right even if the generation later
      // fails. Best-effort inside — the pairs travel on the row regardless.
      await rememberDesignations(client, body.designations ?? []);

      const generation = await insertGeneration(client, {
        // May be short, or empty where every source is a file. The article call reads the
        // documents themselves; this is the typed context and any transcripts.
        note,
        outputType: 'article',
        category: body.category ?? row.category,
        heading: body.heading,
        dloIntakeId: row.id,
        nameDesignations: (body.designations ?? []).map((pair) => ({
          name: pair.name,
          designation: pair.designation,
        })),
        styleReference: body.styleReference,
        instructions: body.instructions,
      });
      // The ordinary article runner. It finds this run's files through `dlo_intake_id` and
      // calls generateArticleFromSources instead of generateArticleSimple — the only
      // difference between the two lanes past this point.
      startGenerationJob(client, generation.id);
      return reply.code(202).send({ generationId: generation.id });
    },
  );

  // ---------- removing a source before generating ----------
  //
  // Deletes the OpenAI upload as well as the entry. This is the one place a source file is
  // deliberately deleted: everywhere else the upload must survive, because a retry or a
  // second article from the same intake still needs something to read.
  app.delete<{ Params: { id: string; index: string } }>(
    '/new-dlo/intakes/:id/files/:index',
    async (request, reply) => {
      const row = await getDloIntake(client, request.params.id);
      if (!row) {
        return reply
          .code(404)
          .send({ error: { message: 'Intake not found.' } });
      }
      const index = Number.parseInt(request.params.index, 10);
      const entry = row.files[index];
      if (!Number.isInteger(index) || !entry) {
        return reply.code(404).send({ error: { message: 'File not found.' } });
      }
      if (entry.openaiFileId) await deleteSourceFile(entry.openaiFileId);
      const files = row.files.filter((_, position) => position !== index);
      await updateDloIntake(client, row.id, { files });
      return reply.code(204).send();
    },
  );
}

export type { SourceFileRef };
