// In-process job runner for DLO intakes: transcribe uploaded audio (Sarvam
// batch STT), extract document text (Sarvam doc digitization / mammoth), and
// combine everything into the reviewable Marathi text. Sequencing and
// persistence only — the actual Sarvam/extraction logic lives in
// @dgipr/content-engine (same boundary as runner.ts, per AGENTS.md).
//
// PDFs are the exception to "the intake job reads everything": a scanned PDF is only
// PROBED here (page count, free text-layer attempt) and parked at 'needs-selection', because
// OCR is billed per page and the officer has not yet said which pages matter. The reading
// happens later, in startDloExtractionJob, over exactly the pages they picked.
//
// Job state of record is the dlo_intakes row (status/step/error + per-file
// status inside the files jsonb), so polling clients survive refreshes. The
// in-memory `running` set mirrors runner.ts: double-run guard + restart-orphan
// detection for the detail route.

import {
  extractDocxText,
  extractPdfPagesDetailed,
  probePdf,
  transcribeAudioFiles,
} from '@dgipr/content-engine';
import {
  DLO_UPLOADS_BUCKET,
  downloadFile,
  getDloIntake,
  updateDloIntake,
  type DloIntakeFileEntry,
  type SupabaseClient,
} from '@dgipr/database';
import { combineIntakeSources, type IntakeSource } from '@dgipr/schemas';

const running = new Set<string>();

export function isIntakeJobRunning(id: string): boolean {
  return running.has(id);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// One source's whole text, however it was stored: a PDF keeps its pages so the
// review step can select among them, everything else keeps one string. Pages are
// joined with a blank line, so a page break reads as a paragraph break.
function sourceTextOf(entry: DloIntakeFileEntry): string {
  if (entry.pages) {
    return entry.pages
      .map((page) => page.text)
      .filter((text) => text.length > 0)
      .join('\n\n');
  }
  return entry.text ?? '';
}

// The everything-included combined text. It is what the review step seeds from on
// an old row and what a client without the per-source fields would still get; the
// review step normally re-assembles its own from the officer's edits/selection.
function rebuildCombinedText(
  notes: string,
  entries: readonly DloIntakeFileEntry[],
): string {
  const sources: IntakeSource[] = entries.flatMap((entry) => {
    const text = sourceTextOf(entry);
    return text ? [{ label: entry.name, text }] : [];
  });
  return combineIntakeSources(notes, sources);
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

async function downloadEntry(
  client: SupabaseClient,
  entry: DloIntakeFileEntry,
): Promise<Buffer> {
  return downloadFile(client, DLO_UPLOADS_BUCKET, entry.storagePath);
}

// Look at a PDF without paying for it. A born-digital file's text layer is free, so it is
// read here and the officer never sees a selection step for it. A SCANNED file stops at
// 'needs-selection' carrying only its page count: reading it costs OCR credits per page,
// and which pages are worth that is the officer's call, not the pipeline's.
async function probePdfEntry(
  client: SupabaseClient,
  entry: DloIntakeFileEntry,
): Promise<DloIntakeFileEntry> {
  const probe = await probePdf(entry.name, await downloadEntry(client, entry));
  // Built explicitly rather than spread over `entry`, so a re-read drops the
  // previous read's error instead of leaving a stale failure on screen.
  const base = {
    name: entry.name,
    storagePath: entry.storagePath,
    kind: entry.kind,
    pageCount: probe.pageCount,
  };
  if (!probe.pages) {
    return { ...base, status: 'needs-selection' };
  }
  return {
    ...base,
    status: 'done',
    chars: sourceTextOf({ ...entry, pages: probe.pages }).length,
    pages: probe.pages,
    pdfSource: probe.source,
  };
}

// PDFs are read PAGE BY PAGE (not flattened) so the review step can offer page
// selection, and the backend that read them is recorded: OCR misreads names and
// amounts, a text layer is exact, and the user is told which they are looking at.
//
// `pages` is the officer's selection and is what bounds the spend — only these pages are
// sent to OCR. 'auto' rather than a forced 'ocr' even here, because the selected pages may
// carry a readable text layer even when the document as a whole did not.
async function extractPdfEntry(
  client: SupabaseClient,
  entry: DloIntakeFileEntry,
  pages: readonly number[],
  source: 'auto' | 'ocr' = 'auto',
): Promise<DloIntakeFileEntry> {
  const data = await downloadEntry(client, entry);
  const extracted = await extractPdfPagesDetailed(entry.name, data, {
    source,
    pages,
  });
  return {
    name: entry.name,
    storagePath: entry.storagePath,
    kind: entry.kind,
    status: 'done',
    chars: sourceTextOf({ ...entry, pages: extracted.pages }).length,
    pages: extracted.pages,
    ...(entry.pageCount !== undefined ? { pageCount: entry.pageCount } : {}),
    pdfSource: extracted.source,
  };
}

async function extractDocxEntry(
  client: SupabaseClient,
  entry: DloIntakeFileEntry,
): Promise<DloIntakeFileEntry> {
  const data = await downloadFile(
    client,
    DLO_UPLOADS_BUCKET,
    entry.storagePath,
  );
  const text = await extractDocxText(entry.name, data);
  return { ...entry, status: 'done', chars: text.length, text };
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
    // shows which source succeeded/failed. Each entry also carries its extracted
    // text (PDFs: page by page), which is what the review step edits.
    const entries: DloIntakeFileEntry[] = row.files.map((entry) => ({
      ...entry,
    }));

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
            entries[index] = {
              ...entries[index]!,
              status: 'done',
              chars: result.text.length,
              text: result.text,
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

    // --- extract: documents one by one; each failure stays on its own file. A PDF is
    // only PROBED here — a scanned one waits at 'needs-selection' until the officer says
    // which pages are worth OCR'ing, so this phase never spends credits on a page nobody
    // asked for. DOCX is local and free, so it is simply read.
    await updateDloIntake(client, id, { step: 'extract' });
    for (const [index, entry] of entries.entries()) {
      if (entry.kind !== 'pdf' && entry.kind !== 'docx') continue;
      try {
        entries[index] =
          entry.kind === 'pdf'
            ? await probePdfEntry(client, entry)
            : await extractDocxEntry(client, entry);
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
    // upload order. A PDF still awaiting its page selection contributes nothing yet, so
    // the intake fails only when nothing survived AND nothing is waiting to be chosen.
    await updateDloIntake(client, id, { step: 'combine' });
    const combined = rebuildCombinedText(row.notes, entries);
    const awaitingSelection = entries.some(
      (entry) => entry.status === 'needs-selection',
    );
    if (!combined && !awaitingSelection) {
      throw new Error(
        'कोणत्याही फाईलमधून मजकूर मिळाला नाही. कृपया फाईल्स तपासून पुन्हा प्रयत्न करा.',
      );
    }
    await updateDloIntake(client, id, { combinedText: combined });
  });
}

// "Read these pages of these PDFs." One job for every file the officer just chose pages
// for, because an intake can hold several scanned documents and making them one click each
// would be tedious for no benefit. Each file's failure stays on that file.
export function startDloExtractionJob(
  client: SupabaseClient,
  id: string,
  selections: ReadonlyArray<{ index: number; pages: readonly number[] }>,
): void {
  runIntakeJob(client, id, async () => {
    const row = await getDloIntake(client, id);
    if (!row) throw new Error(`DLO intake ${id} not found.`);

    // The route already flipped the row to running/extract (see the comment there), so
    // this job goes straight to work.
    const entries = [...row.files];
    for (const selection of selections) {
      const entry = entries[selection.index];
      if (!entry || entry.kind !== 'pdf') continue;
      try {
        entries[selection.index] = await extractPdfEntry(
          client,
          entry,
          selection.pages,
        );
      } catch (error) {
        entries[selection.index] = {
          ...entry,
          status: 'failed',
          error: errorMessage(error),
        };
      }
      await updateDloIntake(client, id, { files: entries });
    }

    await updateDloIntake(client, id, {
      combinedText: rebuildCombinedText(row.notes, entries),
    });
  });
}

// "This PDF's text came out wrong — read it with OCR instead." The auto gate in
// @dgipr/content-engine cannot catch every broken PDF font, and the officer is the
// one looking at the text, so the override is theirs. Only this one file is re-read;
// every other source (and the officer's edits to them) is untouched.
//
// Unlike /translate, DLO still has the original in the private dlo-uploads bucket,
// so there is nothing to re-upload.
export function startDloFileReextractionJob(
  client: SupabaseClient,
  id: string,
  index: number,
  pages: readonly number[],
): void {
  runIntakeJob(client, id, async () => {
    const row = await getDloIntake(client, id);
    if (!row) throw new Error(`DLO intake ${id} not found.`);
    const entry = row.files[index];
    if (!entry || entry.kind !== 'pdf') {
      throw new Error(`DLO intake ${id} has no PDF at index ${index}.`);
    }

    // The route already flipped the row to running/extract (see the comment
    // there), so this job goes straight to work.

    // A failed re-read marks only this file and keeps its previous pages — the
    // intake stays usable, exactly as in the initial extraction phase.
    const entries = [...row.files];
    try {
      entries[index] = await extractPdfEntry(client, entry, pages, 'ocr');
    } catch (error) {
      entries[index] = {
        ...entry,
        status: 'failed',
        error: errorMessage(error),
      };
    }
    await updateDloIntake(client, id, {
      files: entries,
      combinedText: rebuildCombinedText(row.notes, entries),
    });
  });
}
