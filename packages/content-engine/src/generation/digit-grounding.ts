// Every digit run in a generated line must occur in the source. The inexpensive,
// deterministic half of "never invent an amount, a date or a count": a model asked to lay out
// the officer's note can still slip a figure that is not in it, and a figure on an official
// poster is exactly the kind of error nobody catches by eye.
//
// Compared in ONE script, so `31` is accepted against a note that wrote `३१` and vice versa —
// re-scripting a numeral is allowed, re-valuing one is not. Generalised out of the /video
// key-point guard (video/video-key-point.ts), which now delegates here, so the carousel planner
// and the video overlay cannot disagree about what "grounded" means.

const DEVANAGARI_ZERO = 0x0966;

export function toLatinDigits(text: string): string {
  return text.replace(/[०-९]/g, (digit) =>
    String(digit.codePointAt(0)! - DEVANAGARI_ZERO),
  );
}

export function toDevanagariDigits(text: string): string {
  return text.replace(/[0-9]/g, (digit) =>
    String.fromCodePoint(DEVANAGARI_ZERO + Number(digit)),
  );
}

/** True when every digit run in `text` also occurs in `source` (either numeral script). */
export function digitsAreGrounded(text: string, source: string): boolean {
  const numbers = toLatinDigits(text).match(/\d+/g);
  if (!numbers) return true;
  const haystack = toLatinDigits(source);
  return numbers.every((number) => haystack.includes(number));
}
