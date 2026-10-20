// How /transcribe gets its recordings to the server — DIRECT TO S3 first, multipart second.
//
// The direct path (2026-10-16): ask the API for one presigned PUT per recording, upload each
// file straight into the bucket (through the S3 accelerate endpoint, so an upload from India
// enters AWS at the nearest edge instead of crossing to us-east-2 on one lossy connection),
// then ask the API to create the run from what landed. The bytes never pass through our
// server, and the officer gets a real upload percentage — the multipart path had none.
//
// The multipart path is the original one, untouched, and is the FALLBACK whenever the direct
// path cannot even start or a PUT fails: a bucket without its CORS rule, an API that predates
// the prepare route, a network that blocks the accelerate host. A browser reports a CORS
// refusal exactly like a network failure, so the two cannot be told apart here — falling back
// on both is what guarantees this change can never make an upload WORSE than it was.
//
// What is NOT a fallback: the API refusing the finished run (a bad trim window, an upload it
// could not find). That is an answer about the officer's input and is shown as one, since
// re-sending the same input by another route would only be refused again.

import type { AudioTrimEntry, YouTubeVideo } from '@dgipr/schemas';
import {
  createTranscription,
  createTranscriptionFromUploads,
  prepareTranscriptionUploads,
  putFileToSignedUrl,
} from './api';

// Parallel PUTs per run. A handful saturates an upload link; more only split it further.
const UPLOAD_CONCURRENCY = 3;

export type TranscriptionUploadInput = Readonly<{
  files: readonly File[];
  // The trim slider's sparse, positional entries (lib/useAudioTrims), already decoded.
  audioTrims: readonly AudioTrimEntry[];
  youtube: readonly YouTubeVideo[];
  // 0..1 across every file, by bytes. Not called on the multipart fallback, which cannot
  // report progress.
  onProgress?: ((fraction: number) => void) | undefined;
}>;

function multipartForm(input: TranscriptionUploadInput): FormData {
  const form = new FormData();
  for (const file of input.files) form.append('files', file, file.name);
  if (input.audioTrims.length > 0) {
    form.append('audioTrims', JSON.stringify(input.audioTrims));
  }
  if (input.youtube.length > 0) {
    form.append('youtube', JSON.stringify(input.youtube));
  }
  return form;
}

// Runs `task` over every item with at most `limit` in flight; rejects on the first failure.
async function eachLimited<T>(
  items: readonly T[],
  limit: number,
  task: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      await task(items[index]!, index);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
}

// Upload every recording straight to S3. Returns false when the direct path is unavailable
// (the caller then falls back); returns the run id when it worked.
async function uploadDirect(
  input: TranscriptionUploadInput,
): Promise<{ id: string } | false> {
  let prepared;
  try {
    prepared = await prepareTranscriptionUploads(
      input.files.map((file) => ({ name: file.name, size: file.size })),
    );
  } catch (error) {
    console.warn(
      '[transcribe] direct upload unavailable, using multipart:',
      error,
    );
    return false;
  }
  if (prepared.uploads.length !== input.files.length) return false;

  const totalBytes = input.files.reduce((sum, file) => sum + file.size, 0);
  const loaded = new Array<number>(input.files.length).fill(0);
  const report = () =>
    input.onProgress?.(
      totalBytes === 0
        ? 1
        : loaded.reduce((sum, value) => sum + value, 0) / totalBytes,
    );
  report();

  try {
    await eachLimited(input.files, UPLOAD_CONCURRENCY, async (file, index) => {
      const upload = prepared.uploads[index]!;
      await putFileToSignedUrl(
        upload.url,
        file,
        upload.contentType,
        (bytes) => {
          loaded[index] = bytes;
          report();
        },
      );
    });
  } catch (error) {
    console.warn('[transcribe] direct upload failed, using multipart:', error);
    return false;
  }

  // Not wrapped: a refusal here is the API's answer about this input (see the header).
  const id = await createTranscriptionFromUploads({
    runId: prepared.runId,
    files: input.files.map((file, index) => ({
      name: file.name,
      storagePath: prepared.uploads[index]!.storagePath,
    })),
    audioTrims: [...input.audioTrims],
    youtube: [...input.youtube],
  });
  return { id };
}

/** Create a transcription run, uploading its recordings the fastest way available. */
export async function uploadTranscription(
  input: TranscriptionUploadInput,
): Promise<string> {
  // A links-only run has no bytes to move; the multipart request is a few hundred bytes.
  if (input.files.length > 0) {
    const direct = await uploadDirect(input);
    if (direct !== false) return direct.id;
  }
  return createTranscription(multipartForm(input));
}
