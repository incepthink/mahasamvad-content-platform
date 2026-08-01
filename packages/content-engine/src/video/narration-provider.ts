// Provider seam for the explainer video's Marathi voiceover, mirroring
// clip-provider.ts (clips) and frame-provider.ts (frames). The runner asks for
// "one WAV of this Marathi passage in this voice" and this module dispatches to
// the configured backend; NARRATION_TTS_PROVIDER trades them in an .env edit.
//
// Deliberately thin, like its two siblings: per-provider quirks live inside each
// client (Sarvam's model/pace fields, ElevenLabs' PCM-to-WAV wrapping and its
// learned sample-rate ladder), and none of them widen this type.
//
// The contract every provider must honour is WAV bytes, because the narration's
// MEASURED duration is what the clip windows are derived from
// (clipSecondsForNarration) and wavDurationSeconds parses RIFF chunks. A
// provider that natively returns MP3 must convert before returning.
//
// `voice` is a plain string at the seam and is ALSO the staleness key stored as
// narrationAudioVoice: changing provider or voice must invalidate the cached
// track, which it does for free because the two providers' voice ids never
// collide (`shubh` vs a 20-char ElevenLabs id).

import { pathToFileURL } from 'node:url';
import {
  synthesizeMarathiNarration,
  ttsSpeaker,
  type NarrationOptions,
} from './sarvam-tts.js';
import {
  elevenLabsVoiceId,
  synthesizeElevenLabsNarration,
} from './elevenlabs-tts.js';

const SUPPORTED_PROVIDERS = ['sarvam', 'elevenlabs'] as const;

export function narrationProviderName(): string {
  const raw = process.env.NARRATION_TTS_PROVIDER;
  return raw && raw.trim() !== '' ? raw.trim().toLowerCase() : 'sarvam';
}

// Which env var the narrate/storyboard gate must find for the configured
// provider, so a route can name the RIGHT key in its Marathi 503 rather than
// hardcoding SARVAM_API_KEY (the clipProviderApiKeyEnv precedent — an
// ElevenLabs deployment may legitimately hold no Sarvam key at all).
export function narrationProviderApiKeyEnv(): string {
  switch (narrationProviderName()) {
    case 'elevenlabs':
      return 'ELEVENLABS_API_KEY';
    default:
      return 'SARVAM_API_KEY';
  }
}

export function narrationKeyPresent(): boolean {
  const key = process.env[narrationProviderApiKeyEnv()];
  return typeof key === 'string' && key.trim() !== '';
}

// The configured provider's default voice — stored per project as the
// narration's staleness key.
export function narrationVoice(): string {
  switch (narrationProviderName()) {
    case 'elevenlabs':
      return elevenLabsVoiceId();
    default:
      return ttsSpeaker();
  }
}

// Synthesize one Marathi narration passage. Returns WAV bytes; each provider
// records its own character cost into the ambient meter.
export async function synthesizeNarration(
  text: string,
  options?: NarrationOptions,
): Promise<Buffer> {
  const provider = narrationProviderName();
  switch (provider) {
    case 'sarvam':
      return synthesizeMarathiNarration(text, options);
    case 'elevenlabs':
      return synthesizeElevenLabsNarration(text, {
        ...(options?.speaker !== undefined ? { voiceId: options.speaker } : {}),
      });
    default:
      throw new Error(
        `Unknown NARRATION_TTS_PROVIDER "${provider}". ` +
          `Supported: ${SUPPORTED_PROVIDERS.join(', ')}.`,
      );
  }
}

// Free harness: asserts dispatch and which key each provider's gate names.
//   tsx src/video/narration-provider.ts
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const checks: Array<[string, boolean]> = [];
  const check = (label: string, ok: boolean): void => {
    checks.push([label, ok]);
  };
  const original = process.env.NARRATION_TTS_PROVIDER;

  delete process.env.NARRATION_TTS_PROVIDER;
  check('unset defaults to sarvam', narrationProviderName() === 'sarvam');
  check(
    'sarvam gate names SARVAM_API_KEY',
    narrationProviderApiKeyEnv() === 'SARVAM_API_KEY',
  );

  process.env.NARRATION_TTS_PROVIDER = '  ElevenLabs  ';
  check('trimmed + lowercased', narrationProviderName() === 'elevenlabs');
  check(
    'elevenlabs gate names ELEVENLABS_API_KEY',
    narrationProviderApiKeyEnv() === 'ELEVENLABS_API_KEY',
  );

  process.env.NARRATION_TTS_PROVIDER = 'nope';
  let threw = '';
  void synthesizeNarration('चाचणी').catch((error: unknown) => {
    threw = error instanceof Error ? error.message : String(error);
  });

  if (original === undefined) delete process.env.NARRATION_TTS_PROVIDER;
  else process.env.NARRATION_TTS_PROVIDER = original;

  setTimeout(() => {
    check(
      'unknown provider names the supported list',
      threw.includes('sarvam, elevenlabs'),
    );
    let failed = 0;
    for (const [label, ok] of checks) {
      console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
      if (!ok) failed++;
    }
    console.log(`\n${checks.length - failed}/${checks.length} passed.`);
    process.exitCode = failed > 0 ? 1 : 0;
  }, 0);
}
