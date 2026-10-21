// /new-video-workflow, both modes on the same rows: नवीन व्हिडिओ (Gemini video turns) and
// Storyboard (an OpenAI chat that may paint pictures). One span per turn.

import type { NewVideoConversationRow, NewVideoTurnRow } from '@dgipr/database';
import {
  compact,
  lastTimestamp,
  sortSpans,
  traceId,
  urlMedia,
  type ReconstructedTrace,
  type TraceSpan,
} from '../trace.js';

export function buildNewVideoTrace(
  conversation: NewVideoConversationRow,
  turns: readonly NewVideoTurnRow[],
): ReconstructedTrace {
  const feature =
    conversation.mode === 'storyboard' ? 'storyboard' : 'new-video';
  const ordered = [...turns].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );
  const spans: TraceSpan[] = ordered.map((turn, index) => ({
    key: `turn:${turn.id}`,
    name: `turn ${index + 1}`,
    type: 'llm' as const,
    startedAt: turn.createdAt,
    input: compact({
      prompt: turn.prompt,
      pictures: turn.images.map((image) => urlMedia(image.url, image.name)),
    }),
    output: compact({
      video: turn.videoUrl ? urlMedia(turn.videoUrl) : null,
      answer: turn.modelText,
      generatedPictures: turn.generatedImages.map((image) =>
        compact({
          label: image.label,
          prompt: image.prompt,
          image: urlMedia(image.url),
        }),
      ),
      error: turn.error,
    }),
    // The provider interaction id is a handle, not something a reviewer reads; it stays out.
    metadata: { status: turn.status },
  }));
  const failed = ordered.filter((turn) => turn.status === 'failed').length;
  const last = ordered[ordered.length - 1];
  const sorted = sortSpans(spans);
  return {
    id: traceId(feature, conversation.id),
    feature,
    rowId: conversation.id,
    name: `${feature} · ${ordered.length} turn(s)`,
    startedAt: conversation.createdAt,
    endedAt: lastTimestamp(conversation.updatedAt, sorted),
    input: compact({
      firstPrompt: ordered[0]?.prompt,
      title: conversation.title,
    }),
    output: compact({
      lastVideo: last?.videoUrl ? urlMedia(last.videoUrl) : null,
      lastAnswer: last?.modelText,
    }),
    metadata: compact({
      feature,
      lane: ordered.length > 1 ? 'multi-turn' : 'single-turn',
      reconstructed: true,
      status: failed > 0 ? 'has-failed-turn' : (last?.status ?? 'empty'),
      createdAt: conversation.createdAt,
      turnCount: ordered.length,
      failedTurns: failed,
    }),
    spans: sorted,
    notes:
      feature === 'new-video'
        ? [
            'The cast (characters and voices) chosen for this conversation is not shown.',
          ]
        : [],
  };
}
