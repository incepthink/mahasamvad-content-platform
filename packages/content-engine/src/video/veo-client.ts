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
  // The approved START frame this clip animates from (image-to-video).
  imagePng: Buffer;
  // The approved END frame (first+last-frame interpolation). Veo only accepts
  // it at durationSeconds 8 — generateVeoClip throws early on 4/6, before any
  // spend. Sent only to models that accept the field; a model that rejects it
  // is rendered from the start frame alone (see modelsRejectingLastFrame),
  // never failed.
  lastFramePng?: Buffer;
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

// lastFrame carries the same learned-capability treatment, twice over: the
// docs disagree with the working raw-REST `image` shape on the field's JSON
// encoding (inlineData vs bytesBase64Encoded), and the lite preview rejects
// the field entirely. Both are learned from the API's own 400s and cached per
// model id, so repointing VEO_MODEL_* needs no code change.
type LastFrameShape = 'bytes' | 'inline';
const modelsRejectingLastFrame = new Set<string>();
const lastFrameShapeByModel = new Map<string, LastFrameShape>();

function mentionsLastFrame(error: unknown): boolean {
  if (!(error instanceof GeminiRequestError) || error.status !== 400) {
    return false;
  }
  const detail = error.detail.toLowerCase();
  return (
    detail.includes('lastframe') ||
    detail.includes('last_frame') ||
    detail.includes('last frame')
  );
}

function lastFramePayload(png: Buffer, shape: LastFrameShape): unknown {
  const data = png.toString('base64');
  return shape === 'bytes'
    ? { bytesBase64Encoded: data, mimeType: 'image/png' }
    : { inlineData: { data, mimeType: 'image/png' } };
}

// Veo 3.x generates NATIVE AUDIO unless told not to — and this pipeline throws
// every frame of it away: assembleSilentVideo strips the track (-an) and
// muxNarration lays the Sarvam Marathi voiceover over the result. So the audio
// was pure cost, latency AND risk: Google runs a separate safety filter over the
// generated audio, and a trip on it fails the whole clip
// ("We encountered an issue with the audio for your prompt") after the render
// has already been waited out. Asking for silence removes the entire failure
// class. Learned, not declared, like every other Veo param: a model that
// rejects the field is rendered without it.
const modelsRejectingGenerateAudio = new Set<string>();

// Output resolution. 1080p is a straight quality win on 16:9 at no extra cost
// (Veo bills per second, not per pixel), but support varies by model and
// aspect — vertical 9:16 is 720p-only on several preview ids. Requesting it and
// learning from the rejection beats a per-model table that goes stale the
// moment VEO_MODEL_* is repointed.
const modelsRejectingResolution = new Set<string>();

function resolutionSetting(): string {
  const raw = process.env.VEO_RESOLUTION;
  return raw && raw.trim() !== '' ? raw.trim() : '1080p';
}

// Both fields are OPTIONAL to us — silence and 1080p are improvements, not
// requirements — so a 400 that merely NAMES the field is enough to drop it,
// the looser `mentionsLastFrame` rule rather than the stricter
// `rejectsNegativePrompt` one.
function mentionsField(error: unknown, ...needles: string[]): boolean {
  if (!(error instanceof GeminiRequestError) || error.status !== 400) {
    return false;
  }
  const detail = error.detail.toLowerCase();
  return needles.some((needle) => detail.includes(needle));
}

async function startVeoOperation(
  model: string,
  apiKey: string,
  input: VeoClipInput,
): Promise<VeoOperation> {
  const buildBody = (
    withNegativePrompt: boolean,
    lastFrameShape: LastFrameShape | null,
    withGenerateAudio: boolean,
    withResolution: boolean,
  ): unknown => ({
    instances: [
      {
        prompt: input.prompt,
        image: {
          bytesBase64Encoded: input.imagePng.toString('base64'),
          mimeType: 'image/png',
        },
        ...(lastFrameShape !== null && input.lastFramePng
          ? { lastFrame: lastFramePayload(input.lastFramePng, lastFrameShape) }
          : {}),
      },
    ],
    parameters: {
      aspectRatio: input.aspectRatio,
      durationSeconds: input.durationSeconds,
      // Silence, deliberately: the voiceover is Sarvam's and the mux would
      // discard anything Veo generated here anyway.
      ...(withGenerateAudio ? { generateAudio: false } : {}),
      ...(withResolution ? { resolution: resolutionSetting() } : {}),
      ...(withNegativePrompt && input.negativePrompt
        ? { negativePrompt: input.negativePrompt }
        : {}),
    },
  });

  const send = async (
    withNegativePrompt: boolean,
    lastFrameShape: LastFrameShape | null,
    withGenerateAudio: boolean,
    withResolution: boolean,
  ): Promise<VeoOperation> => {
    const response = await geminiFetch(`models/${model}:predictLongRunning`, {
      label: 'veo start',
      apiKey,
      body: buildBody(
        withNegativePrompt,
        lastFrameShape,
        withGenerateAudio,
        withResolution,
      ),
    });
    return (await response.json()) as VeoOperation;
  };

  const wantNegative =
    input.negativePrompt !== undefined && input.negativePrompt.trim() !== '';
  let sendingNegative = wantNegative && !modelsRejectingNegativePrompt.has(model);
  let lastFrameShape: LastFrameShape | null =
    input.lastFramePng !== undefined && !modelsRejectingLastFrame.has(model)
      ? (lastFrameShapeByModel.get(model) ?? 'bytes')
      : null;
  let sendingGenerateAudio = !modelsRejectingGenerateAudio.has(model);
  let sendingResolution = !modelsRejectingResolution.has(model);

  // Downgrade ladder: each caught rejection strictly narrows the request
  // (negativePrompt on→off; lastFrame bytes→inline→off; generateAudio on→off;
  // resolution on→off), so this terminates in at most five extra round trips —
  // and a rejected START is free, no render has begun. Anything unrecognised is
  // rethrown untouched.
  for (;;) {
    try {
      const operation = await send(
        sendingNegative,
        lastFrameShape,
        sendingGenerateAudio,
        sendingResolution,
      );
      if (lastFrameShape !== null) {
        lastFrameShapeByModel.set(model, lastFrameShape);
      }
      return operation;
    } catch (error) {
      if (sendingNegative && rejectsNegativePrompt(error)) {
        modelsRejectingNegativePrompt.add(model);
        // Worth a warning, not a silent downgrade: the no-text and no-talking
        // rules remain in the motion prompt (video-prompts.ts hard-appends
        // both), but their negative-prompt backup is gone for this model, and
        // glitchy mouths plus on-screen Devanagari were the worst artifacts in
        // real renders.
        console.warn(
          `[veo] ${model} rejects negativePrompt; retrying this and every ` +
            'later clip without it. The motion prompt still forbids on-screen ' +
            'text and talking, but watch the renders for both.',
        );
        sendingNegative = false;
        continue;
      }
      if (
        lastFrameShape === 'bytes' &&
        !lastFrameShapeByModel.has(model) &&
        mentionsLastFrame(error)
      ) {
        // Possibly just the encoding: the docs show an inlineData wrapper
        // where our image field uses bytesBase64Encoded. Try it once.
        lastFrameShape = 'inline';
        continue;
      }
      if (lastFrameShape !== null && mentionsLastFrame(error)) {
        modelsRejectingLastFrame.add(model);
        console.warn(
          `[veo] ${model} rejects lastFrame; rendering this and every later ` +
            'clip from the start frame only. The reviewed end frames are ' +
            'ignored on this model — repoint VEO_MODEL_* at a 3.1/3.1-fast ' +
            'id to restore interpolation.',
        );
        lastFrameShape = null;
        continue;
      }
      if (sendingGenerateAudio && mentionsField(error, 'generateaudio', 'generate_audio')) {
        modelsRejectingGenerateAudio.add(model);
        // Not fatal, but worth saying out loud: this model will generate audio
        // we then strip, and its audio safety filter can fail an otherwise good
        // render. If clips start dying on "an issue with the audio", this is why.
        console.warn(
          `[veo] ${model} rejects generateAudio; rendering this and every ` +
            'later clip WITH generated audio, which the assembly step strips. ' +
            "Veo's audio safety filter can now fail a render on its own.",
        );
        sendingGenerateAudio = false;
        continue;
      }
      if (sendingResolution && mentionsField(error, 'resolution')) {
        modelsRejectingResolution.add(model);
        console.warn(
          `[veo] ${model} rejects resolution=${resolutionSetting()} at ` +
            `${input.aspectRatio}; falling back to the model default for this ` +
            'and every later clip.',
        );
        sendingResolution = false;
        continue;
      }
      throw error;
    }
  }
}

// Generate one scene clip. Returns the MP4 bytes — SILENT (generateAudio:false;
// the Marathi voiceover is muxed in later from Sarvam) and at VEO_RESOLUTION
// where the model accepts it — and records the per-second tier cost into the
// ambient cost meter.
export async function generateVeoClip(input: VeoClipInput): Promise<Buffer> {
  // Veo rejects interpolation at 4/6s with INVALID_ARGUMENT — fail here, free
  // and with a message that names the rule, instead of at the API.
  if (input.lastFramePng !== undefined && input.durationSeconds !== 8) {
    throw new Error(
      'Veo first+last-frame interpolation requires an 8s clip; got ' +
        `${input.durationSeconds}s.`,
    );
  }
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

// Run directly to prove account access + the operation lifecycle with ONE
// cheap clip before wiring the animate job (Veo spend). A second PNG becomes
// the LAST frame (first+last interpolation — forces the 8s window; ~$1.20 on
// fast). Without one, --lite --4s stays the cheapest smoke test.
//
//   tsx --env-file=../../.env src/video/veo-client.ts <start.png> [end.png] [--lite|--standard] [--4s|--6s]
//
// Writes veo-test.mp4 beside the input still.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const args = process.argv.slice(2);
  const positional = args.filter((arg) => !arg.startsWith('--'));
  const stillPath = positional[0];
  const lastFramePath = positional[1];
  if (!stillPath) {
    console.error(
      'Usage: tsx --env-file=../../.env src/video/veo-client.ts <start.png> [end.png] [--lite|--standard] [--4s|--6s]',
    );
    process.exit(1);
  }
  const tier: VeoTier = args.includes('--lite')
    ? 'lite'
    : args.includes('--standard')
      ? 'standard'
      : 'fast';
  // Interpolation only exists at 8s; a duration flag is ignored with a note
  // rather than handed to the API to bounce.
  let durationSeconds: VeoDurationSeconds = args.includes('--4s')
    ? 4
    : args.includes('--6s')
      ? 6
      : 8;
  if (lastFramePath && durationSeconds !== 8) {
    console.warn('Last frame provided — forcing the 8s interpolation window.');
    durationSeconds = 8;
  }

  void (async () => {
    const { writeFile } = await import('node:fs/promises');
    const { dirname, join } = await import('node:path');
    const imagePng = await readFile(stillPath);
    const lastFramePng = lastFramePath
      ? await readFile(lastFramePath)
      : undefined;
    console.log(
      `Rendering ${durationSeconds}s ${tier} clip from ${stillPath}` +
        (lastFramePath ? ` → ${lastFramePath}` : '') +
        '…',
    );
    const clip = await generateVeoClip({
      prompt:
        'One continuous realistic live-action shot; smooth, purposeful ' +
        'camera motion. ' +
        (lastFramePath
          ? 'Move naturally from the first frame to the provided final frame. '
          : '') +
        'Absolutely no on-screen text, letters, numerals, captions, signage or logos.',
      imagePng,
      ...(lastFramePng ? { lastFramePng } : {}),
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
