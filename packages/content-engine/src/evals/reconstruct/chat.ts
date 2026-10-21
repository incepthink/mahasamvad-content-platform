// चॅट (`/chat`): one thread. Each user message is paired with the assistant answer that follows
// it; attachments appear by name, images as pictures, and extracted text is NOT repeated (it is
// whole documents and transcripts — the name says what was attached).

import type { ChatMessageRow, ChatThreadRow } from '@dgipr/database';
import {
  compact,
  lastTimestamp,
  sortSpans,
  traceId,
  urlMedia,
  type ReconstructedTrace,
  type TraceSpan,
} from '../trace.js';

function attachmentsView(message: ChatMessageRow) {
  return message.attachments.map((attachment) =>
    attachment.kind === 'image' && attachment.imageUrl
      ? {
          kind: 'image',
          name: attachment.name,
          image: urlMedia(attachment.imageUrl, attachment.name),
        }
      : compact({
          kind: attachment.kind,
          name: attachment.name,
          chars: attachment.chars,
          youtubeUrl: attachment.sourceUrl,
        }),
  );
}

export function buildChatTrace(
  thread: ChatThreadRow,
  messages: readonly ChatMessageRow[],
): ReconstructedTrace {
  const ordered = [...messages].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );
  const spans: TraceSpan[] = [];
  let turn = 0;
  for (let i = 0; i < ordered.length; i += 1) {
    const message = ordered[i]!;
    if (message.role !== 'user') continue;
    const answer =
      ordered[i + 1]?.role === 'assistant' ? ordered[i + 1] : undefined;
    turn += 1;
    spans.push({
      key: `turn:${message.id}`,
      name: `turn ${turn}`,
      type: 'llm',
      startedAt: message.createdAt,
      input: compact({
        message: message.content,
        attachments: attachmentsView(message),
      }),
      output: answer
        ? compact({ answer: answer.content, error: answer.error })
        : { note: 'No answer stored for this message.' },
      metadata: compact({ model: answer?.model, costUsd: answer?.costUsd }),
    });
  }
  const errors = ordered.filter((m) => m.error).length;
  const sorted = sortSpans(spans);
  return {
    id: traceId('chat', thread.id),
    feature: 'chat',
    rowId: thread.id,
    name: `chat · ${turn} turn(s)`,
    startedAt: thread.createdAt,
    endedAt: lastTimestamp(thread.updatedAt, sorted),
    input: compact({ title: thread.title, firstMessage: ordered[0]?.content }),
    output: compact({
      lastAnswer: [...ordered].reverse().find((m) => m.role === 'assistant')
        ?.content,
    }),
    metadata: compact({
      feature: 'chat',
      lane: ordered.some((m) => m.attachments.length > 0)
        ? 'with-attachments'
        : 'text-only',
      reconstructed: true,
      status: errors > 0 ? 'has-error' : 'ok',
      createdAt: thread.createdAt,
      messageCount: ordered.length,
      costUsd: ordered.reduce((sum, m) => sum + (m.costUsd ?? 0), 0),
    }),
    spans: sorted,
    notes: [],
  };
}
