// Whether the content-addressed transcript cache (audio_transcript_cache, migration 0031)
// is READ before calling the STT provider. Two lanes consume it — /transcribe and /dlo —
// so the flag is read here rather than in either job, beside the ARTICLE_POSTER_MODE
// precedent.
//
// KNOWN AND DELIBERATE, read this before turning reads on: the cache key is a hash of the
// AUDIO BYTES ALONE (hashAudioContent), so it does not record WHICH provider produced a
// transcript. Since STT_PROVIDER became switchable (ElevenLabs by default, Sarvam the
// rollback — see intake/stt-provider.ts), a recording first transcribed by the other
// provider is served from the cache verbatim, and in Devanagari that substitution is
// invisible. Reads defaulting to 'off' is what keeps this dormant; the fix, if reads are
// ever wanted back, is to fold the provider name into the key (no migration — old rows
// simply become misses).
//
// Default 'off': every run transcribes its recordings afresh. Re-uploading the same MP3 is
// therefore a real, billed Sarvam batch job again, on purpose — a transcript is the officer's
// deliverable and reusing an older one hides a re-run that was asked for.
//
// The WRITE is unconditional either way. History does not depend on it (a run's transcript
// lives on its own row, in transcriptions.files[].text / dlo_intakes.files[].text), but
// keeping the table warm is what makes TRANSCRIPT_CACHE_MODE=read a working rollback rather
// than a cold start.

export type TranscriptCacheMode = 'off' | 'read';

export function transcriptCacheMode(): TranscriptCacheMode {
  return process.env.TRANSCRIPT_CACHE_MODE?.trim().toLowerCase() === 'read'
    ? 'read'
    : 'off';
}
