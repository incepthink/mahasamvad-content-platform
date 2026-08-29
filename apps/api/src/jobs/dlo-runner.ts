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
// Unless they picked them ALREADY. A document uploaded at the input step is normally read
// there too, but the officer may hand over the page selection without waiting for it
// ("न वाचता ही पृष्ठे वापरा"); that file arrives 'pending' carrying `pendingPages`, and the
// extract phase below reads exactly those instead of probing. Same spend gate — the pages
// were still chosen before anything was billed — just a wait folded into a job that was
// going to run anyway.
//
// Job state of record is the dlo_intakes row (status/step/error + per-file
// status inside the files jsonb), so polling clients survive refreshes. The
// in-memory `running` set mirrors runner.ts: double-run guard + restart-orphan
// detection for the detail route.

import {
  createCostAccumulator,
  extractDocxText,
  extractImageTextViaProvider,
  extractPdfPagesDetailed,
  probePdf,
  runInCostScope,
  runInCostTask,
  sttProviderName,
  totalCostUsd,
  isAudioUrlInput,
  transcribeAudio,
  type AudioInput,
} from '@dgipr/content-engine';
import {
  DLO_UPLOADS_BUCKET,
  downloadFile,
  getCachedTranscripts,
  getDloIntake,
  hashAudioContent,
  putCachedTranscript,
  updateDloIntake,
  type DloIntakeFileEntry,
  type SupabaseClient,
} from '@dgipr/database';
import { combineIntakeSources, type IntakeSource } from '@dgipr/schemas';

import { recordTasksFromCost } from './service-usage.js';
import { transcriptCacheMode } from './transcript-cache-mode.js';

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

// The original bytes out of the private bucket. A document read at the input step whose
// ephemeral upload job had already expired carries no storagePath — its text made it into
// the row, its bytes did not — so nothing can be re-read from it.
async function downloadEntry(
  client: SupabaseClient,
  entry: DloIntakeFileEntry,
): Promise<Buffer> {
  if (!entry.storagePath) {
    throw new Error(`या फाईलची मूळ प्रत उपलब्ध नाही: ${entry.name}`);
  }
  return downloadFile(client, DLO_UPLOADS_BUCKET, entry.storagePath);
}

// How often a running PDF read reports its page count onto the row. `files` is one jsonb
// blob rewritten in full on every update, so this is a real cost at 400 pages, not a
// nicety — see extractPdfEntry.
const PROGRESS_WRITE_MS = 2_000;

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
//
// While it runs it reports PROGRESS onto the row (`pagesRead`), so प्रक्रिया can fill in a
// row per page instead of showing a spinner for what, on a long scan, is many minutes.
// Throttled rather than written per page: `files` is one jsonb blob holding every source, so
// each write re-sends the whole thing — writing per page on a 400-page document would rewrite
// a growing blob 400 times, which is quadratic and would become its own bottleneck. Every
// PROGRESS_WRITE_MS the officer sees a small group of pages appear, which nobody notices.
//
// `index` is where this entry sits in the row's `files`, needed because the progress write
// has to re-read and patch that array; omit it and the read simply runs without reporting.
async function extractPdfEntry(
  client: SupabaseClient,
  entry: DloIntakeFileEntry,
  pages: readonly number[],
  source: 'auto' | 'ocr' = 'auto',
  progress?: Readonly<{ intakeId: string; index: number }>,
): Promise<DloIntakeFileEntry> {
  const data = await downloadEntry(client, entry);
  // A cost scope around the read itself rather than around the whole job: this function is
  // the ONE place all three /dlo document paths meet (the intake job's deferred pages, the
  // explicit extract job, and the per-file OCR re-read), so metering here counts every paid
  // page exactly once no matter which pressed the button. `dlo_intakes` has no cost column,
  // so the event is the only record. A born-digital PDF read from its text layer spends
  // nothing and records nothing — recordOcrCost only fires on the pixel path.
  const cost = createCostAccumulator();

  // Fire-and-forget, throttled, and never allowed to fail the read: these pages are already
  // paid for, so a progress write that loses a race or hits a transient database error must
  // cost the animation, not the document.
  const readPages: number[] = [];
  let lastWrite = 0;
  let writing: Promise<void> = Promise.resolve();
  const reportProgress = (): void => {
    if (!progress) return;
    const now = Date.now();
    if (now - lastWrite < PROGRESS_WRITE_MS) return;
    lastWrite = now;
    // Snapshot ascending: the reads finish out of order, and a list that jumps around would
    // make the rows reshuffle in front of the officer.
    const seen = [...readPages].sort((a, b) => a - b);
    // Chained rather than fired in parallel, so two writes can never interleave and land
    // an older snapshot last.
    writing = writing.then(async () => {
      try {
        const current = await getDloIntake(client, progress.intakeId);
        const files = current?.files ? [...current.files] : null;
        const target = files?.[progress.index];
        if (!files || !target) return;
        files[progress.index] = { ...target, readPages: seen };
        await updateDloIntake(client, progress.intakeId, { files });
      } catch (error) {
        console.warn('[dlo] page progress write failed (ignored):', error);
      }
    });
  };

  const extracted = await runInCostScope(cost, () =>
    runInCostTask('document_ocr', () =>
      extractPdfPagesDetailed(entry.name, data, {
        source,
        pages,
        onPage: (page) => {
          readPages.push(page.page);
          reportProgress();
        },
      }),
    ),
  );
  // Let the last in-flight progress write land before the caller overwrites this entry with
  // its finished form, or a late write could resurrect a stale partial count.
  await writing;
  recordTasksFromCost(client, 'article', cost);
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
  const data = await downloadEntry(client, entry);
  const text = await extractDocxText(entry.name, data);
  return { ...entry, status: 'done', chars: text.length, text };
}

// A photograph of a document, read by the same model and under the same fidelity prompt a PDF
// page gets (@dgipr/content-engine's image-ocr.ts).
//
// Read HERE rather than at the input step, unlike a document: a scan stops at the input step
// because OCR is billed per PAGE and the officer has to choose which pages are worth it, but
// an image is one page and there is nothing to choose — so the only thing waiting in front of
// the form would buy is the wait itself. Metered like the PDF read for the same reason: this
// is a paid pixel read, and `dlo_intakes` has no cost column, so the usage event is the only
// record of it.
//
// Empty text is NOT a failure. A photograph carrying no readable words is a real answer, and
// the review card shows it as a source that contributed nothing — which is checkable — where a
// failed file reads as "something went wrong" and invites a pointless retry.
async function extractImageEntry(
  client: SupabaseClient,
  entry: DloIntakeFileEntry,
): Promise<DloIntakeFileEntry> {
  const data = await downloadEntry(client, entry);
  const cost = createCostAccumulator();
  const text = await runInCostScope(cost, () =>
    runInCostTask('document_ocr', () =>
      extractImageTextViaProvider(entry.name, data),
    ),
  );
  recordTasksFromCost(client, 'article', cost);
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

    // --- transcribe: every recording through the configured STT provider
    // (STT_PROVIDER; ElevenLabs by default, Sarvam's batch job as the rollback).
    // A job-level failure (auth/timeout) marks every audio file failed instead
    // of sinking the documents too.
    // Uploaded recordings AND pasted YouTube links, in one pass — they are the same job
    // to the STT seam, which takes either bytes we hold or a URL the provider fetches for
    // itself. The two differ in exactly two places below: a link has nothing to download,
    // and nothing to hash, so audio_transcript_cache (keyed on the bytes) does not apply
    // to it and its position is always a miss.
    const audioIndexes = entries.flatMap((entry, index) =>
      entry.kind === 'audio' || entry.kind === 'youtube' ? [index] : [],
    );
    if (audioIndexes.length > 0) {
      try {
        // Download every uploaded recording (needed for the batch anyway) and hash its
        // bytes. The hash is a cache key, but it is only CONSULTED under
        // TRANSCRIPT_CACHE_MODE=read; by default every recording is transcribed
        // afresh and the hash serves the write-back alone.
        const inputs: AudioInput[] = await Promise.all(
          audioIndexes.map(async (index) => {
            const entry = entries[index]!;
            if (entry.kind === 'youtube') {
              // Not downloaded HERE — the STT seam resolves a link to bytes with yt-dlp
              // before dispatch (YOUTUBE_AUDIO_SOURCE, default `download`; ElevenLabs'
              // own `source_url` fetching of YouTube broke on 2026-08-19). Below the
              // cache layer deliberately, so a YouTube source is still always a cache
              // miss: audio_transcript_cache is keyed on bytes we do not have at this
              // point. A 'youtube' entry always carries a sourceUrl (the create route
              // sets both together), so the fallback is unreachable defence.
              return { name: entry.name, sourceUrl: entry.sourceUrl ?? '' };
            }
            return {
              name: entry.name,
              data: await downloadEntry(client, entry),
            };
          }),
        );
        // A URL source has no bytes, so it has no cache key. The empty string is never
        // looked up as one — the loop below skips those positions outright.
        const hashes = inputs.map((input) =>
          isAudioUrlInput(input) ? '' : hashAudioContent(input.data),
        );

        // Off by default: nothing is reused, so every position below is a miss. Under
        // TRANSCRIPT_CACHE_MODE=read a cache read failure (e.g. an un-applied 0031)
        // must not sink transcription — treat it as an empty cache and transcribe all.
        let cached: Map<string, string>;
        if (transcriptCacheMode() === 'read') {
          try {
            cached = await getCachedTranscripts(
              client,
              hashes.filter((hash) => hash !== ''),
            );
          } catch (error) {
            console.error(
              `[dlo-intake ${id}] transcript cache read failed:`,
              error,
            );
            cached = new Map();
          }
        } else {
          cached = new Map();
        }

        // Fill cache hits immediately; collect the misses for one Sarvam batch,
        // remembering each miss's position so a result maps back to its file.
        const missPositions: number[] = [];
        for (const [position, index] of audioIndexes.entries()) {
          const hash = hashes[position]!;
          const hit = hash === '' ? undefined : cached.get(hash);
          if (hit !== undefined) {
            entries[index] = {
              ...entries[index]!,
              status: 'done',
              chars: hit.length,
              text: hit,
            };
          } else {
            missPositions.push(position);
          }
        }

        if (missPositions.length > 0) {
          // A cost scope purely for visibility: `dlo_intakes` has no cost column, so the
          // metered figure is LOGGED rather than persisted. Only the ElevenLabs path
          // records (it returns word timestamps to measure); a Sarvam run logs nothing.
          const cost = createCostAccumulator();
          const missedInputs = missPositions.map(
            (position) => inputs[position]!,
          );
          const transcriptionTask = missedInputs.every(isAudioUrlInput)
            ? 'youtube_transcription'
            : missedInputs.some(isAudioUrlInput)
              ? 'audio_youtube_transcription'
              : 'audio_transcription';
          const results = await runInCostScope(cost, () =>
            runInCostTask(transcriptionTask, () =>
              transcribeAudio(missedInputs),
            ),
          );
          if (cost.sttSeconds > 0) {
            console.log(
              `[dlo-intake ${id}] ${sttProviderName()} STT: ` +
                `${(cost.sttSeconds / 60).toFixed(1)} min, ` +
                `~$${totalCostUsd(cost).toFixed(4)}.`,
            );
          }
          // Attributed to लेख / बातमी, not to ध्वनिलेखन: this recording was transcribed on
          // the way to an article, and /transcribe is the standalone product. Same split
          // the analytics page draws everywhere else.
          recordTasksFromCost(client, 'article', cost);
          await Promise.all(
            results.map(async (result, resultIndex) => {
              const position = missPositions[resultIndex]!;
              const index = audioIndexes[position]!;
              if ('text' in result) {
                entries[index] = {
                  ...entries[index]!,
                  status: 'done',
                  chars: result.text.length,
                  text: result.text,
                };
                // Cache the fresh transcript for next time. Best-effort: a write
                // failure must not fail a file that just transcribed fine. A URL source
                // has no bytes and therefore no key, so it is simply not cached — the
                // cache is content-addressed and there is no content on our side.
                try {
                  if (hashes[position] !== '') {
                    await putCachedTranscript(
                      client,
                      hashes[position]!,
                      result.text,
                    );
                  }
                } catch (error) {
                  console.error(
                    `[dlo-intake ${id}] transcript cache write failed:`,
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
      } catch (error) {
        const message = errorMessage(error);
        for (const index of audioIndexes) {
          // A job-level failure (download/auth/timeout) fails only the recordings
          // still awaiting a result — anything already resolved (a cache hit in read
          // mode, a transcript that landed before the throw) stays done.
          if (entries[index]!.status === 'done') continue;
          entries[index] = {
            ...entries[index]!,
            status: 'failed',
            error: message,
          };
        }
      }
      await updateDloIntake(client, id, { files: entries });
    }

    // --- extract: documents and photographs one by one; each failure stays on its own file.
    // A PDF is only PROBED here — a scanned one waits at 'needs-selection' until the officer
    // says which pages are worth OCR'ing, so this phase never spends credits on a page nobody
    // asked for. DOCX is local and free, so it is simply read. An IMAGE is read outright: it
    // is one page with nothing to select, so there is no question to stop and ask.
    await updateDloIntake(client, id, { step: 'extract' });
    for (const [index, entry] of entries.entries()) {
      // A document the officer uploaded and read at the INPUT step arrives already
      // extracted, pages picked and corrections made. Re-reading it here would OCR a
      // scanned PDF a second time and throw away those corrections — so it is left alone.
      if (entry.status === 'done') continue;
      // Already failed before this phase ran — the only way that happens is the route rejecting
      // a document at create time (a deferred scan whose original could not be archived). Its
      // message is the actionable one; probing it would only fail again, less usefully.
      if (entry.status === 'failed') continue;
      if (
        entry.kind !== 'pdf' &&
        entry.kind !== 'docx' &&
        entry.kind !== 'image'
      ) {
        continue;
      }
      try {
        entries[index] =
          entry.kind === 'pdf'
            ? // A scan whose pages the officer already picked at the input step and chose not
              // to wait for. Probing it again would only park it at 'needs-selection' and ask
              // a question they have already answered, so it is read here instead — bounded to
              // their selection, so the spend gate is exactly the one they authorised.
              entry.pendingPages && entry.pendingPages.length > 0
              ? await extractPdfEntry(client, entry, entry.pendingPages, 'auto', {
                  intakeId: id,
                  index,
                })
              : await probePdfEntry(client, entry)
            : entry.kind === 'image'
              ? await extractImageEntry(client, entry)
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
    // A NEW-LANE source (/new-dlo) is a file the article model reads for itself, so it
    // contributes no text here and never will — see intake/openai-source-files.ts. That is
    // not "nothing survived"; it is the entire point of that lane. Without this an intake of
    // one scan and no typed note would fail at the last step with a message telling the
    // officer to check files that are perfectly fine.
    const readByModel = entries.some(
      (entry) => entry.status === 'done' && entry.openaiFileId,
    );
    if (!combined && !awaitingSelection && !readByModel) {
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
          'auto',
          { intakeId: id, index: selection.index },
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
      entries[index] = await extractPdfEntry(client, entry, pages, 'ocr', {
        intakeId: id,
        index,
      });
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
