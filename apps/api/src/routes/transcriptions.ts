// Standalone transcription API routes. Thin handlers only (per AGENTS.md): parse the
// multipart upload, archive the recordings, persist the row, and hand the Sarvam work to
// jobs/transcription-runner.
//
// Unlike /dlo this path ends at the transcript — there is no review contract and no
// generation lineage, so there are exactly three routes: create, list, detail.

import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import {
  DLO_UPLOADS_BUCKET,
  getTranscription,
  insertTranscription,
  listTranscriptions,
  removeObjectsIn,
  updateTranscription,
  uploadStream,
  type SupabaseClient,
  type TranscriptionFileEntry,
  type TranscriptionRow,
  type TranscriptionSummaryRow,
} from '@dgipr/database';
import {
  audioMimeForFileName,
  isAudioFileName,
  parseYouTubeVideoId,
  TRANSCRIPTION_MAX_FILES,
  YouTubeSourcesSchema,
  type TranscriptionDetail,
  type TranscriptionSummary,
  type YouTubeVideo,
} from '@dgipr/schemas';
import {
  isTranscriptionJobRunning,
  startTranscriptionJob,
} from '../jobs/transcription-runner.js';

// Meeting recordings are big, so this route overrides the conservative global multipart
// limits per request, exactly as /dlo/intakes does — and, since 2026-08-24, to the same
// unlimited ceiling: a two-hour recording passes 50 MB routinely, and refusing it at the
// door is a failure the officer can do nothing about (the /dlo reasoning, which this route
// was simply left behind by). The transcriber itself is nowhere near the bound — ElevenLabs
// Scribe accepts 5 GB per upload — so the cap was only ever ours.
//
// busboy treats Infinity as "unlimited", so this override now exists purely to LIFT the
// global cap in index.ts. It must be STATED, not omitted: @fastify/multipart DEEP-merges
// these into the global limits key by key, so a dropped key exposes the global value rather
// than removing it (that mistake cost a production outage on 2026-08-17 — see routes/dlo.ts).
// No `fieldSize` bump: this request carries no text fields.
//
// UNLIMITED IS NOW A PROMISE THE BOX CAN KEEP. Until 2026-08-30 this route read each part
// with `part.toBuffer()`, so "no size limit" meant the whole recording sat in the API
// process — and a 239.6 MB upload OOM-killed the container mid-transfer, which the officer
// saw as "सेवेशी संपर्क होऊ शकला नाही" with the recording lost. The file count was described
// here as what kept a submission bounded; ten unbounded files are not bounded. Each part now
// streams straight through to S3 (uploadStream), so peak memory is a few MiB per file
// whatever its length, and the count is back to being an ordinary sanity limit.
const MAX_FILE_BYTES = Number.POSITIVE_INFINITY;

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
      // A YouTube source's link and probe details, so the card can name and link the video
      // instead of showing a bare URL. Cheap enough for the progress poll.
      ...(entry.sourceUrl !== undefined ? { sourceUrl: entry.sourceUrl } : {}),
      ...(entry.sourceAuthor !== undefined
        ? { sourceAuthor: entry.sourceAuthor }
        : {}),
      ...(entry.sourceThumbnailUrl !== undefined
        ? { sourceThumbnailUrl: entry.sourceThumbnailUrl }
        : {}),
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
    // The row id is minted HERE rather than by the database, because each recording is
    // streamed to its final storage key while the request is still arriving — the key has to
    // exist before the first byte does. The row itself is still inserted last, after every
    // file has been accepted, so a rejected upload leaves no run in the history list.
    const runId = randomUUID();
    const uploads: Array<{ name: string; storagePath: string; bytes: number }> =
      [];
    // Pasted YouTube links, already probed by the form. Nothing is downloaded here or ever:
    // the transcriber fetches the media itself (@dgipr/schemas' youtube.ts).
    let youtube: YouTubeVideo[] = [];

    // Everything already written to the private bucket for a row that may still never be
    // inserted. Best-effort on every path that gives up: an abandoned recording is invisible
    // to the product and nothing would ever come back for it.
    const discardStaged = async (): Promise<void> => {
      if (uploads.length === 0) return;
      try {
        await removeObjectsIn(
          client,
          DLO_UPLOADS_BUCKET,
          uploads.map((upload) => upload.storagePath),
        );
      } catch (error) {
        console.error(
          `[transcription ${runId}] could not discard staged uploads:`,
          error,
        );
      }
    };

    const parts = request.parts({
      limits: { fileSize: MAX_FILE_BYTES, files: TRANSCRIPTION_MAX_FILES },
    });
    try {
      for await (const part of parts) {
        if (part.type === 'field') {
          // Any other field is ignored rather than rejected, so adding one later cannot
          // break an older client.
          if (part.fieldname !== 'youtube') continue;
          const value = typeof part.value === 'string' ? part.value : '';
          if (value.trim().length === 0) continue;
          try {
            youtube = YouTubeSourcesSchema.parse(JSON.parse(value));
          } catch {
            await discardStaged();
            return reply.code(400).send({
              error: { message: 'यूट्युब लिंकची माहिती वाचता आली नाही.' },
            });
          }
          // Re-derived from the URL rather than trusted, so a hand-crafted payload cannot
          // put an arbitrary URL in front of the transcriber.
          for (const video of youtube) {
            if (parseYouTubeVideoId(video.url) === null) {
              await discardStaged();
              return reply
                .code(400)
                .send({ error: { message: 'यूट्युब लिंक वैध नाही.' } });
            }
          }
          continue;
        }
        const name = part.filename ?? '';
        if (!isAudioFileName(name)) {
          await discardStaged();
          return reply.code(400).send({
            error: {
              message:
                'फक्त समर्थित ध्वनिमुद्रण फाईल्स (MP3, M4A, AAC, AIFF, OGG, OPUS, WAV, FLAC, WEBM) स्वीकारल्या जातात.',
            },
          });
        }
        // Straight from the wire to S3 — the recording is never assembled in this process.
        // Awaited inside the loop deliberately: busboy delivers one part at a time and stalls
        // until the current one is drained, so this is also what keeps the parts in order.
        const storagePath = storagePathFor(runId, uploads.length, name);
        const bytes = await uploadStream(
          client,
          DLO_UPLOADS_BUCKET,
          storagePath,
          part.file,
          // Extension-driven rather than trusting the browser's reported type, which is empty
          // or wrong for several of these containers. `isAudioFileName` above guarantees a hit.
          audioMimeForFileName(name) ?? 'audio/mpeg',
        );
        uploads.push({ name, storagePath, bytes });
        // busboy TRUNCATES a part that hits the size limit rather than erroring, so without
        // this a capped upload would be stored and transcribed as if it were the whole
        // recording. Unreachable while the limit above is Infinity; here so that a future
        // ceiling fails loudly instead of silently shortening a meeting.
        if (part.file.truncated) {
          await discardStaged();
          return reply
            .code(413)
            .send({ error: { message: 'फाईल खूप मोठी आहे.' } });
        }
      }
    } catch (error) {
      // Reached by a browser that vanished mid-upload as well as by a rejected part: the
      // iterator raises FST_MP_PREMATURE_CLOSE, and whatever had already landed belongs to a
      // run that will never exist.
      await discardStaged();
      // @fastify/multipart raises FST_REQ_FILE_TOO_LARGE when a part exceeds the per-request
      // fileSize limit above. That limit is now unlimited, so this branch is unreachable and
      // is kept only so a future ceiling has somewhere to land — hence a message that names
      // no number (the routes/dlo.ts precedent).
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'FST_REQ_FILE_TOO_LARGE'
      ) {
        return reply
          .code(413)
          .send({ error: { message: 'फाईल खूप मोठी आहे.' } });
      }
      throw error;
    }

    if (uploads.length === 0 && youtube.length === 0) {
      return reply.code(400).send({
        error: {
          message: 'किमान एक ध्वनिमुद्रण जोडा किंवा यूट्युब लिंक द्या.',
        },
      });
    }

    // The recordings are already archived — they were streamed there as they arrived, under
    // keys built from `runId`, which is why this insert can carry that id rather than take
    // one from the database. Everything else is unchanged: the row is still written before
    // the job starts, and the job still reads it all back off the row.
    const row = await insertTranscription(client, {
      id: runId,
      title: transcriptionTitle([
        ...uploads.map((upload) => upload.name),
        // A video's probed title where there is one; the link itself otherwise.
        ...youtube.map((video) => video.title ?? video.url),
      ]),
      files: [],
    });
    const entries: TranscriptionFileEntry[] = uploads.map((upload) => ({
      name: upload.name,
      storagePath: upload.storagePath,
      // What the upload actually weighed. The job reads it to decide how many recordings it
      // may hold at once, so it is a memory bound rather than a display figure.
      bytes: upload.bytes,
      status: 'pending',
    }));

    // Then the links, beside the recordings — the job transcribes both in one pass. No
    // upload and no archive: there are no bytes on our side at any point, only a URL.
    for (const video of youtube) {
      entries.push({
        name: video.title ?? video.url,
        status: 'pending',
        sourceUrl: video.url,
        ...(video.author !== undefined ? { sourceAuthor: video.author } : {}),
        ...(video.thumbnailUrl !== undefined
          ? { sourceThumbnailUrl: video.thumbnailUrl }
          : {}),
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
