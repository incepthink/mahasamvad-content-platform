// Turn "the officer wanted 4:20 to 9:05 of this recording" into a storage object holding
// exactly that, so every consumer downstream carries on reading a storage path and knows
// nothing about trimming.
//
// WHY IT RETURNS A PATH RATHER THAN BYTES. Both transcribe phases already branch on how the
// recording reaches the provider: with ElevenLabs a PRESIGNED URL is handed over and the audio
// travels S3 -> transcriber without entering this process (the arrangement that removed the
// ~480 MB spike which OOM-killed the container on meeting recordings), and with Sarvam the
// bytes are downloaded in size-bounded groups. Handing a Buffer back here would force the
// first branch to hold a recording it deliberately never holds — and a 90-minute window out of
// a 2-hour meeting is not meaningfully smaller than the meeting. Swapping the PATH leaves both
// branches byte-for-byte what they are, and the cut is streamed into storage by ffmpeg's own
// output plus uploadStream, so nothing anywhere holds a recording.
//
// WHY THE CUT IS STORED RATHER THAN PIPED. It has to exist somewhere the provider can fetch it
// from, which for the URL branch means storage. Keeping it also makes a RETRY free: the job
// re-runs, finds the object already there under a name derived from the window, and skips
// ffmpeg entirely. The name is what makes that safe — change the window and it is a different
// object, so a re-trim can never serve a stale cut.
//
// THE ORIGINAL IS NEVER TOUCHED. A trim is a reading of the recording, not an edit to it: the
// officer can widen the window later, the review card can still play the whole thing, and a
// mistake costs an ffmpeg run rather than a meeting.

import { createReadStream } from 'node:fs';
import {
  signedDownloadUrl,
  uploadStream,
  type SupabaseClient,
} from '@dgipr/database';
import { trimAudio, trimmedFileName } from '@dgipr/content-engine';
import { audioMimeForFileName, isPartialTrim } from '@dgipr/schemas';

// The shape both runners' file entries already have. Structural rather than either concrete
// entry type, because DloIntakeFileEntry and TranscriptionFileEntry differ in every field but
// these three and this function cares about none of the others.
export type TrimmableAudioEntry = Readonly<{
  name: string;
  storagePath?: string | undefined;
  trim?:
    | Readonly<{
        startSeconds: number;
        endSeconds: number;
        durationSeconds?: number | undefined;
      }>
    | undefined;
}>;

/**
 * Where the cut for one window lives, beside the original.
 *
 * The WINDOW IS IN THE NAME, to a tenth of a second: that is what makes a repeat run reuse the
 * object and a re-trim write a different one. Milliseconds are deliberately not encoded — the
 * slider cannot express them, and a float's tail would make two identical requests miss.
 */
export function trimmedObjectPath(
  storagePath: string,
  trim: Readonly<{ startSeconds: number; endSeconds: number }>,
): string {
  const at = (seconds: number): string => Math.max(0, seconds).toFixed(1);
  const suffix = `${at(trim.startSeconds)}-${at(trim.endSeconds)}`;
  return `${storagePath}.trim-${suffix}-${trimmedFileName(storagePath)}`;
}

/**
 * The storage path the transcriber should be pointed at for this recording.
 *
 * The whole recording's path when there is no trim, or when the window turns out to cover the
 * whole thing — an ffmpeg run and a stored object to reproduce the original is pure waste, and
 * `isPartialTrim` is what recognises that a handle dragged to the very end is not a trim.
 *
 * A FAILURE THROWS. It would be easy to fall back to the untrimmed recording, and it would be
 * wrong: the officer chose four minutes of a two-hour meeting, and quietly transcribing all of
 * it bills them for the whole thing and buries what they came for. The caller already turns a
 * throw into a per-file error the review step shows, which is the honest outcome.
 */
export async function trimmedAudioPath(
  client: SupabaseClient,
  bucket: string,
  entry: TrimmableAudioEntry,
): Promise<string> {
  const source = entry.storagePath;
  if (source === undefined) {
    throw new Error(`या फाईलची मूळ प्रत उपलब्ध नाही: ${entry.name}`);
  }
  const trim = entry.trim;
  // Nothing was selected, or what was selected turns out to be the whole recording — a window
  // reaching the very ends of a file it was measured against. Reproducing the original costs
  // an ffmpeg run and a second stored object and yields the same audio, so it is skipped.
  // `isPartialTrim` reads the duration off the trim itself, which is exactly why the browser
  // sends it.
  if (trim === undefined || !isPartialTrim(trim)) return source;

  const destination = trimmedObjectPath(source, trim);

  // Read the original straight out of storage: ffmpeg seeks the presigned URL with Range
  // requests, so only the selected window crosses the network and none of it lands here.
  const url = await signedDownloadUrl(client, bucket, source);
  const cut = await trimAudio(url, entry.name, trim);
  try {
    await uploadStream(
      client,
      bucket,
      destination,
      createReadStream(cut.path),
      // The container is unchanged (`-c copy`), so the original's content type is still the
      // right one — and a wrong one has already cost this repo a real `invalid_audio: File is
      // corrupted` downstream.
      audioMimeForFileName(entry.name) ?? 'audio/mpeg',
    );
  } finally {
    await cut.cleanup();
  }
  return destination;
}
