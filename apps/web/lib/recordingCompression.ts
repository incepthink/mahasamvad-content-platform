// The cheap, name-and-size half of "should this recording be shrunk before upload?" — kept
// out of extractRecordingAudio.ts so a page can ask it without importing mediabunny (which
// must only ever load inside the worker chunk; see useVideoExtraction.ts).
//
// The decision proper (does its bitrate justify the encode?) needs the file opened, and is
// made in the worker by compressRecordingAudio.

// Below this an encode costs more time than the smaller upload saves.
export const COMPRESS_MIN_BYTES = 8 * 1024 * 1024;

// Already Opus/Vorbis — re-encoding would only lose quality.
const ALREADY_EFFICIENT_SUFFIX = /\.(opus|ogg|oga|webm)$/i;

export function mayCompressRecording(file: File): boolean {
  return (
    file.size >= COMPRESS_MIN_BYTES && !ALREADY_EFFICIENT_SUFFIX.test(file.name)
  );
}

// Split audio picks into those to send as they are and those worth trying to shrink.
export function splitCompressible(files: readonly File[]): {
  asIs: File[];
  compress: File[];
} {
  const asIs: File[] = [];
  const compress: File[] = [];
  for (const file of files) {
    (mayCompressRecording(file) ? compress : asIs).push(file);
  }
  return { asIs, compress };
}
