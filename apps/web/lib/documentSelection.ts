'use client';

// The bookkeeping behind every page picker in the product, kept in one place so
// /translate, /dlo, the media room and /proofread agree on what "the selected text" means.
//
// Deliberately NOT a state container. The surfaces disagree about how to hold a selection,
// for good reasons: /translate tracks the page numbers it WANTS, while /dlo tracks the
// source keys the officer EXCLUDED (it spans several files plus the notes, so "everything
// is in until you take it out" is the only sane default there). Forcing either to invert
// would cost more than it saves. So this module is pure functions over whatever the caller
// holds, and <DocumentPages> asks a predicate rather than reading a Set.
//
// Edits are keyed by string, not page number, for the same reason: a page number is unique
// within one document but /dlo shows several at once, so it keys by `${fileIndex}:${page}`.
// Anything single-document uses the default key — the page number itself.

// `language` is optional because not every surface's page carries it (a /dlo page does
// not); where it is present the page list badges it.
export type PageLike = Readonly<{
  page: number;
  text: string;
  language?: 'mr' | 'en' | undefined;
}>;

export const defaultPageKey = (page: number): string => String(page);

// The page numbers to list for a document that has NOT been read yet: its text does not
// exist, only the count from the free probe, and that list is exactly what the user is
// choosing to buy.
export function numberedPages(count: number): number[] {
  return Array.from({ length: count }, (_, index) => index + 1);
}

export function togglePage(
  selected: ReadonlySet<number>,
  page: number,
): Set<number> {
  const next = new Set(selected);
  if (next.has(page)) next.delete(page);
  else next.add(page);
  return next;
}

export function setPages(
  selected: ReadonlySet<number>,
  pages: readonly number[],
  include: boolean,
): Set<number> {
  const next = new Set(selected);
  for (const page of pages) {
    if (include) next.add(page);
    else next.delete(page);
  }
  return next;
}

// Devanagari digits (०-९) → ASCII, so a range typed in Marathi numerals parses like a
// Latin one. The rest of the string (spaces, commas, hyphens) is script-independent.
const DEVANAGARI_DIGITS = '०१२३४५६७८९';
function normalizeDigits(input: string): string {
  return input.replace(/[०-९]/g, (ch) => String(DEVANAGARI_DIGITS.indexOf(ch)));
}

// Parse a page-range string ("1-5, 8, 10-12", Marathi digits accepted) into the page
// numbers it names, keeping only pages that actually exist in `listed`. Everything
// unparseable — stray words, out-of-range numbers, reversed ranges — is silently dropped,
// because this drives a live selection as the user types and must never throw. The result
// is deduped and sorted so it can be compared or fed straight to a selection.
export function parsePageRanges(
  input: string,
  listed: readonly number[],
): number[] {
  const allowed = new Set(listed);
  const picked = new Set<number>();
  for (const part of normalizeDigits(input).split(',')) {
    const trimmed = part.trim();
    if (trimmed.length === 0) continue;
    const range = trimmed.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      const [lo, hi] = start <= end ? [start, end] : [end, start];
      for (let page = lo; page <= hi; page += 1) {
        if (allowed.has(page)) picked.add(page);
      }
      continue;
    }
    const single = trimmed.match(/^\d+$/);
    if (single) {
      const page = Number(trimmed);
      if (allowed.has(page)) picked.add(page);
    }
  }
  return [...picked].sort((a, b) => a - b);
}

// Compress a selected set back into the "1-5, 8, 10-12" form the range input shows. Runs
// of consecutive pages collapse to a hyphenated range; a lone page stands alone.
export function formatPageRanges(pages: readonly number[]): string {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  const parts: string[] = [];
  let start: number | null = null;
  let prev: number | null = null;
  const flush = () => {
    if (start === null || prev === null) return;
    parts.push(start === prev ? `${start}` : `${start}-${prev}`);
  };
  for (const page of sorted) {
    if (start === null) {
      start = page;
      prev = page;
    } else if (prev !== null && page === prev + 1) {
      prev = page;
    } else {
      flush();
      start = page;
      prev = page;
    }
  }
  flush();
  return parts.join(', ');
}

// One page's text as the user currently sees it: their correction if they made one, the
// extracted text otherwise.
export function pageText(
  page: PageLike,
  edits?: Readonly<Record<string, string>>,
  keyOf: (page: number) => string = defaultPageKey,
): string {
  return edits?.[keyOf(page.page)] ?? page.text;
}

// The selected pages as one string, joined with a blank line so a page break reads as a
// paragraph break. This is what a surface actually sends onward — the note, the text to
// proofread, the pages to translate.
export function joinPageTexts(
  pages: readonly PageLike[],
  options?: Readonly<{
    isSelected?: ((page: number) => boolean) | undefined;
    edits?: Readonly<Record<string, string>> | undefined;
    keyOf?: ((page: number) => string) | undefined;
  }>,
): string {
  const keyOf = options?.keyOf ?? defaultPageKey;
  return pages
    .filter((page) => options?.isSelected?.(page.page) ?? true)
    .map((page) => pageText(page, options?.edits, keyOf))
    .filter((text) => text.trim().length > 0)
    .join('\n\n');
}

// Drop every edit belonging to one file — used after an OCR re-read, whose new pages have
// nothing to do with the corrections made to the old ones.
export function forgetPageEdits<T>(
  map: Readonly<Record<string, T>>,
  keyOf: (page: number) => string,
  pages: readonly number[],
): Record<string, T> {
  const drop = new Set(pages.map(keyOf));
  return Object.fromEntries(
    Object.entries(map).filter(([key]) => !drop.has(key)),
  );
}
