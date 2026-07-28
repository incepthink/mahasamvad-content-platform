// In-process job runner for standalone transcription runs: download the archived
// recordings, reuse any transcript the content-addressed cache already holds, send only the
// misses to one Sarvam batch STT job, and write the transcripts back onto the row.
//
// Sequencing and persistence only — the Sarvam logic lives in @dgipr/content-engine (same
// boundary as runner.ts and dlo-runner.ts, per AGENTS.md).
//
// This is deliberately the DLO intake job's transcribe phase and nothing else: no documents,
// no page selection, no combine contract for an article. The transcript IS the output, so
// the job ends the moment every recording has one.
//
// Job state of record is the transcriptions row (status/error + per-file status inside the
// files jsonb), so polling clients survive refreshes. The in-memory `running` set mirrors
// dlo-runner.ts: double-run guard + restart-orphan detection for the detail route.

import { transcribeAudioFiles } from '@dgipr/content-engine';
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

      // Download every recording (the batch needs the bytes anyway) and hash it. The hash is
      // the cache key: a recording transcribed before — here or on /dlo, now or months ago —
      // already has a transcript and skips the slow, paid Sarvam job entirely.
      const inputs = await Promise.all(
        entries.map(async (entry) => ({
          name: entry.name,
          data: await downloadFile(
            client,
            DLO_UPLOADS_BUCKET,
            entry.storagePath,
          ),
        })),
      );
      const hashes = inputs.map((input) => hashAudioContent(input.data));

      // A cache read failure (e.g. an un-applied 0031) must not sink transcription: treat it
      // as an empty cache and transcribe everything, exactly as if the cache did not exist.
      let cached: Map<string, string>;
      try {
        cached = await getCachedTranscripts(client, hashes);
      } catch (error) {
        console.error(
          `[transcription ${id}] transcript cache read failed:`,
          error,
        );
        cached = new Map();
      }

      const missPositions: number[] = [];
      for (const [index] of entries.entries()) {
        const hit = cached.get(hashes[index]!);
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
      // Show the cache hits straight away — on an all-cached run this is the whole result and
      // the officer should not wait on a Sarvam call that is never made.
      if (missPositions.length < entries.length) {
        await updateTranscription(client, id, { files: entries });
      }

      if (missPositions.length > 0) {
        const results = await transcribeAudioFiles(
          missPositions.map((index) => inputs[index]!),
        );
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
              // transcribed fine.
              try {
                await putCachedTranscript(client, hashes[index]!, result.text);
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
