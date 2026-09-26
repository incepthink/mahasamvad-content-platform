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

// Bounded retry for the image calls, which do not go through content-engine's
// openAiFetch (this package cannot import it). Retried ONLY where the request
// provably never started a render, because an image call is paid: a connect
// timeout / DNS / refused connection (undici names these by code on `cause`),
// or a 429 / 502 / 503 answer. A reset mid-response is deliberately NOT
// retried — the render may already have been billed.
const MAX_ATTEMPTS = Math.max(
  1,
  Number(process.env.OPENAI_IMAGE_MAX_ATTEMPTS ?? 4) || 4,
);
const PRE_REQUEST_ERROR_CODES = new Set([
  'UND_ERR_CONNECT_TIMEOUT',
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ENETUNREACH',
  'EHOSTUNREACH',
]);
const RETRYABLE_STATUSES = new Set([429, 502, 503]);

function errorCode(error: unknown): string | undefined {
  const cause = (error as { cause?: { code?: unknown } } | null)?.cause;
  const code = cause?.code ?? (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : undefined;
}

function retryDelayMs(attempt: number, response?: Response): number {
  const header = response?.headers.get('retry-after');
  const seconds =
    header === null || header === undefined ? NaN : Number(header);
  if (Number.isFinite(seconds) && seconds >= 0)
    return Math.min(seconds * 1000, 60_000);
  return Math.min(2_000 * 2 ** (attempt - 1), 20_000) + Math.random() * 500;
}

async function postWithRetry(
  url: string,
  init: RequestInit,
  context: string,
): Promise<Response> {
  for (let attempt = 1; ; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(url, init);
    } catch (error) {
      const code = errorCode(error);
      if (
        attempt >= MAX_ATTEMPTS ||
        !code ||
        !PRE_REQUEST_ERROR_CODES.has(code)
      )
        throw error;
      const delay = retryDelayMs(attempt);
      console.warn(
        `[openai-image] ${context} could not connect (${code}); ` +
          `retrying in ${Math.round(delay)}ms (attempt ${attempt + 1}/${MAX_ATTEMPTS})`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
      continue;
    }
    if (attempt >= MAX_ATTEMPTS || !RETRYABLE_STATUSES.has(response.status))
      return response;
    const delay = retryDelayMs(attempt, response);
    await response.body?.cancel().catch(() => undefined);
    console.warn(
      `[openai-image] ${context} got ${response.status}; ` +
        `retrying in ${Math.round(delay)}ms (attempt ${attempt + 1}/${MAX_ATTEMPTS})`,
    );
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}

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

export type EditImageOptions = GenerateImageOptions & {
  // gpt-image's `input_fidelity`: how hard the model works to keep the input images' features
  // — above all FACES and logos. 'high' is what an officer's own photograph needs, since the
  // whole point of attaching it is that the subject comes out unchanged. Optional: omitted,
  // the request is byte-for-byte what it always was.
  //
  // LEARNED, not declared (the veo-client doctrine): a model that rejects the field (some
  // always process inputs at high fidelity and refuse the parameter) is remembered for the
  // life of the process and the call is re-sent without it — never failed.
  inputFidelity?: 'high' | 'low';
};

// Models that answered a 400 naming `input_fidelity`. See EditImageOptions.inputFidelity.
const modelsRejectingInputFidelity = new Set<string>();

// Generates a text-free PNG for a poster from a prompt. Default size is the landscape
// background band; pass { size } for other aspect ratios (e.g. a square CMO circle photo).
export async function generateImage(
  prompt: string,
  opts: GenerateImageOptions = {},
): Promise<Buffer> {
  const apiKey = requireApiKey();
  const response = await postWithRetry(
    GENERATIONS_URL,
    {
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
    },
    'image generation',
  );
  return decode(response, 'image generation');
}

// Edits an existing PNG with a prompt (multipart POST /v1/images/edits — the
// same endpoint the n8n poster workflows call). Used for the video pipeline's
// END frame: editing the start frame instead of generating fresh is what keeps
// the pair inside ONE shot, so Veo's interpolation reads as motion rather than
// a crossfade between two different places.
//
// Several buffers may be passed: gpt-image's edits endpoint accepts a repeated
// `image[]` field, and the FIRST one is the image being edited while the rest
// are context the model may draw on. That is what lets the video frame provider
// hand gpt-image the same cross-scene world reference the Gemini path gets,
// instead of dropping it. Order therefore matters — never reorder the array.
export async function editImage(
  imagePng: Buffer | readonly Buffer[],
  prompt: string,
  opts: EditImageOptions = {},
): Promise<Buffer> {
  const apiKey = requireApiKey();
  const images = Array.isArray(imagePng) ? imagePng : [imagePng as Buffer];
  if (images.length === 0) {
    throw new Error('editImage was called with no image.');
  }
  const fidelity =
    opts.inputFidelity && !modelsRejectingInputFidelity.has(IMAGE_MODEL)
      ? opts.inputFidelity
      : undefined;
  const response = await postEdit(apiKey, images, prompt, opts, fidelity);
  if (fidelity && response.status === 400) {
    const detail = await response.clone().text();
    if (/input_fidelity/i.test(detail)) {
      modelsRejectingInputFidelity.add(IMAGE_MODEL);
      console.warn(
        `[openai-image] ${IMAGE_MODEL} rejected input_fidelity; re-sending the edit without it.`,
      );
      await response.body?.cancel().catch(() => undefined);
      return decode(
        await postEdit(apiKey, images, prompt, opts, undefined),
        'image edit',
      );
    }
  }
  return decode(response, 'image edit');
}

async function postEdit(
  apiKey: string,
  images: readonly Buffer[],
  prompt: string,
  opts: EditImageOptions,
  fidelity: 'high' | 'low' | undefined,
): Promise<Response> {
  const form = new FormData();
  form.append('model', IMAGE_MODEL);
  form.append('prompt', prompt);
  form.append('size', opts.size ?? SIZE);
  form.append('quality', QUALITY);
  form.append('n', '1');
  if (fidelity) form.append('input_fidelity', fidelity);
  // A single image keeps the scalar `image` field (byte-for-byte the old
  // request); only a multi-image call uses the array form, so nothing that
  // works today changes shape.
  const field = images.length === 1 ? 'image' : 'image[]';
  images.forEach((png, index) => {
    form.append(
      field,
      new Blob([new Uint8Array(png)], { type: 'image/png' }),
      `frame-${index + 1}.png`,
    );
  });
  // FormData is re-serialized on every fetch, so the same `form` is safe to resend.
  return postWithRetry(
    EDITS_URL,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}` },
      body: form,
    },
    'image edit',
  );
}
