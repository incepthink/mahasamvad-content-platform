// A VIDEO picked as a recording becomes an ordinary AUDIO file, in the browser, before anything
// is uploaded.
//
// Officers record meetings and press meets on a phone, as video — 1-4 GB of which only ~2-5 %
// is the audio a transcript needs. Uploading the video whole would send those gigabytes over
// the officer's connection with no progress and no resume, so the audio track is pulled out
// HERE and what joins the recording list is a small `.m4a` (or `.webm`) that every step after
// the picker already handles: the trim dialog, the draft, the multipart upload, S3, the runner,
// the transcriber, the transcript cache. The video itself never leaves the device.
//
// Three paths, cheapest first:
//
//   COPY      AAC or MP3 audio (every phone camera) is REMUXED into an MP4 audio container
//             without decoding a sample — an hour of audio in seconds, memory bounded by the
//             8 MiB read cache plus the output itself. Needs no WebCodecs, which is also why
//             the Node harness (extractRecordingAudio.check.ts) can prove it for free.
//             Opus/Vorbis (a WebM/MKV screen recording) is copied into WebM the same way.
//   RE-ENCODE when copying is impossible (PCM in a MOV, AC-3, …) or the copy came out larger
//             than RECORDING_COPY_MAX_BYTES: decode and encode mono 48 kbps OPUS in WebM,
//             ~21 MB an hour. Opus rather than AAC because AAC ENCODING is missing from
//             Firefox and from Safari before 26, while Opus is in every current browser; and
//             `.webm → audio/webm` is already a recording container the API and the
//             transcriber accept. Speech-to-text loses nothing at mono 48 kbps.
//   PASSTHROUGH `.webm` is an AUDIO extension too (MediaRecorder writes audio-only WebM), so a
//             `.webm` is probed and handed back untouched when it holds no video track.
//
// There is deliberately NO raw-video fallback: a browser that can neither copy nor encode the
// audio gets a typed `unsupported` error naming a browser that can, rather than a silent
// multi-gigabyte upload.
//
// This module is the pure half. It runs inside a Web Worker in the app (the re-encode is CPU
// work that would otherwise freeze the page — see extractRecordingAudio.worker.ts and
// lib/useVideoExtraction.ts), and directly under Node in the harness.

import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  canEncodeAudio,
  Conversion,
  Input,
  Mp4OutputFormat,
  Output,
  Quality,
  WebMOutputFormat,
  type AudioCodec,
  type ConversionAudioOptions,
  type ConversionCopyOptions,
  type InputAudioTrack,
} from 'mediabunny';

// Past this, a COPIED track is re-encoded instead: ~3.5 h of 128 kbps AAC. A copy that large
// would be a long upload for audio that Opus carries in a tenth of the bytes — and above it the
// transcriber's own URL-fetch ceiling starts to come into view.
export const RECORDING_COPY_MAX_BYTES = 200 * 1024 * 1024;

// Mono 48 kbps Opus: transparent for speech, ~21 MB per hour.
const REENCODE_BITRATE = 48_000;
const REENCODE_SAMPLE_RATE = 48_000;

export type RecordingExtractionErrorCode =
  // The file opened, but there is no audio track in it.
  | 'no-audio'
  // The audio can be neither copied nor re-encoded in this browser.
  | 'unsupported'
  // The file could not be opened as media at all.
  | 'unreadable';

export class RecordingExtractionError extends Error {
  readonly code: RecordingExtractionErrorCode;
  constructor(code: RecordingExtractionErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'RecordingExtractionError';
    this.code = code;
  }
}

export type RecordingExtractionMethod = 'copy' | 'reencode' | 'passthrough';

export type ExtractedRecording = Readonly<{
  file: File;
  method: RecordingExtractionMethod;
  sourceName: string;
  // Of the audio track, when the container states it cheaply. Null is a normal answer.
  durationSeconds: number | null;
}>;

// Extensions a recording list already understands — a video called `meeting.m4a.mp4` (which
// some share sheets produce) becomes `meeting.m4a`, never `meeting.m4a.m4a`.
const AUDIO_SUFFIX = /\.(mp3|m4a|aac|aif|aiff|ogg|oga|opus|wav|flac|webm)$/i;

/**
 * The name the extracted recording is given: the video's own stem with the audio extension.
 *
 * It does NOT make names unique. Duplicate detection downstream (lib/filePicks) is by name AND
 * size, so re-picking the same video must produce the same name — renaming it to "meeting (2)"
 * would let one video be attached twice. Two different videos with one name already differ in
 * size, and the API keys recordings by position, not by name.
 */
export function recordingNameFromVideo(
  name: string,
  extension: '.m4a' | '.webm',
): string {
  const trimmed = name.trim();
  const dot = trimmed.lastIndexOf('.');
  let stem = dot > 0 ? trimmed.slice(0, dot) : dot === 0 ? '' : trimmed;
  stem = stem.replace(AUDIO_SUFFIX, '').replace(/[.\s]+$/, '');
  return `${stem || 'ध्वनिमुद्रण'}${extension}`;
}

const COPYABLE_TO_MP4: ReadonlySet<AudioCodec> = new Set(['aac', 'mp3']);
const COPYABLE_TO_WEBM: ReadonlySet<AudioCodec> = new Set(['opus', 'vorbis']);

function openInput(file: Blob): Input {
  return new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
}

async function durationOf(track: InputAudioTrack): Promise<number | null> {
  try {
    const seconds = await track.computeDuration();
    return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
  } catch {
    return null;
  }
}

type Progress = (fraction: number) => void;

// One conversion into memory. Null when mediabunny judges it invalid (the track could not be
// carried the way asked), which the caller treats as "try the next path", never as an error.
async function convert(
  file: Blob,
  format: 'mp4' | 'webm',
  audio: ConversionAudioOptions,
  copy: ConversionCopyOptions | false,
  onProgress: Progress | undefined,
): Promise<ArrayBuffer | null> {
  // A fresh Input per attempt: a conversion owns its input's read position, and a failed copy
  // must not leave a half-read one behind for the re-encode.
  const input = openInput(file);
  try {
    const target = new BufferTarget();
    const output = new Output({
      format:
        format === 'mp4'
          ? new Mp4OutputFormat({ fastStart: 'in-memory' })
          : new WebMOutputFormat(),
      target,
    });
    const conversion = await Conversion.init({
      input,
      output,
      tracks: 'primary',
      video: { discard: true },
      audio,
      copy,
      // A phone video's tags (location, device, cover art) mean nothing on a recording.
      tags: {},
      showWarnings: false,
    });
    if (!conversion.isValid) return null;
    if (onProgress) {
      conversion.onProgress = (fraction) => onProgress(fraction);
    }
    await conversion.execute();
    return target.buffer;
  } finally {
    input.dispose();
  }
}

/**
 * Turn a picked video (or `.webm`) into an audio recording the recording pipeline accepts.
 * Throws `RecordingExtractionError` on every failure the officer should hear about.
 */
export async function extractRecordingAudio(
  file: File,
  options: {
    onProgress?: Progress | undefined;
    // Overridable so the harness can pretend a copy is too large without a 200 MB fixture.
    copyMaxBytes?: number | undefined;
  } = {},
): Promise<ExtractedRecording> {
  const { onProgress, copyMaxBytes = RECORDING_COPY_MAX_BYTES } = options;

  // 1. Probe: is this media at all, and what does it carry?
  const probe = openInput(file);
  let codec: AudioCodec | null;
  let hasVideo: boolean;
  let canDecode: boolean;
  let durationSeconds: number | null;
  try {
    let audio: InputAudioTrack | null;
    try {
      audio = await probe.getPrimaryAudioTrack();
      hasVideo = (await probe.getPrimaryVideoTrack()) !== null;
    } catch (cause) {
      throw new RecordingExtractionError(
        'unreadable',
        cause instanceof Error ? cause.message : undefined,
      );
    }
    if (!audio) throw new RecordingExtractionError('no-audio');
    codec = audio.codec;
    durationSeconds = await durationOf(audio);
    canDecode = await audio.canDecode().catch(() => false);
  } finally {
    probe.dispose();
  }

  const sourceName = file.name;

  // An audio-only WebM is already a recording: nothing to do.
  if (!hasVideo && file.name.toLowerCase().endsWith('.webm')) {
    return { file, method: 'passthrough', sourceName, durationSeconds };
  }

  // 2. Copy — no decode, no WebCodecs. 'forced' so a track that would need transcoding is
  //    dropped (making the conversion invalid) rather than silently transcoded into a format
  //    this path did not choose; shiftTolerance so an edit-list offset does not refuse it.
  const copyInto: 'mp4' | 'webm' | null =
    codec !== null && COPYABLE_TO_MP4.has(codec)
      ? 'mp4'
      : codec !== null && COPYABLE_TO_WEBM.has(codec)
        ? 'webm'
        : null;
  if (copyInto !== null) {
    const copied = await convert(
      file,
      copyInto,
      {},
      { mode: 'forced', shiftTolerance: Infinity },
      onProgress,
    ).catch(() => null);
    if (copied !== null && copied.byteLength <= copyMaxBytes) {
      const extension = copyInto === 'mp4' ? '.m4a' : '.webm';
      return {
        file: new File([copied], recordingNameFromVideo(file.name, extension), {
          type: copyInto === 'mp4' ? 'audio/mp4' : 'audio/webm',
          lastModified: file.lastModified,
        }),
        method: 'copy',
        sourceName,
        durationSeconds,
      };
    }
  }

  // 3. Re-encode to mono Opus in WebM. Needs both a decoder for the source and an Opus
  //    encoder — WebCodecs in the browser; neither exists in Node, which is how the harness
  //    reaches the `unsupported` branch honestly.
  const canEncode = await canEncodeAudio('opus', {
    numberOfChannels: 1,
    sampleRate: REENCODE_SAMPLE_RATE,
    bitrate: REENCODE_BITRATE,
  }).catch(() => false);
  if (!canDecode || !canEncode) {
    throw new RecordingExtractionError('unsupported');
  }
  onProgress?.(0);
  const encoded = await convert(
    file,
    'webm',
    {
      codec: 'opus',
      numberOfChannels: 1,
      sampleRate: REENCODE_SAMPLE_RATE,
      quality: new Quality({ bitrate: REENCODE_BITRATE }),
      forceTranscode: true,
    },
    false,
    onProgress,
  ).catch((cause: unknown) => {
    throw new RecordingExtractionError(
      'unsupported',
      cause instanceof Error ? cause.message : undefined,
    );
  });
  if (encoded === null) throw new RecordingExtractionError('unsupported');
  return {
    file: new File([encoded], recordingNameFromVideo(file.name, '.webm'), {
      type: 'audio/webm',
      lastModified: file.lastModified,
    }),
    method: 'reencode',
    sourceName,
    durationSeconds,
  };
}
