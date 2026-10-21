// Reconstructed traces for error analysis, round 1 (docs/evals-error-analysis.md).
//
// WHAT A "RECONSTRUCTED" TRACE IS. The product does not log full traces yet. What the database
// DOES hold for each user-facing job is what the officer supplied, what the platform produced,
// and how the officer reacted (feedback rounds, redos, downloads, publishes). A reconstructed
// trace lays those rows out as one root span plus child spans in time order, so an editor can
// read a run end to end and write down the FIRST thing that went wrong (open coding). It is not
// a record of the internal model calls, and `metadata.reconstructed: true` keeps it from ever
// being mistaken for one when instrumented traces arrive later.
//
// EVERYTHING HERE IS PURE. The builders in ./reconstruct take rows and return plain objects with
// no I/O, so they can be checked offline (reconstruct.check.ts). Pictures, clips and recordings
// are described by a MediaRef; only the uploader turns a MediaRef into bytes.
//
// NO IDENTITY. activity_events carries an IP, a device id and a user agent. None of them may
// reach a trace: `activitySpans` copies an allowlist of fields, never the row.

import { createHash } from 'node:crypto';

export const EVAL_FEATURES = [
  'creative',
  'dlo',
  'transcribe',
  'translate',
  'references',
  'storyboard',
  'new-video',
  'chat',
] as const;
export type EvalFeature = (typeof EVAL_FEATURES)[number];

export function isEvalFeature(value: string): value is EvalFeature {
  return (EVAL_FEATURES as readonly string[]).includes(value);
}

// Where the bytes behind a MediaRef live. `storage` is read with downloadFile (any bucket,
// public or private); `url` is fetched over HTTP (a public URL a row stored as such).
export type MediaRef = Readonly<{
  kind: 'media';
  role: 'image' | 'audio' | 'video' | 'document';
  filename: string;
  contentType: string;
  source:
    | Readonly<{ type: 'storage'; bucket: string; path: string }>
    | Readonly<{ type: 'url'; url: string }>;
  // True when the path is a naming convention rather than something a row recorded (e.g.
  // poster-v1.png). The uploader says "not found in storage" rather than failing the trace.
  derived?: boolean;
}>;

export type TraceSpanType = 'task' | 'llm' | 'tool' | 'function';

export type TraceSpan = Readonly<{
  // Stable within the trace: re-running the exporter rewrites the same rows.
  key: string;
  name: string;
  type: TraceSpanType;
  startedAt: string;
  input?: unknown;
  output?: unknown;
  metadata?: Readonly<Record<string, unknown>>;
}>;

export type ReconstructedTrace = Readonly<{
  // `<feature>:<row id>` — deterministic, so a re-run updates rather than duplicates.
  id: string;
  feature: EvalFeature;
  rowId: string;
  name: string;
  startedAt: string;
  endedAt: string | null;
  input: Readonly<Record<string, unknown>>;
  output: Readonly<Record<string, unknown>>;
  metadata: Readonly<Record<string, unknown>>;
  spans: readonly TraceSpan[];
  // Caveats the reviewer must see, e.g. "earlier draft not stored". Never invented content.
  notes: readonly string[];
}>;

export function traceId(feature: EvalFeature, rowId: string): string {
  return `${feature}:${rowId}`;
}

// A UUID-shaped id derived from a string (SHA-1, RFC 4122 v5 layout). Braintrust span ids are
// UUIDs by default; deriving them keeps the whole tree stable across re-runs.
export function stableUuid(name: string): string {
  const hash = createHash('sha1').update(`dgipr-evals:${name}`).digest();
  hash[6] = (hash[6]! & 0x0f) | 0x50;
  hash[8] = (hash[8]! & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  mp4: 'video/mp4',
  webm: 'audio/webm',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
  flac: 'audio/flac',
  aiff: 'audio/aiff',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain',
};

export function contentTypeFor(name: string): string {
  const ext = name.split('?')[0]!.split('.').pop()?.toLowerCase() ?? '';
  return CONTENT_TYPES[ext] ?? 'application/octet-stream';
}

function roleFor(contentType: string): MediaRef['role'] {
  if (contentType.startsWith('image/')) return 'image';
  if (contentType.startsWith('audio/')) return 'audio';
  if (contentType.startsWith('video/')) return 'video';
  return 'document';
}

function baseName(path: string): string {
  return path.split('?')[0]!.split('/').pop() || 'file';
}

export function storageMedia(
  bucket: string,
  path: string,
  options: { filename?: string; derived?: boolean } = {},
): MediaRef {
  const filename = options.filename ?? baseName(path);
  const contentType = contentTypeFor(path);
  return {
    kind: 'media',
    role: roleFor(contentType),
    filename,
    contentType,
    source: { type: 'storage', bucket, path },
    ...(options.derived ? { derived: true } : {}),
  };
}

export function urlMedia(url: string, filename?: string): MediaRef {
  const contentType = contentTypeFor(url);
  return {
    kind: 'media',
    role: roleFor(contentType),
    filename: filename ?? baseName(url),
    contentType,
    source: { type: 'url', url },
  };
}

export function isMediaRef(value: unknown): value is MediaRef {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { kind?: unknown }).kind === 'media'
  );
}

// Every MediaRef anywhere inside a trace, for the uploader and the harness.
export function collectMedia(value: unknown, out: MediaRef[] = []): MediaRef[] {
  if (isMediaRef(value)) {
    out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectMedia(item, out);
  } else if (typeof value === 'object' && value !== null) {
    for (const item of Object.values(value)) collectMedia(item, out);
  }
  return out;
}

// ---------------------------------------------------------------------------
// What happened next, from activity_events — action and status only.
// ---------------------------------------------------------------------------

export type ActivityLite = Readonly<{
  createdAt: string;
  settledAt: string | null;
  feature: string;
  action: string;
  status: string;
  subjectId: string | null;
  error: string | null;
}>;

// Columns read off activity_events. Deliberately excludes ip, device_id, user_agent and summary.
export const ACTIVITY_LITE_COLUMNS =
  'created_at,settled_at,feature,action,status,subject_id,error';

// Officer reactions that are not themselves a revision row (those get their own spans).
const REACTION_ACTIONS = /download|publish|retry|canva|copy|export|pdf/i;

export function activitySpans(events: readonly ActivityLite[]): TraceSpan[] {
  return events
    .filter((event) => REACTION_ACTIONS.test(event.action))
    .map((event, index) => ({
      key: `activity:${index}:${event.createdAt}`,
      name: `officer: ${event.action}`,
      type: 'function' as const,
      startedAt: event.createdAt,
      output: {
        action: event.action,
        status: event.status,
        ...(event.error ? { error: event.error } : {}),
      },
    }));
}

export function sortSpans(spans: readonly TraceSpan[]): TraceSpan[] {
  // Stable: equal timestamps keep the builder's order (input before output).
  return spans
    .map((span, index) => ({ span, index }))
    .sort(
      (a, b) =>
        Date.parse(a.span.startedAt) - Date.parse(b.span.startedAt) ||
        a.index - b.index,
    )
    .map(({ span }) => span);
}

export function lastTimestamp(
  base: string,
  spans: readonly TraceSpan[],
): string {
  let latest = base;
  for (const span of spans) {
    if (Date.parse(span.startedAt) > Date.parse(latest))
      latest = span.startedAt;
  }
  return latest;
}

// Drop undefined/null/empty-string fields so the reviewer is not shown a wall of nulls.
export function compact<T extends Record<string, unknown>>(
  value: T,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined || item === null) continue;
    if (typeof item === 'string' && item.trim() === '') continue;
    if (Array.isArray(item) && item.length === 0) continue;
    out[key] = item;
  }
  return out;
}

export const EARLIER_DRAFT_NOT_STORED =
  'Earlier draft not stored: the database keeps only the result of each revision, so the version before the first feedback round is not available.';
