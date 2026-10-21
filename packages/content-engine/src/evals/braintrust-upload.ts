// Sends reconstructed traces to a Braintrust project's logs.
//
// Two properties the review loop depends on:
//   * IDEMPOTENT. The root row id is the trace id (`<feature>:<row id>`) and every span id is
//     derived from it, so re-running the exporter REPLACES the same rows rather than adding a
//     second copy of each trace (and a second, unreviewed copy of every note).
//   * REAL BYTES. A poster, slide, clip or recording is uploaded as an Attachment, so the
//     reviewer sees the artifact itself rather than a storage path they cannot open (most of
//     these buckets are private or CDN paths nobody outside the team can read).

import { Attachment, initLogger } from 'braintrust';
import {
  downloadFile,
  storedObjectSize,
  type SupabaseClient,
} from '@dgipr/database';
import {
  isMediaRef,
  stableUuid,
  type MediaRef,
  type ReconstructedTrace,
} from './trace.js';

export const DEFAULT_BRAINTRUST_PROJECT = 'mahasamvad-error-analysis';

export type UploadOptions = Readonly<{
  client: SupabaseClient;
  projectName: string;
  maxAttachmentBytes: number;
  log?: (line: string) => void;
}>;

type ResolvedMedia = Attachment | Readonly<Record<string, unknown>>;

function seconds(iso: string): number {
  return Date.parse(iso) / 1000;
}

async function fetchUrl(
  url: string,
  maxBytes: number,
): Promise<Buffer | 'too-large'> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const length = Number(response.headers.get('content-length') ?? 0);
  if (length > maxBytes) return 'too-large';
  const bytes = Buffer.from(await response.arrayBuffer());
  return bytes.length > maxBytes ? 'too-large' : bytes;
}

async function resolveMedia(
  ref: MediaRef,
  options: UploadOptions,
): Promise<ResolvedMedia> {
  const where =
    ref.source.type === 'storage'
      ? `${ref.source.bucket}/${ref.source.path}`
      : ref.source.url;
  const placeholder = (reason: string) => ({
    attachmentOmitted: reason,
    filename: ref.filename,
    location: where,
  });
  try {
    let bytes: Buffer | 'too-large';
    if (ref.source.type === 'storage') {
      const size = await storedObjectSize(ref.source.bucket, ref.source.path);
      if (size === null) {
        return placeholder(
          ref.derived
            ? 'not found in storage (earlier version not kept)'
            : 'not found in storage',
        );
      }
      bytes =
        size > options.maxAttachmentBytes
          ? 'too-large'
          : await downloadFile(
              options.client,
              ref.source.bucket,
              ref.source.path,
            );
    } else {
      bytes = await fetchUrl(ref.source.url, options.maxAttachmentBytes);
    }
    if (bytes === 'too-large') {
      return placeholder(
        `larger than ${Math.round(options.maxAttachmentBytes / 1_048_576)} MB`,
      );
    }
    const data = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    return new Attachment({
      data,
      filename: ref.filename,
      contentType: ref.contentType,
    });
  } catch (error) {
    return placeholder(
      `could not be read: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

// Replace every MediaRef in a value with its Attachment (or a placeholder saying why not). One
// cache per run, so a poster shown in two spans is read and uploaded once.
async function withAttachments(
  value: unknown,
  cache: Map<string, Promise<ResolvedMedia>>,
  options: UploadOptions,
): Promise<unknown> {
  if (isMediaRef(value)) {
    const key = JSON.stringify(value.source);
    let pending = cache.get(key);
    if (!pending) {
      pending = resolveMedia(value, options);
      cache.set(key, pending);
    }
    return pending;
  }
  if (Array.isArray(value)) {
    return Promise.all(
      value.map((item) => withAttachments(item, cache, options)),
    );
  }
  if (typeof value === 'object' && value !== null) {
    const entries = await Promise.all(
      Object.entries(value).map(
        async ([key, item]) =>
          [key, await withAttachments(item, cache, options)] as const,
      ),
    );
    return Object.fromEntries(entries);
  }
  return value;
}

// Replace every MediaRef inside a value with an Attachment (or a note saying why not). Used by
// the live job tracer (tracing/generation-trace.ts) for posters, slides and source files.
export function resolveMediaRefs(
  value: unknown,
  client: SupabaseClient,
  maxAttachmentBytes: number,
): Promise<unknown> {
  return withAttachments(value, new Map(), {
    client,
    projectName: '',
    maxAttachmentBytes,
  });
}

export async function uploadTraces(
  traces: readonly ReconstructedTrace[],
  options: UploadOptions,
): Promise<void> {
  const apiKey = process.env.BRAINTRUST_API_KEY;
  if (!apiKey) {
    throw new Error(
      'BRAINTRUST_API_KEY is not set. Add it to the root .env (see .env.example).',
    );
  }
  const logger = initLogger({
    projectName: options.projectName,
    apiKey,
    asyncFlush: true,
    setCurrent: false,
  });
  const cache = new Map<string, Promise<ResolvedMedia>>();
  for (const trace of traces) {
    const resolve = (value: unknown) => withAttachments(value, cache, options);
    const root = logger.startSpan({
      name: trace.name,
      type: 'task',
      spanId: stableUuid(trace.id),
      startTime: seconds(trace.startedAt),
      event: {
        id: trace.id,
        input: await resolve(trace.input),
        output: await resolve(trace.output),
        metadata: {
          ...trace.metadata,
          ...(trace.notes.length > 0 ? { reviewNotes: trace.notes } : {}),
        },
      },
    });
    for (const span of trace.spans) {
      const spanKey = `${trace.id}/${span.key}`;
      const child = root.startSpan({
        name: span.name,
        type: span.type,
        spanId: stableUuid(spanKey),
        startTime: seconds(span.startedAt),
        event: {
          id: spanKey,
          ...(span.input !== undefined
            ? { input: await resolve(span.input) }
            : {}),
          ...(span.output !== undefined
            ? { output: await resolve(span.output) }
            : {}),
          ...(span.metadata ? { metadata: { ...span.metadata } } : {}),
        },
      });
      child.end({ endTime: seconds(span.startedAt) });
    }
    root.end({ endTime: seconds(trace.endedAt ?? trace.startedAt) });
    options.log?.(`uploaded ${trace.id} (${trace.spans.length} spans)`);
  }
  await logger.flush();
}
