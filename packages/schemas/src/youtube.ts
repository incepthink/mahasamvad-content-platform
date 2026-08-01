// YouTube links as an intake source, shared by apps/api and apps/web.
//
// It lives here rather than in @dgipr/content-engine for the usual reason: BOTH sides need
// the same answer to "is this a YouTube URL, and which video is it?" — the web to validate
// a paste before it hits the network and to key its cards, the API to canonicalise what it
// stores and sends to the transcriber — and apps/web cannot import content-engine
// (pdfjs/sarvam/openai). The combineIntakeSources / tweetWeightedLength precedent.
//
// THE REASON THERE IS NO DOWNLOADER ANYWHERE IN THIS REPO: ElevenLabs Scribe takes a
// `source_url` and fetches the media itself — its docs list YouTube explicitly ("Supports
// hosted video or audio files, YouTube video URLs, TikTok video URLs, and other video
// hosting services"). So a YouTube source never becomes bytes on our side: no yt-dlp binary
// in the API image, no bot-check exposure from a datacentre IP, no archive object, and no
// per-video vendor. What we store is the URL. See intake/elevenlabs-stt.ts.
//
// The consequence worth knowing is that Sarvam CANNOT serve this — its batch STT takes
// uploaded bytes only — so a deployment on STT_PROVIDER=sarvam fails YouTube sources
// individually with a Marathi message rather than pretending to transcribe them.

import { z } from 'zod';

// ---------- recognising a link ----------

// Every host YouTube actually serves watch pages on. `youtube-nocookie` is included because
// an embed URL copied out of a page is a real thing officers paste.
const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
  'youtu.be',
  'www.youtu.be',
]);

// A video id is exactly 11 characters of URL-safe base64. Checked rather than assumed: a
// bare `?v=` or a playlist-only link would otherwise sail through and fail much later, at
// the transcriber, after the officer had already submitted the form.
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

// The path prefixes that carry the id as the FIRST segment rather than in `?v=`.
const PATH_PREFIXES = ['/embed/', '/shorts/', '/live/', '/v/'];

/**
 * The 11-character video id in `raw`, or null if it is not a YouTube video link.
 *
 * Deliberately tolerant about how the link was obtained — `youtu.be/ID`, a full watch URL
 * with tracking parameters, an `/embed/`, `/shorts/` or `/live/` URL, and a bare
 * `youtube.com/...` with no scheme (which is what a copy out of a chat message often is) —
 * and deliberately strict about the id itself.
 */
export function parseYouTubeVideoId(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;

  // A pasted link frequently arrives without a scheme; `new URL` would reject it outright.
  const withScheme = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (!YOUTUBE_HOSTS.has(url.hostname.toLowerCase())) return null;

  // youtu.be/ID — the id is the whole path.
  if (url.hostname.toLowerCase().endsWith('youtu.be')) {
    const id = url.pathname.slice(1).split('/')[0] ?? '';
    return VIDEO_ID.test(id) ? id : null;
  }

  // The canonical watch URL.
  const query = url.searchParams.get('v');
  if (query !== null && VIDEO_ID.test(query)) return query;

  for (const prefix of PATH_PREFIXES) {
    if (url.pathname.startsWith(prefix)) {
      const id = url.pathname.slice(prefix.length).split('/')[0] ?? '';
      return VIDEO_ID.test(id) ? id : null;
    }
  }
  return null;
}

export function isYouTubeUrl(raw: string): boolean {
  return parseYouTubeVideoId(raw) !== null;
}

/**
 * The canonical watch URL for a video id.
 *
 * What gets STORED and what gets sent to the transcriber, rather than whatever the officer
 * pasted: a link copied out of the YouTube app carries `?si=`/`&t=`/`&list=` tracking and
 * playlist parameters, and a `&t=` in particular is a real hazard — it is a request to start
 * partway in, which is not what "transcribe this video" means.
 */
export function canonicalYouTubeUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

/**
 * A thumbnail that exists for every public video without an API key.
 *
 * `hqdefault` rather than `maxresdefault`: the latter 404s on any video never published at
 * 720p+, which for a departmental upload is common, and a broken image in the preview card
 * would read as "this link is wrong".
 */
export function youTubeThumbnailUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

// ---------- the probe ----------

// What the officer sees before submitting. It comes from YouTube's public oEmbed endpoint,
// which needs no key and no quota — and which returns the title, the channel and a
// thumbnail, but NOT the duration. That is a deliberate accepted limit: showing a duration
// (and from it a cost estimate) would mean provisioning a YouTube Data API key, and the
// card's job here is only to answer "is this the video I meant?".
export const YouTubeProbeRequestSchema = z.object({
  url: z.string().trim().min(1),
});
export type YouTubeProbeRequest = z.infer<typeof YouTubeProbeRequestSchema>;

export const YouTubeVideoSchema = z.object({
  videoId: z.string(),
  // Canonical, never the pasted string — see canonicalYouTubeUrl.
  url: z.string(),
  // Both optional: oEmbed is a live third-party call, and a video that cannot be described
  // is still a video that Scribe may well transcribe. A failed probe must degrade to a plain
  // link chip, never block the source.
  title: z.string().optional(),
  author: z.string().optional(),
  thumbnailUrl: z.string().optional(),
});
export type YouTubeVideo = z.infer<typeof YouTubeVideoSchema>;

// Same ceiling as an intake's recordings and documents: a meeting's worth of material.
export const MAX_YOUTUBE_LINKS = 10;

export const YouTubeSourcesSchema = z
  .array(YouTubeVideoSchema)
  .max(MAX_YOUTUBE_LINKS);

// Free harness. This parser runs on BOTH sides — the form to validate a paste, the API to
// re-derive the id it will not trust from the client — so the shapes it accepts and rejects
// are worth pinning down rather than assuming.
//   npx tsx packages/schemas/src/youtube.ts
if (
  typeof process !== 'undefined' &&
  process.argv[1]?.replace(/\\/g, '/').endsWith('schemas/src/youtube.ts')
) {
  const checks: Array<[string, boolean]> = [];
  const check = (label: string, ok: boolean): void => {
    checks.push([label, ok]);
  };
  const ID = 'dQw4w9WgXcQ';

  // Accepted: every shape a link is actually copied in.
  for (const [label, raw] of [
    ['canonical watch URL', `https://www.youtube.com/watch?v=${ID}`],
    ['youtu.be short link', `https://youtu.be/${ID}`],
    ['no scheme (copied from a chat)', `youtube.com/watch?v=${ID}`],
    ['m. mobile host', `https://m.youtube.com/watch?v=${ID}`],
    ['music host', `https://music.youtube.com/watch?v=${ID}`],
    ['embed URL', `https://www.youtube.com/embed/${ID}`],
    ['nocookie embed', `https://www.youtube-nocookie.com/embed/${ID}`],
    ['shorts URL', `https://www.youtube.com/shorts/${ID}`],
    ['live URL', `https://www.youtube.com/live/${ID}`],
    ['tracking params', `https://youtu.be/${ID}?si=abcdefg&t=42`],
    [
      'playlist params',
      `https://www.youtube.com/watch?v=${ID}&list=PL123&index=2`,
    ],
    ['surrounding whitespace', `  https://youtu.be/${ID}  `],
    ['http upgraded', `http://www.youtube.com/watch?v=${ID}`],
  ] as const) {
    check(`accepts: ${label}`, parseYouTubeVideoId(raw) === ID);
  }

  // Rejected: everything that is not one video.
  for (const [label, raw] of [
    ['empty', ''],
    ['whitespace only', '   '],
    ['a bare word', 'hello'],
    ['another host', 'https://vimeo.com/123456789'],
    // The near-misses are the ones worth having: each looks like a YouTube link.
    ['a channel page', 'https://www.youtube.com/@MahaDGIPR'],
    ['a playlist with no video', 'https://www.youtube.com/playlist?list=PL123'],
    ['an empty v parameter', 'https://www.youtube.com/watch?v='],
    ['a short id', 'https://www.youtube.com/watch?v=abc'],
    ['an over-long id', `https://www.youtube.com/watch?v=${ID}XX`],
    [
      'an id with an illegal character',
      'https://www.youtube.com/watch?v=dQw4w9Wg!cQ',
    ],
    ['a lookalike host', `https://youtube.com.evil.example/watch?v=${ID}`],
    ['results page', 'https://www.youtube.com/results?search_query=test'],
  ] as const) {
    check(`rejects: ${label}`, parseYouTubeVideoId(raw) === null);
  }

  // The canonical URL is what gets stored and transcribed — never the pasted string, whose
  // `&t=` would ask the transcriber to start partway through the video.
  check(
    'canonicalises away tracking and timestamps',
    canonicalYouTubeUrl(
      parseYouTubeVideoId(`https://youtu.be/${ID}?si=x&t=42`)!,
    ) === `https://www.youtube.com/watch?v=${ID}`,
  );
  check(
    'the thumbnail is hqdefault (maxres 404s on low-res uploads)',
    youTubeThumbnailUrl(ID) === `https://i.ytimg.com/vi/${ID}/hqdefault.jpg`,
  );
  check(
    'isYouTubeUrl agrees with the parser',
    isYouTubeUrl(`https://youtu.be/${ID}`),
  );
  check(
    'isYouTubeUrl rejects a channel',
    !isYouTubeUrl('https://www.youtube.com/@x'),
  );

  // The wire shape the two create routes parse.
  check(
    'a source list caps at MAX_YOUTUBE_LINKS',
    !YouTubeSourcesSchema.safeParse(
      Array.from({ length: MAX_YOUTUBE_LINKS + 1 }, () => ({
        videoId: ID,
        url: canonicalYouTubeUrl(ID),
      })),
    ).success,
  );
  check(
    'title/author/thumbnail are all optional (a failed probe still submits)',
    YouTubeSourcesSchema.safeParse([
      { videoId: ID, url: canonicalYouTubeUrl(ID) },
    ]).success,
  );

  let failed = 0;
  for (const [label, ok] of checks) {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
    if (!ok) failed++;
  }
  console.log(`\n${checks.length - failed}/${checks.length} passed.`);
  process.exitCode = failed > 0 ? 1 : 0;
}
