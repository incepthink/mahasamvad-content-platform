// X (Twitter) post-length rules. Pure functions with no platform SDK, so both the
// API's publish guard and the web's live caption counter can use the SAME number —
// a counter that disagreed with the publish-time rejection would be worse than none.
// (apps/web cannot import @dgipr/social-publisher: that would pull twitter-api-v2
// into the browser bundle.)

export const TWEET_MAX_LENGTH = 280;

// X measures tweets in weighted units: every URL counts 23 regardless of its real
// length, and Devanagari (like most non-CJK scripts) weighs 1 per NFC code point.
// A pre-flight approximation — the API stays the referee for edge cases.
export function tweetWeightedLength(text: string): number {
  let urlWeight = 0;
  const withoutUrls = text.normalize('NFC').replace(/https?:\/\/\S+/g, () => {
    urlWeight += 23;
    return '';
  });
  return urlWeight + Array.from(withoutUrls).length;
}
