// Standalone transcription API routes. Thin handlers only (per AGENTS.md): parse the
// multipart upload, archive the recordings, persist the row, and hand the Sarvam work to
// jobs/transcription-runner.
//
// Unlike /dlo this path ends at the transcript — there is no review contract and no
// generation lineage, so there are exactly three routes: create, list, detail.

import type { FastifyInstance } from 'fastify';
import {
  DLO_UPLOADS_BUCKET,
  getTranscription,
  insertTranscription,
  listTranscriptions,
  updateTranscription,
  uploadFile,
  type SupabaseClient,
  type TranscriptionFileEntry,
  type TranscriptionRow,
  type TranscriptionSummaryRow,
} from '@dgipr/database';
import {
  audioMimeForFileName,
  isAudioFileName,
  TRANSCRIPTION_MAX_FILES,
  UPLOAD_FILE_MAX_BYTES,
  UPLOAD_FILE_MAX_MB,
  type TranscriptionDetail,
  type TranscriptionSummary,
} from '@dgipr/schemas';
import {
  isTranscriptionJobRunning,
  startTranscriptionJob,
} from '../jobs/transcription-runner.js';

// Meeting recordings are big, so this route overrides the conservative global multipart
// limits per request, exactly as /dlo/intakes does — and to the same shared ceiling, so one
// recording is accepted or refused identically whichever surface it was picked on. No
// `fieldSize` bump: this request carries no text fields.
const MAX_FILE_BYTES = UPLOAD_FILE_MAX_BYTES;

// Storage object names must be ASCII-safe; the index prefix keeps them unique (display
// names may collide and may be entirely Devanagari). The `transcriptions/` prefix is what
// keeps these runs' archives distinguishable from /dlo's inside the shared private bucket.
function storagePathFor(id: string, index: number, name: string): string {
  const safe = name.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `transcriptions/${id}/${index}-${safe || 'audio'}`;
}

// What the list card calls a run. Computed here rather than in the web so every surface
// names a run the same way (the intakeTitle precedent).
function transcriptionTitle(names: readonly string[]): string {
  if (names.length === 0) return 'विनाशीर्षक';
  if (names.length === 1) return names[0]!;
  return `${names[0]!} + ${(names.length - 1).toLocaleString('mr-IN')}`;
}

function toSummary(row: TranscriptionSummaryRow): TranscriptionSummary {
  return {
    id: row.id,
    status: row.status,
    error: row.error,
    title: row.title,
    fileCount: row.fileCount,
    failedCount: row.failedCount,
    charCount: row.charCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// `includeText` carries the transcripts. Opt-in because the result is needed exactly once
// while the 2.5 s progress poll behind it runs for minutes (the /dlo detail precedent).
function toDetail(
  row: TranscriptionRow,
  includeText: boolean,
): TranscriptionDetail {
  return {
    id: row.id,
    status: row.status,
    error: row.error,
    title: row.title,
    files: row.files.map((entry) => ({
      // storagePath is a server-side concern; the client sees name + progress.
      name: entry.name,
      status: entry.status,
      ...(entry.chars !== undefined ? { chars: entry.chars } : {}),
      ...(entry.error !== undefined ? { error: entry.error } : {}),
      ...(entry.cached !== undefined ? { cached: entry.cached } : {}),
      ...(includeText && entry.text !== undefined ? { text: entry.text } : {}),
    })),
    combinedText: includeText ? row.combinedText : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function registerTranscriptionRoutes(
  app: FastifyInstance,
  client: SupabaseClient,
): void {
  app.post('/transcriptions', async (request, reply) => {
    const uploads: Array<{ name: string; data: Buffer }> = [];

    const parts = request.parts({
      limits: { fileSize: MAX_FILE_BYTES, files: TRANSCRIPTION_MAX_FILES },
    });
    try {
      for await (const part of parts) {
        // This request carries recordings and nothing else; any stray field is ignored
        // rather than rejected, so adding one later cannot break an older client.
        if (part.type === 'field') continue;
        const name = part.filename ?? '';
        if (!isAudioFileName(name)) {
          return reply.code(400).send({
            error: {
              message:
                'फक्त ध्वनिमुद्रण (MP3, AAC, M4A) फाईल्स स्वीकारल्या जातात.',
            },
          });
        }
        uploads.push({ name, data: await part.toBuffer() });
      }
    } catch (error) {
      // @fastify/multipart raises FST_REQ_FILE_TOO_LARGE from toBuffer when a part exceeds
      // the per-request fileSize limit above.
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'FST_REQ_FILE_TOO_LARGE'
      ) {
        return reply.code(413).send({
          error: {
            message: `फाईल खूप मोठी आहे (कमाल ${UPLOAD_FILE_MAX_MB.toLocaleString('mr-IN')} MB प्रति फाईल).`,
          },
        });
      }
      throw error;
    }

    if (uploads.length === 0) {
      return reply.code(400).send({
        error: { message: 'किमान एक ध्वनिमुद्रण जोडा.' },
      });
    }

    // Insert first (the storage paths need the row id), then archive the originals to the
    // private bucket, then attach the per-file entries and start the job — the job reads
    // everything back off the row, so a restart between the two loses nothing silently.
    const row = await insertTranscription(client, {
      title: transcriptionTitle(uploads.map((upload) => upload.name)),
      files: [],
    });
    const entries: TranscriptionFileEntry[] = [];
    for (const [index, upload] of uploads.entries()) {
      const storagePath = storagePathFor(row.id, index, upload.name);
      await uploadFile(
        client,
        DLO_UPLOADS_BUCKET,
        storagePath,
        upload.data,
        // Extension-driven rather than trusting the browser's reported type, which is empty
        // or wrong for several of these containers. `isAudioFileName` above guarantees a hit.
        audioMimeForFileName(upload.name) ?? 'audio/mpeg',
      );
      entries.push({
        name: upload.name,
        storagePath,
        status: 'pending',
      });
    }

    await updateTranscription(client, row.id, {
      files: entries,
      fileCount: entries.length,
    });
    startTranscriptionJob(client, row.id);
    return reply.code(202).send({ id: row.id });
  });

  // The recent-run list. Every run, newest first — there is no auth and no owner column.
  //
  // Like /dlo/intakes this route deliberately does NOT run the orphan check below: it would
  // fail every run currently transcribing the moment anyone opened the page in a second tab.
  app.get('/transcriptions', async () => {
    const rows = await listTranscriptions(client);
    return rows.map(toSummary);
  });

  app.get<{ Params: { id: string }; Querystring: { text?: string } }>(
    '/transcriptions/:id',
    async (request, reply) => {
      const row = await getTranscription(client, request.params.id);
      if (!row) {
        return reply
          .code(404)
          .send({ error: { message: 'Transcription not found.' } });
      }
      const includeText = request.query.text === '1';
      // Orphan check, same as the generation and DLO detail routes: a row stuck in
      // queued/running whose job is not in this process died with a previous server, so
      // fail it rather than leave the UI spinning forever.
      //
      // NOTE: this shares the single-process constraint documented on /dlo/intakes/:id —
      // with two API instances, instance B's poll would fail a job running on instance A.
      if (
        (row.status === 'queued' || row.status === 'running') &&
        !isTranscriptionJobRunning(row.id)
      ) {
        const error = 'Server restarted while this job was running.';
        await updateTranscription(client, row.id, { status: 'failed', error });
        return toDetail({ ...row, status: 'failed', error }, includeText);
      }
      return toDetail(row, includeText);
    },
  );
}
