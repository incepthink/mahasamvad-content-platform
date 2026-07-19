// In-process job runner for DLO intakes: transcribe uploaded audio (Sarvam
// batch STT), extract document text (Sarvam doc digitization / mammoth), and
// combine everything into the reviewable Marathi text. Sequencing and
// persistence only — the actual Sarvam/extraction logic lives in
// @dgipr/content-engine (same boundary as runner.ts, per AGENTS.md).
//
// Job state of record is the dlo_intakes row (status/step/error + per-file
// status inside the files jsonb), so polling clients survive refreshes. The
// in-memory `running` set mirrors runner.ts: double-run guard + restart-orphan
// detection for the detail route.

import {
  combineIntakeSources,
  extractDocxText,
  extractPdfText,
  transcribeAudioFiles,
  type IntakeSource,
} from '@dgipr/content-engine';
import {
  DLO_UPLOADS_BUCKET,
  downloadFile,
  getDloIntake,
  updateDloIntake,
  type DloIntakeFileEntry,
  type SupabaseClient,
} from '@dgipr/database';

const running = new Set<string>();

export function isIntakeJobRunning(id: string): boolean {
  return running.has(id);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Wrap the job body with the shared bookkeeping: claim the id, persist
// ready/failed, always release the id. No cost meter — Sarvam usage is not
// metered today (same as the translate job).
function runIntakeJob(
  client: SupabaseClient,
  id: string,
  job: () => Promise<void>,
): void {
  running.add(id);
  void (async () => {
    try {
      await job();
      await updateDloIntake(client, id, {
        status: 'ready',
        step: 'done',
        error: null,
      });
    } catch (error) {
      console.error(`[dlo-intake ${id}] failed:`, error);
      try {
        await updateDloIntake(client, id, {
          status: 'failed',
          error: errorMessage(error),
        });
      } catch (updateError) {
        console.error(
          `[dlo-intake ${id}] could not persist failure:`,
          updateError,
        );
      }
    } finally {
      running.delete(id);
    }
  })();
}

export function startDloIntakeJob(client: SupabaseClient, id: string): void {
  runIntakeJob(client, id, async () => {
    const row = await getDloIntake(client, id);
    if (!row) throw new Error(`DLO intake ${id} not found.`);

    await updateDloIntake(client, id, {
      status: 'running',
      step: 'transcribe',
      error: null,
    });

    // Mutable per-file state, persisted after each phase so the processing UI
    // shows which source succeeded/failed. Extracted texts stay local (only
    // their char counts are stored per file; the combined text is the output).
    const entries: DloIntakeFileEntry[] = row.files.map((entry) => ({
      ...entry,
    }));
    const texts = new Map<number, string>();

    // --- transcribe: all audio files in ONE Sarvam batch job. A job-level
    // failure (auth/timeout) marks every audio file failed instead of sinking
    // the documents too.
    const audioIndexes = entries.flatMap((entry, index) =>
      entry.kind === 'audio' ? [index] : [],
    );
    if (audioIndexes.length > 0) {
      try {
        const inputs = await Promise.all(
          audioIndexes.map(async (index) => ({
            name: entries[index]!.name,
            data: await downloadFile(
              client,
              DLO_UPLOADS_BUCKET,
              entries[index]!.storagePath,
            ),
          })),
        );
        const results = await transcribeAudioFiles(inputs);
        results.forEach((result, position) => {
          const index = audioIndexes[position]!;
          if ('text' in result) {
            texts.set(index, result.text);
            entries[index] = {
              ...entries[index]!,
              status: 'done',
              chars: result.text.length,
            };
          } else {
            entries[index] = {
              ...entries[index]!,
              status: 'failed',
              error: result.error,
            };
          }
        });
      } catch (error) {
        const message = errorMessage(error);
        for (const index of audioIndexes) {
          entries[index] = {
            ...entries[index]!,
            status: 'failed',
            error: message,
          };
        }
      }
      await updateDloIntake(client, id, { files: entries });
    }

    // --- extract: documents one by one; each failure stays on its own file.
    await updateDloIntake(client, id, { step: 'extract' });
    for (const [index, entry] of entries.entries()) {
      if (entry.kind !== 'pdf' && entry.kind !== 'docx') continue;
      try {
        const data = await downloadFile(
          client,
          DLO_UPLOADS_BUCKET,
          entry.storagePath,
        );
        const text =
          entry.kind === 'pdf'
            ? await extractPdfText(entry.name, data)
            : await extractDocxText(entry.name, data);
        texts.set(index, text);
        entries[index] = { ...entry, status: 'done', chars: text.length };
      } catch (error) {
        entries[index] = {
          ...entry,
          status: 'failed',
          error: errorMessage(error),
        };
      }
      await updateDloIntake(client, id, { files: entries });
    }

    // --- combine: notes first, then each source under its Marathi header, in
    // upload order. Only if literally nothing survived does the intake fail.
    await updateDloIntake(client, id, { step: 'combine' });
    const sources: IntakeSource[] = entries.flatMap((entry, index) => {
      const text = texts.get(index);
      return text ? [{ label: entry.name, text }] : [];
    });
    const combined = combineIntakeSources(row.notes, sources);
    if (!combined) {
      throw new Error(
        'कोणत्याही फाईलमधून मजकूर मिळाला नाही. कृपया फाईल्स तपासून पुन्हा प्रयत्न करा.',
      );
    }
    await updateDloIntake(client, id, { combinedText: combined });
  });
}
