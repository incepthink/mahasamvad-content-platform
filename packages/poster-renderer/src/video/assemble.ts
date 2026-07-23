// ffmpeg assembly for the explainer-video pipeline: strip Veo's native audio
// (the Marathi voiceover is added later, outside this system) and stitch the
// per-scene clips into ONE browser-safe silent MP4.
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

// Stitch scene clips (in order) into one silent MP4. Returns the MP4 bytes.
export async function assembleSilentVideo(
  clips: readonly Buffer[],
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
// its window rather than the reverse: a segment longer than its window is sped up
// (atempo, capped at 2.0 so the voice stays natural — narration is authored to
// ~8s, so factors sit near 1.0 — with a hard trim past the cap), a shorter one is
// padded with silence. Every segment ends up exactly its window long, so the
// concatenated track equals the video's length and stays in lock-step with the
// SRT/timing. Video is copied (already encoded); only audio is added.
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
      const factor = Math.min(2, Math.max(1, rawSeconds / window));
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
        '160k',
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
