import { VIDEO_KEY_POINT_MAX_CHARS } from '@dgipr/schemas';
import { digitsAreGrounded } from '../generation/digit-grounding.js';

// A key point is burned onto the finished video. Keep the inexpensive,
// deterministic number check even though the model prompt is intentionally
// minimal: it is output validation, not an instruction sent to the model. The
// check itself is shared with the carousel planner (generation/digit-grounding.ts).
export function keyPointIsGrounded(keyPoint: string, source: string): boolean {
  return digitsAreGrounded(keyPoint, source);
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
