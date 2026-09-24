// The Web Worker that runs `extractRecordingAudio` off the main thread.
//
// The COPY path is mostly I/O and would barely touch the page, but the RE-ENCODE decodes and
// encodes every sample of a meeting — minutes of CPU that would freeze the composer the
// officer is still typing into. A `File` crosses into a worker by reference (structured clone
// of a Blob copies the handle, not the bytes), and the result `File` crosses back the same way,
// so a multi-gigabyte video is never copied between threads.
//
// Started by lib/useVideoExtraction.ts with `new Worker(new URL(...), { type: 'module' })`,
// which Next's bundler recognises and splits into its own chunk — mediabunny is therefore
// never part of a page bundle.

import {
  extractRecordingAudio,
  RecordingExtractionError,
  type ExtractedRecording,
  type RecordingExtractionErrorCode,
} from './extractRecordingAudio';

export type ExtractionWorkerRequest = Readonly<{ file: File }>;

export type ExtractionWorkerMessage =
  | Readonly<{ type: 'progress'; fraction: number }>
  | Readonly<{ type: 'done'; result: ExtractedRecording }>
  | Readonly<{
      type: 'error';
      code: RecordingExtractionErrorCode;
      message: string;
    }>;

// The app's tsconfig types `self` as a Window (lib "dom"); adding the webworker lib to the same
// program collides with it. Only these two members are used, so they are stated here.
const scope = self as unknown as {
  postMessage: (message: ExtractionWorkerMessage) => void;
  onmessage: ((event: MessageEvent<ExtractionWorkerRequest>) => void) | null;
};

// Progress arrives per packet — thousands of times for a long meeting. One message per whole
// percent is all the card can show anyway.
let lastPercent = -1;

scope.onmessage = (event) => {
  lastPercent = -1;
  void extractRecordingAudio(event.data.file, {
    onProgress: (fraction) => {
      const percent = Math.floor(fraction * 100);
      if (percent === lastPercent) return;
      lastPercent = percent;
      scope.postMessage({ type: 'progress', fraction });
    },
  }).then(
    (result) => scope.postMessage({ type: 'done', result }),
    (error: unknown) =>
      scope.postMessage({
        type: 'error',
        code:
          error instanceof RecordingExtractionError ? error.code : 'unreadable',
        message: error instanceof Error ? error.message : String(error),
      }),
  );
};
