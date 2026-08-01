// In-process job runner for standalone transcription runs: download the archived
// recordings, send them to the configured STT provider, and write the transcripts back onto
// the row. Every recording is transcribed afresh — the content-addressed cache is written
// but not read unless TRANSCRIPT_CACHE_MODE=read (see transcript-cache-mode.ts).
//
// Sequencing and persistence only — which provider transcribes, and how, lives behind
// transcribeAudio in @dgipr/content-engine (same boundary as runner.ts and dlo-runner.ts,
// per AGENTS.md).
//
// This is deliberately the DLO intake job's transcribe phase and nothing else: no documents,
// no page selection, no combine contract for an article. The transcript IS the output, so
// the job ends the moment every recording has one.
//
// Job state of record is the transcriptions row (status/error + per-file status inside the
// files jsonb), so polling clients survive refreshes. The in-memory `running` set mirrors
// dlo-runner.ts: double-run guard + restart-orphan detection for the detail route.

import {
  createCostAccumulator,
  isAudioUrlInput,
  runInCostScope,
  sttProviderName,
  totalCostUsd,
  transcribeAudio,
  type AudioInput,
} from '@dgipr/content-engine';
import {
  DLO_UPLOADS_BUCKET,
  downloadFile,
  getCachedTranscripts,
  getTranscription,
  hashAudioContent,
  putCachedTranscript,
  updateTranscription,
  type SupabaseClient,
  type TranscriptionFileEntry,
} from '@dgipr/database';
import { combineTranscripts } from '@dgipr/schemas';

import { transcriptCacheMode } from './transcript-cache-mode.js';

const running = new Set<string>();

export function isTranscriptionJobRunning(id: string): boolean {
  return running.has(id);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// The counters the list card reads. Kept on the row rather than derived from `files`, so the
// list query never has to select the transcripts themselves.
function countersFor(
  entries: readonly TranscriptionFileEntry[],
  combined: string,
): Readonly<{ fileCount: number; failedCount: number; charCount: number }> {
  return {
    fileCount: entries.length,
    failedCount: entries.filter((entry) => entry.status === 'failed').length,
    charCount: combined.length,
  };
}

export function startTranscriptionJob(
  client: SupabaseClient,
  id: string,
): void {
  running.add(id);
  void (async () => {
    try {
      const row = await getTranscription(client, id);
      if (!row) throw new Error(`Transcription ${id} not found.`);

      await updateTranscription(client, id, {
        status: 'running',
        error: null,
      });

      const entries: TranscriptionFileEntry[] = row.files.map((entry) => ({
        ...entry,
      }));

      // Download every UPLOADED recording (the batch needs the bytes anyway) and hash it.
      // The hash is the cache key. It is only CONSULTED under TRANSCRIPT_CACHE_MODE=read; by
      // default every recording is transcribed afresh and the hash serves the write-back
      // alone.
      //
      // A pasted YouTube link is neither downloaded nor hashed: the transcriber fetches the
      // media itself, so there are no bytes on our side — which also means the
      // content-addressed cache (0031) simply does not apply to it, and its position below
      // is always a miss.
      const inputs: AudioInput[] = await Promise.all(
        entries.map(async (entry) =>
          entry.sourceUrl !== undefined
            ? { name: entry.name, sourceUrl: entry.sourceUrl }
            : {
                name: entry.name,
                data: await downloadFile(
                  client,
                  DLO_UPLOADS_BUCKET,
                  // An entry without a sourceUrl was uploaded, so it has a storagePath;
                  // the fallback is unreachable defence rather than a real case.
                  entry.storagePath ?? '',
                ),
              },
        ),
      );
      // The empty string is never looked up as a key — those positions are skipped below.
      const hashes = inputs.map((input) =>
        isAudioUrlInput(input) ? '' : hashAudioContent(input.data),
      );

      // Off by default: nothing is reused, so every position below is a miss. Under
      // TRANSCRIPT_CACHE_MODE=read a cache read failure (e.g. an un-applied 0031) must not
      // sink transcription — treat it as an empty cache and transcribe everything.
      let cached: Map<string, string>;
      if (transcriptCacheMode() === 'read') {
        try {
          cached = await getCachedTranscripts(
            client,
            hashes.filter((hash) => hash !== ''),
          );
        } catch (error) {
          console.error(
            `[transcription ${id}] transcript cache read failed:`,
            error,
          );
          cached = new Map();
        }
      } else {
        cached = new Map();
      }

      const missPositions: number[] = [];
      for (const [index] of entries.entries()) {
        const hash = hashes[index]!;
        const hit = hash === '' ? undefined : cached.get(hash);
        if (hit !== undefined) {
          entries[index] = {
            ...entries[index]!,
            status: 'done',
            chars: hit.length,
            text: hit,
            cached: true,
          };
        } else {
          missPositions.push(index);
        }
      }
      // Read mode only (no run has hits with the cache off): show them straight away — on an
      // all-cached run this is the whole result and the officer should not wait on a Sarvam
      // call that is never made.
      if (missPositions.length < entries.length) {
        await updateTranscription(client, id, { files: entries });
      }

      if (missPositions.length > 0) {
        // A cost scope purely for visibility: `transcriptions` has no cost column, so the
        // metered figure is LOGGED rather than persisted. Only the ElevenLabs path records
        // (it returns word timestamps to measure); a Sarvam run logs nothing.
        const cost = createCostAccumulator();
        const results = await runInCostScope(cost, () =>
          transcribeAudio(missPositions.map((index) => inputs[index]!)),
        );
        if (cost.sttSeconds > 0) {
          console.log(
            `[transcription ${id}] ${sttProviderName()} STT: ` +
              `${(cost.sttSeconds / 60).toFixed(1)} min, ` +
              `~$${totalCostUsd(cost).toFixed(4)}.`,
          );
        }
        await Promise.all(
          results.map(async (result, resultIndex) => {
            const index = missPositions[resultIndex]!;
            if ('text' in result) {
              entries[index] = {
                ...entries[index]!,
                status: 'done',
                chars: result.text.length,
                text: result.text,
                cached: false,
              };
              // Best-effort: a cache write failure must not fail a recording that just
              // transcribed fine. A URL source has no bytes and therefore no key, so it is
              // simply not cached.
              try {
                if (hashes[index] !== '') {
                  await putCachedTranscript(
                    client,
                    hashes[index]!,
                    result.text,
                  );
                }
              } catch (error) {
                console.error(
                  `[transcription ${id}] transcript cache write failed:`,
                  error,
                );
              }
            } else {
              entries[index] = {
                ...entries[index]!,
                status: 'failed',
                error: result.error,
              };
            }
          }),
        );
      }

      const combined = combineTranscripts(
        entries.map((entry) => ({ label: entry.name, text: entry.text ?? '' })),
      );
      // Every recording failed — there is no output at all, so the RUN failed. One bad file
      // among several is not fatal: its error rides on its own entry and the rest deliver.
      if (!combined) {
        await updateTranscription(client, id, {
          files: entries,
          ...countersFor(entries, ''),
        });
        throw new Error(
          'कोणत्याही ध्वनिमुद्रणातून मजकूर मिळाला नाही. कृपया फाईल्स तपासून पुन्हा प्रयत्न करा.',
        );
      }

      await updateTranscription(client, id, {
        status: 'ready',
        error: null,
        files: entries,
        combinedText: combined,
        ...countersFor(entries, combined),
      });
    } catch (error) {
      console.error(`[transcription ${id}] failed:`, error);
      try {
        await updateTranscription(client, id, {
          status: 'failed',
          error: errorMessage(error),
        });
      } catch (updateError) {
        console.error(
          `[transcription ${id}] could not persist failure:`,
          updateError,
        );
      }
    } finally {
      running.delete(id);
    }
  })();
}
