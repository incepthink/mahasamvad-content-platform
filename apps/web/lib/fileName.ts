// One place that decides how a file name is DISPLAYED.
//
// The bug this exists for: an officer's phone photograph arrives named
// `54254676-ae8d-4efc-a2ad-aca8b0bfa729-1_all_32002.jpg` — 45 characters with no space and
// no other break opportunity — and every surface that showed it (the /dlo review card, the
// upload lists, the document intake hints, the transcription result) pushed its whole page
// sideways on a phone. A name that long is also unreadable: what tells one phone snap from
// another is the picture, and what tells one document from another is its first few words
// plus its extension.
//
// So the name is TRIMMED for display and the full one is kept in a `title` (see
// components/FileName). Trimming rather than relying on CSS ellipsis alone, because a name
// is often rendered INLINE beside other text (`<FileText /> {fileName} · N pages`), where
// `text-overflow` does nothing at all — the CSS in globals.css is the second half of the
// fix, for the case where even a trimmed name is wider than a 390px card.

/** Display budget, in characters. Fits a phone card beside a chip and a counter. */
export const FILE_NAME_MAX_CHARS = 34;

/** Longer budget for a work-list title, which is a whole row of its own. Matches the API's
 *  own 80-character note excerpt (`TITLE_EXCERPT_CHARS` in routes/dlo.ts), so a list mixes
 *  excerpts and file names at one length. */
export const FILE_TITLE_MAX_CHARS = 80;

/** A real extension, short and alphanumeric — `.jpg`, `.docx`, `.mp3`. Deliberately not
 *  "anything after the last dot": a YouTube title or a note excerpt may end in `…देशपांडे`
 *  or carry a dot mid-sentence, and neither has an extension to protect. */
const EXTENSION = /\.[A-Za-z0-9]{1,8}$/;

/** Devanagari dependent signs (matras, anusvara, virama, nukta). A trim must never end on
 *  one: a matra split from its consonant renders as a stray mark, which is exactly the class
 *  of Devanagari damage the rest of this product goes out of its way to avoid. */
const TRAILING_COMBINING =
  /[\u0900-\u0903\u093A-\u094D\u0951-\u0957\u0962\u0963\u200C\u200D]+$/;

function cut(chars: readonly string[], length: number): string {
  return chars
    .slice(0, Math.max(0, length))
    .join('')
    .replace(TRAILING_COMBINING, '');
}

/**
 * Shorten a file name for display, keeping its extension.
 *
 * Under the budget the string is returned unchanged, so a caller can compare the two to
 * decide whether a `title` tooltip is worth adding. Over it, a name WITH an extension is cut
 * in the middle (`54254676-ae8d-4efc…_32002.jpg` — the kind still legible), and anything
 * else, which is prose rather than a file name, is cut at the end where a sentence reads
 * naturally.
 */
export function shortFileName(
  name: string,
  max: number = FILE_NAME_MAX_CHARS,
): string {
  const trimmed = name.trim();
  const chars = Array.from(trimmed);
  if (chars.length <= max) return trimmed;

  const ext = EXTENSION.exec(trimmed)?.[0] ?? '';
  const extLength = Array.from(ext).length;

  // No extension worth keeping, or one so long that keeping it would leave no name at all.
  if (extLength === 0 || extLength + 6 > max) {
    return `${cut(chars, max - 1)}…`;
  }

  return `${cut(chars, max - extLength - 1)}…${ext}`;
}
