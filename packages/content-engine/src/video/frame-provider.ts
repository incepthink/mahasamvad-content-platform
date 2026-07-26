// Provider seam for the explainer video's storyboard FRAMES, the twin of
// clip-provider.ts. The runner asks for "one frame at this aspect, optionally
// edited from that one" in provider-neutral terms and this module dispatches to
// the configured backend: Gemini (Nano Banana) by default, gpt-image kept and
// switchable in one env line.
//
// The interface takes an ASPECT, not a pixel size, and that is the load-bearing
// difference from what it replaces. A pixel size is an OpenAI concept: gpt-image
// renders 3:2 / 2:3 and the pipeline then centre-crops to 16:9 / 9:16, throwing
// away real pixels and re-framing a shot the model composed. Gemini takes the
// aspect natively. Asking at the seam for what the pipeline actually wants lets
// each adapter get there its own way — the OpenAI one still crops, the Gemini
// one does not need to.
//
// Deliberately thin, per clip-provider.ts: no capability tables, no registry.
// Per-model quirks (which params an id rejects, whether it honours the aspect)
// live INSIDE each client, learned from its API.
//
// Scope is VIDEO frames only. The poster paths (article poster, CMO circle
// photo) keep calling @dgipr/poster-renderer directly — they have their own
// sizes, their own chrome geometry and no aspect question.

import { cropToAspect, editImage, generateImage } from '@dgipr/poster-renderer';
import { recordImageCost } from '../cost/cost-meter.js';
import { type ImageQuality } from '../cost/pricing.js';
import {
  generateGeminiImage,
  type GeminiImageAspect,
} from './gemini-image-client.js';

export type FrameAspect = Extract<GeminiImageAspect, '16:9' | '9:16'>;

export type FrameRenderInput = Readonly<{
  prompt: string;
  aspect: FrameAspect;
  // Present ⇒ this is an EDIT of that frame rather than a fresh generation.
  // The video pipeline's END frame is always an edit of its START frame, which
  // is what keeps a scene's two reviewed frames inside one continuous shot.
  sourceFramePng?: Buffer | undefined;
  // An earlier scene's approved frame, attached so THIS scene inherits the same
  // visual world (country, people, colour treatment). Ignored when
  // sourceFramePng is set: an edit already inherits everything from what it
  // edits, and two attached images would make "edit this" ambiguous.
  referenceFramePng?: Buffer | undefined;
}>;

const SUPPORTED_PROVIDERS = ['gemini', 'openai'] as const;

function providerName(): string {
  const raw = process.env.VIDEO_IMAGE_PROVIDER;
  return raw && raw.trim() !== '' ? raw.trim().toLowerCase() : 'gemini';
}

// Same sync rule as the runner's: used only to attribute the fixed per-render
// gpt-image price. Gemini bills flat per image and meters itself.
function imageQuality(): ImageQuality {
  const q = process.env.OPENAI_IMAGE_QUALITY;
  return q === 'high' || q === 'low' ? q : 'medium';
}

// gpt-image renders 3:2 / 2:3 only; cropToAspect trims to the video aspect
// afterwards. The edits endpoint takes the same generation sizes, so a start
// frame and the end frame edited from it stay comparably framed.
function openAiSizeFor(aspect: FrameAspect): string {
  return aspect === '9:16' ? '1024x1536' : '1536x1024';
}

// Render one storyboard frame with the configured provider. Returns PNG bytes
// already at the requested aspect; the provider client records its own cost
// into the ambient meter.
export async function renderFrame(input: FrameRenderInput): Promise<Buffer> {
  const provider = providerName();
  switch (provider) {
    case 'gemini': {
      const png = await generateGeminiImage({
        prompt: input.prompt,
        aspect: input.aspect,
        ...(input.sourceFramePng
          ? { sourceImagePng: input.sourceFramePng }
          : input.referenceFramePng
            ? { referenceImagePng: input.referenceFramePng }
            : {}),
      });
      // A no-op when the native aspect was honoured (the normal path), and the
      // safety net when it was not — a model that ignored imageConfig, or one
      // whose id was repointed at something that takes no aspect at all, still
      // yields a correctly shaped frame instead of a stretched clip.
      return cropToAspect(png, input.aspect);
    }
    case 'openai': {
      // referenceFramePng is deliberately DROPPED here: editImage/generateImage
      // take a single image, so there is nowhere to attach a second one without
      // changing what the call means. The gemini path is the default; a project
      // rendered on this one simply gets the older behaviour, where the style
      // paragraph alone carries cross-scene consistency.
      const size = openAiSizeFor(input.aspect);
      const png = input.sourceFramePng
        ? await editImage(input.sourceFramePng, input.prompt, { size })
        : await generateImage(input.prompt, { size });
      recordImageCost('article', imageQuality());
      return cropToAspect(png, input.aspect);
    }
    default:
      throw new Error(
        `Unknown VIDEO_IMAGE_PROVIDER "${provider}". ` +
          `Supported: ${SUPPORTED_PROVIDERS.join(', ')}.`,
      );
  }
}
