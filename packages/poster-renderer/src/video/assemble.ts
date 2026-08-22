// ffmpeg assembly for the explainer-video pipeline: strip Veo's native audio
// (the Marathi voiceover is added later, outside this system), burn in the
// per-scene Marathi key points, and stitch the clips into ONE browser-safe
// silent MP4.
//
// Always re-encode the source clips, never pass them through with `-c copy`:
// per-scene re-animation legitimately mixes clips from different render runs
// (and potentially different tier models after a retry), so stream-parameter
// equality can't be assumed. Re-encoding ≤60s of 720p costs seconds of CPU and
// guarantees a uniform yuv420p + faststart MP4 that Safari and Chrome both play.
//
// That re-encode happens ONE CLIP AT A TIME, and the normalized segments are
// then joined by the concat DEMUXER with `-c copy`. It used to be a single
// ffmpeg run whose filter graph took every clip as a simultaneous input and
// joined them with the concat FILTER — which is what killed a real production
// stitch with SIGKILL and no stderr. The ffmpeg CLI reads packets from whichever
// input has the earliest DTS, and every clip starts at 0, so it decodes all of
// them at once; the concat filter meanwhile consumes only the segment it is
// currently on, and the frames of every LATER segment pile up decoded in the
// filter's input queue. Eight 15s 720p clips is ~4 GB of yuv420p frames (~9 GB
// at 1080p), plus a full-frame RGBA still per looped caption PNG. Peak memory
// grew with the video's length, on a small instance shared with n8n and
// Chromium.
//
// Per-segment encoding bounds that at one clip: ffmpeg holds a few frames of one
// input, whatever its length, and the demuxer then opens the finished segments
// strictly in sequence. The demuxer is only safe here BECAUSE of the pass above
// it — every segment is written by the same encoder at the same resolution,
// frame rate, pixel format, SAR and profile, so their stream parameters are
// identical by construction. Concatenating provider clips directly (mixed sizes,
// provider timestamps) is the thing that is not safe, and is not what this does.

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import sharp from 'sharp';
import {
  VIDEO_LOCKUP_MARGIN_RATIO,
  VIDEO_LOCKUP_WIDTH_RATIO,
  VIDEO_NARRATION_TEMPO_TOLERANCE,
} from '@dgipr/schemas';
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
const VIDEO_STITCH_TIMEOUT_MS = 900_000;
const VIDEO_VALIDATE_MAX_BUFFER = 16 * 1024 * 1024;
const VIDEO_OUTRO_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../assets/video-outro.mp4',
);

// Run one ffmpeg encode, translating a KILLED child into an error that says so.
// execFile's own message is "Command failed: <the whole command line>" plus
// stderr — and a process stopped by SIGKILL/SIGTERM writes no stderr, so a
// timeout and an out-of-memory kill both reached the officer (and the
// video_projects.error column) as a screenful of filter graph with no reason in
// it. That is what one real production failure looked like.
async function runFfmpeg(
  args: readonly string[],
  label: string,
  timeoutMs: number = VIDEO_VALIDATE_TIMEOUT_MS,
): Promise<void> {
  try {
    await execFileAsync(resolveFfmpeg(), [...args], {
      timeout: timeoutMs,
      maxBuffer: VIDEO_VALIDATE_MAX_BUFFER,
    });
  } catch (error) {
    const detail = error as NodeJS.ErrnoException & {
      signal?: NodeJS.Signals | null;
      stderr?: string;
    };
    const stderr = (detail.stderr ?? '').trim();
    if (detail.signal) {
      const cause =
        detail.signal === 'SIGTERM'
          ? `it exceeded the ${Math.round(timeoutMs / 1000)}s limit`
          : 'it was killed by the operating system, most likely out of memory';
      throw new Error(
        `${label} was stopped by ${detail.signal}: ${cause}.` +
          (stderr === '' ? '' : ` ffmpeg said: ${stderr}`),
      );
    }
    throw new Error(
      `${label} failed` +
        (stderr === '' ? ` (${detail.message})` : `: ${stderr}`),
    );
  }
}

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

// Every segment is encoded with EXACTLY these settings, which is what makes the
// concat demuxer's `-c copy` join safe: same encoder, preset, profile, pixel
// format, frame rate and timescale, on top of the common canvas the filter
// chain forces. x264 derives its level from resolution + frame rate + DPB
// (never from content), so identical settings on an identical canvas produce
// identical stream parameters. Changing anything here means changing it for the
// outro segment too — they are joined without re-encoding.
const SEGMENT_ENCODE_ARGS: readonly string[] = [
  '-c:v',
  'libx264',
  '-preset',
  'veryfast',
  '-crf',
  '20',
  '-profile:v',
  'high',
  '-pix_fmt',
  'yuv420p',
  '-r',
  '25',
  '-video_track_timescale',
  '12800',
  '-an',
];

// The filter chain that puts any clip on the common canvas: fixed frame rate,
// fitted and padded to the output size, square pixels, and timestamps rebuilt
// from the frame number so provider timestamps cannot survive into the join.
function normalizeChain(
  input: number,
  width: number,
  height: number,
  padColor: 'black' | 'white',
  label: string,
): string {
  return (
    `[${input}:v:0]fps=25,scale=${width}:${height}:` +
    `force_original_aspect_ratio=decrease:force_divisible_by=2,` +
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=${padColor},` +
    `setsar=1,format=yuv420p,setpts=N/(25*TB)[${label}]`
  );
}

// A still image laid over one segment, in that segment's OWN time base.
type SegmentStill = Readonly<{
  path: string;
  // Omitted means "the whole segment" — the video logo, which has no window.
  startSeconds?: number;
  endSeconds?: number;
  x: number;
  y: number;
}>;

// Encode ONE segment of the final video: normalize it onto the common canvas
// and burn in whatever stills belong to it. This is the memory boundary — a
// single clip input plus a handful of finite still inputs, whatever the length
// of the video as a whole.
async function encodeSegment(
  inputPath: string,
  outPath: string,
  width: number,
  height: number,
  padColor: 'black' | 'white',
  stills: readonly SegmentStill[],
  expectedSeconds: number,
  measuredSeconds: number,
  label: string,
): Promise<void> {
  const inputArgs: string[] = ['-i', inputPath];
  const chains: string[] = [normalizeChain(0, width, height, padColor, 'base')];
  let stage = 'base';

  // Finite (`-t`), so a looped still can never become the endless input it was
  // in the old single-pass graph — but always longer than the footage, so that
  // `shortest=1` ends the segment on the FOOTAGE and never on a still. It is
  // measured, not declared: a clip that decoded longer than its billed window
  // must be cut by nothing here, and cutting it to the DECLARED length would do
  // it silently, since the duration gate below only checks the minimum.
  const stillSeconds = Math.max(expectedSeconds, measuredSeconds) + 2;

  for (const [index, still] of stills.entries()) {
    inputArgs.push(
      '-framerate',
      '25',
      '-loop',
      '1',
      '-t',
      stillSeconds.toFixed(3),
      '-i',
      still.path,
    );
    const input = index + 1;
    const next = `s${index}`;
    const window =
      still.startSeconds === undefined || still.endSeconds === undefined
        ? ''
        : `:enable='between(t,${still.startSeconds.toFixed(3)},` +
          `${still.endSeconds.toFixed(3)})'`;
    chains.push(
      `[${stage}][${input}:v]overlay=${still.x}:${still.y}:shortest=1` +
        `${window}[${next}]`,
    );
    stage = next;
  }

  await runFfmpeg(
    [
      '-hide_banner',
      '-loglevel',
      'error',
      ...inputArgs,
      '-filter_complex',
      chains.join(';'),
      '-map',
      `[${stage}]`,
      ...SEGMENT_ENCODE_ARGS,
      outPath,
    ],
    label,
    // Generous: this runs on a small shared instance beside n8n and Chromium,
    // and an over-eager timeout throws away nothing but this free local step
    // while costing the officer a whole paid run's deliverable.
    VIDEO_STITCH_TIMEOUT_MS,
  );

  // Per segment rather than only on the finished file, so a defect names the
  // scene it came from instead of surfacing as a short total.
  await assertStreamDuration(outPath, expectedSeconds, label, 'video');
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

export type SceneClipCheckOptions = Readonly<{
  expectedDurationSeconds?: number;
}>;

// Decode one freshly rendered scene clip and gate its duration BEFORE it is
// uploaded, so a truncated provider render is caught where it can still be
// re-rendered rather than at stitch time with the row already marked done.
//
// This is all that is left of the old overlayVideoLogo: the government lockup
// is NOT burned into a stored clip any more. It used to be, so that the
// per-scene review players were branded — but a burned-in lockup is permanent,
// so every stored clip froze whatever VIDEO_LOCKUP_WIDTH_RATIO was in force the
// day it rendered. A later ratio change then produced a visible double stamp on
// every reused clip: assembleSilentVideo re-stamps at the CURRENT size over the
// same top-right anchor, and a smaller new lockup cannot cover a larger old one.
// Branding is now the stitch's alone, which makes the ratio a stitch-time
// decision that takes effect on every (free) restitch and can never double up.
// The review player lays the same lockup over the raw clip in CSS instead —
// see VIDEO_LOCKUP_WIDTH_RATIO in @dgipr/schemas, which both sides read.
export async function validateSceneClip(
  mp4: Buffer,
  options: SceneClipCheckOptions = {},
): Promise<VideoValidation> {
  const dir = await mkdtemp(join(tmpdir(), 'dgipr-video-clip-'));
  try {
    const path = join(dir, 'clip.mp4');
    await writeFile(path, mp4);
    return options.expectedDurationSeconds
      ? await assertStreamDuration(
          path,
          options.expectedDurationSeconds,
          'Generated scene clip',
          'video',
        )
      : await inspectStreamFile(path, 'video');
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

    const expectedDurations =
      options.expectedClipDurations ??
      (await Promise.all(
        clipPaths.map(async (path) => {
          const result = await inspectStreamFile(path, 'video');
          return result.durationSeconds;
        }),
      ));
    // The gate every clip must pass, and — since it decodes the clip to report
    // it — also where each clip's REAL length comes from, which is what the
    // caption stills are sized against below.
    const measuredDurations: number[] = [];
    for (const [index, path] of clipPaths.entries()) {
      const validation = await assertStreamDuration(
        path,
        expectedDurations[index]!,
        `Scene ${index + 1} clip`,
        'video',
      );
      measuredDurations.push(validation.durationSeconds);
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
    // Re-stamp the lockup on every generated scene. New clips already carry it
    // for their individual review players; this makes the final logo crisp
    // after concatenation and brands free restitches of older stored clips. It
    // ends exactly where the generated scenes end because the supplied outro is
    // already a full-frame DGIPR brand/contact slate — which is now expressed by
    // simply not stamping the outro segment, rather than by a time window over a
    // joined timeline.
    const expectedSceneTotal = expectedDurations.reduce(
      (sum, seconds) => sum + seconds,
      0,
    );
    const lockup = await renderGovernmentLockup(
      Math.round(width * VIDEO_LOCKUP_WIDTH_RATIO),
      { background: 'transparent' },
    );
    const logoPath = join(dir, 'video-logo.png');
    await writeFile(logoPath, lockup.data);
    const logoMargin = Math.max(
      4,
      Math.round(width * VIDEO_LOCKUP_MARGIN_RATIO),
    );
    const logoStill: SegmentStill = {
      path: logoPath,
      x: width - lockup.width - logoMargin,
      y: logoMargin,
    };

    // Resized ONCE here rather than by an ffmpeg `scale` filter, which would
    // rescale the looped still on every frame it is laid over. Resizing must
    // still happen: caption-overlay.ts typesets at a fixed 1080p reference, so
    // on 720p footage an unscaled panel lands below the bottom edge and the key
    // point vanishes with no ffmpeg error at all.
    const overlayPaths: string[] = [];
    for (const [index, overlay] of overlays.entries()) {
      const pngPath = join(dir, `overlay-${index}.png`);
      await writeFile(
        pngPath,
        await sharp(overlay.png)
          .resize(width, height, { fit: 'fill' })
          .png()
          .toBuffer(),
      );
      overlayPaths.push(pngPath);
    }

    // Each scene becomes its own normalized, branded, captioned segment. The
    // caption windows arrive on the FINAL timeline (they come from sceneTimings,
    // the same function the SRT is built from), so they are clipped to the scene
    // they fall in and shifted into that segment's own time base — where the
    // `enable` expression's `t` is measured, setpts having reset it to zero.
    const segmentPaths: string[] = [];
    let sceneStart = 0;
    for (const [index, clipPath] of clipPaths.entries()) {
      const seconds = expectedDurations[index]!;
      const sceneEnd = sceneStart + seconds;
      const captions: SegmentStill[] = [];
      for (const [overlayIndex, overlay] of overlays.entries()) {
        const from = Math.max(overlay.startSeconds, sceneStart);
        const to = Math.min(overlay.endSeconds, sceneEnd);
        if (to <= from) continue;
        captions.push({
          path: overlayPaths[overlayIndex]!,
          startSeconds: from - sceneStart,
          endSeconds: to - sceneStart,
          x: 0,
          y: 0,
        });
      }
      const segmentPath = join(dir, `segment-${index}.mp4`);
      await encodeSegment(
        clipPath,
        segmentPath,
        width,
        height,
        'black',
        [...captions, logoStill],
        seconds,
        measuredDurations[index]!,
        `Scene ${index + 1} segment`,
      );
      segmentPaths.push(segmentPath);
      sceneStart = sceneEnd;
    }

    const outroSegmentPath = join(dir, 'segment-outro.mp4');
    await encodeSegment(
      VIDEO_OUTRO_PATH,
      outroSegmentPath,
      width,
      height,
      'white',
      [],
      outroValidation.durationSeconds,
      outroValidation.durationSeconds,
      'Outro segment',
    );
    segmentPaths.push(outroSegmentPath);

    // Relative names, so the temp directory's own path never has to be escaped
    // into the list file — the concat demuxer resolves them against the list's
    // directory, which is that same directory.
    const listPath = join(dir, 'segments.txt');
    await writeFile(
      listPath,
      segmentPaths
        .map((path) => `file '${path.slice(dir.length + 1)}'\n`)
        .join(''),
    );

    const outPath = join(dir, 'out.mp4');
    await runFfmpeg(
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-f',
        'concat',
        '-safe',
        '0',
        '-i',
        listPath,
        '-c',
        'copy',
        '-movflags',
        '+faststart',
        outPath,
      ],
      'Video stitch',
      VIDEO_STITCH_TIMEOUT_MS,
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

// Decode an officer-supplied narration recording (MP3 from a TTS product, M4A
// from a phone, a studio WAV) into the same 16-bit PCM WAV a synthesized track
// arrives as.
//
// The conversion is not a convenience: WAV is the narration contract of this
// whole pipeline, because the measured duration is what the scene split and the
// clip windows are derived from, and `wavDurationSeconds` reads RIFF chunks. An
// MP3's duration is not in its header at all. Normalizing here — once, at
// upload — means no later phase has to know where its audio came from.
//
// Mono 44.1 kHz matches what Sarvam returns, so `muxNarration` resamples
// nothing. `-vn` drops cover art, which is otherwise a video stream in an MP3.
export async function decodeAudioToWav(
  audio: Buffer,
  extension: string,
): Promise<Buffer> {
  const suffix = extension.startsWith('.') ? extension : `.${extension}`;
  const dir = await mkdtemp(join(tmpdir(), 'dgipr-audio-'));
  try {
    const inPath = join(dir, `source${suffix}`);
    // Distinct basenames, not just extensions: an officer may upload a WAV, and
    // ffmpeg refuses to edit a file in place ("Output ... same as Input").
    const outPath = join(dir, 'narration.wav');
    await writeFile(inPath, audio);
    await runFfmpeg(
      [
        '-y',
        '-i',
        inPath,
        '-vn',
        '-ac',
        '1',
        '-ar',
        '44100',
        '-c:a',
        'pcm_s16le',
        outPath,
      ],
      'narration audio decode',
    );
    const wav = await readFile(outPath);
    // A container ffmpeg opened but found no audio in decodes to an empty WAV
    // rather than failing, and an empty narration would silently become a video
    // with no voice — after the officer had approved a script for it.
    if (wavDurationSeconds(wav) <= 0) {
      throw new Error('narration audio decode produced no audio.');
    }
    return wav;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
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

    // The silent video's REAL decoded length, measured rather than assumed: the
    // narration segments only cover the generated scenes, while the video also
    // carries the fixed DGIPR outro. This is what the padded audio is trimmed
    // to below, so it must come from the file and not from the scene windows.
    const videoSeconds = (await inspectStreamFile(videoPath, 'video'))
      .durationSeconds;
    if (!(videoSeconds > 0)) {
      throw new Error(
        'muxNarration could not measure the silent video duration.',
      );
    }

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
    // The generated-scene narration ends before the fixed visual outro, so the
    // joined track is padded with silence across the slate: a full-length audio
    // stream stops a downstream social transcoder trimming the slate away to a
    // shorter audio duration.
    //
    // The pad is TRIMMED to the measured video length, and `-shortest` is NOT
    // used to end it. `apad` alone is INFINITE, and `-shortest` does not stop an
    // infinite encoded stream when the video is `-c copy` — the copy finishes at
    // once and the aac encoder then runs forever. That combination hung ffmpeg
    // until the 300s timeout SIGKILLed it, which surfaced as a bare
    // "Command failed" with empty stderr and failed the whole paid run at the
    // one step that spends nothing.
    const filter =
      chains.join(';') +
      `;${concatInputs}concat=n=${segments.length}:v=0:a=1[spoken]` +
      `;[spoken]apad,atrim=0:${videoSeconds.toFixed(3)},` +
      'asetpts=PTS-STARTPTS[aout]';

    const outPath = join(dir, 'narrated.mp4');
    await runFfmpeg(
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
        '-movflags',
        '+faststart',
        outPath,
      ],
      'Narration mux',
    );

    // Both streams are checked against the measured video length, not the sum
    // of the narration windows: the audio is now padded across the outro, so a
    // track that stops at the last scene is a defect this must catch.
    await assertStreamDuration(
      outPath,
      videoSeconds,
      'Narrated video',
      'video',
    );
    await assertStreamDuration(
      outPath,
      videoSeconds,
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
