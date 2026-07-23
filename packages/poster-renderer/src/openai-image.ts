// OpenAI GPT-image call for the poster's background SCENE (PROJECT_CONTEXT step 14).
// Same raw-fetch + OPENAI_API_KEY style as content-engine/openai-chat.ts (no SDK).
//
// We only ever generate a text-free photograph from scratch now (POST
// /v1/images/generations); the poster's text, header and footer are typeset later in
// HTML (poster-template.ts), so the mangled-Devanagari image-edit path is gone.
//
// The scene fills a wide landscape band, so the default size is landscape. Model, size
// and quality stay env-overridable (OPENAI_IMAGE_MODEL / OPENAI_IMAGE_SIZE /
// OPENAI_IMAGE_QUALITY) as a fallback if an account can't request a given model or size.

const GENERATIONS_URL = 'https://api.openai.com/v1/images/generations';

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
