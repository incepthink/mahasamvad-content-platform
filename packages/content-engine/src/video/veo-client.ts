// Veo 3.1 video generation via the Gemini API (image-to-video, one scene clip
// per call). Raw REST through geminiFetch — same no-SDK policy as every other
// model call in this package — because the transport rules (process-wide
// serialization, retry-after-driven backoff) must be ours either way.
//
// Veo is a LONG-RUNNING operation: start it, poll the operation name every
// ~10s until done, then download the video file. Google keeps the file for
// only 2 days, so the caller must persist the returned bytes immediately.
//
// The preview model ids churn; each tier's id is env-overridable so a rename
// is an .env edit, not a deploy.

import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { GeminiRequestError, geminiFetch } from '../http/gemini-request.js';
import { recordVideoCost } from '../cost/cost-meter.js';

export type VeoTier = 'fast' | 'lite' | 'standard';
export type VeoAspectRatio = '16:9' | '9:16';
export type VeoDurationSeconds = 4 | 6 | 8;

const DEFAULT_MODELS: Readonly<Record<VeoTier, string>> = {
  standard: 'veo-3.1-generate-preview',
  fast: 'veo-3.1-fast-generate-preview',
  lite: 'veo-3.1-lite-generate-preview',
};

function modelFor(tier: VeoTier): string {
  const envName = `VEO_MODEL_${tier.toUpperCase()}`;
  const override = process.env[envName];
  return override && override.trim() !== '' ? override : DEFAULT_MODELS[tier];
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

function readInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// The operation response, parsed tolerantly: the raw REST shape nests the
// result under generateVideoResponse.generatedSamples, while SDK-normalized
// docs show response.generatedVideos. A preview API earns a parser that
// accepts both and fails with the raw JSON, not a silent undefined.
type VeoOperation = {
  name?: string;
  done?: boolean;
  error?: { code?: number; message?: string };
  response?: {
    generateVideoResponse?: {
      generatedSamples?: Array<{ video?: { uri?: string } }>;
      raiMediaFilteredReasons?: string[];
    };
    generatedVideos?: Array<{ video?: { uri?: string } }>;
  };
};

function videoUriOf(operation: VeoOperation): string | null {
  const fromRest =
    operation.response?.generateVideoResponse?.generatedSamples?.[0]?.video
      ?.uri;
  if (fromRest) return fromRest;
  const fromSdkShape = operation.response?.generatedVideos?.[0]?.video?.uri;
  return fromSdkShape ?? null;
}

export type VeoClipInput = Readonly<{
  prompt: string;
  // The approved storyboard keyframe this clip animates (image-to-video).
  imagePng: Buffer;
  aspectRatio: VeoAspectRatio;
  durationSeconds: VeoDurationSeconds;
  tier: VeoTier;
  // Steers the model away from on-screen text, talking mouths, etc. Sent only
  // to models that accept it — a model that rejects the field is rendered
  // without it (see modelsRejectingNegativePrompt), never failed.
  negativePrompt?: string;
  onProgress?: (elapsedMs: number) => void;
}>;

// Veo's parameter set differs BY MODEL: the 3.1 lite preview rejects
// `negativePrompt` outright (400 INVALID_ARGUMENT) where fast and standard
// accept it. The capability is learned from the API's own rejection rather than
// declared in a per-model table, because the preview ids churn and are
// env-overridable (VEO_MODEL_*) — a table would go stale the moment one is
// repointed, and repointing is exactly what a quota wall makes you do. Cached
// per model id for the life of the process, so only the first clip of a run
// pays the extra round trip; a rejected start is free (no render begins), and
// switching back to a model that supports the field sends it again with no
// config change.
const modelsRejectingNegativePrompt = new Set<string>();

function rejectsNegativePrompt(error: unknown): boolean {
  if (!(error instanceof GeminiRequestError) || error.status !== 400) {
    return false;
  }
  const detail = error.detail.toLowerCase();
  return (
    detail.includes('negativeprompt') &&
    (detail.includes("isn't supported") ||
      detail.includes('is not supported') ||
      detail.includes('not supported') ||
      detail.includes('unsupported'))
  );
}

async function startVeoOperation(
  model: string,
  apiKey: string,
  input: VeoClipInput,
): Promise<VeoOperation> {
  const buildBody = (withNegativePrompt: boolean): unknown => ({
    instances: [
      {
        prompt: input.prompt,
        image: {
          bytesBase64Encoded: input.imagePng.toString('base64'),
          mimeType: 'image/png',
        },
      },
    ],
    parameters: {
      aspectRatio: input.aspectRatio,
      durationSeconds: input.durationSeconds,
      ...(withNegativePrompt && input.negativePrompt
        ? { negativePrompt: input.negativePrompt }
        : {}),
    },
  });

  const send = async (withNegativePrompt: boolean): Promise<VeoOperation> => {
    const response = await geminiFetch(`models/${model}:predictLongRunning`, {
      label: 'veo start',
      apiKey,
      body: buildBody(withNegativePrompt),
    });
    return (await response.json()) as VeoOperation;
  };

  const wanted =
    input.negativePrompt !== undefined && input.negativePrompt.trim() !== '';
  const sending = wanted && !modelsRejectingNegativePrompt.has(model);

  try {
    return await send(sending);
  } catch (error) {
    if (!sending || !rejectsNegativePrompt(error)) throw error;
    modelsRejectingNegativePrompt.add(model);
    // Worth a warning, not a silent downgrade: the no-text and no-talking rules
    // remain in the motion prompt (video-prompts.ts hard-appends both), but
    // their negative-prompt backup is gone for this model, and glitchy mouths
    // plus on-screen Devanagari were the worst artifacts in real renders.
    console.warn(
      `[veo] ${model} rejects negativePrompt; retrying this and every later ` +
        'clip without it. The motion prompt still forbids on-screen text and ' +
        'talking, but watch the renders for both.',
    );
    return send(false);
  }
}

// Generate one scene clip. Returns the MP4 bytes (720p, WITH Veo's native
// audio — the assembly step strips it) and records the per-second tier cost
// into the ambient cost meter.
export async function generateVeoClip(input: VeoClipInput): Promise<Buffer> {
  const apiKey = requireApiKey();
  const model = modelFor(input.tier);
  const pollIntervalMs = readInt('VEO_POLL_INTERVAL_MS', 10_000);
  const timeoutMs = readInt('VEO_RENDER_TIMEOUT_MS', 600_000);

  const started = await startVeoOperation(model, apiKey, input);
  if (!started.name) {
    throw new Error(
      `Veo start response carried no operation name: ${JSON.stringify(started)}`,
    );
  }

  // Poll until done. The wall clock is the release valve: a stuck operation
  // must fail the scene, not hang the whole animate job forever.
  const startedAt = Date.now();
  let operation = started;
  while (!operation.done) {
    const elapsed = Date.now() - startedAt;
    if (elapsed > timeoutMs) {
      throw new Error(
        `Veo render timed out after ${Math.round(elapsed / 1000)}s (operation ${started.name}).`,
      );
    }
    input.onProgress?.(elapsed);
    await sleep(pollIntervalMs);
    const pollResponse = await geminiFetch(started.name, {
      label: 'veo poll',
      apiKey,
      method: 'GET',
    });
    operation = (await pollResponse.json()) as VeoOperation;
  }

  if (operation.error) {
    throw new Error(
      `Veo render failed: ${operation.error.message ?? JSON.stringify(operation.error)}`,
    );
  }
  const uri = videoUriOf(operation);
  if (!uri) {
    const filtered =
      operation.response?.generateVideoResponse?.raiMediaFilteredReasons;
    if (filtered && filtered.length > 0) {
      // Safety-filtered render (e.g. person-generation policy): surface the
      // reason so the scene card can show it instead of a generic failure.
      throw new Error(`Veo blocked this render: ${filtered.join('; ')}`);
    }
    throw new Error(
      `Veo operation finished without a video: ${JSON.stringify(operation)}`,
    );
  }

  // Download the MP4. The file endpoint authenticates via the same API-key
  // header and may redirect; geminiFetch follows fetch's default redirect
  // handling and returns the ok response.
  const download = await geminiFetch(uri, {
    label: 'veo download',
    apiKey,
    method: 'GET',
  });
  const bytes = Buffer.from(await download.arrayBuffer());
  if (bytes.length === 0) {
    throw new Error(`Veo download for ${uri} returned an empty body.`);
  }

  recordVideoCost(input.tier, input.durationSeconds);
  return bytes;
}

// Run directly to prove account access + the operation lifecycle with ONE cheap
// clip before wiring the animate job (Veo spend — use --lite --4s):
//
//   tsx --env-file=../../.env src/video/veo-client.ts <still.png> [--lite|--standard] [--4s|--6s]
//
// Writes veo-test.mp4 beside the input still.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const args = process.argv.slice(2);
  const stillPath = args.find((arg) => !arg.startsWith('--'));
  if (!stillPath) {
    console.error(
      'Usage: tsx --env-file=../../.env src/video/veo-client.ts <still.png> [--lite|--standard] [--4s|--6s]',
    );
    process.exit(1);
  }
  const tier: VeoTier = args.includes('--lite')
    ? 'lite'
    : args.includes('--standard')
      ? 'standard'
      : 'fast';
  const durationSeconds: VeoDurationSeconds = args.includes('--4s')
    ? 4
    : args.includes('--6s')
      ? 6
      : 8;

  void (async () => {
    const { writeFile } = await import('node:fs/promises');
    const { dirname, join } = await import('node:path');
    const imagePng = await readFile(stillPath);
    console.log(
      `Rendering ${durationSeconds}s ${tier} clip from ${stillPath}…`,
    );
    const clip = await generateVeoClip({
      prompt:
        'Gentle camera push-in on this illustrated scene; subtle ambient motion. ' +
        'Absolutely no on-screen text, letters, numerals, captions, signage or logos.',
      imagePng,
      aspectRatio: '16:9',
      durationSeconds,
      tier,
      onProgress: (elapsedMs) =>
        console.log(`…still rendering (${Math.round(elapsedMs / 1000)}s)`),
    });
    const outPath = join(dirname(stillPath), 'veo-test.mp4');
    await writeFile(outPath, clip);
    console.log(`Wrote ${outPath} (${clip.length} bytes).`);
  })().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
