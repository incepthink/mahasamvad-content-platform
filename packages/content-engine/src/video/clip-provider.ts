// Provider seam for scene-clip rendering: the runner asks for "one clip from a
// start frame (+ optional end frame)" in provider-neutral terms and this module
// dispatches to the configured backend. Veo and Kling are both implemented;
// VIDEO_CLIP_PROVIDER picks one, so trading them is an .env edit rather than a
// deploy, and neither the runner nor the routes know which is running.
//
// Deliberately thin: no capability tables, no plugin registry. Per-provider
// quirks live INSIDE each provider client, learned from its API where possible
// — the veo-client "params are LEARNED, not declared" doctrine. Which is why
// the two adapters are NOT mirror images: Kling has no negative-prompt field
// and no aspect field, so it folds the negative list into the prompt text and
// takes its output shape from the frames. All of that is kling-client's
// business, and none of it widens this type.
//
// Tier stays a plain string at the seam: tiers are a provider concept, and each
// adapter narrows it — Veo maps a tier to a MODEL id, Kling (one model) maps it
// to a RESOLUTION.
//
// Duration is likewise a plain number here (whole seconds), NOT a union: since
// clip lengths became audio-derived a scene can be any length its narration
// needs, and each adapter enforces its own real bounds — Kling 3-15s at
// pre-flight, Veo only 4|6|8 (its start+end interpolation exists at 8s alone),
// which is the guard below.

import { pathToFileURL } from 'node:url';
import { VIDEO_CLIP_MAX_SECONDS, VIDEO_CLIP_MIN_SECONDS } from '@dgipr/schemas';
import { generateVeoClip } from './veo-client.js';
import { generateKlingClip } from './kling-client.js';

export type ClipRenderInput = Readonly<{
  prompt: string;
  // The approved START frame (image-to-video input).
  startFramePng: Buffer;
  // The approved END frame, when the scene has one — the provider interpolates
  // between the two. A provider/model without the capability renders from the
  // start frame alone rather than failing.
  endFramePng?: Buffer | undefined;
  aspectRatio: '16:9' | '9:16';
  // Whole seconds. What each provider actually accepts is its own business:
  // Kling 3-15, Veo only 4|6|8.
  durationSeconds: number;
  tier: 'fast' | 'lite' | 'standard';
  negativePrompt?: string | undefined;
  onProgress?: ((elapsedMs: number) => void) | undefined;
}>;

const SUPPORTED_PROVIDERS = ['veo', 'kling'] as const;

export function clipProviderName(): string {
  const raw = process.env.VIDEO_CLIP_PROVIDER;
  return raw && raw.trim() !== '' ? raw.trim().toLowerCase() : 'kling';
}

// Which env var the ANIMATE gate must find for the configured provider, so the
// route can name the right one in its Marathi 503 without re-deriving the
// default. Returns null when the provider needs no key.
//
// This exists because the two steps need DIFFERENT keys: frames are rendered at
// the storyboard gate (VIDEO_IMAGE_PROVIDER, Gemini by default), so by animate
// time a Kling-clips deployment needs no GEMINI_API_KEY at all.
export function clipProviderApiKeyEnv(): string | null {
  switch (clipProviderName()) {
    case 'veo':
      return 'GEMINI_API_KEY';
    case 'kling':
      return 'KLING_API_KEY';
    default:
      // An unknown provider fails loudly at render time with the message below;
      // the gate should not invent a key name for it.
      return null;
  }
}

// Render one scene clip with the configured provider. Returns the MP4 bytes;
// the provider client records its own per-second cost into the ambient meter.
export async function renderClip(input: ClipRenderInput): Promise<Buffer> {
  const provider = clipProviderName();
  switch (provider) {
    case 'veo': {
      // Veo renders 4, 6 or 8 seconds only, and with a lastFrame it is 8s
      // alone — so an audio-derived duration (3-15s) is not renderable here.
      // Checked BEFORE the call so a misconfigured deployment fails free
      // rather than after a full render wait, and the message names the fix.
      const seconds = input.durationSeconds;
      if (seconds !== 4 && seconds !== 6 && seconds !== 8) {
        throw new Error(
          `Veo renders only 4, 6 or 8 second clips (got ${seconds}s). ` +
            'Variable clip lengths need VIDEO_CLIP_PROVIDER=kling.',
        );
      }
      return generateVeoClip({
        prompt: input.prompt,
        imagePng: input.startFramePng,
        ...(input.endFramePng ? { lastFramePng: input.endFramePng } : {}),
        aspectRatio: input.aspectRatio,
        durationSeconds: seconds,
        tier: input.tier,
        ...(input.negativePrompt !== undefined
          ? { negativePrompt: input.negativePrompt }
          : {}),
        ...(input.onProgress !== undefined
          ? { onProgress: input.onProgress }
          : {}),
      });
    }
    case 'kling':
      return generateKlingClip({
        prompt: input.prompt,
        imagePng: input.startFramePng,
        ...(input.endFramePng ? { lastFramePng: input.endFramePng } : {}),
        aspectRatio: input.aspectRatio,
        durationSeconds: input.durationSeconds,
        tier: input.tier,
        ...(input.negativePrompt !== undefined
          ? { negativePrompt: input.negativePrompt }
          : {}),
        ...(input.onProgress !== undefined
          ? { onProgress: input.onProgress }
          : {}),
      });
    default:
      throw new Error(
        `Unknown VIDEO_CLIP_PROVIDER "${provider}". ` +
          `Supported: ${SUPPORTED_PROVIDERS.join(', ')}.`,
      );
  }
}

// Free self-check of the dispatch itself. Worth asserting because both of its
// consumers are invisible until something breaks: a wrong key name turns the
// animate gate's setup message into a wild goose chase, and a typo'd provider
// must fail with a message that lists the real options rather than a stack
// trace from whichever client happened to be reached.
//
//   tsx src/video/clip-provider.ts
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const failures: string[] = [];
  const check = (label: string, ok: boolean): void => {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
    if (!ok) failures.push(label);
  };

  const saved = process.env.VIDEO_CLIP_PROVIDER;

  delete process.env.VIDEO_CLIP_PROVIDER;
  check('unset defaults to kling', clipProviderName() === 'kling');
  check(
    'the default gate asks for KLING_API_KEY, not Gemini',
    clipProviderApiKeyEnv() === 'KLING_API_KEY',
  );

  process.env.VIDEO_CLIP_PROVIDER = 'veo';
  check('veo is selectable', clipProviderName() === 'veo');
  check(
    'veo gate asks for GEMINI_API_KEY',
    clipProviderApiKeyEnv() === 'GEMINI_API_KEY',
  );

  process.env.VIDEO_CLIP_PROVIDER = 'kling';
  check('kling is selectable', clipProviderName() === 'kling');

  process.env.VIDEO_CLIP_PROVIDER = '  KLING  ';
  check('the value is trimmed and lowercased', clipProviderName() === 'kling');

  process.env.VIDEO_CLIP_PROVIDER = 'bogus';
  check('an unknown provider names no key', clipProviderApiKeyEnv() === null);

  if (saved === undefined) delete process.env.VIDEO_CLIP_PROVIDER;
  else process.env.VIDEO_CLIP_PROVIDER = saved;

  void (async () => {
    process.env.VIDEO_CLIP_PROVIDER = 'bogus';
    let message = '';
    try {
      await renderClip({
        prompt: 'x',
        startFramePng: Buffer.alloc(0),
        aspectRatio: '16:9',
        durationSeconds: 8,
        tier: 'fast',
      });
    } catch (error) {
      message = String((error as Error).message ?? error);
    }
    check(
      'an unknown provider throws listing both real ones',
      message.includes('Supported: veo, kling'),
    );

    // The veo duration guard. It must fire BEFORE the API call (these frames
    // are empty buffers — a request would fail with something unrelated), and
    // it must name the escape hatch, since a deployment hitting this has a
    // config problem, not a content one.
    process.env.VIDEO_CLIP_PROVIDER = 'veo';
    let veoMessage = '';
    try {
      await renderClip({
        prompt: 'x',
        startFramePng: Buffer.alloc(0),
        aspectRatio: '16:9',
        durationSeconds: 5,
        tier: 'fast',
      });
    } catch (error) {
      veoMessage = String((error as Error).message ?? error);
    }
    check(
      'veo rejects an audio-derived duration free of charge',
      veoMessage.includes('4, 6 or 8'),
    );
    check(
      'veo names kling as the fix',
      veoMessage.includes('VIDEO_CLIP_PROVIDER=kling'),
    );
    check(
      'the derivable range is wider than veo can render',
      VIDEO_CLIP_MIN_SECONDS < 4 && VIDEO_CLIP_MAX_SECONDS > 8,
    );

    if (saved === undefined) delete process.env.VIDEO_CLIP_PROVIDER;
    else process.env.VIDEO_CLIP_PROVIDER = saved;

    console.log(
      failures.length === 0
        ? '\nAll clip-provider checks passed.'
        : `\n${failures.length} check(s) FAILED.`,
    );
    process.exitCode = failures.length === 0 ? 0 : 1;
  })();
}
