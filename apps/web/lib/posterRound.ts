// One pixel-feedback round for POST /generations/:id/poster/image-feedback, built from what
// is marked on the poster plus an optional overall instruction. Shared by the social and
// article poster cards (and the edit assistant acting on either) so they send the same shape.
//
// The schema wants ABSENT keys, not '' / [] (its min lengths reject those). A blue box's note
// is genuinely optional — an empty one means "you decide where that content goes" — so it is
// omitted rather than sent blank. `markerNotes` overrides the notes typed beside the red
// marks, position by position; the edit assistant uses it to fill the ones left blank.

import type { PosterImageFeedbackRequest } from '@dgipr/schemas';
import type {
  PosterClearDraft,
  PosterMarkerDraft,
} from '../components/PosterAnnotator';

export function posterRoundPayload(
  markers: readonly PosterMarkerDraft[],
  clearRegions: readonly PosterClearDraft[],
  options: { feedback?: string; markerNotes?: readonly string[] } = {},
): PosterImageFeedbackRequest {
  const feedback = options.feedback?.trim() ?? '';
  return {
    ...(feedback.length >= 3 ? { feedback } : {}),
    ...(markers.length > 0
      ? {
          annotations: markers.map((m, i) => ({
            region: m.region,
            note: (options.markerNotes?.[i] ?? m.note).trim(),
          })),
        }
      : {}),
    ...(clearRegions.length > 0
      ? {
          clearRegions: clearRegions.map((c) => ({
            region: c.region,
            action: c.action,
            ...(c.note.trim().length > 0 ? { note: c.note.trim() } : {}),
          })),
        }
      : {}),
  };
}
