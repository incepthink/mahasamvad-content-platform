// क्रिएटिव्ह आणि सोशल (`/`): one generation that did NOT come from a /dlo intake, on any of the
// format picker's lanes — social poster, caption only, article poster, YouTube thumbnail,
// carousel, Dynamic Poster.

import type { GenerationRow, RevisionRow } from '@dgipr/database';
import {
  activitySpans,
  compact,
  EARLIER_DRAFT_NOT_STORED,
  lastTimestamp,
  sortSpans,
  storageMedia,
  traceId,
  type ActivityLite,
  type ReconstructedTrace,
  type TraceSpan,
} from '../trace.js';
import {
  carouselSlides,
  creativeLane,
  firstMotionPath,
  firstPosterPath,
  generationInput,
  generationMetadata,
  generationOutput,
  posterMedia,
  POSTER_V1_NOTE,
  revisionSpans,
} from './generation-common.js';
import { VIDEOS_BUCKET } from '@dgipr/database';

export function buildCreativeTrace(
  row: GenerationRow,
  revisions: readonly RevisionRow[],
  activity: readonly ActivityLite[],
): ReconstructedTrace {
  const lane = creativeLane(row);
  const notes: string[] = [];
  const spans: TraceSpan[] = [];
  const ordered = [...revisions].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );

  spans.push({
    key: 'input',
    name: 'officer input',
    type: 'function',
    startedAt: row.createdAt,
    input: generationInput(row),
  });

  // v1. With no revisions the current output IS v1; with revisions only the poster/clip can be
  // recovered (by naming convention), never the text.
  if (ordered.length === 0) {
    spans.push({
      key: 'v1',
      name: 'first output (v1)',
      type: 'task',
      startedAt: row.createdAt,
      output: generationOutput(row),
    });
  } else {
    const v1: Record<string, unknown> = {};
    if (row.posterPath && lane !== 'carousel' && lane !== 'dynamic-poster') {
      v1.poster = posterMedia(firstPosterPath(row.id), true);
      notes.push(POSTER_V1_NOTE);
    }
    if (lane === 'dynamic-poster' && row.motionPath) {
      v1.motionClip = storageMedia(VIDEOS_BUCKET, firstMotionPath(row.id), {
        derived: true,
      });
    }
    const textEdited = ordered.some((r) =>
      [
        'article',
        'caption',
        'manual_caption',
        'poster_copy',
        'manual_copy',
      ].includes(r.target),
    );
    if (textEdited) notes.push(EARLIER_DRAFT_NOT_STORED);
    spans.push({
      key: 'v1',
      name: 'first output (v1)',
      type: 'task',
      startedAt: row.createdAt,
      output: compact({
        ...v1,
        note: textEdited
          ? 'Earlier text version not stored.'
          : Object.keys(v1).length === 0
            ? 'Earlier version not stored.'
            : null,
      }),
    });
  }

  spans.push(...revisionSpans(ordered));

  // A carousel keeps its history per slide (no revision rows), so each later version of a slide
  // is its own round.
  if (lane === 'carousel') {
    for (const slide of carouselSlides(row.carousel)) {
      slide.versions.forEach((version, index) => {
        if (index === 0) return;
        spans.push({
          key: `slide:${slide.index}:v${index + 1}`,
          name: `slide ${slide.index + 1} redo (version ${index + 1})`,
          type: 'task',
          startedAt: version.createdAt,
          input: compact({ feedback: version.feedback }),
          output: { image: posterMedia(version.path) },
        });
      });
    }
  }

  spans.push(...activitySpans(activity));

  if (row.status === 'failed') {
    spans.push({
      key: 'failure',
      name: 'run failed',
      type: 'function',
      startedAt: row.updatedAt,
      output: compact({ error: row.error, step: row.step }),
    });
  }

  const sorted = sortSpans(spans);
  return {
    id: traceId('creative', row.id),
    feature: 'creative',
    rowId: row.id,
    name: `creative · ${lane}`,
    startedAt: row.createdAt,
    endedAt: lastTimestamp(row.updatedAt, sorted),
    input: generationInput(row),
    output: generationOutput(row),
    metadata: {
      feature: 'creative',
      lane,
      reconstructed: true,
      feedbackRounds: ordered.length,
      ...generationMetadata(row),
    },
    spans: sorted,
    notes,
  };
}
