// ध्वनिलेखन (`/transcribe`): recordings (and YouTube links) in, Marathi text out. One span per
// recording, so a reviewer hears the audio next to its transcript.

import { DLO_UPLOADS_BUCKET, type TranscriptionRow } from '@dgipr/database';
import {
  activitySpans,
  compact,
  lastTimestamp,
  sortSpans,
  storageMedia,
  traceId,
  type ActivityLite,
  type ReconstructedTrace,
  type TraceSpan,
} from '../trace.js';

export function buildTranscriptionTrace(
  row: TranscriptionRow,
  activity: readonly ActivityLite[],
): ReconstructedTrace {
  const recordings = row.files.map((file) =>
    compact({
      name: file.name,
      audio: file.storagePath
        ? storageMedia(DLO_UPLOADS_BUCKET, file.storagePath, {
            filename: file.name,
          })
        : null,
      youtubeUrl: file.sourceUrl,
      trim: file.trim,
    }),
  );
  const spans: TraceSpan[] = row.files.map((file, index) => ({
    key: `recording:${index}`,
    name: `recording ${index + 1}: ${file.name}`,
    type: 'tool' as const,
    startedAt: row.createdAt,
    input: recordings[index],
    output: compact({ transcript: file.text, error: file.error }),
    metadata: compact({
      status: file.status,
      cached: file.cached,
      chars: file.chars,
      bytes: file.bytes,
    }),
  }));
  spans.push(...activitySpans(activity));
  if (row.status === 'failed') {
    spans.push({
      key: 'failure',
      name: 'run failed',
      type: 'function',
      startedAt: row.updatedAt,
      output: compact({ error: row.error }),
    });
  }
  const sorted = sortSpans(spans);
  return {
    id: traceId('transcribe', row.id),
    feature: 'transcribe',
    rowId: row.id,
    name: `transcribe · ${row.files.length} recording(s)`,
    startedAt: row.createdAt,
    endedAt: lastTimestamp(row.updatedAt, sorted),
    input: { recordings },
    output: compact({ transcript: row.combinedText }),
    metadata: compact({
      feature: 'transcribe',
      lane: row.files.some((f) => f.sourceUrl) ? 'youtube' : 'upload',
      reconstructed: true,
      status: row.status,
      error: row.error,
      createdAt: row.createdAt,
      fileCount: row.fileCount,
      failedCount: row.failedCount,
      charCount: row.charCount,
    }),
    spans: sorted,
    notes: [],
  };
}
