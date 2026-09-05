// Reading an OpenAI **Responses** event stream, once, for every caller that wants one.
//
// Two places in this package stream from `/v1/responses`: /chat's conversation transport
// (chat/misc-chat.ts) and the article lane's source-file call (generation/
// responses-with-sources.ts). They share nothing else — one is a stored, continuable
// conversation, the other a single unstored government-article call — but the wire format is
// the provider's, not the feature's, so a second copy of this loop would be a second place to
// get frame buffering, chunk-boundary splitting and the `[DONE]` sentinel subtly wrong.
//
// Deliberately NOT the Chat Completions reader in http/openai-chat-stream.ts: that endpoint
// frames its deltas as `choices[].delta.content`, which is a different shape entirely.

// One frame of the event stream. Every frame carries its own `type`, so the SSE `event:` line
// is redundant and only `data:` is read.
type OpenAiStreamFrame = Readonly<{
  type?: string;
  delta?: string;
  response?: unknown;
  message?: string;
  error?: Readonly<{ message?: string }> | null;
}>;

/**
 * Read the event stream, forwarding text as it is written.
 *
 * Resolves with the authoritative final response (the `response.completed` /
 * `.incomplete` / `.failed` frame's payload), or null when the stream ended before one
 * arrived — which the caller must treat as a failure rather than as an empty answer.
 *
 * `onDelta` is the caller's live view; `onText` accumulates. They are separate because the
 * accumulated text is what decides whether a failure may still fall back to a blocking call:
 * past the first token those tokens are billed and already on screen.
 *
 * The generic is the caller's own response-body type. This module deliberately does not
 * declare one: /chat and the article lane read different fields off it, and a shared shape
 * would be the union of two features' needs rather than the provider's contract.
 */
export async function readResponseStream<T>(
  body: ReadableStream<Uint8Array>,
  onDelta: (chunk: string) => void,
  onText: (chunk: string) => void,
  label = 'chat',
): Promise<T | null> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let final: T | null = null;

  try {
    reading: for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      // Bare CR is never meaningful here (a carriage return inside a JSON string is escaped
      // as two characters), so the event separator is exactly a blank line however the server
      // framed its lines and wherever a chunk split.
      buffer = (buffer + decoder.decode(value, { stream: true })).replace(
        /\r/g,
        '',
      );

      let separator = buffer.indexOf('\n\n');
      while (separator !== -1) {
        const event = buffer.slice(0, separator);
        buffer = buffer.slice(separator + 2);
        for (const line of event.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data === '') continue;
          if (data === '[DONE]') break reading;
          let frame: OpenAiStreamFrame;
          try {
            frame = JSON.parse(data) as OpenAiStreamFrame;
          } catch {
            // A malformed frame is not worth failing a paid call over: the completed frame
            // is the authority on the text, so a dropped delta is recovered there.
            console.warn(
              `[openai] skipped an unparseable ${label} stream frame`,
            );
            continue;
          }

          if (
            frame.type === 'response.output_text.delta' ||
            frame.type === 'response.refusal.delta'
          ) {
            const chunk = frame.delta ?? '';
            if (chunk !== '') {
              onText(chunk);
              onDelta(chunk);
            }
          } else if (
            frame.type === 'response.completed' ||
            frame.type === 'response.incomplete' ||
            frame.type === 'response.failed'
          ) {
            final = (frame.response as T | undefined) ?? null;
            if (final !== null) break reading;
          } else if (frame.type === 'error') {
            const detail =
              frame.error?.message ?? frame.message ?? 'unknown error';
            throw new Error(`OpenAI ${label} stream failed: ${detail}.`);
          }
        }
        separator = buffer.indexOf('\n\n');
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  return final;
}
