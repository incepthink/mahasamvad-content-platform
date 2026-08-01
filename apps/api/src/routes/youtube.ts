// "What is this link?" — one synchronous route behind the YouTube source cards on /dlo and
// /transcribe. It persists nothing and spends nothing.
//
// It calls YouTube's public oEmbed endpoint, which needs no API key and no quota, and which
// returns the title, the channel and a thumbnail. It does NOT return the DURATION, and that
// is a deliberate accepted limit rather than an oversight: a duration (and the cost estimate
// that would follow from it) is only available through the YouTube Data API, which means
// provisioning and rotating a key. The card's job is to answer "is this the video I meant?",
// and a title plus a thumbnail answers it.
//
// A probe failure is NOT an error the officer has to clear. A private, region-blocked or
// simply unlisted video has no oEmbed record while remaining perfectly transcribable, so a
// failed probe degrades to a bare link chip and the source still submits — which is why this
// route answers 200 with the id alone rather than 4xx when oEmbed declines. It 400s only for
// something that is not a YouTube video link at all, because that IS worth stopping at.
//
// No Supabase client: like registerDocumentRoutes, this route stores nothing.

import type { FastifyInstance } from 'fastify';
import {
  canonicalYouTubeUrl,
  parseYouTubeVideoId,
  YouTubeProbeRequestSchema,
  youTubeThumbnailUrl,
  type YouTubeVideo,
} from '@dgipr/schemas';

const OEMBED_ENDPOINT = 'https://www.youtube.com/oembed';

// Short on purpose: this runs while the officer waits with a paste in the box, and the
// answer is a nicety. Timing out into a bare chip beats a spinner.
const PROBE_TIMEOUT_MS = 6_000;

type OEmbedResponse = Readonly<{
  title?: unknown;
  author_name?: unknown;
  thumbnail_url?: unknown;
}>;

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== ''
    ? value.trim()
    : undefined;
}

// Best-effort description of a video. Never throws: every failure path returns the id and
// the canonical URL, which is everything the intake actually needs.
async function describe(videoId: string): Promise<YouTubeVideo> {
  const url = canonicalYouTubeUrl(videoId);
  // The thumbnail is derived rather than taken from oEmbed, so a card still shows an image
  // when the probe fails — i.ytimg.com serves it for every public video.
  const fallback: YouTubeVideo = {
    videoId,
    url,
    thumbnailUrl: youTubeThumbnailUrl(videoId),
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(
      `${OEMBED_ENDPOINT}?url=${encodeURIComponent(url)}&format=json`,
      { signal: controller.signal },
    );
    if (!response.ok) return fallback;
    const payload = (await response.json()) as OEmbedResponse;
    const title = stringOrUndefined(payload.title);
    const author = stringOrUndefined(payload.author_name);
    const thumbnailUrl =
      stringOrUndefined(payload.thumbnail_url) ?? fallback.thumbnailUrl;
    return {
      videoId,
      url,
      ...(title !== undefined ? { title } : {}),
      ...(author !== undefined ? { author } : {}),
      ...(thumbnailUrl !== undefined ? { thumbnailUrl } : {}),
    };
  } catch {
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}

export function registerYouTubeRoutes(app: FastifyInstance): void {
  app.post('/youtube/probe', async (request, reply) => {
    const body = YouTubeProbeRequestSchema.parse(request.body);
    const videoId = parseYouTubeVideoId(body.url);
    if (videoId === null) {
      return reply.code(400).send({
        error: {
          message:
            'ही यूट्युब व्हिडिओची लिंक वाटत नाही. ' +
            'उदा. https://www.youtube.com/watch?v=… किंवा https://youtu.be/…',
        },
      });
    }
    return describe(videoId);
  });
}
