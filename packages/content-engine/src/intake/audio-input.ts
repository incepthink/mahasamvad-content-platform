// What "a recording" means to the STT seam. Two shapes, because there are two genuinely
// different ways one reaches us and the difference is not cosmetic:
//
//   - BYTES  — an officer uploaded a file. We hold it, we archive it, we can hash it, and
//              every provider can transcribe it.
//   - A URL  — an officer pasted a YouTube link. We never fetch it: ElevenLabs Scribe takes
//              a `source_url` and fetches the media itself, which is what keeps a video
//              downloader out of this repo entirely (see @dgipr/schemas' youtube.ts).
//
// Modelled as a UNION rather than one type with two optional fields, deliberately. An
// optional-fields shape can represent "neither" and "both", neither of which is a real
// input, and it would let the Sarvam client keep compiling while quietly reading
// `undefined` bytes. The union makes the one provider that cannot serve URLs say so, in
// code, at the one place that dispatches.
//
// The consequences that ripple outward from "a URL source has no bytes" are all in the two
// jobs, and all the same shape: it cannot be archived to the private bucket, and it cannot
// be hashed, so audio_transcript_cache (0031) — which is keyed on the audio bytes alone —
// simply does not apply to it. Neither is a regression; both are properties of not having
// downloaded a video.

// An uploaded recording, in hand.
export type AudioFileInput = Readonly<{
  // Display name (may be Devanagari); results come back in input order, so the
  // name is only for error messages.
  name: string;
  data: Buffer;
}>;

// A recording the PROVIDER fetches, from a URL we only pass along.
export type AudioUrlInput = Readonly<{
  // Display name — the video's title where the probe found one, else the link itself.
  name: string;
  sourceUrl: string;
  // When true, the STT seam must NOT resolve this to bytes: hand the URL straight to the
  // provider. Set for PRESIGNED STORAGE URLs, where the audio is already ours and sitting
  // in S3 — the point of them is that no part of this process ever holds the recording.
  //
  // Without this flag such a URL would take the pasted-link path and be run through yt-dlp
  // (YOUTUBE_AUDIO_SOURCE defaults to `download`), which would both fail and buffer the
  // whole file to disk — the exact opposite of why it was signed. A pasted YouTube link
  // leaves it unset and keeps its existing behaviour byte for byte.
  providerFetches?: boolean;
}>;

export type AudioInput = AudioFileInput | AudioUrlInput;

export type AudioTranscription =
  Readonly<{ text: string }> | Readonly<{ error: string }>;

export function isAudioUrlInput(input: AudioInput): input is AudioUrlInput {
  return 'sourceUrl' in input;
}
