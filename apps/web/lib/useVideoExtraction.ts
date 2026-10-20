'use client';

// The browser half of "a video is a recording": run the audio extraction
// (lib/extractRecordingAudio.ts) in a Web Worker, one video at a time, and hand each finished
// `.m4a`/`.webm` to the composer EXACTLY as if the officer had picked an audio file.
//
// Three composers pick recordings — /dlo, /transcribe and /chat — and all three use this file,
// so a video is accepted, converted, shown and refused the same way everywhere:
//
//   splitRecordingPicks      which picks are audio (unchanged path) and which need extracting;
//   useVideoExtraction       the jobs in flight, as AttachmentStrip cards with a progress line,
//                            and `busy` so a composer can hold its send until they land;
//   runRecordingExtraction   the queue itself, for /chat's tray, which has its own card model;
//   wasExtractedFromVideo    so a finished recording's card can say "व्हिडिओमधून" — otherwise
//                            `meeting.mp4` silently turning into `meeting.m4a` reads as a bug.
//
// ONE AT A TIME, across the whole page: a re-encode is CPU-bound and a copy reads the whole
// file, so two in parallel finish no sooner and make both progress bars crawl.
//
// Nothing here imports mediabunny: it is loaded only inside the worker chunk (or, where a
// Worker cannot be built, by a dynamic import), so no page bundle carries it.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Film, Minimize2 } from 'lucide-react';
import { needsAudioExtraction } from '@dgipr/schemas';
import type { AttachmentItem } from '@/components/common/AttachmentStrip';
import type {
  ExtractedRecording,
  RecordingExtractionErrorCode,
} from './extractRecordingAudio';
import type {
  ExtractionWorkerMessage,
  ExtractionWorkerMode,
} from './extractRecordingAudio.worker';
import { STR } from './strings';

// ---------- which picks need the extraction ----------

// Every video, plus every `.webm` (probed, and passed through untouched when it holds no
// video). Everything else keeps the ordinary audio path — including files of the wrong kind,
// which that path's own check rejects with the surface's message.
export function splitRecordingPicks(picked: readonly File[]): {
  audio: File[];
  videos: File[];
} {
  const audio: File[] = [];
  const videos: File[] = [];
  for (const file of picked) {
    (needsAudioExtraction(file.name) ? videos : audio).push(file);
  }
  return { audio, videos };
}

// ---------- the "from a video" / "shrunk" badges ----------

const fromVideo = new WeakSet<File>();
// Recordings shrunk before upload (`compress` mode) — badged so `meeting.wav` turning into
// `meeting.webm` reads as intended rather than as a bug.
const compressed = new WeakSet<File>();

export function wasExtractedFromVideo(file: File): boolean {
  return fromVideo.has(file);
}

// A recording card's second line, badged when the file was made from a video or shrunk.
export function recordingCardMeta(file: File, meta: string): string {
  if (wasExtractedFromVideo(file))
    return `${STR.videoExtractedBadge} · ${meta}`;
  if (compressed.has(file)) return `${STR.audioCompressedBadge} · ${meta}`;
  return meta;
}

// ---------- the failure the officer is told about ----------

// Its message is already Marathi, so `errorMessage()` passes it through unchanged.
export class VideoExtractionFailure extends Error {
  readonly code: RecordingExtractionErrorCode;
  constructor(code: RecordingExtractionErrorCode, detail?: string) {
    super(
      code === 'no-audio'
        ? STR.videoNoAudio
        : code === 'unsupported'
          ? STR.videoUnsupported
          : STR.videoUnreadable,
    );
    this.name = 'VideoExtractionFailure';
    this.code = code;
    // The English cause is for the console, never for the card.
    if (detail) console.warn(`[video-extraction] ${code}: ${detail}`);
  }
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

// ---------- the queue ----------

let queue: Promise<void> = Promise.resolve();

async function runOnMainThread(
  file: File,
  onProgress: (fraction: number) => void,
  mode: ExtractionWorkerMode,
): Promise<ExtractedRecording> {
  const {
    compressRecordingAudio,
    extractRecordingAudio,
    RecordingExtractionError,
  } = await import('./extractRecordingAudio');
  try {
    return mode === 'compress'
      ? await compressRecordingAudio(file, { onProgress })
      : await extractRecordingAudio(file, { onProgress });
  } catch (error) {
    if (error instanceof RecordingExtractionError) {
      throw new VideoExtractionFailure(error.code, error.message);
    }
    throw new VideoExtractionFailure('unreadable', String(error));
  }
}

function runInWorker(
  file: File,
  onProgress: (fraction: number) => void,
  signal: AbortSignal | undefined,
  mode: ExtractionWorkerMode,
): Promise<ExtractedRecording> {
  if (typeof Worker === 'undefined') {
    return runOnMainThread(file, onProgress, mode);
  }
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL('./extractRecordingAudio.worker.ts', import.meta.url),
      { type: 'module' },
    );
    const finish = () => {
      worker.terminate();
      signal?.removeEventListener('abort', onAbort);
    };
    // Removing the card mid-extraction stops the work outright: terminating the worker is
    // the only cancellation a re-encode in progress honours.
    const onAbort = () => {
      finish();
      reject(new DOMException('Extraction removed.', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    worker.onmessage = (event: MessageEvent<ExtractionWorkerMessage>) => {
      const message = event.data;
      if (message.type === 'progress') {
        onProgress(message.fraction);
        return;
      }
      finish();
      if (message.type === 'done') resolve(message.result);
      else reject(new VideoExtractionFailure(message.code, message.message));
    };
    // The worker could not be started at all (a blocked script, an old browser without
    // module workers). The same code still runs on the main thread — slower to the eye
    // during a re-encode, but a converted recording beats a refusal.
    worker.onerror = (event) => {
      event.preventDefault();
      finish();
      runOnMainThread(file, onProgress, mode).then(resolve, reject);
    };
    worker.postMessage({ file, mode });
  });
}

/**
 * Extract one video's audio, queued behind any other extraction on the page. Rejects with a
 * `VideoExtractionFailure` (Marathi message) or an `AbortError` when `signal` fires.
 */
export function runRecordingExtraction(
  file: File,
  {
    onProgress = () => undefined,
    signal,
    mode = 'extract',
  }: {
    onProgress?: ((fraction: number) => void) | undefined;
    signal?: AbortSignal | undefined;
    // `compress` shrinks a large AUDIO recording instead (see compressRecordingAudio).
    mode?: ExtractionWorkerMode | undefined;
  } = {},
): Promise<ExtractedRecording> {
  return new Promise((resolve, reject) => {
    const job = async () => {
      // Removed while it was still waiting its turn: never start it.
      if (signal?.aborted) {
        reject(new DOMException('Extraction removed.', 'AbortError'));
        return;
      }
      try {
        const result = await runInWorker(file, onProgress, signal, mode);
        if (result.method !== 'passthrough') {
          (mode === 'compress' ? compressed : fromVideo).add(result.file);
        }
        resolve(result);
      } catch (error) {
        reject(error);
      }
    };
    queue = queue.then(job, job);
  });
}

// ---------- the hook for the strip-based composers (/dlo, /transcribe) ----------

export type VideoExtractionJob = Readonly<{
  id: string;
  mode: ExtractionWorkerMode;
  sourceName: string;
  sizeBytes: number;
  // 0..1 once the worker reports; null while it is queued or probing.
  fraction: number | null;
  // Marathi. A failed job stays on screen until removed — it is never dropped silently.
  error: string | null;
}>;

let nextJobId = 0;

export function useVideoExtraction(onReady: (file: File) => void): {
  jobs: readonly VideoExtractionJob[];
  // An extraction is still running or queued: the composer's send waits for it.
  busy: boolean;
  // Resolves with the files that were extracted, after every one of them has settled.
  // `compress` jobs never end in an error card: a recording that cannot be shrunk is handed
  // to `onReady` exactly as it was picked.
  start: (
    files: readonly File[],
    mode?: ExtractionWorkerMode,
  ) => Promise<File[]>;
  remove: (id: string) => void;
  items: AttachmentItem[];
} {
  const [jobs, setJobs] = useState<VideoExtractionJob[]>([]);
  // Latest callback, so a job finishing minutes later appends to the list as it is THEN,
  // not to the list as it was when the video was picked.
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const controllers = useRef(new Map<string, AbortController>());

  // Leaving the page stops the work: the result would have nowhere to go.
  useEffect(() => {
    const running = controllers.current;
    return () => {
      for (const controller of running.values()) controller.abort();
      running.clear();
    };
  }, []);

  const update = useCallback(
    (id: string, next: Partial<VideoExtractionJob>) =>
      setJobs((current) =>
        current.map((job) => (job.id === id ? { ...job, ...next } : job)),
      ),
    [],
  );

  const start = useCallback(
    (
      files: readonly File[],
      mode: ExtractionWorkerMode = 'extract',
    ): Promise<File[]> => {
      if (files.length === 0) return Promise.resolve([]);
      const made = files.map((file) => {
        nextJobId += 1;
        return {
          id: `video-${nextJobId}`,
          mode,
          sourceName: file.name,
          sizeBytes: file.size,
          fraction: null,
          error: null,
        };
      });
      setJobs((current) => [...current, ...made]);

      return Promise.all(
        made.map(async (job, index) => {
          const controller = new AbortController();
          controllers.current.set(job.id, controller);
          try {
            const result = await runRecordingExtraction(files[index]!, {
              signal: controller.signal,
              mode,
              onProgress: (fraction) => update(job.id, { fraction }),
            });
            setJobs((current) => current.filter((item) => item.id !== job.id));
            onReadyRef.current(result.file);
            return result.file;
          } catch (error) {
            // Shrinking is an optimisation: when it fails the recording goes up as picked.
            if (mode === 'compress' && !isAbort(error)) {
              setJobs((current) =>
                current.filter((item) => item.id !== job.id),
              );
              onReadyRef.current(files[index]!);
              return files[index]!;
            }
            if (!isAbort(error)) {
              update(job.id, {
                error:
                  error instanceof Error ? error.message : STR.videoUnreadable,
              });
            }
            return null;
          } finally {
            controllers.current.delete(job.id);
          }
        }),
      ).then((settled) =>
        settled.filter((file): file is File => file !== null),
      );
    },
    [update],
  );

  const remove = useCallback((id: string) => {
    controllers.current.get(id)?.abort();
    controllers.current.delete(id);
    setJobs((current) => current.filter((job) => job.id !== id));
  }, []);

  const items: AttachmentItem[] = jobs.map((job) => ({
    id: job.id,
    name: job.sourceName,
    icon: job.mode === 'compress' ? Minimize2 : Film,
    // The percentage and nothing else: the card is 240px wide and truncates, and the one
    // thing it must never cut off is how far along the conversion is.
    meta:
      job.error ??
      (job.mode === 'compress' ? STR.audioCompressing : STR.videoExtracting)(
        job.fraction === null ? null : job.fraction * 100,
      ),
    busy: job.error === null,
    failed: job.error !== null,
    removeLabel: `${STR.dloRemoveAudio}: ${job.sourceName}`,
    onRemove: () => remove(job.id),
  }));

  return {
    jobs,
    busy: jobs.some((job) => job.error === null),
    start,
    remove,
    items,
  };
}
