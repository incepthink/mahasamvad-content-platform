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
import { join } from 'node:path';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import sharp from 'sharp';
import { VIDEO_NARRATION_TEMPO_TOLERANCE } from '@dgipr/schemas';

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

// Stitch scene clips (in order) into one silent MP4. Returns the MP4 bytes.
//
// `overlays` burns the per-scene Marathi key points in during the SAME encode:
// the concat pass already re-encodes, and a second pass over the finished file
// would cost a full generation of quality for nothing. Omit it (or pass an
// empty list) and the output is byte-for-byte the old behaviour.
export async function assembleSilentVideo(
  clips: readonly Buffer[],
  overlays: readonly SceneOverlay[] = [],
): Promise<Buffer> {
  if (clips.length === 0) {
    throw new Error('assembleSilentVideo needs at least one clip.');
  }

  const dir = await mkdtemp(join(tmpdir(), 'dgipr-video-'));
  try {
    const listLines: string[] = [];
    for (const [index, clip] of clips.entries()) {
      const clipPath = join(dir, `clip-${index}.mp4`);
      await writeFile(clipPath, clip);
      // concat-demuxer entries need quoting; the paths are ours (no quotes in them).
      listLines.push(`file '${clipPath.replace(/\\/g, '/')}'`);
    }
    const listPath = join(dir, 'list.txt');
    await writeFile(listPath, listLines.join('\n') + '\n', 'utf8');

    // Input 0 stays the concatenated video; each overlay PNG becomes an extra
    // input chained onto it, visible only inside its own scene's window.
    //
    // scale2ref resizes the overlay to the CURRENT video stage before laying it
    // on. Its default (w=iw:h=ih) resolves against the reference — the second
    // input — so the footage's real size is never written down here and this is
    // a no-op whenever the two already match (1080p Veo output, unchanged).
    // Rendering the caption at 1080p and scaling DOWN is also the right
    // direction for text quality.
    const overlayArgs: string[] = [];
    const chains: string[] = [];
    let stage = '0:v';
    for (const [index, overlay] of overlays.entries()) {
      const pngPath = join(dir, `overlay-${index}.png`);
      await writeFile(pngPath, overlay.png);
      overlayArgs.push('-i', pngPath);
      const scaled = `ov${index}`;
      const base = `base${index}`;
      const next = `v${index}`;
      chains.push(
        `[${index + 1}:v][${stage}]scale2ref[${scaled}][${base}]`,
        `[${base}][${scaled}]overlay=0:0:enable='between(t,` +
          `${overlay.startSeconds.toFixed(3)},${overlay.endSeconds.toFixed(3)})'` +
          `[${next}]`,
      );
      stage = next;
    }

    const outPath = join(dir, 'out.mp4');
    await execFileAsync(
      resolveFfmpeg(),
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
        ...overlayArgs,
        ...(chains.length > 0
          ? ['-filter_complex', chains.join(';'), '-map', `[${stage}]`]
          : []),
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
    const filter =
      chains.join(';') +
      `;${concatInputs}concat=n=${segments.length}:v=0:a=1[aout]`;

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
        '-movflags',
        '+faststart',
        '-shortest',
        outPath,
      ],
      { timeout: 300_000, maxBuffer: 16 * 1024 * 1024 },
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
