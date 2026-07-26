// Gemini image generation ("Nano Banana") for the explainer video's frame
// pairs. Raw REST through geminiFetch — same no-SDK policy, same limiter and
// retry policy, as veo-client.ts. Never call generativelanguage.googleapis.com
// directly.
//
// ONE endpoint serves both halves of the pipeline's frame work, which is the
// reason this model was chosen: `:generateContent` with an IMAGE response
// modality generates from text alone, and generates from text PLUS an input
// image — i.e. an edit. The end frame is an edit of the start frame (see
// buildEndFramePrompt), and holding a scene's location, people and light across
// that edit is exactly what this model family is built for; the pair has to sit
// inside one shot or Veo's interpolation reads as a crossfade between two
// different places rather than motion within a scene.
//
// Aspect ratio is asked for NATIVELY (imageConfig.aspectRatio) rather than
// generated at 3:2 and centre-cropped the way the gpt-image path must be. That
// keeps the pixels the model actually composed — no crop, no re-framing of a
// shot someone approved.
//
// The preview model ids churn, so GEMINI_IMAGE_MODEL is env-overridable, and
// the request parameters are LEARNED from the API's own rejections rather than
// declared in a table that goes stale the moment the id is repointed
// (veo-client.ts's doctrine).

import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { GeminiRequestError, geminiFetch } from '../http/gemini-request.js';
import { recordGeminiImageCost } from '../cost/cost-meter.js';

const DEFAULT_IMAGE_MODEL = 'gemini-3-pro-image-preview';

export type GeminiImageAspect = '16:9' | '9:16' | '1:1';

export function geminiImageModel(): string {
  const override = process.env.GEMINI_IMAGE_MODEL;
  return override && override.trim() !== ''
    ? override.trim()
    : DEFAULT_IMAGE_MODEL;
}

function requireApiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error(
      'Missing required environment variable GEMINI_API_KEY. ' +
        'Copy .env.example to .env and fill it in.',
    );
  }
  return key;
}

// Parsed tolerantly and failing with the raw JSON rather than a silent
// undefined — the videoUriOf precedent. A refusal comes back as a text part
// with no image, which is worth reporting verbatim: it usually names the rule
// the prompt tripped.
type GeminiImageResponse = {
  candidates?: Array<{
    finishReason?: string;
    content?: {
      parts?: Array<{
        text?: string;
        inlineData?: { mimeType?: string; data?: string };
        inline_data?: { mime_type?: string; data?: string };
      }>;
    };
  }>;
  promptFeedback?: { blockReason?: string };
};

function imageDataOf(body: GeminiImageResponse): string | null {
  const parts = body.candidates?.[0]?.content?.parts ?? [];
  for (const part of parts) {
    const data = part.inlineData?.data ?? part.inline_data?.data;
    if (data) return data;
  }
  return null;
}

function refusalTextOf(body: GeminiImageResponse): string {
  const parts = body.candidates?.[0]?.content?.parts ?? [];
  const text = parts
    .map((part) => part.text)
    .filter((value): value is string => typeof value === 'string' && value !== '')
    .join(' ')
    .trim();
  const blocked = body.promptFeedback?.blockReason;
  const finish = body.candidates?.[0]?.finishReason;
  return [
    blocked ? `blockReason=${blocked}` : '',
    finish ? `finishReason=${finish}` : '',
    text,
  ]
    .filter((value) => value !== '')
    .join(' — ');
}

// Some model ids reject imageConfig outright (older/flash previews take no
// aspect ratio at all). Learned once per model, then the caller's normaliser
// crops the returned image instead — a slightly worse frame beats a failed one.
const modelsRejectingImageConfig = new Set<string>();

function mentionsImageConfig(error: unknown): boolean {
  if (!(error instanceof GeminiRequestError) || error.status !== 400) {
    return false;
  }
  const detail = error.detail.toLowerCase();
  return (
    detail.includes('imageconfig') ||
    detail.includes('image_config') ||
    detail.includes('aspectratio') ||
    detail.includes('aspect_ratio')
  );
}

export type GeminiImageInput = Readonly<{
  prompt: string;
  aspect: GeminiImageAspect;
  // When present the call is an EDIT: the model is given this image plus the
  // prompt and returns a modified version of it.
  sourceImagePng?: Buffer | undefined;
  // A frame from an EARLIER scene, attached so this one inherits its world
  // (country, people, colour treatment) rather than being invented afresh.
  // Callers must not send it together with sourceImagePng: two inline images
  // and one "edit this" instruction leave the model to guess which is which.
  referenceImagePng?: Buffer | undefined;
}>;

// Generate (or edit) one image. Returns the PNG bytes and records the flat
// per-image price against the ambient cost meter.
//
// `aspectHonoured` is not reported: the caller normalises with cropToAspect
// either way, so a model that ignored the request still yields a correctly
// shaped frame.
export async function generateGeminiImage(
  input: GeminiImageInput,
): Promise<Buffer> {
  const apiKey = requireApiKey();
  const model = geminiImageModel();

  if (input.sourceImagePng && input.referenceImagePng) {
    throw new Error(
      'generateGeminiImage: pass either sourceImagePng (an edit) or ' +
        'referenceImagePng (a world reference), never both — the model cannot ' +
        'tell which image an "edit this" instruction refers to.',
    );
  }

  const inlinePng = (png: Buffer) => ({
    inlineData: { mimeType: 'image/png', data: png.toString('base64') },
  });

  const buildBody = (withImageConfig: boolean): unknown => ({
    contents: [
      {
        role: 'user',
        parts: [
          { text: input.prompt },
          ...(input.sourceImagePng ? [inlinePng(input.sourceImagePng)] : []),
          ...(input.referenceImagePng
            ? [inlinePng(input.referenceImagePng)]
            : []),
        ],
      },
    ],
    generationConfig: {
      responseModalities: ['IMAGE'],
      ...(withImageConfig
        ? { imageConfig: { aspectRatio: input.aspect } }
        : {}),
    },
  });

  const send = async (withImageConfig: boolean): Promise<GeminiImageResponse> => {
    const response = await geminiFetch(`models/${model}:generateContent`, {
      label: 'gemini image',
      apiKey,
      body: buildBody(withImageConfig),
    });
    return (await response.json()) as GeminiImageResponse;
  };

  let withImageConfig = !modelsRejectingImageConfig.has(model);
  let body: GeminiImageResponse;
  for (;;) {
    try {
      body = await send(withImageConfig);
      break;
    } catch (error) {
      if (withImageConfig && mentionsImageConfig(error)) {
        modelsRejectingImageConfig.add(model);
        console.warn(
          `[gemini-image] ${model} rejects imageConfig; requesting this and ` +
            'every later frame without a native aspect ratio. Frames will be ' +
            'centre-cropped to the video aspect instead.',
        );
        withImageConfig = false;
        continue;
      }
      throw error;
    }
  }

  const data = imageDataOf(body);
  if (!data) {
    const reason = refusalTextOf(body);
    throw new Error(
      `Gemini image model ${model} returned no image` +
        (reason ? `: ${reason}` : `: ${JSON.stringify(body)}`),
    );
  }

  const bytes = Buffer.from(data, 'base64');
  if (bytes.length === 0) {
    throw new Error(`Gemini image model ${model} returned an empty image.`);
  }
  recordGeminiImageCost();
  return bytes;
}

// Run directly to prove model access, the response shape and — the part worth
// checking before any pipeline wiring — that passing a source image performs a
// real EDIT (same room, same people, a moment later) rather than generating a
// fresh unrelated scene. A few cents per call.
//
//   tsx --env-file=../../.env src/video/gemini-image-client.ts "<prompt>" [source.png] [--vertical]
//
// Writes gemini-image-test.png to the cwd.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const args = process.argv.slice(2);
  const positional = args.filter((arg) => !arg.startsWith('--'));
  const prompt = positional[0];
  const sourcePath = positional[1];
  if (!prompt) {
    console.error(
      'Usage: tsx --env-file=../../.env src/video/gemini-image-client.ts "<prompt>" [source.png] [--vertical]',
    );
    process.exit(1);
  }
  const aspect: GeminiImageAspect = args.includes('--vertical')
    ? '9:16'
    : '16:9';

  void (async () => {
    const { writeFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const sharp = (await import('sharp')).default;
    const sourceImagePng = sourcePath ? await readFile(sourcePath) : undefined;
    console.log(
      `${sourcePath ? 'Editing' : 'Generating'} a ${aspect} frame with ` +
        `${geminiImageModel()}…`,
    );
    const png = await generateGeminiImage({
      prompt,
      aspect,
      ...(sourceImagePng ? { sourceImagePng } : {}),
    });
    const meta = await sharp(png).metadata();
    const outPath = join(process.cwd(), 'gemini-image-test.png');
    await writeFile(outPath, png);
    console.log(
      `Wrote ${outPath} (${png.length} bytes, ${meta.width}x${meta.height}).`,
    );
    // The whole point of the native aspect request: confirm it was honoured, or
    // the frame is being cropped after the fact like the gpt-image path.
    const ratio = (meta.width ?? 0) / (meta.height ?? 1);
    const want = aspect === '16:9' ? 16 / 9 : 9 / 16;
    console.log(
      Math.abs(ratio - want) < 0.02
        ? `Aspect ${aspect} honoured natively — no crop needed.`
        : `WARNING: asked for ${aspect}, got ${ratio.toFixed(3)}:1 — cropToAspect will trim it.`,
    );
  })().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
