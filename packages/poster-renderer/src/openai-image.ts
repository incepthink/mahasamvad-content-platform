// OpenAI GPT-image calls: generation for poster scenes / video keyframes, and
// an EDIT call for the video pipeline's end frame (derive the last frame of a
// scene from its first, so setting/people/light hold across the pair).
// Same raw-fetch + OPENAI_API_KEY style as content-engine/openai-chat.ts (no SDK).
//
// Posters only ever generate a text-free photograph from scratch (POST
// /v1/images/generations); the poster's text, header and footer are typeset later in
// HTML (poster-template.ts), so the mangled-Devanagari poster image-EDIT path is gone.
// editImage below is NOT that path's return: it edits a text-free frame into another
// text-free frame, no Devanagari involved.
//
// The scene fills a wide landscape band, so the default size is landscape. Model, size
// and quality stay env-overridable (OPENAI_IMAGE_MODEL / OPENAI_IMAGE_SIZE /
// OPENAI_IMAGE_QUALITY) as a fallback if an account can't request a given model or size.

const GENERATIONS_URL = 'https://api.openai.com/v1/images/generations';
const EDITS_URL = 'https://api.openai.com/v1/images/edits';

// gpt-image-2 (gpt-image-1 is deprecated on OpenAI's model page); matches what both
// n8n workflows use. Env-overridable if an account can't request it.
export const IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL ?? 'gpt-image-2';
// Landscape 3:2 — object-fit:cover-cropped into the poster's photo zone.
const SIZE = process.env.OPENAI_IMAGE_SIZE ?? '1536x1024';
// 'medium' is ~4x cheaper than 'high' with an acceptable poster background; keep in sync
// with the n8n workflow JSONs (and apps/api reads OPENAI_IMAGE_QUALITY to attribute cost).
const QUALITY = process.env.OPENAI_IMAGE_QUALITY ?? 'medium';

type ImageResponse = {
  data: Array<{ b64_json?: string }>;
};

function requireApiKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    throw new Error(
      'Missing required environment variable OPENAI_API_KEY. ' +
        'Copy .env.example to .env and fill it in.',
    );
  }
  return key;
}

async function decode(response: Response, context: string): Promise<Buffer> {
  if (!response.ok) {
    const detail = await response.text();
    const hint =
      response.status === 403
        ? ' (a 403 here usually means the API key/organisation is not verified for image generation)'
        : '';
    throw new Error(
      `OpenAI ${context} failed: ${response.status} ${response.statusText}${hint} — ${detail}`,
    );
  }
  const body = (await response.json()) as ImageResponse;
  const b64 = body.data[0]?.b64_json;
  if (!b64) {
    throw new Error(`OpenAI ${context} response contained no image data.`);
  }
  return Buffer.from(b64, 'base64');
}

export type GenerateImageOptions = {
  // Override the default (landscape) size — e.g. '1024x1024' for a square photo that
  // crops cleanly into a circle. Falls back to OPENAI_IMAGE_SIZE / the landscape default.
  size?: string;
};

// Generates a text-free PNG for a poster from a prompt. Default size is the landscape
// background band; pass { size } for other aspect ratios (e.g. a square CMO circle photo).
export async function generateImage(
  prompt: string,
  opts: GenerateImageOptions = {},
): Promise<Buffer> {
  const apiKey = requireApiKey();
  const response = await fetch(GENERATIONS_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: IMAGE_MODEL,
      prompt,
      size: opts.size ?? SIZE,
      quality: QUALITY,
      n: 1,
    }),
  });
  return decode(response, 'image generation');
}

// Edits an existing PNG with a prompt (multipart POST /v1/images/edits — the
// same endpoint the n8n poster workflows call). Used for the video pipeline's
// END frame: editing the start frame instead of generating fresh is what keeps
// the pair inside ONE shot, so Veo's interpolation reads as motion rather than
// a crossfade between two different places.
export async function editImage(
  imagePng: Buffer,
  prompt: string,
  opts: GenerateImageOptions = {},
): Promise<Buffer> {
  const apiKey = requireApiKey();
  const form = new FormData();
  form.append('model', IMAGE_MODEL);
  form.append('prompt', prompt);
  form.append('size', opts.size ?? SIZE);
  form.append('quality', QUALITY);
  form.append('n', '1');
  form.append(
    'image',
    new Blob([new Uint8Array(imagePng)], { type: 'image/png' }),
    'frame.png',
  );
  const response = await fetch(EDITS_URL, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}` },
    body: form,
  });
  return decode(response, 'image edit');
}
