// ffmpeg assembly for the explainer-video pipeline: strip Veo's native audio
// (the Marathi voiceover is added later, outside this system), burn in the
// per-scene Marathi key points, and stitch the clips into ONE browser-safe
// silent MP4.
//
// Always re-encode, never `-c copy`: per-scene re-animation legitimately mixes
// clips from different render runs (and potentially different tier models after
// a retry), so stream-parameter equality can't be assumed. Re-encoding ≤60s of
// 720p costs seconds of CPU and guarantees a uniform yuv420p + faststart MP4
// that Safari and Chrome both play.

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import sharp from 'sharp';
import { VIDEO_NARRATION_TEMPO_TOLERANCE } from '@dgipr/schemas';
import { renderGovernmentLockup } from '../twitter-chrome.js';

const execFileAsync = promisify(execFile);

// FFMPEG_PATH env first (e.g. /usr/bin/ffmpeg in a docker image where the
// ffmpeg-static postinstall download was blocked), then the ffmpeg-static
// binary. createRequire because ffmpeg-static's export is CJS.
export function resolveFfmpeg(): string {
  const fromEnv = process.env.FFMPEG_PATH;
  if (fromEnv && fromEnv.trim() !== '') return fromEnv;
  const require = createRequire(import.meta.url);
  const ffmpegPath = require('ffmpeg-static') as string | null;
  if (!ffmpegPath) {
    throw new Error(
      'ffmpeg binary not found: ffmpeg-static resolved to null and FFMPEG_PATH is unset.',
    );
  }
  return ffmpegPath;
}

// One scene's burned-in key-point overlay and the window it is visible for.
// The PNG is a full transparent frame with the panel in it, SCALED to the
// footage at burn-in and laid on at 0,0 — so no geometry crosses this boundary
// and the layout stays entirely in caption-overlay.ts, which can see the text
// it is laying out.
//
// It is scaled rather than assumed to match because the clip provider decides
// the footage size: caption-overlay renders at a fixed 1080p reference, while
// Kling at 720p returns 1280x720. Composited at 0,0 without scaling, a
// 1920x1080 overlay on 1280x720 footage puts the lower-third panel below the
// bottom edge and the key point VANISHES — silently, with no ffmpeg error.
export type SceneOverlay = Readonly<{
  png: Buffer;
  startSeconds: number;
  endSeconds: number;
}>;

export type VideoAssemblyOptions = Readonly<{
  // Used only if ffmpeg cannot report the first clip's dimensions. Normally
  // that clip's native size becomes the common canvas, so 1080p stays 1080p
  // while a mixed 720p/1080p retry is still normalized before concatenation.
  aspectRatio?: '16:9' | '9:16';
  // Supplying the paid scene windows makes every input clip and the completed
  // output pass a full decode + duration gate before any bytes are returned.
  expectedClipDurations?: readonly number[];
}>;

export type VideoValidation = Readonly<{
  durationSeconds: number;
  frames: number;
}>;

const VIDEO_VALIDATE_TIMEOUT_MS = 300_000;
const VIDEO_VALIDATE_MAX_BUFFER = 16 * 1024 * 1024;
// Social posts use a 160px lockup on a 1280px canvas (12.5%). Video uses 15%:
// visibly larger, but still clear of the lower-third information overlay.
const VIDEO_LOCKUP_WIDTH_RATIO = 0.15;
const VIDEO_LOCKUP_MARGIN_RATIO = 0.008;
const VIDEO_OUTRO_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../assets/video-outro.mp4',
);

function progressNumber(stdout: string, key: string): number {
  let value = 0;
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.startsWith(`${key}=`)) continue;
    const parsed = Number(line.slice(key.length + 1));
    if (Number.isFinite(parsed)) value = Math.max(value, parsed);
  }
  return value;
}

// Decode a stream all the way to ffmpeg's null sink. This is deliberately not
// a container-header check: the production failure that prompted it was a
// formally valid, 48 KB MP4 containing only its first frame. ffmpeg exited 0,
// so only decoded frames + decoded time can distinguish it from a real video.
async function inspectStreamFile(
  path: string,
  stream: 'video' | 'audio',
): Promise<VideoValidation> {
  const { stdout } = await execFileAsync(
    resolveFfmpeg(),
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      path,
      '-map',
      stream === 'video' ? '0:v:0' : '0:a:0',
      ...(stream === 'video' ? ['-an'] : ['-vn']),
      '-f',
      'null',
      '-',
      '-progress',
      'pipe:1',
      '-nostats',
    ],
    {
      timeout: VIDEO_VALIDATE_TIMEOUT_MS,
      maxBuffer: VIDEO_VALIDATE_MAX_BUFFER,
    },
  );
  const text = String(stdout);
  return {
    durationSeconds: progressNumber(text, 'out_time_us') / 1_000_000,
    frames: stream === 'video' ? progressNumber(text, 'frame') : 0,
  };
}

function durationTolerance(expectedSeconds: number): number {
  // Provider/container timestamps commonly finish one frame short.
  return Math.max(0.75, expectedSeconds * 0.08);
}

async function assertStreamDuration(
  path: string,
  expectedSeconds: number,
  label: string,
  stream: 'video' | 'audio',
): Promise<VideoValidation> {
  const result = await inspectStreamFile(path, stream);
  const minimumDuration = Math.max(
    0.25,
    expectedSeconds - durationTolerance(expectedSeconds),
  );
  const enoughFrames =
    stream === 'audio' ||
    result.frames >= Math.max(2, Math.floor(expectedSeconds * 2));
  if (result.durationSeconds < minimumDuration || !enoughFrames) {
    throw new Error(
      `${label} failed validation: decoded ${result.durationSeconds.toFixed(2)}s` +
        (stream === 'video' ? ` / ${result.frames} frames` : '') +
        `; expected about ${expectedSeconds.toFixed(2)}s.`,
    );
  }
  return result;
}

async function firstClipDimensions(
  path: string,
  fallbackAspect: '16:9' | '9:16',
): Promise<{ width: number; height: number }> {
  try {
    const { stderr } = await execFileAsync(
      resolveFfmpeg(),
      [
        '-hide_banner',
        '-i',
        path,
        '-map',
        '0:v:0',
        '-frames:v',
        '1',
        '-f',
        'null',
        '-',
      ],
      { timeout: 60_000, maxBuffer: VIDEO_VALIDATE_MAX_BUFFER },
    );
    const match = String(stderr).match(
      /Stream #.*Video:[^\r\n]*?(\d{2,5})x(\d{2,5})(?:\s|\[|,)/,
    );
    const width = Number(match?.[1]);
    const height = Number(match?.[2]);
    if (width >= 300 && height >= 300) {
      return { width: width - (width % 2), height: height - (height % 2) };
    }
  } catch {
    // The full decode below owns the useful error. Metadata-log parsing alone
    // is not a reason to reject otherwise good footage.
  }
  return fallbackAspect === '9:16'
    ? { width: 720, height: 1280 }
    : { width: 1280, height: 720 };
}

// Validate an in-memory final MP4 before its versioned storage upload. Exported
// because narration muxing happens after the silent assembly.
export async function validateVideoOutput(
  mp4: Buffer,
  expectedSeconds: number,
  options: Readonly<{ requireAudio?: boolean }> = {},
): Promise<VideoValidation> {
  const dir = await mkdtemp(join(tmpdir(), 'dgipr-video-validate-'));
  try {
    const path = join(dir, 'candidate.mp4');
    await writeFile(path, mp4);
    const video = await assertStreamDuration(
      path,
      expectedSeconds,
      'Final video',
      'video',
    );
    if (options.requireAudio) {
      await assertStreamDuration(
        path,
        expectedSeconds,
        'Final narration track',
        'audio',
      );
    }
    return video;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export type VideoLogoOptions = Readonly<{
  aspectRatio?: '16:9' | '9:16';
  expectedDurationSeconds?: number;
}>;

// Burn the shared Government of Maharashtra lockup into one generated scene
// clip before it is uploaded. Scene clips are exposed individually in the
// review UI, so branding only the final stitch would leave those previews
// unbranded. Audio, when a provider returns any, is preserved unchanged.
export async function overlayVideoLogo(
  mp4: Buffer,
  options: VideoLogoOptions = {},
): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'dgipr-video-logo-'));
  try {
    const inputPath = join(dir, 'input.mp4');
    const logoPath = join(dir, 'logo.png');
    const outputPath = join(dir, 'branded.mp4');
    await writeFile(inputPath, mp4);

    const inputValidation = options.expectedDurationSeconds
      ? await assertStreamDuration(
          inputPath,
          options.expectedDurationSeconds,
          'Generated scene clip',
          'video',
        )
      : await inspectStreamFile(inputPath, 'video');
    const { width } = await firstClipDimensions(
      inputPath,
      options.aspectRatio ?? '16:9',
    );
    const lockup = await renderGovernmentLockup(
      Math.round(width * VIDEO_LOCKUP_WIDTH_RATIO),
    );
    await writeFile(logoPath, lockup.data);
    const margin = Math.max(4, Math.round(width * VIDEO_LOCKUP_MARGIN_RATIO));

    await execFileAsync(
      resolveFfmpeg(),
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        inputPath,
        '-loop',
        '1',
        '-i',
        logoPath,
        '-filter_complex',
        `[0:v:0][1:v:0]overlay=${width - lockup.width - margin}:${margin}:shortest=1[branded]`,
        '-map',
        '[branded]',
        '-map',
        '0:a?',
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '18',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'copy',
        '-movflags',
        '+faststart',
        outputPath,
      ],
      {
        timeout: VIDEO_VALIDATE_TIMEOUT_MS,
        maxBuffer: VIDEO_VALIDATE_MAX_BUFFER,
      },
    );

    await assertStreamDuration(
      outputPath,
      options.expectedDurationSeconds ?? inputValidation.durationSeconds,
      'Branded scene clip',
      'video',
    );
    return await readFile(outputPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// Stitch scene clips (in order), brand the generated portion, and append the
// fixed DGIPR contact slate as the final clip. Returns the silent MP4 bytes.
//
// `overlays` burns the per-scene Marathi key points in during the SAME encode:
// the concat pass already re-encodes, and a second pass over the finished file
// would cost a full generation of quality for nothing. Omitting them only
// disables the key points; the mandatory video logo and outro still apply.
export async function assembleSilentVideo(
  clips: readonly Buffer[],
  overlays: readonly SceneOverlay[] = [],
  options: VideoAssemblyOptions = {},
): Promise<Buffer> {
  if (clips.length === 0) {
    throw new Error('assembleSilentVideo needs at least one clip.');
  }
  if (
    options.expectedClipDurations &&
    options.expectedClipDurations.length !== clips.length
  ) {
    throw new Error(
      'assembleSilentVideo expectedClipDurations must match the clip count.',
    );
  }

  const dir = await mkdtemp(join(tmpdir(), 'dgipr-video-'));
  try {
    const clipPaths: string[] = [];
    for (const [index, clip] of clips.entries()) {
      const clipPath = join(dir, `clip-${index}.mp4`);
      await writeFile(clipPath, clip);
      clipPaths.push(clipPath);
    }

    // Each clip is an independent input; caption PNGs follow them. Captions are
    // rendered at a high-quality reference size and scaled once to the common
    // output canvas before being enabled for their scene window.
    const expectedDurations =
      options.expectedClipDurations ??
      (await Promise.all(
        clipPaths.map(async (path) => {
          const result = await inspectStreamFile(path, 'video');
          return result.durationSeconds;
        }),
      ));
    for (const [index, path] of clipPaths.entries()) {
      await assertStreamDuration(
        path,
        expectedDurations[index]!,
        `Scene ${index + 1} clip`,
        'video',
      );
    }

    const { width, height } = await firstClipDimensions(
      clipPaths[0]!,
      options.aspectRatio ?? '16:9',
    );
    const outroValidation = await inspectStreamFile(VIDEO_OUTRO_PATH, 'video');
    await assertStreamDuration(
      VIDEO_OUTRO_PATH,
      outroValidation.durationSeconds,
      'Video outro asset',
      'video',
    );
    const videoInputPaths = [...clipPaths, VIDEO_OUTRO_PATH];
    const inputArgs = videoInputPaths.flatMap((path) => ['-i', path]);
    const chains: string[] = [];

    // Normalize canvas, SAR, FPS, and timestamps before using the concat
    // filter. Provider timestamps and mixed 720p/1080p retries therefore
    // cannot collapse an otherwise successful encode to its first frame.
    for (const index of clipPaths.keys()) {
      chains.push(
        `[${index}:v:0]fps=25,scale=${width}:${height}:` +
          `force_original_aspect_ratio=decrease:force_divisible_by=2,` +
          `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,` +
          `setsar=1,format=yuv420p,setpts=N/(25*TB)[clip${index}]`,
      );
    }
    const outroInput = clipPaths.length;
    chains.push(
      `[${outroInput}:v:0]fps=25,scale=${width}:${height}:` +
        `force_original_aspect_ratio=decrease:force_divisible_by=2,` +
        `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=white,` +
        `setsar=1,format=yuv420p,setpts=N/(25*TB)[outro]`,
    );
    chains.push(
      `${clipPaths.map((_, index) => `[clip${index}]`).join('')}[outro]` +
        `concat=n=${videoInputPaths.length}:v=1:a=0[joined]`,
    );

    let stage = 'joined';
    for (const [index, overlay] of overlays.entries()) {
      const pngPath = join(dir, `overlay-${index}.png`);
      await writeFile(pngPath, overlay.png);
      inputArgs.push('-loop', '1', '-i', pngPath);
      const input = videoInputPaths.length + index;
      const scaled = `ov${index}`;
      const next = `v${index}`;
      chains.push(
        `[${input}:v]scale=${width}:${height}[${scaled}]`,
        `[${stage}][${scaled}]overlay=0:0:shortest=1:enable='between(t,` +
          `${overlay.startSeconds.toFixed(3)},${overlay.endSeconds.toFixed(3)})'` +
          `[${next}]`,
      );
      stage = next;
    }

    // Re-stamp the lockup on the final stitch as well. New clips already carry
    // it for their individual review players; this makes the final logo crisp
    // after concatenation and brands free restitches of older stored clips.
    // It ends exactly where the generated scenes end because the supplied
    // outro is already a full-frame DGIPR brand/contact slate.
    const expectedSceneTotal = expectedDurations.reduce(
      (sum, seconds) => sum + seconds,
      0,
    );
    const lockup = await renderGovernmentLockup(
      Math.round(width * VIDEO_LOCKUP_WIDTH_RATIO),
    );
    const logoPath = join(dir, 'video-logo.png');
    await writeFile(logoPath, lockup.data);
    inputArgs.push('-loop', '1', '-i', logoPath);
    const logoInput = videoInputPaths.length + overlays.length;
    const logoMargin = Math.max(
      4,
      Math.round(width * VIDEO_LOCKUP_MARGIN_RATIO),
    );
    chains.push(
      `[${stage}][${logoInput}:v:0]overlay=` +
        `${width - lockup.width - logoMargin}:${logoMargin}:shortest=1:` +
        `enable='between(t,0,${expectedSceneTotal.toFixed(3)})'[branded]`,
    );
    stage = 'branded';

    const outPath = join(dir, 'out.mp4');
    await execFileAsync(
      resolveFfmpeg(),
      [
        '-hide_banner',
        '-loglevel',
        'error',
        ...inputArgs,
        '-filter_complex',
        chains.join(';'),
        '-map',
        `[${stage}]`,
        '-an',
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '20',
        '-pix_fmt',
        'yuv420p',
        '-movflags',
        '+faststart',
        outPath,
      ],
      // 8 scenes of 720p re-encode in well under a minute; the timeout is the
      // release valve so a hung ffmpeg fails the job instead of wedging it.
      { timeout: 300_000, maxBuffer: 16 * 1024 * 1024 },
    );

    const expectedTotal = expectedSceneTotal + outroValidation.durationSeconds;
    await assertStreamDuration(
      outPath,
      expectedTotal,
      'Stitched video',
      'video',
    );
    return await readFile(outPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// Duration (seconds) of a PCM WAV, read from its header — ffmpeg-static ships no
// ffprobe, and Sarvam TTS returns a complete WAV, so the header is exact and
// free. Scans the RIFF chunk list (chunks can be reordered and a LIST/fact chunk
// may sit before `data`), taking byteRate from `fmt ` and the payload size from
// `data`. duration = dataBytes / byteRate.
export function wavDurationSeconds(wav: Buffer): number {
  if (
    wav.length < 12 ||
    wav.toString('ascii', 0, 4) !== 'RIFF' ||
    wav.toString('ascii', 8, 12) !== 'WAVE'
  ) {
    throw new Error('wavDurationSeconds: not a RIFF/WAVE buffer.');
  }
  let byteRate = 0;
  let dataBytes = 0;
  let offset = 12;
  while (offset + 8 <= wav.length) {
    const id = wav.toString('ascii', offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ' && body + 16 <= wav.length) {
      const channels = wav.readUInt16LE(body + 2);
      const sampleRate = wav.readUInt32LE(body + 4);
      const declaredByteRate = wav.readUInt32LE(body + 8);
      const bitsPerSample = wav.readUInt16LE(body + 14);
      byteRate =
        declaredByteRate > 0
          ? declaredByteRate
          : sampleRate * channels * (bitsPerSample / 8);
    } else if (id === 'data') {
      // Clamp to what's actually present (a streamed WAV can carry a bogus size).
      dataBytes = Math.min(size, wav.length - body);
    }
    // Chunks are word-aligned: an odd size is followed by a pad byte.
    offset = body + size + (size % 2);
  }
  if (byteRate <= 0 || dataBytes <= 0) {
    throw new Error('wavDurationSeconds: could not read fmt/data chunks.');
  }
  return dataBytes / byteRate;
}

// One scene's narration audio + the clip window it must occupy.
export type NarrationSegment = Readonly<{
  wav: Buffer;
  durationSeconds: number;
}>;

// Mux a per-scene Marathi narration track onto the (silent) stitched video.
//
// Each Veo clip is a FIXED length and already billed, so the narration is fit to
// its window rather than the reverse: a shorter segment is padded with silence,
// and every segment ends up exactly its window long, so the concatenated track
// equals the video's length and stays in lock-step with the SRT/timing. Video is
// copied (already encoded); only audio is added.
//
// SPEEDING UP IS A BACKSTOP, NOT THE FIT MECHANISM. Fast-forwarded narration
// sounds wrong, so overrun is prevented upstream instead — each scene's window
// is DERIVED from its measured narration (clipSecondsForNarration ceils, so the
// window is never shorter than the speech), and a line that busts the longest
// renderable clip is rewritten rather than squeezed. atempo survives
// only because the alternative for a line that slipped through is worse (a
// scene's voice bleeding into the next one, desyncing every later cue), and it
// now engages only past VIDEO_NARRATION_TEMPO_TOLERANCE, with a warning: if that
// warning ever appears, the narration budget is wrong for the voice in use and
// the fix belongs upstream, not here.
export async function muxNarration(
  silentMp4: Buffer,
  segments: readonly NarrationSegment[],
): Promise<Buffer> {
  if (segments.length === 0) {
    throw new Error('muxNarration needs at least one narration segment.');
  }

  const dir = await mkdtemp(join(tmpdir(), 'dgipr-narrate-'));
  try {
    const videoPath = join(dir, 'video.mp4');
    await writeFile(videoPath, silentMp4);

    const inputArgs: string[] = ['-i', videoPath];
    const chains: string[] = [];
    for (const [index, segment] of segments.entries()) {
      const segPath = join(dir, `narration-${index}.wav`);
      await writeFile(segPath, segment.wav);
      inputArgs.push('-i', segPath);

      const rawSeconds = wavDurationSeconds(segment.wav);
      const window = segment.durationSeconds;
      // Only ever speed UP to fit; never slow down (that would desync the SRT and
      // leave the words trailing the visuals). apad+atrim make the result exactly
      // `window` seconds; aformat unifies the streams so concat can join them.
      const overrun = rawSeconds / window;
      if (overrun > VIDEO_NARRATION_TEMPO_TOLERANCE) {
        console.warn(
          `[assemble] scene ${index + 1} narration is ${rawSeconds.toFixed(2)}s ` +
            `in a ${window}s clip — speeding it up ${overrun.toFixed(2)}x to fit. ` +
            'The narration budget should have prevented this; re-check the TTS ' +
            'calibration rather than widening the tolerance.',
        );
      }
      const factor =
        overrun > VIDEO_NARRATION_TEMPO_TOLERANCE
          ? Math.min(2, overrun)
          : // Inside tolerance: leave the voice at natural pace and let the
            // atrim take the few stray milliseconds.
            1;
      const input = index + 1; // input 0 is the video
      chains.push(
        `[${input}:a]atempo=${factor.toFixed(4)},apad,atrim=0:${window},` +
          `aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,` +
          `asetpts=PTS-STARTPTS[a${index}]`,
      );
    }
    const concatInputs = segments.map((_, index) => `[a${index}]`).join('');
    // The generated-scene narration ends before the fixed visual outro. Pad
    // the joined track indefinitely and let `-shortest` stop it with the video,
    // producing a full-length audio stream whose outro portion is silence.
    // This prevents downstream social transcoders from trimming the slate to a
    // shorter audio-track duration.
    const filter =
      chains.join(';') +
      `;${concatInputs}concat=n=${segments.length}:v=0:a=1[spoken]` +
      ';[spoken]apad[aout]';

    const outPath = join(dir, 'narrated.mp4');
    await execFileAsync(
      resolveFfmpeg(),
      [
        '-hide_banner',
        '-loglevel',
        'error',
        ...inputArgs,
        '-filter_complex',
        filter,
        '-map',
        '0:v:0',
        '-map',
        '[aout]',
        '-c:v',
        'copy',
        '-c:a',
        'aac',
        '-b:a',
        '192k',
        '-shortest',
        '-movflags',
        '+faststart',
        outPath,
      ],
      { timeout: 300_000, maxBuffer: 16 * 1024 * 1024 },
    );

    const expectedSeconds = segments.reduce(
      (sum, segment) => sum + segment.durationSeconds,
      0,
    );
    await assertStreamDuration(
      outPath,
      expectedSeconds,
      'Narrated video',
      'video',
    );
    await assertStreamDuration(
      outPath,
      expectedSeconds,
      'Narration track',
      'audio',
    );
    return await readFile(outPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// Center-crop a gpt-image still (3:2 landscape 1536x1024 / 2:3 portrait
// 1024x1536) to Veo's aspect (16:9 / 9:16), so the still the user approves on
// the storyboard is framed exactly as the animated clip will be.
export async function cropToAspect(
  png: Buffer,
  aspect: '16:9' | '9:16',
): Promise<Buffer> {
  const image = sharp(png);
  const meta = await image.metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (width === 0 || height === 0) {
    throw new Error('cropToAspect could not read the image dimensions.');
  }

  const [aw, ah] = aspect === '16:9' ? [16, 9] : [9, 16];
  let cropWidth = width;
  let cropHeight = Math.round((width * ah) / aw);
  if (cropHeight > height) {
    cropHeight = height;
    cropWidth = Math.round((height * aw) / ah);
  }
  const left = Math.floor((width - cropWidth) / 2);
  const top = Math.floor((height - cropHeight) / 2);

  return image
    .extract({ left, top, width: cropWidth, height: cropHeight })
    .png()
    .toBuffer();
}
