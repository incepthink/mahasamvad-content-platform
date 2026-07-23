import { TwitterApi } from 'twitter-api-v2';

import { SocialPublishError, type PublishResult } from './types.js';

// OAuth 1.0a user-context keys of the official account (they never expire, unlike
// OAuth 2.0 user tokens). The same four values sign both media upload and tweet
// creation on the v2 endpoints.
export type TwitterCredentials = Readonly<{
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessSecret: string;
}>;

// TWEET_MAX_LENGTH / tweetWeightedLength live in @dgipr/schemas: the web's live
// caption counter needs the same numbers, and it cannot import this package
// (twitter-api-v2 must not reach the browser bundle). This package stays platform I/O.

export async function publishTweet(
  input: Readonly<{
    credentials: TwitterCredentials;
    text: string;
    imagePng: Buffer;
  }>,
): Promise<PublishResult> {
  const client = new TwitterApi({
    appKey: input.credentials.apiKey,
    appSecret: input.credentials.apiSecret,
    accessToken: input.credentials.accessToken,
    accessSecret: input.credentials.accessSecret,
  });
  try {
    // v2 media upload — the v1.1 media/upload endpoint is retired on current
    // API tiers.
    const mediaId = await client.v2.uploadMedia(input.imagePng, {
      media_type: 'image/png',
    });
    const tweet = await client.v2.tweet({
      text: input.text,
      media: { media_ids: [mediaId] },
    });
    const postId = tweet.data.id;
    // /i/web/status/ resolves without knowing the account's handle.
    return { postId, postUrl: `https://x.com/i/web/status/${postId}` };
  } catch (error) {
    throw new SocialPublishError(describeTwitterError(error), { cause: error });
  }
}

function describeTwitterError(error: unknown): string {
  if (error && typeof error === 'object') {
    const data = (
      error as {
        data?: {
          detail?: string;
          title?: string;
          errors?: Array<{ message?: string }>;
        };
      }
    ).data;
    const detail = data?.detail ?? data?.errors?.[0]?.message ?? data?.title;
    if (detail) return `X API: ${detail}`;
  }
  if (error instanceof Error && error.message) return `X API: ${error.message}`;
  return 'X API request failed.';
}
