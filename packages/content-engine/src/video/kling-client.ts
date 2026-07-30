// Kling 3.0 video generation via the official Kling API (image-to-video, one
// scene clip per call). Raw REST through klingFetch — same no-SDK policy as
// every other model call in this package.
//
// This is the OFFICIAL api-singapore.klingai.com API, on its model-specific
// endpoints (`/image-to-video/kling-3.0`), NOT a reseller and NOT the legacy
// `/v1/videos/image2video` route. Two consequences worth knowing before
// touching this file:
//
// - Auth is a plain API key, not the AK/SK JWT signing the older docs describe.
//   Kling's own docs mark JWT as legacy-only, and 3.0 exists only here.
// - A 200 can still be a failure (`code !== 0`). klingFetch owns that check and
//   hands back the envelope's `data`, so nothing in this file re-implements it.
//
// Like Veo, this is a LONG-RUNNING task: submit it, poll `/tasks` every ~10s
// until the status settles, then download the result. Kling keeps the file for
// 30 days, but the caller persists the bytes immediately anyway.
//
// Three shape differences from veo-client, all forced by the API and all the
// reason this adapter is not a mirror image of that one:
//
// - THERE IS NO negative_prompt FIELD. The docs say the prompt itself carries
//   positive and negative description, so the caller's negative list is folded
//   into the prompt text by buildAvoidClause.
// - THERE IS NO aspect_ratio FIELD. Output aspect follows the input frames,
//   which is why this validates the two frames agree with each other BEFORE
//   spending anything — mismatched frames would produce a clip the stitch
//   cannot concat, and there is no parameter to correct it with.
// - `multi_shot` DEFAULTS TO TRUE. A single continuous shot is the entire
//   premise of frame interpolation, so it is sent explicitly as false and its
//   downgrade rung warns loudly.

import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { KlingRequestError, klingApiKey, klingFetch, klingFetchBinary } from '../http/kling-request.js';
import { recordVideoCost } from '../cost/cost-meter.js';
import { buildAvoidClause, fitClipPrompt } from './video-prompts.js';

export type KlingTier = 'fast' | 'lite' | 'standard';
export type KlingAspectRatio = '16:9' | '9:16';
export type KlingResolution = '720p' | '1080p' | '4k';

// Kling recommends <=2500 characters and hard-caps at 3072 (a longer prompt is
// rejected with `code 1201 contents[0].text: size must be between 0 and 3072`,
// before any render). We aim at the recommendation and let fitClipPrompt
// overshoot toward — but never past — the hard cap.
const PROMPT_MAX_CHARS = 2500;
const PROMPT_HARD_MAX_CHARS = 3072;

// Kling's own input rules, checked locally so a bad frame fails free instead of
// after a round trip.
const MIN_FRAME_SIDE = 300;
const MAX_FRAME_RATIO = 2.5;

export function klingModel(): string {
  const raw = process.env.KLING_MODEL;
  return raw && raw.trim() !== '' ? raw.trim() : 'kling-3.0';
}

// Resolution is Kling's quality AND price axis (6 credits/s at 720p with audio
// off, 8 at 1080p), so unlike Veo's resolution it is a real cost lever.
//
// KLING_RESOLUTION wins outright when set — that is what "720p for now" means,
// and it is how this deployment is configured. Unset, it falls back to the
// project's tier so the knob still means something: the officer's दर्जा choice
// maps onto the only quality axis this model has.
export function klingResolution(tier: KlingTier): KlingResolution {
  const raw = process.env.KLING_RESOLUTION;
  if (raw && raw.trim() !== '') return raw.trim() as KlingResolution;
  return tier === 'standard' ? '1080p' : '720p';
}

export type KlingClipInput = Readonly<{
  prompt: string;
  // The approved START frame this clip animates from. Required — Kling supports
  // first-frame and first+last-frame generation, but not last-frame-only.
  imagePng: Buffer;
  // The approved END frame. Kling interpolates between the two.
  lastFramePng?: Buffer;
  // Cross-check only: Kling has no aspect parameter, so the FRAMES decide the
  // output aspect and this is what they are checked against.
  aspectRatio: KlingAspectRatio;
  // 3..15 per the API. The pipeline's interpolation window is 8.
  durationSeconds: number;
  // Selects the resolution (unless KLING_RESOLUTION pins it) and attributes the
  // cost. Kling 3.0 is one model — the tier is not a model id here, unlike Veo.
  tier: KlingTier;
  // Folded into the prompt text; Kling has no field for it.
  negativePrompt?: string;
  onProgress?: (elapsedMs: number) => void;
}>;

// The create call's payload.
type KlingCreateData = {
  id?: string;
  status?: string;
  external_id?: string;
};

type KlingTaskOutput = {
  type?: string;
  id?: string;
  url?: string;
  watermark_url?: string;
  duration?: string | number;
};

type KlingBillingEntry = {
  charge_type?: string;
  amount?: string | number;
};

type KlingTask = {
  id?: string;
  status?: string;
  message?: string;
  external_id?: string;
  outputs?: KlingTaskOutput[];
  billing?: KlingBillingEntry[];
};

// Tolerant, in the videoUriOf spirit: prefer the entry that declares itself a
// video, but a single unlabelled output carrying a url is still the clip.
function videoUrlOf(task: KlingTask): string | null {
  const labelled = task.outputs?.find(
    (output) => output.type === 'video' && output.url,
  );
  if (labelled?.url) return labelled.url;
  return task.outputs?.find((output) => output.url)?.url ?? null;
}

// A rejection that NAMES a field is enough to drop it: every field on the
// ladder below is optional to us. Accepts both failure shapes — an HTTP 400 and
// an in-band `code !== 0` on a 200 — because Kling uses both.
function mentionsField(error: unknown, ...needles: string[]): boolean {
  if (!(error instanceof KlingRequestError)) return false;
  if (error.status !== 400 && error.code === 0) return false;
  const detail = error.detail.toLowerCase();
  return needles.some((needle) => detail.includes(needle));
}

// The one genuine unknown in this integration. Kling's docs say a frame's `url`
// field accepts "URL or Base64" without showing which base64 form, and the two
// candidates are indistinguishable until the API answers. Learned from its own
// rejection and cached per model, the veo-client doctrine — a rejected create
// is free, no render has begun.
type FrameShape = 'raw' | 'data-uri';
const frameShapeByModel = new Map<string, FrameShape>();

const modelsRejectingMultiShot = new Set<string>();
const modelsRejectingAudio = new Set<string>();
const modelsRejectingResolution = new Set<string>();
const modelsRejectingWatermark = new Set<string>();

function encodeFrame(jpeg: Buffer, shape: FrameShape): string {
  const base64 = jpeg.toString('base64');
  return shape === 'raw' ? base64 : `data:image/jpeg;base64,${base64}`;
}

// Frames arrive as PNGs (2-4 MB from Nano Banana). Inline base64 inflates by a
// third, and two PNGs would put a ~10 MB JSON body on the critical path of
// every clip. A q92 JPEG is visually lossless as a video SOURCE frame — the
// model re-encodes everything downstream anyway — and Kling accepts .jpg
// explicitly. Also validates Kling's own input rules while the metadata is
// already in hand.
async function prepareFrame(
  png: Buffer,
  label: string,
): Promise<{ jpeg: Buffer; width: number; height: number }> {
  const image = sharp(png);
  const meta = await image.metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (width === 0 || height === 0) {
    throw new Error(`Kling ${label}: could not read the image dimensions.`);
  }
  if (width < MIN_FRAME_SIDE || height < MIN_FRAME_SIDE) {
    throw new Error(
      `Kling ${label}: both sides must be at least ${MIN_FRAME_SIDE}px; got ${width}x${height}.`,
    );
  }
  const ratio = width / height;
  if (ratio > MAX_FRAME_RATIO || ratio < 1 / MAX_FRAME_RATIO) {
    throw new Error(
      `Kling ${label}: aspect must be between 1:${MAX_FRAME_RATIO} and ${MAX_FRAME_RATIO}:1; ` +
        `got ${width}x${height}.`,
    );
  }
  const jpeg = await image.jpeg({ quality: 92 }).toBuffer();
  return { jpeg, width, height };
}

async function submitTask(
  model: string,
  apiKey: string,
  input: KlingClipInput,
  startJpeg: Buffer,
  endJpeg: Buffer | null,
): Promise<KlingCreateData> {
  const avoid = input.negativePrompt
    ? buildAvoidClause(input.negativePrompt)
    : '';
  const text = fitClipPrompt(
    avoid ? `${input.prompt}\n\n${avoid}` : input.prompt,
    PROMPT_MAX_CHARS,
    PROMPT_HARD_MAX_CHARS,
  );

  const buildBody = (
    frameShape: FrameShape,
    withMultiShot: boolean,
    withAudio: boolean,
    withResolution: boolean,
    withWatermark: boolean,
  ): unknown => ({
    contents: [
      { type: 'prompt', text },
      { type: 'first_frame', url: encodeFrame(startJpeg, frameShape) },
      ...(endJpeg
        ? [{ type: 'last_frame', url: encodeFrame(endJpeg, frameShape) }]
        : []),
    ],
    settings: {
      duration: input.durationSeconds,
      ...(withResolution
        ? { resolution: klingResolution(input.tier) }
        : {}),
      // Silence, deliberately: the voiceover is Sarvam's and assembleSilentVideo
      // strips any track Kling generated. `off` is also Kling's own default, so
      // this is belt and braces.
      ...(withAudio ? { audio: 'off' } : {}),
      // NOT a default — Kling's default is true. One continuous shot is the
      // premise of frame interpolation.
      ...(withMultiShot ? { multi_shot: false } : {}),
    },
    ...(withWatermark
      ? { options: { watermark_info: { enabled: false } } }
      : {}),
  });

  const send = (
    frameShape: FrameShape,
    withMultiShot: boolean,
    withAudio: boolean,
    withResolution: boolean,
    withWatermark: boolean,
  ): Promise<KlingCreateData> =>
    klingFetch<KlingCreateData>(`image-to-video/${model}`, {
      label: 'clip start',
      apiKey,
      body: buildBody(
        frameShape,
        withMultiShot,
        withAudio,
        withResolution,
        withWatermark,
      ),
    });

  let frameShape: FrameShape = frameShapeByModel.get(model) ?? 'raw';
  const shapeWasKnown = frameShapeByModel.has(model);
  let sendingMultiShot = !modelsRejectingMultiShot.has(model);
  let sendingAudio = !modelsRejectingAudio.has(model);
  let sendingResolution = !modelsRejectingResolution.has(model);
  let sendingWatermark = !modelsRejectingWatermark.has(model);

  // Downgrade ladder: each caught rejection strictly narrows the request, so
  // this terminates in at most five extra round trips — and a rejected START is
  // free, no render has begun. Anything unrecognised is rethrown untouched.
  for (;;) {
    try {
      const created = await send(
        frameShape,
        sendingMultiShot,
        sendingAudio,
        sendingResolution,
        sendingWatermark,
      );
      frameShapeByModel.set(model, frameShape);
      return created;
    } catch (error) {
      if (
        frameShape === 'raw' &&
        !shapeWasKnown &&
        mentionsField(
          error,
          'base64',
          'first_frame',
          'last_frame',
          'first frame',
          'last frame',
          'image',
          'contents',
        )
      ) {
        // Possibly just the encoding: the docs say "URL or Base64" without
        // saying whether a data: URI is expected. Try the other form once.
        frameShape = 'data-uri';
        continue;
      }
      if (sendingMultiShot && mentionsField(error, 'multi_shot', 'multishot')) {
        modelsRejectingMultiShot.add(model);
        // The loudest rung on the ladder: this field defaults to TRUE, so
        // dropping it means a single-shot interpolation prompt can come back as
        // a montage — a visible defect, not a silent cost.
        console.warn(
          `[kling] ${model} rejects multi_shot; this and every later clip is ` +
            'submitted WITHOUT it, and Kling defaults it to true. Watch the ' +
            'renders for cuts — a scene must be one continuous shot.',
        );
        sendingMultiShot = false;
        continue;
      }
      if (sendingAudio && mentionsField(error, 'audio', 'sound')) {
        modelsRejectingAudio.add(model);
        console.warn(
          `[kling] ${model} rejects settings.audio; this and every later clip ` +
            'may carry generated audio, which the assembly step strips. Cost ' +
            'and latency only — the Marathi voiceover is unaffected.',
        );
        sendingAudio = false;
        continue;
      }
      if (sendingResolution && mentionsField(error, 'resolution')) {
        modelsRejectingResolution.add(model);
        console.warn(
          `[kling] ${model} rejects resolution=${klingResolution(input.tier)}; ` +
            'falling back to the model default (720p) for this and every ' +
            'later clip.',
        );
        sendingResolution = false;
        continue;
      }
      if (sendingWatermark && mentionsField(error, 'watermark')) {
        modelsRejectingWatermark.add(model);
        sendingWatermark = false;
        continue;
      }
      throw error;
    }
  }
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

// Generate one scene clip. Returns the MP4 bytes — SILENT (settings.audio 'off';
// the Marathi voiceover is muxed in later from Sarvam) at KLING_RESOLUTION —
// and records the per-second tier cost into the ambient cost meter.
export async function generateKlingClip(input: KlingClipInput): Promise<Buffer> {
  // Everything checkable is checked before a single billable call, with
  // messages that name the rule (the generateVeoClip pre-flight precedent).
  if (!Number.isInteger(input.durationSeconds) || input.durationSeconds < 3 || input.durationSeconds > 15) {
    throw new Error(
      `Kling accepts a whole-second duration from 3 to 15; got ${input.durationSeconds}.`,
    );
  }

  const apiKey = klingApiKey();
  const model = klingModel();

  const start = await prepareFrame(input.imagePng, 'start frame');
  const end = input.lastFramePng
    ? await prepareFrame(input.lastFramePng, 'end frame')
    : null;

  // Kling has no aspect parameter, so the frames ARE the aspect. Two frames
  // that disagree would yield a clip of an unpredictable shape, which the
  // stitch then concatenates against differently-shaped scenes — so this is
  // fatal rather than a warning, and it costs nothing to catch here.
  if (end) {
    const startRatio = start.width / start.height;
    const endRatio = end.width / end.height;
    if (Math.abs(startRatio - endRatio) / startRatio > 0.02) {
      throw new Error(
        `Kling: the start and end frames must have the same aspect (Kling has no ` +
          `aspect parameter, so the frames decide it); got ${start.width}x${start.height} ` +
          `and ${end.width}x${end.height}.`,
      );
    }
  }
  const declared = input.aspectRatio === '16:9' ? 16 / 9 : 9 / 16;
  if (Math.abs(start.width / start.height - declared) / declared > 0.05) {
    // Informational: the frames win regardless, but a mismatch means the
    // storyboard the officer approved is not the shape being rendered.
    console.warn(
      `[kling] start frame is ${start.width}x${start.height}, which is not ` +
        `${input.aspectRatio}. Kling has no aspect parameter, so the clip will ` +
        'follow the frame, not the project orientation.',
    );
  }

  const pollIntervalMs = readInt('KLING_POLL_INTERVAL_MS', 10_000);
  const timeoutMs = readInt('KLING_RENDER_TIMEOUT_MS', 600_000);

  const created = await submitTask(
    model,
    apiKey,
    input,
    start.jpeg,
    end?.jpeg ?? null,
  );
  const taskId = created.id;
  if (!taskId) {
    throw new Error(
      `Kling create response carried no task id: ${JSON.stringify(created)}`,
    );
  }

  // Poll until the status settles. The wall clock is the release valve: a stuck
  // task must fail the scene, not hang the whole animate job forever.
  const startedAt = Date.now();
  let task: KlingTask = { id: taskId, status: created.status ?? 'submitted' };
  while (task.status !== 'succeeded' && task.status !== 'failed') {
    const elapsed = Date.now() - startedAt;
    if (elapsed > timeoutMs) {
      throw new Error(
        `Kling render timed out after ${Math.round(elapsed / 1000)}s (task ${taskId}).`,
      );
    }
    input.onProgress?.(elapsed);
    await sleep(pollIntervalMs);
    const tasks = await klingFetch<KlingTask[]>(
      `tasks?task_ids=${encodeURIComponent(taskId)}`,
      { label: 'clip poll', apiKey, method: 'GET' },
    );
    const found = tasks.find((entry) => entry.id === taskId) ?? tasks[0];
    if (!found) {
      throw new Error(`Kling poll returned no task for id ${taskId}.`);
    }
    task = found;
  }

  if (task.status === 'failed') {
    // The Kling analogue of Veo's raiMediaFilteredReasons: the task-level
    // message carries the real reason (content risk control and the like).
    // Surfaced verbatim so the scene card shows it instead of a generic failure.
    throw new Error(
      `Kling could not render this clip: ${task.message ?? 'no reason given'}`,
    );
  }

  const url = videoUrlOf(task);
  if (!url) {
    throw new Error(
      `Kling task ${taskId} succeeded without a video: ${JSON.stringify(task)}`,
    );
  }

  const bytes = await klingFetchBinary(url, 'clip download');
  if (bytes.length === 0) {
    throw new Error(`Kling download for task ${taskId} returned an empty body.`);
  }

  // Kling reports what it ACTUALLY charged, which Veo never did. Deliberately
  // logged rather than metered: the amounts are credits or account currency,
  // and converting them needs the purchased package's rate. This log is the
  // calibration signal for VIDEO_TIER_PRICE_PER_SECOND_USD in @dgipr/schemas.
  if (task.billing && task.billing.length > 0) {
    console.log(
      `[kling] task ${taskId} billing: ` +
        task.billing
          .map((entry) => `${entry.charge_type ?? '?'}=${entry.amount ?? '?'}`)
          .join(', '),
    );
  }

  recordVideoCost(input.tier, input.durationSeconds);
  return bytes;
}

// Free self-check of the resolution mapping and every pre-flight guard — the
// things that must hold before a single billable call, asserted rather than
// trusted (the video-prompts.ts harness pattern).
//
//   tsx src/video/kling-client.ts --check
async function runOfflineChecks(): Promise<void> {
  const failures: string[] = [];
  const check = (label: string, ok: boolean): void => {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
    if (!ok) failures.push(label);
  };
  const rejects = async (
    run: () => Promise<unknown>,
    needle: string,
  ): Promise<boolean> => {
    try {
      await run();
      return false;
    } catch (error) {
      const message = String((error as Error).message ?? error);
      if (!message.includes(needle)) console.log(`     got: ${message}`);
      return message.includes(needle);
    }
  };
  const png = (w: number, h: number): Promise<Buffer> =>
    sharp({ create: { width: w, height: h, channels: 3, background: '#888' } })
      .png()
      .toBuffer();

  delete process.env.KLING_RESOLUTION;
  check('unset resolution: fast -> 720p', klingResolution('fast') === '720p');
  check('unset resolution: lite -> 720p', klingResolution('lite') === '720p');
  check(
    'unset resolution: standard -> 1080p',
    klingResolution('standard') === '1080p',
  );
  process.env.KLING_RESOLUTION = '720p';
  check(
    'pinned resolution wins over the tier',
    klingResolution('standard') === '720p',
  );
  check('default model id', klingModel() === 'kling-3.0');

  const start = await png(1280, 720);
  const base = {
    prompt: 'x',
    aspectRatio: '16:9' as const,
    tier: 'fast' as const,
  };

  const savedKey = process.env.KLING_API_KEY;
  delete process.env.KLING_API_KEY;
  check(
    'a missing key fails naming the env var',
    await rejects(
      () => generateKlingClip({ ...base, imagePng: start, durationSeconds: 8 }),
      'KLING_API_KEY',
    ),
  );
  process.env.KLING_API_KEY = 'offline-check-never-sent';

  // Every one of these must fail BEFORE the network, which is what makes them
  // safe to run with a junk key.
  check(
    'duration below 3 rejected',
    await rejects(
      () => generateKlingClip({ ...base, imagePng: start, durationSeconds: 2 }),
      'from 3 to 15',
    ),
  );
  check(
    'duration above 15 rejected',
    await rejects(
      () => generateKlingClip({ ...base, imagePng: start, durationSeconds: 20 }),
      'from 3 to 15',
    ),
  );
  check(
    'a fractional duration is rejected',
    await rejects(
      () => generateKlingClip({ ...base, imagePng: start, durationSeconds: 7.5 }),
      'from 3 to 15',
    ),
  );
  const tiny = await png(200, 120);
  check(
    'a frame under 300px is rejected',
    await rejects(
      () => generateKlingClip({ ...base, imagePng: tiny, durationSeconds: 8 }),
      'at least 300px',
    ),
  );
  const wide = await png(3000, 400);
  check(
    'a frame outside 1:2.5..2.5:1 is rejected',
    await rejects(
      () => generateKlingClip({ ...base, imagePng: wide, durationSeconds: 8 }),
      'aspect must be between',
    ),
  );
  // The one that protects the STITCH: Kling has no aspect parameter, so two
  // frames of different shapes would yield a clip that cannot concat.
  const portrait = await png(720, 1280);
  check(
    'start/end frames of different aspects are rejected',
    await rejects(
      () =>
        generateKlingClip({
          ...base,
          imagePng: start,
          lastFramePng: portrait,
          durationSeconds: 8,
        }),
      'same aspect',
    ),
  );

  if (savedKey === undefined) delete process.env.KLING_API_KEY;
  else process.env.KLING_API_KEY = savedKey;

  console.log(
    failures.length === 0
      ? '\nAll Kling checks passed.'
      : `\n${failures.length} check(s) FAILED.`,
  );
  process.exitCode = failures.length === 0 ? 0 : 1;
}

// Run directly to prove account access + the task lifecycle with ONE clip
// before wiring the animate job (Kling spend). A second PNG becomes the LAST
// frame, which is the interpolation this pipeline actually uses.
//
//   tsx src/video/kling-client.ts --check                        (free)
//   tsx --env-file=../../.env src/video/kling-client.ts <start.png> [end.png] [--1080p] [--Ns]
//
// The paid form writes kling-test.mp4 beside the input still and, if ffmpeg is
// reachable, prints its streams — which is how "no audio / 1280x720 / 8.0s" is
// checked in one command.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  if (process.argv.includes('--check')) {
    void runOfflineChecks().catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
  } else {
    runPaidHarness();
  }
}

function runPaidHarness(): void {
  const args = process.argv.slice(2);
  const positional = args.filter((arg) => !arg.startsWith('--'));
  const stillPath = positional[0];
  const lastFramePath = positional[1];
  if (!stillPath) {
    console.error(
      'Usage: tsx --env-file=../../.env src/video/kling-client.ts <start.png> [end.png] [--1080p] [--Ns]',
    );
    process.exit(1);
  }
  if (args.includes('--1080p')) process.env.KLING_RESOLUTION = '1080p';
  const durationFlag = args.find((arg) => /^--\d+s$/.test(arg));
  const durationSeconds = durationFlag
    ? Number(durationFlag.slice(2, -1))
    : 8;

  void (async () => {
    const { writeFile } = await import('node:fs/promises');
    const { dirname, join } = await import('node:path');
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const { resolveFfmpeg } = await import('@dgipr/poster-renderer');

    const imagePng = await readFile(stillPath);
    const lastFramePng = lastFramePath
      ? await readFile(lastFramePath)
      : undefined;
    console.log(
      `Rendering ${durationSeconds}s ${klingResolution('fast')} clip on ` +
        `${klingModel()} from ${stillPath}` +
        (lastFramePath ? ` → ${lastFramePath}` : '') +
        '…',
    );
    const clip = await generateKlingClip({
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
      tier: 'fast',
      onProgress: (elapsedMs) =>
        console.log(`…still rendering (${Math.round(elapsedMs / 1000)}s)`),
    });
    const outPath = join(dirname(stillPath), 'kling-test.mp4');
    await writeFile(outPath, clip);
    console.log(`Wrote ${outPath} (${clip.length} bytes).`);
    console.log(
      `Frame encoding accepted: ${frameShapeByModel.get(klingModel()) ?? 'unknown'}`,
    );

    // Best effort: ffmpeg prints the streams on stderr and exits non-zero with
    // no output file, so the failure is expected and swallowed.
    try {
      const execFileAsync = promisify(execFile);
      await execFileAsync(resolveFfmpeg(), ['-hide_banner', '-i', outPath]);
    } catch (error) {
      const stderr = (error as { stderr?: string }).stderr ?? '';
      for (const line of stderr.split('\n')) {
        if (/Stream #0:|Duration:/.test(line)) console.log(line.trim());
      }
    }
  })().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
