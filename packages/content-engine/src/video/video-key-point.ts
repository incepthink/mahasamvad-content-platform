import { VIDEO_KEY_POINT_MAX_CHARS } from '@dgipr/schemas';

// A key point is burned onto the finished video. Keep the inexpensive,
// deterministic number check even though the model prompt is intentionally
// minimal: it is output validation, not an instruction sent to the model.
const DEVANAGARI_ZERO = 0x0966;

function toLatinDigits(text: string): string {
  return text.replace(/[०-९]/g, (digit) =>
    String(digit.codePointAt(0)! - DEVANAGARI_ZERO),
  );
}

export function keyPointIsGrounded(keyPoint: string, source: string): boolean {
  const numbers = toLatinDigits(keyPoint).match(/\d+/g);
  if (!numbers) return true;
  const haystack = toLatinDigits(source);
  return numbers.every((number) => haystack.includes(number));
}

export function keyPointOf(raw: string | undefined, source: string): string {
  const keyPoint = (raw ?? '').trim();
  if (keyPoint === '') return '';
  if (keyPoint.length > VIDEO_KEY_POINT_MAX_CHARS) {
    console.warn(
      `[video-script] dropping on-screen key point "${keyPoint}" — it is ` +
        `${keyPoint.length} characters, over the ${VIDEO_KEY_POINT_MAX_CHARS}-` +
        'character overlay budget. That scene will render without an overlay.',
    );
    return '';
  }
  if (keyPointIsGrounded(keyPoint, source)) return keyPoint;
  console.warn(
    `[video-script] dropping on-screen key point "${keyPoint}" — it carries a ` +
      'number that is not in the source. That scene will render without an overlay.',
  );
  return '';
}
