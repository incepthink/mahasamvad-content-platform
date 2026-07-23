'use client';

// The bookkeeping behind /dlo's review step, kept out of the page and the card so
// both agree on one thing: how the officer's per-source edits and page selection
// become the single text that is sent as the generation's note.
//
// State is two flat maps keyed by a source key — `notes`, `${fileIndex}` for a
// whole file, `${fileIndex}:${page}` for one PDF page — rather than nested
// per-file objects, because every operation here is a lookup and nothing ever
// needs a file's keys as a group except the OCR re-read (which clears by prefix).
//
// Assembly uses combineIntakeSources from @dgipr/schemas — the SAME function the
// intake job used to write combined_text, so the `=== स्रोत: … ===` headers the
// article pipeline sees are identical whether the text came from here or the job.

import { combineIntakeSources, type DloIntakeFile } from '@dgipr/schemas';

export const NOTES_KEY = 'notes';

export function sourceKey(index: number): string {
  return String(index);
}

export function pageKey(index: number, page: number): string {
  return `${index}:${page}`;
}

// The page numbers a PDF card lists. Normally the pages actually READ — which, after a
// partial read, is not 1..n. A scanned file still awaiting its selection has read none of
// them, so it lists every page the document has instead: that list is exactly what the
// officer is choosing from, and the count came free from the probe.
export function filePageNumbers(file: DloIntakeFile): number[] | null {
  if (file.pages) return file.pages.map((page) => page.page);
  if (file.status === 'needs-selection' && file.pageCount !== undefined) {
    return Array.from({ length: file.pageCount }, (_, index) => index + 1);
  }
  return null;
}

// Whether any PDF here is still waiting for the officer to say which pages are worth
// OCR'ing. Such a file contributes nothing to the assembled note until it is read, so
// generating while one is outstanding would quietly drop a whole source.
export function hasPendingSelection(files: readonly DloIntakeFile[]): boolean {
  return files.some((file) => file.status === 'needs-selection');
}

// The page choices to send to /extract: one entry per unread PDF, carrying only the pages
// left ticked. A file with everything unticked is omitted — the officer has said they want
// none of it, and asking for zero pages is not a request worth making.
export function pendingSelections(
  files: readonly DloIntakeFile[],
  excluded: ReadonlySet<string>,
): Array<{ index: number; pages: number[] }> {
  return files.flatMap((file, index) => {
    if (file.status !== 'needs-selection') return [];
    const pages = (filePageNumbers(file) ?? []).filter(
      (page) => !excluded.has(pageKey(index, page)),
    );
    return pages.length > 0 ? [{ index, pages }] : [];
  });
}

// One source's contribution: a PDF's selected pages joined with a blank line (a
// page break reads as a paragraph break, as the job's own flattening did), or the
// whole text of an audio/DOCX source. A PDF still awaiting its page selection has no
// pages yet and so contributes nothing.
export function sourceText(
  file: DloIntakeFile,
  index: number,
  edits: Readonly<Record<string, string>>,
  excluded: ReadonlySet<string>,
): string {
  if (file.pages) {
    return file.pages
      .filter((page) => !excluded.has(pageKey(index, page.page)))
      .map((page) => edits[pageKey(index, page.page)] ?? page.text)
      .filter((text) => text.trim().length > 0)
      .join('\n\n');
  }
  if (excluded.has(sourceKey(index))) return '';
  return edits[sourceKey(index)] ?? file.text ?? '';
}

export function assembleDloText(
  notes: string,
  files: readonly DloIntakeFile[],
  edits: Readonly<Record<string, string>>,
  excluded: ReadonlySet<string>,
): string {
  const notesText = excluded.has(NOTES_KEY) ? '' : (edits[NOTES_KEY] ?? notes);
  return combineIntakeSources(
    notesText,
    files.map((file, index) => ({
      label: file.name,
      text: sourceText(file, index, edits, excluded),
    })),
  );
}

// Whether this intake carries per-source text at all. An intake created before
// this feature shipped has extracted files with no text on them — only the
// combined text — so the review step falls back to its old single textarea
// instead of showing a row of empty cards.
export function hasPerSourceText(files: readonly DloIntakeFile[]): boolean {
  return files.every(
    (file) =>
      file.status !== 'done' ||
      file.text !== undefined ||
      file.pages !== undefined,
  );
}

// Drop everything remembered about one file — used after an OCR re-read, whose
// new pages have nothing to do with the corrections made to the old ones. Other
// sources' edits survive, which is the whole point of keying state per source.
export function forgetFile<T>(
  map: Readonly<Record<string, T>>,
  index: number,
): Record<string, T> {
  const prefix = `${index}:`;
  return Object.fromEntries(
    Object.entries(map).filter(
      ([key]) => key !== sourceKey(index) && !key.startsWith(prefix),
    ),
  );
}

export function forgetFileKeys(
  keys: ReadonlySet<string>,
  index: number,
): Set<string> {
  const prefix = `${index}:`;
  return new Set(
    [...keys].filter(
      (key) => key !== sourceKey(index) && !key.startsWith(prefix),
    ),
  );
}
