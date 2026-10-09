// Read the numbers back off a finished poster and report any the source does not contain.
//
// Why it exists: the image model paints the Devanagari, and ONE and NINE look alike — generation
// 93f948da printed «९९» for the officer's «११». The prompt now spells every number digit by digit
// (poster-numerals.ts), which lowers the rate but cannot remove it, so the officer is told when a
// poster carries a number that is not in the source.
//
// WARN ONLY, deliberately. The reader (the image OCR seam, Sarvam by default) can misread a digit
// too — the repo has measured exactly that — so this is a "please check the numbers" notice, never
// a failed run or an automatic re-render (which would be another paid image call). Best-effort in
// every way: any failure logs and returns null, and a source with no numbers is not read at all.
import {
  extractImageTextViaProvider,
  extractNumeralRuns,
  findUnsupportedNumerals,
} from '@dgipr/content-engine';

export type PosterNumeralWarning = { numbers: string[] };

const READ_TIMEOUT_MS = 90_000;

export async function checkPosterNumerals(
  id: string,
  rawPoster: Buffer,
  sourceText: string,
): Promise<PosterNumeralWarning | null> {
  if (extractNumeralRuns(sourceText).length === 0) return null;
  try {
    const read = await extractImageTextViaProvider('poster.png', rawPoster, {
      timeoutMs: READ_TIMEOUT_MS,
    });
    const numbers = findUnsupportedNumerals(read, sourceText);
    console.log(
      `[job ${id}] numeral check: ${
        numbers.length > 0
          ? `poster shows ${numbers.join(', ')} — not in the source`
          : 'every number on the poster is in the source'
      }`,
    );
    return numbers.length > 0 ? { numbers } : null;
  } catch (error) {
    console.warn(
      `[job ${id}] numeral check failed (poster kept): ${(error as Error).message}`,
    );
    return null;
  }
}
