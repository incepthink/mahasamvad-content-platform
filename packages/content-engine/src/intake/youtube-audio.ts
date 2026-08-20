// Turning a pasted media link into BYTES, with yt-dlp.
//
// This file exists because the assumption the YouTube feature was built on stopped
// holding. ElevenLabs Scribe takes a `source_url` and fetches the media itself — its docs
// still list YouTube explicitly — and that is what kept a video downloader out of this
// repo: no binary in the API image, no bot-check exposure from a datacentre IP, no
// archive object. In August 2026 that path began failing for EVERY YouTube video with
//
//   400 {"message":"Failed to download the file from the provided URL
//        (upstream status 400). Ensure the URL is publicly accessible …"}
//
// `upstream status 400` is what ElevenLabs got back from YouTube, not what we sent.
// Measured before writing any of this: an ordinary public video fails identically to a
// livestream, and a plain hosted MP3 URL downloads and transcribes fine through the same
// parameter — so `source_url` works and YouTube specifically is blocked on their side.
// It reproduces locally as well as in production, because our IP plays no part in it.
//
// Five things worth knowing before touching this:
//
// - THE BYTES MUST COME TO US; there is no shortcut. `yt-dlp -g` resolves a direct
//   googlevideo CDN URL that Scribe could be handed instead, but that URL is IP-LOCKED
//   (the requesting address is signed into it), so ElevenLabs fetching it from their own
//   address would 403. Whoever resolves the link has to be whoever downloads it.
//
// - IT IS A SEPARATE BINARY, ON PURPOSE. yt-dlp is a moving target against a hostile
//   extractor: it needs updating whenever YouTube changes, which is a Dockerfile version
//   bump rather than an npm dependency this workspace has to resolve. `YTDLP_PATH` names
//   it; the image installs it to /usr/local/bin/yt-dlp (see deploy/api.Dockerfile).
//
// - ONLY THE HLS RENDITIONS DOWNLOAD (2026-08-19). Every `https` format YouTube offers is
//   now behind a GVS PO token — the audio-only 139/249/140/251 AND the muxed 18 — and each
//   answers the sustained download with `HTTP Error 403`. The `m3u8_native` renditions
//   (91–96) serve without one. This matters more than it sounds, because yt-dlp falls
//   through a `-f a/b/c` chain only when a format is UNAVAILABLE, never when it 403s
//   mid-download: naming `bestaudio` first therefore fails EVERY YouTube link rather than
//   degrading, and `--check-formats` does not help (its probe on 140 succeeds and the real
//   download still 403s — measured). So the selector names HLS first and keeps the old
//   audio-only chain below it, where a non-YouTube host still reaches it by ordinary
//   unavailability. `--audio-format best` keeps the source codec, so the AAC track is
//   COPIED out of the muxed stream rather than re-encoded.
//
// - THE PLAYER CLIENT IS NOW UNPINNED (`default`, YTDLP_PLAYER_CLIENT), which is the exact
//   reversal of what this file said a fortnight ago — read that as the shape of the
//   problem rather than as a correction. Pinning ANY single client now returns
//   `Only images are available for download`: web_safari, tv, ios, mweb, web_embedded and
//   web were each measured doing so, while yt-dlp's own default set resolves real formats.
//   A JS runtime is still required to solve YouTube's challenges, which is why `node` is
//   enabled explicitly — the API image is node:22-bookworm-slim, so it is already there
//   and no Deno needs installing. Both are env-overridable, because which client works is
//   a fact about YouTube this month, not about this code.
//
// - THE `n`-CHALLENGE SOLVER IS DELIBERATELY NOT ENABLED. yt-dlp warns that its remote
//   component (`--remote-components ejs:github`) may be needed and offers to fetch it from
//   github.com at download time. It is required only for the https/DASH formats, which are
//   PO-token gated anyway — the HLS path was measured downloading cleanly without it. So
//   enabling it would add a runtime dependency on github.com from the API box and buy
//   nothing; add it through YTDLP_EXTRA_ARGS if that ever changes.
//
// - THE RISK THIS CANNOT REMOVE is that YouTube refuses the SERVER's IP, which is a
//   different question from whether it refuses ElevenLabs'. A datacentre address is what
//   its bot checks are aimed at. That failure has a recognisable shape and is reported
//   with the two knobs that answer it — YTDLP_COOKIES_FILE and YTDLP_PROXY — rather than
//   as a bare non-zero exit.
//
// - A FAILURE HERE IS ONE FILE'S FAILURE. This throws; stt-provider.ts is what turns that
//   into the `{ error }` its contract promises, so a dead link never sinks an intake whose
//   other recordings transcribed fine.
//
// Rollback is one env line: YOUTUBE_AUDIO_SOURCE=provider restores the old behaviour
// exactly (the link is passed to the provider untouched), for the day ElevenLabs' YouTube
// support comes back.

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { audioMimeForFileName } from '@dgipr/schemas';
import type { AudioFileInput, AudioUrlInput } from './audio-input.js';

// Bounds what is DOWNLOADED, which since the PO-token change is usually a muxed 360p
// stream rather than an audio track — roughly 3 MB a minute, so this is several hours of
// press conference. A runaway guard, not a policy; the extracted audio is a fraction of it.
const DEFAULT_MAX_BYTES = 1536 * 1024 * 1024;

// The ceiling on ONE download, not on an intake. A long press conference over a slow link
// legitimately takes minutes.
const DEFAULT_TIMEOUT_MS = 20 * 60_000;

// HLS FIRST, and that inversion is measured rather than preferred. Every `https` format
// YouTube now offers — the audio-only 139/249/140/251 and the muxed 18 alike — is gated
// behind a GVS PO token and answers the sustained download with `HTTP Error 403`, while
// the `m3u8_native` renditions serve without one. yt-dlp only falls through a `-f a/b/c`
// chain when a format is UNAVAILABLE, never when it 403s mid-download, so naming
// `bestaudio` first does not degrade gracefully — it fails every YouTube link. (Nor does
// `--check-formats` rescue it: the probe request on 140 SUCCEEDS and the real download
// still 403s.) So the cheapest thing that actually arrives is named first.
//
// Within the HLS renditions the LC-AAC one (`mp4a.40.2`, the 360p rung) is preferred over
// the smaller 144p rung, whose `mp4a.40.5` is 22 kHz HE-AAC — this audio is Marathi speech
// on its way to an STT model, so the codec profile is worth the extra bytes.
//
// The old chain is kept BELOW it and still earns its place: a non-YouTube host offers no
// m3u8 formats at all, so the HLS branches are genuinely unavailable there and yt-dlp
// falls through to `bestaudio` exactly as before — and a deployment with cookies
// configured can reach the audio-only formats again by overriding YTDLP_EXTRA_ARGS.
const FORMAT_SELECTOR =
  'worst[acodec^=mp4a.40.2][protocol^=m3u8]/worst[acodec!=none][protocol^=m3u8]/' +
  'bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio[ext=mp3]/bestaudio/' +
  '18/worst[acodec!=none]/worst';

// An HLS rendition arrives as fragments — 39 for a 3½-minute video, so roughly 1,300 for
// a two-hour press conference — and yt-dlp fetches them one at a time by default. This is
// what keeps a long recording from being bound by round trips.
const FRAGMENT_CONCURRENCY = '4';

// `default` is yt-dlp's own client set, and pinning ANY single client is now what breaks
// the download: web_safari, tv, ios, mweb, web_embedded and web each come back
// `Only images are available for download`, while the default set resolves real formats.
// It was pinned to web_safari for the opposite reason a fortnight earlier — which is the
// point of the env override: which client works is a fact about YouTube this month, not
// about this code.
const DEFAULT_PLAYER_CLIENT = 'default';

// An audio-only mp4 IS an m4a (same container, audio track only), and `.weba` is what a
// few tools call an audio-only webm. Both are renamed rather than converted.
const CONTAINER_ALIASES: Readonly<Record<string, string>> = {
  '.mp4': '.m4a',
  '.weba': '.webm',
};

// What YouTube's bot check looks like coming out of yt-dlp. Matched so the officer is told
// the actionable thing (this address is refused) rather than `exited with code 1`.
const BLOCKED_PATTERNS =
  /sign in to confirm|confirm you.?re not a bot|HTTP Error 403|Requested format is not available/i;

function readEnv(name: string): string | undefined {
  const raw = process.env[name];
  return raw !== undefined && raw.trim() !== '' ? raw.trim() : undefined;
}

function readPositiveInt(name: string, fallback: number): number {
  const raw = readEnv(name);
  const value = raw === undefined ? Number.NaN : Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

export type YouTubeAudioSource = 'download' | 'provider';

/**
 * Where a URL source's audio comes from.
 *
 * `download` (the default) fetches it here with yt-dlp and hands the STT provider bytes.
 * `provider` restores the original behaviour — pass the link along and let the provider
 * fetch it — which only ElevenLabs can serve, and which is broken for YouTube today.
 */
export function youTubeAudioSource(): YouTubeAudioSource {
  return readEnv('YOUTUBE_AUDIO_SOURCE')?.toLowerCase() === 'provider'
    ? 'provider'
    : 'download';
}

export function ytDlpPath(): string {
  return readEnv('YTDLP_PATH') ?? 'yt-dlp';
}

export function youTubeDownloadMaxBytes(): number {
  return readPositiveInt('YOUTUBE_DOWNLOAD_MAX_BYTES', DEFAULT_MAX_BYTES);
}

export function youTubeDownloadTimeoutMs(): number {
  return readPositiveInt('YOUTUBE_DOWNLOAD_TIMEOUT_MS', DEFAULT_TIMEOUT_MS);
}

export function youTubePlayerClient(): string {
  return readEnv('YTDLP_PLAYER_CLIENT') ?? DEFAULT_PLAYER_CLIENT;
}

/**
 * The ffmpeg yt-dlp extracts the audio track with, or null to let it search PATH.
 *
 * FFMPEG_PATH first (the same variable poster-renderer's assemble.ts reads, so one
 * deployment setting serves both), then the ffmpeg-static binary. `createRequire` because
 * ffmpeg-static's export is CJS — assemble.ts's precedent exactly.
 */
export function ffmpegLocation(): string | null {
  const fromEnv = readEnv('FFMPEG_PATH');
  if (fromEnv !== undefined) return fromEnv;
  try {
    const require = createRequire(import.meta.url);
    return (require('ffmpeg-static') as string | null) ?? null;
  } catch {
    // Not fatal: yt-dlp looks on PATH, and an audio-only format needs no ffmpeg at all.
    return null;
  }
}

// The escape hatch for YouTube's churn: extractor arguments, a player-client override, a
// JS-runtime path. Whitespace-separated, appended last so it can override anything above.
// It exists because the alternative to a knob here is a code change and a deploy on a day
// the platform is already broken.
function extraArgs(): string[] {
  const raw = readEnv('YTDLP_EXTRA_ARGS');
  return raw === undefined ? [] : raw.split(/\s+/).filter((arg) => arg !== '');
}

/**
 * The full yt-dlp argument list. Pure, so the harness can assert it without spawning.
 *
 * `--` before the URL matters: a link is user input and must never be read as a flag.
 */
export function buildYtDlpArgs(url: string, outputTemplate: string): string[] {
  const args = [
    '--no-playlist',
    '--no-progress',
    // No .part file left in the output directory, and no resume of a stale one — each
    // download runs in its own empty temp directory anyway.
    '--no-part',
    '--no-continue',
    '--retries',
    '3',
    '--socket-timeout',
    '30',
    '-f',
    FORMAT_SELECTOR,
    '--concurrent-fragments',
    FRAGMENT_CONCURRENCY,
    // Extract the audio track when what came down carries video. `best` keeps the source
    // codec, so AAC is copied rather than re-encoded, and the extension stays one the
    // MIME map knows (.m4a / .opus / .webm).
    '-x',
    '--audio-format',
    'best',
    // YouTube's challenges cannot be solved without a JS runtime, and only Deno is enabled
    // by default. The API image is node:22-bookworm-slim, so node is always present —
    // passed by absolute path rather than by name so it cannot resolve to something else.
    '--js-runtimes',
    `node:${process.execPath}`,
    '--extractor-args',
    `youtube:player_client=${youTubePlayerClient()}`,
    // yt-dlp SKIPS a file over this and still exits 0, which is why the caller reads an
    // empty output directory as the size failure rather than as a mystery.
    '--max-filesize',
    String(youTubeDownloadMaxBytes()),
    '-o',
    outputTemplate,
  ];
  const ffmpeg = ffmpegLocation();
  if (ffmpeg !== null) args.push('--ffmpeg-location', ffmpeg);
  const cookies = readEnv('YTDLP_COOKIES_FILE');
  if (cookies !== undefined) args.push('--cookies', cookies);
  const cookiesFromBrowser = readEnv('YTDLP_COOKIES_FROM_BROWSER');
  if (cookiesFromBrowser !== undefined) {
    args.push('--cookies-from-browser', cookiesFromBrowser);
  }
  const proxy = readEnv('YTDLP_PROXY');
  if (proxy !== undefined) args.push('--proxy', proxy);
  args.push(...extraArgs());
  args.push('--', url);
  return args;
}

function tail(text: string, limit = 400): string {
  const trimmed = text.trim();
  return trimmed.length <= limit ? trimmed : `…${trimmed.slice(-limit)}`;
}

/**
 * The name the downloaded stream is handed on under.
 *
 * Only the EXTENSION carries meaning downstream — it is what `audioMimeForFileName`
 * resolves the multipart content type from, and a wrong one has already cost this repo a
 * real `invalid_audio: File is corrupted` (see AUDIO_MIME_BY_EXTENSION's `.opus` note).
 * The base is the video's title and is for error messages only, so it is sanitised to
 * something safe to put in a Content-Disposition header while keeping its Devanagari.
 */
export function audioFileNameFor(
  displayName: string,
  downloadedFileName: string,
): string {
  const raw = extname(downloadedFileName).toLowerCase();
  const ext = CONTAINER_ALIASES[raw] ?? raw;
  if (ext === '' || audioMimeForFileName(`audio${ext}`) === null) {
    throw new Error(
      `yt-dlp ने "${raw || 'unknown'}" या अपरिचित स्वरूपात ध्वनी दिला.`,
    );
  }
  const base = displayName
    .replace(/\.[A-Za-z0-9]{1,5}$/, '')
    // Control characters plus the separators that would break a filename or a header.
    // The control range is the point of this line, hence the rule exemption.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
    .trim();
  return `${base === '' ? 'youtube-audio' : base}${ext}`;
}

function runYtDlp(url: string, outputTemplate: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ytDlpPath(), buildYtDlpArgs(url, outputTemplate), {
      timeout: youTubeDownloadTimeoutMs(),
      killSignal: 'SIGKILL',
      windowsHide: true,
    });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      // Keep the tail: the reason is always at the end.
      if (stderr.length > 8_000) stderr = stderr.slice(-8_000);
    });
    // Drained rather than ignored — an unread pipe eventually blocks the child.
    child.stdout.resume();

    child.on('error', (error: NodeJS.ErrnoException) => {
      reject(
        error.code === 'ENOENT'
          ? new Error(
              `yt-dlp सापडले नाही (${ytDlpPath()}). ` +
                'API इमेजमध्ये ते स्थापित करा किंवा YTDLP_PATH निश्चित करा.',
            )
          : error,
      );
    });
    child.on('close', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      if (signal !== null) {
        reject(
          new Error(
            `ध्वनी उतरवण्यास ${Math.round(youTubeDownloadTimeoutMs() / 1000)} ` +
              'सेकंदांपेक्षा जास्त वेळ लागला.',
          ),
        );
        return;
      }
      if (BLOCKED_PATTERNS.test(stderr)) {
        reject(
          new Error(
            'यूट्युबने या सर्व्हरवरून हा व्हिडिओ उतरवण्यास नकार दिला (bot check). ' +
              'YTDLP_COOKIES_FILE किंवा YTDLP_PROXY वापरून पहा. ' +
              `yt-dlp: ${tail(stderr, 200)}`,
          ),
        );
        return;
      }
      reject(new Error(`yt-dlp exited with code ${code}: ${tail(stderr)}`));
    });
  });
}

/**
 * Download a URL source's audio and return it as an ordinary uploaded-recording input.
 *
 * Throws on any failure — stt-provider.ts is what turns that into a per-file `{ error }`.
 */
export async function downloadUrlAudio(
  input: AudioUrlInput,
): Promise<AudioFileInput> {
  const directory = await mkdtemp(join(tmpdir(), 'dgipr-yt-'));
  try {
    await runYtDlp(input.sourceUrl, join(directory, 'audio.%(ext)s'));
    const names = (await readdir(directory)).filter(
      (name) => !name.endsWith('.part'),
    );
    // Normally exactly one file: --audio-format deletes the muxed original once the track
    // is out. Preferring a name the MIME map recognises means that if an extraction ever
    // leaves both behind, the audio is what gets sent rather than the 360p video.
    const downloaded =
      names.find(
        (name) => audioMimeForFileName(`audio${extname(name)}`) !== null,
      ) ?? names[0];
    if (downloaded === undefined) {
      // The only way to exit 0 having written nothing: --max-filesize skipped it.
      throw new Error(
        'या व्हिडिओची ध्वनिफाईल मर्यादेपेक्षा मोठी आहे ' +
          `(${Math.round(youTubeDownloadMaxBytes() / (1024 * 1024))} MB).`,
      );
    }
    const file = join(directory, downloaded);
    const info = await stat(file);
    if (info.size === 0) {
      throw new Error('उतरवलेली ध्वनिफाईल रिकामी आहे.');
    }
    if (info.size > youTubeDownloadMaxBytes()) {
      throw new Error(
        `उतरवलेली ध्वनिफाईल खूप मोठी आहे (${Math.round(info.size / (1024 * 1024))} MB).`,
      );
    }
    const data = await readFile(file);
    const name = audioFileNameFor(input.name, downloaded);
    console.log(
      `[youtube-audio] ${input.sourceUrl} → ${name}, ` +
        `${(data.byteLength / (1024 * 1024)).toFixed(1)} MB.`,
    );
    return { name, data };
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}

// Harness. `--check` is free (argument building + naming, no spawn); a URL argument runs a
// real download and reports what it got, which is the cheapest way to prove both the
// binary and this machine's address before touching the STT path at all.
//   tsx src/intake/youtube-audio.ts --check
//   tsx src/intake/youtube-audio.ts https://www.youtube.com/watch?v=...
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const url = process.argv.slice(2).find((arg) => !arg.startsWith('--'));
  if (url === undefined) {
    const checks: Array<[string, boolean]> = [];
    const check = (label: string, ok: boolean): void => {
      checks.push([label, ok]);
    };
    const reset = (): void => {
      for (const name of [
        'YOUTUBE_AUDIO_SOURCE',
        'YTDLP_PATH',
        'YTDLP_COOKIES_FILE',
        'YTDLP_COOKIES_FROM_BROWSER',
        'YTDLP_PROXY',
        'YTDLP_EXTRA_ARGS',
        'YTDLP_PLAYER_CLIENT',
        'YOUTUBE_DOWNLOAD_MAX_BYTES',
        'YOUTUBE_DOWNLOAD_TIMEOUT_MS',
      ]) {
        delete process.env[name];
      }
    };

    reset();
    check('unset defaults to download', youTubeAudioSource() === 'download');
    process.env.YOUTUBE_AUDIO_SOURCE = '  Provider  ';
    check(
      'provider is trimmed + lowercased',
      youTubeAudioSource() === 'provider',
    );
    process.env.YOUTUBE_AUDIO_SOURCE = 'nonsense';
    check(
      'an unknown value still downloads',
      youTubeAudioSource() === 'download',
    );
    reset();
    check('yt-dlp path defaults to the binary name', ytDlpPath() === 'yt-dlp');

    const plain = buildYtDlpArgs(
      'https://youtu.be/abc',
      '/tmp/x/audio.%(ext)s',
    );
    check('the URL is last', plain.at(-1) === 'https://youtu.be/abc');
    check('the URL is guarded by --', plain.at(-2) === '--');
    check('never fetches a playlist', plain.includes('--no-playlist'));
    check(
      'prefers audio-only, then a muxed stream',
      plain.includes(FORMAT_SELECTOR),
    );
    // The three findings that made a download work at all — each is a live-measured fact
    // about YouTube, so a regression here looks like an unexplained 403 in production.
    check(
      'audio is extracted keeping the source codec',
      plain.includes('-x') &&
        plain[plain.indexOf('--audio-format') + 1] === 'best',
    );
    check(
      'a JS runtime is enabled, by absolute path',
      plain[plain.indexOf('--js-runtimes') + 1] === `node:${process.execPath}`,
    );
    check(
      "the player client is yt-dlp's own set, not a pinned one",
      plain[plain.indexOf('--extractor-args') + 1] ===
        'youtube:player_client=default',
    );
    check(
      'prefers a format that is not PO-token gated',
      (plain[plain.indexOf('-f') + 1] ?? '').startsWith(
        'worst[acodec^=mp4a.40.2][protocol^=m3u8]/',
      ),
    );
    check(
      'keeps the audio-only chain below it for other hosts',
      (plain[plain.indexOf('-f') + 1] ?? '').includes('/bestaudio[ext=m4a]/'),
    );
    check(
      'fetches HLS fragments in parallel',
      plain[plain.indexOf('--concurrent-fragments') + 1] ===
        FRAGMENT_CONCURRENCY,
    );
    check(
      'caps the download size',
      plain[plain.indexOf('--max-filesize') + 1] === String(DEFAULT_MAX_BYTES),
    );
    check(
      'no cookies or proxy by default',
      !plain.includes('--cookies') && !plain.includes('--proxy'),
    );

    const valueAfter = (flag: string): string | undefined => {
      const args = buildYtDlpArgs('https://youtu.be/abc', '/tmp/x/a.%(ext)s');
      return args[args.indexOf(flag) + 1];
    };

    process.env.YTDLP_PLAYER_CLIENT = 'tv_simply';
    check(
      'the player client is overridable without a code change',
      valueAfter('--extractor-args') === 'youtube:player_client=tv_simply',
    );
    delete process.env.YTDLP_PLAYER_CLIENT;

    process.env.FFMPEG_PATH = '/opt/ffmpeg';
    check(
      'FFMPEG_PATH wins over the bundled binary',
      valueAfter('--ffmpeg-location') === '/opt/ffmpeg',
    );
    delete process.env.FFMPEG_PATH;
    check(
      'ffmpeg-static is found without any configuration',
      typeof ffmpegLocation() === 'string',
    );

    process.env.YTDLP_COOKIES_FILE = '/run/secrets/yt.txt';
    process.env.YTDLP_PROXY = 'http://proxy:8080';
    process.env.YTDLP_EXTRA_ARGS =
      '--extractor-args  youtube:player_client=android';
    const tuned = buildYtDlpArgs(
      'https://youtu.be/abc',
      '/tmp/x/audio.%(ext)s',
    );
    check(
      'cookies are passed through',
      tuned[tuned.indexOf('--cookies') + 1] === '/run/secrets/yt.txt',
    );
    check(
      'the proxy is passed through',
      tuned[tuned.indexOf('--proxy') + 1] === 'http://proxy:8080',
    );
    check(
      'extra args survive collapsed whitespace',
      tuned.includes('--extractor-args') &&
        tuned.includes('youtube:player_client=android'),
    );
    check(
      'extra args come before the URL guard',
      tuned.indexOf('youtube:player_client=android') < tuned.lastIndexOf('--'),
    );
    reset();

    check(
      'an m4a keeps its extension',
      audioFileNameFor('CM Press Conference', 'audio.m4a') ===
        'CM Press Conference.m4a',
    );
    check(
      'a webm keeps its extension',
      audioFileNameFor('बैठक', 'audio.webm') === 'बैठक.webm',
    );
    check(
      'an audio-only mp4 is named as the m4a it is',
      audioFileNameFor('बैठक', 'audio.mp4') === 'बैठक.m4a',
    );
    check(
      'the title keeps its Devanagari and loses its separators',
      audioFileNameFor('मुख्यमंत्री LIVE | पत्रकार परिषद', 'audio.m4a') ===
        'मुख्यमंत्री LIVE पत्रकार परिषद.m4a',
    );
    check(
      'a title that sanitises to nothing still names a file',
      audioFileNameFor('///', 'audio.webm') === 'youtube-audio.webm',
    );
    check(
      'a long title is bounded',
      audioFileNameFor('अ'.repeat(400), 'audio.m4a').length <= 124,
    );
    let rejected = false;
    try {
      audioFileNameFor('x', 'audio.avi');
    } catch {
      rejected = true;
    }
    check('an unknown container is refused, not mislabelled', rejected);
    check(
      'every produced name resolves a MIME type',
      audioMimeForFileName(audioFileNameFor('x', 'audio.mp4')) ===
        'audio/mp4' &&
        audioMimeForFileName(audioFileNameFor('x', 'audio.webm')) ===
          'audio/webm',
    );

    let failed = 0;
    for (const [label, ok] of checks) {
      console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
      if (!ok) failed++;
    }
    console.log(`\n${checks.length - failed}/${checks.length} passed.`);
    process.exitCode = failed > 0 ? 1 : 0;
  } else {
    void (async () => {
      console.log(`Downloading ${url} with ${ytDlpPath()}...`);
      const started = Date.now();
      const file = await downloadUrlAudio({ name: url, sourceUrl: url });
      console.log(
        `${file.name} — ${(file.data.byteLength / (1024 * 1024)).toFixed(1)} MB ` +
          `in ${((Date.now() - started) / 1000).toFixed(1)}s ` +
          `(${audioMimeForFileName(file.name)}).`,
      );
    })().catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
  }
}
