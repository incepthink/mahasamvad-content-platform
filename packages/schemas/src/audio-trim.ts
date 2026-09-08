// The slice of a recording an officer actually wants transcribed.
//
// WHY THIS EXISTS. A meeting recording is one file and the news is usually a few minutes of
// it — the announcement, one answer, the part after the formalities. Until now the whole
// recording went to the transcriber, so an officer paid for two hours of speech to read four
// minutes of it, and then had to find those four minutes inside the transcript by hand.
//
// THE RANGE IS CARRIED, NOT APPLIED, ON THE CLIENT. The browser never cuts the audio: a
// two-hour MP3 decoded to PCM is gigabytes, and re-encoding in the page would be both slow and
// lossy. The officer's selection travels as two numbers and the JOB trims with ffmpeg before
// the recording reaches the STT provider (apps/api/src/jobs/audio-trim.ts), so the ORIGINAL is
// always what sits in the private bucket and a trim is never destructive.
//
// SECONDS, NOT BYTES OR PERCENTAGES. Bytes cannot be turned into a time on a variable-bitrate
// file, and a percentage is meaningless the moment anything downstream reports a timecode. The
// numbers here are what ffmpeg is handed verbatim, which is also why they are plain seconds
// rather than a formatted string: one parser, at the edge, and nothing to re-parse later.

import { z } from 'zod';

// The shortest selectable window. Below about a second there is nothing to transcribe, and a
// range that rounds to zero length would make ffmpeg emit an empty file the provider then
// reports as corrupt — a confusing failure a long way from the gesture that caused it.
export const AUDIO_TRIM_MIN_SECONDS = 1;

export const AudioTrimSchema = z
  .object({
    startSeconds: z.number().nonnegative().finite(),
    endSeconds: z.number().positive().finite(),
    // How long the whole recording is, as the browser measured it.
    //
    // Carried rather than derived, for two reasons. It makes the stored entry SELF-DESCRIBING
    // — the review card can say "4:20–9:05 of 1:52:10" instead of a window with nothing to
    // read it against — and it is the only way the API can tell a genuine trim from a window
    // that happens to span the whole file, which decides whether an ffmpeg run and a second
    // stored object are worth spending. Optional because an <audio> element occasionally
    // reports `Infinity` for a stream-ish container, and refusing the officer's trim over a
    // number that is only used to OPTIMISE would be the wrong trade.
    durationSeconds: z.number().positive().finite().optional(),
  })
  .refine(
    (trim) => trim.endSeconds - trim.startSeconds >= AUDIO_TRIM_MIN_SECONDS,
    { message: `Trim must span at least ${AUDIO_TRIM_MIN_SECONDS}s.` },
  );
export type AudioTrim = z.infer<typeof AudioTrimSchema>;

// ---------- the wire format ----------
//
// One entry per TRIMMED recording, not per recording: most are used whole, and a sparse list
// keeps an untrimmed intake's request byte-for-byte what it is today.
//
// `index` is the position among the AUDIO files in the order the client appended them, and it
// is what the route matches on — a name alone is not a key, since two takes of the same meeting
// arrive as recording.m4a twice. `name` rides along as a CHECK, not as the lookup: the route
// refuses a request whose name does not match the recording at that position rather than
// trimming the wrong one, because applying somebody's four-minute window to a different
// two-hour meeting silently destroys the source they came to use.
export const AudioTrimEntrySchema = z.object({
  index: z.number().int().nonnegative(),
  name: z.string(),
  startSeconds: z.number().nonnegative().finite(),
  endSeconds: z.number().positive().finite(),
  durationSeconds: z.number().positive().finite().optional(),
});
export type AudioTrimEntry = z.infer<typeof AudioTrimEntrySchema>;

export const AudioTrimsSchema = z.array(AudioTrimEntrySchema);

// ---------- helpers both halves need ----------

export function trimDurationSeconds(trim: AudioTrim): number {
  return Math.max(0, trim.endSeconds - trim.startSeconds);
}

/**
 * Whether a range actually asks for less than the whole recording.
 *
 * A tolerance rather than an equality test, because the two ends arrive from different places
 * and neither is exact: a duration read off an <audio> element is a float the decoder rounded,
 * and a handle dragged to the very end of a track lands within a pixel of it. Treating
 * "0 to 3599.98 of a 3600s file" as a trim would spend an ffmpeg run and a second stored object
 * to produce a copy of the original.
 */
export function isPartialTrim(
  trim: AudioTrim,
  durationSeconds: number | null | undefined = trim.durationSeconds,
): boolean {
  if (trim.startSeconds > 0.05) return true;
  if (
    durationSeconds === null ||
    durationSeconds === undefined ||
    !Number.isFinite(durationSeconds)
  ) {
    // Nothing to compare the far end against, so only a moved start can be judged. Erring
    // toward "not a trim" is right: the whole recording is what the officer had before.
    return false;
  }
  return trim.endSeconds < durationSeconds - 0.05;
}

/**
 * `h:mm:ss` past an hour, `m:ss` below it — never a bare count of seconds.
 *
 * The same string labels the two handles, the readout between them and the recording's card,
 * so a timecode the officer set on the slider is the one they see on the composer.
 * Devanagari digits are deliberately NOT used: this is a position in a media file, sitting
 * beside a browser's own <audio> controls, and those count in Latin numerals.
 */
export function formatTimecode(seconds: number): string {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (value: number): string => String(value).padStart(2, '0');
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(secs)}`
    : `${minutes}:${pad(secs)}`;
}
