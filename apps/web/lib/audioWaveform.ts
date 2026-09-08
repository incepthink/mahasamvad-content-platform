'use client';

// Turning a picked recording into something the trim slider can draw.
//
// TWO ANSWERS, AND THE CHEAP ONE IS THE ONE THAT MATTERS. The slider cannot exist without a
// DURATION, and it is free: an <audio> element reports it after reading a header, without
// decoding a sample. The WAVEFORM is a different question — it needs the whole file decoded to
// PCM — and it is a convenience, not a requirement. So the two are separate calls and the
// dialog opens on the first one.
//
// WHY THE WAVEFORM IS BEST-EFFORT AND SIZE-CAPPED. `decodeAudioData` holds the entire decoded
// signal at once: a two-hour meeting at 44.1 kHz stereo is several gigabytes of Float32Array,
// which does not fail politely — it hangs or kills the tab, and the officer loses the pick they
// were about to submit. Two things keep that from happening. The context is created at a LOW
// sample rate (`decodeAudioData` resamples to the context's rate, so the buffer that survives
// is a fraction of the full-rate one), and anything past `WAVEFORM_MAX_BYTES` is not attempted
// at all. A recording with no waveform still gets its ruler, its handles, its timecodes and its
// playback — everything except the picture.
//
// Free harness:
//   npx tsx --tsconfig apps/web/tsconfig.check.json apps/web/lib/audioWaveform.check.ts

// The bar count the slider draws. Fixed rather than derived from the element's width so the
// picture does not change shape when the dialog is resized, and low enough that a two-hour
// recording and a two-minute one are drawn from the same number of samples.
export const WAVEFORM_BUCKETS = 480;

// Past this, the waveform is skipped rather than attempted. Chosen against what decoding
// actually costs, not against what feels big: at the 8 kHz context below, 50 MB of MP3 is
// roughly an hour of audio and about 115 MB of Float32Array, which a browser absorbs. Doubling
// it would not double the risk, it would move it into the range where the tab stops responding.
export const WAVEFORM_MAX_BYTES = 50 * 1024 * 1024;

// Decoding at 8 kHz keeps the buffer small and loses nothing that can be drawn: the picture is
// 480 bars wide, so even a two-minute clip is averaging a thousand samples per bar.
const DECODE_SAMPLE_RATE = 8000;

/**
 * How long the recording is, in seconds, without decoding it.
 *
 * Resolves `null` rather than throwing on anything the browser cannot read — a container it
 * declines to open, or the `Infinity` some streamed formats report. The dialog treats that as
 * "no slider" and says so, which is honest; guessing a duration would put handles over a
 * timeline that does not exist.
 */
export function readAudioDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    let settled = false;

    const finish = (value: number | null): void => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      audio.removeAttribute('src');
      resolve(value);
    };

    audio.addEventListener('loadedmetadata', () => {
      const duration = audio.duration;
      finish(Number.isFinite(duration) && duration > 0 ? duration : null);
    });
    audio.addEventListener('error', () => finish(null));
    // A container the browser opens but never reports metadata for would otherwise leave the
    // dialog spinning for as long as it is open.
    setTimeout(() => finish(null), 20_000);

    audio.preload = 'metadata';
    audio.src = url;
  });
}

/**
 * Peak amplitudes, one per bar, normalised so the loudest bar is 1.
 *
 * NORMALISED DELIBERATELY. An un-normalised waveform of a quiet phone recording is a flat line
 * a centimetre tall, which tells the officer nothing about where the speaking starts — and
 * where the speaking starts is the entire reason to show them a waveform. The picture is a
 * navigation aid, not a measurement.
 *
 * Resolves `null` whenever it cannot be done: too large, an unsupported container, a decoder
 * failure, or a cancelled dialog. Never throws.
 */
export async function readAudioPeaks(
  file: File,
  signal?: AbortSignal,
): Promise<Float32Array | null> {
  if (file.size > WAVEFORM_MAX_BYTES) return null;

  let context: AudioContext | null = null;
  try {
    const bytes = await file.arrayBuffer();
    if (signal?.aborted) return null;

    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (Ctor === undefined) return null;

    // Safari rejects a sample rate outside its supported range rather than clamping it, so the
    // low-rate context is a preference and the default is the fallback. The cap above is what
    // keeps the fallback survivable.
    try {
      context = new Ctor({ sampleRate: DECODE_SAMPLE_RATE });
    } catch {
      context = new Ctor();
    }

    const buffer = await context.decodeAudioData(bytes);
    if (signal?.aborted) return null;

    const peaks = new Float32Array(WAVEFORM_BUCKETS);
    const channels = Math.min(buffer.numberOfChannels, 2);
    const perBucket = buffer.length / WAVEFORM_BUCKETS;

    for (let channel = 0; channel < channels; channel += 1) {
      const samples = buffer.getChannelData(channel);
      for (let bucket = 0; bucket < WAVEFORM_BUCKETS; bucket += 1) {
        const from = Math.floor(bucket * perBucket);
        const to = Math.min(
          samples.length,
          Math.floor((bucket + 1) * perBucket),
        );
        let peak = 0;
        // Stride rather than every sample: at an hour long a bucket holds ~60,000 samples and
        // the tallest of every hundredth is visually identical to the tallest of all of them.
        const stride = Math.max(1, Math.floor((to - from) / 512));
        for (let i = from; i < to; i += stride) {
          const value = Math.abs(samples[i] ?? 0);
          if (value > peak) peak = value;
        }
        if (peak > (peaks[bucket] ?? 0)) peaks[bucket] = peak;
      }
    }

    return normalisePeaks(peaks);
  } catch {
    // Every failure here is the same failure to the officer — there is no picture — and none
    // of them is worth a message: the slider works without it.
    return null;
  } finally {
    // Contexts are a limited per-page resource, so one is never left open behind a dialog
    // that has been opened and closed a dozen times.
    await context?.close().catch(() => {});
  }
}

/**
 * Scale so the loudest bar reaches 1, and give every bar a visible floor.
 *
 * The floor is not cosmetic: silence drawn as literally nothing leaves a gap in the track that
 * reads as the end of the recording, and an officer trimming after it would cut the half of
 * the meeting that follows a long pause.
 */
export function normalisePeaks(peaks: Float32Array): Float32Array {
  let max = 0;
  for (const value of peaks) if (value > max) max = value;
  const out = new Float32Array(peaks.length);
  if (max <= 0) {
    // A genuinely silent file: a flat, faint line rather than nothing at all.
    out.fill(0.04);
    return out;
  }
  for (let i = 0; i < peaks.length; i += 1) {
    out[i] = Math.max(0.04, Math.min(1, (peaks[i] ?? 0) / max));
  }
  return out;
}
