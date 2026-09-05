// Reading an OpenAI-compatible **Chat Completions** event stream, once, for every caller
// that wants one.
//
// Two transports in this package stream from `/v1/chat/completions`: the article lane's
// generation/openai-chat.ts (chatCompleteStream, which every generated article is written
// through) and /chat's self-hosted Qwen provider, which vLLM serves on the same
// OpenAI-compatible contract. They agree on nothing above the wire — one is a single
// unstored government-article call with a fallback-to-blocking policy, the other a stored
// conversation that streams a separate thinking channel — but the framing is the
// endpoint's, not the feature's, and a second copy of this loop would be a second place to
// get the parts that fail SILENTLY subtly wrong: buffering a frame that arrived split
// across two reads, splitting on `\n\n` when the server framed its lines with CRLF, and
// the `[DONE]` sentinel, which is not JSON and ends the stream rather than carrying a
// delta. None of those misbehave in a way a short test notices; they misbehave under load,
// on long answers, and against whichever endpoint is the most expensive to exercise.
//
// Deliberately NOT the Responses reader in http/openai-response-stream.ts: that endpoint
// frames its deltas as typed `response.output_text.delta` events carrying an authoritative
// final response object, which is a different shape entirely.
//
// This module is strictly wire-level and reads nothing INTO the text. It hands the caller
// the raw content deltas exactly as they arrived, so a caller whose model emits its
// thinking inline as `<think>…</think>` (a pod running no reasoning parser) can strip that
// itself, across chunk boundaries, without this module knowing the convention exists.
// Interpretation — stripping, fallback policy, cost metering, what an empty answer means —
// belongs to the callers. If a provider quirk ever cannot be expressed as a field on a
// frame, fork this module rather than growing a flag on it.

// One chunk of a `stream: true` completion. `choices` is empty on the final usage-only
// chunk, which is why every field here is optional.
//
// `reasoning_content` is the thinking channel a reasoning-parser-equipped server emits
// beside the answer. OpenAI's models do not send it; vLLM does when started with a
// reasoning parser. It is reported separately and never folded into the answer text.
type ChatCompletionStreamFrame<TUsage> = Readonly<{
  choices?: ReadonlyArray<{
    delta?: { content?: string | null; reasoning_content?: string | null };
    finish_reason?: string | null;
  }>;
  usage?: TUsage;
}>;

// What the stream reported about itself, as opposed to what it said. Both are absent on a
// stream that ended early, so both are explicitly `| undefined` rather than optional
// properties — the caller must decide what a missing one means (chatCompleteStream folds a
// missing finish_reason into its no-content error).
export type ChatCompletionStreamResult<TUsage> = Readonly<{
  finishReason: string | undefined;
  usage: TUsage | undefined;
}>;

/**
 * Read the event stream, forwarding text as it is written.
 *
 * Resolves with the stream's own final report — the last `usage` seen (present only when
 * the request asked for `stream_options: { include_usage: true }`) and the last
 * `finish_reason`. The answer itself is not returned: it reaches the caller through the
 * callbacks, in order, and concatenating every `onText` chunk yields it exactly.
 *
 * `onDelta` is the caller's live view; `onText` accumulates. They are separate because the
 * accumulated text is what decides whether a failure may still fall back to a blocking
 * call: past the first token those tokens are billed and already on screen.
 *
 * `options.onReasoning` receives the thinking channel, which is deliberately NOT passed to
 * `onText` — it is not part of the answer, it is not replayed to the model, and a caller
 * that ignores it must still get an answer identical to one from a server that never sent
 * it.
 *
 * `options.label` is the log tag, and names the PROVIDER rather than the call (the
 * Responses reader's label names the call because it appears in a thrown message; this one
 * only ever appears in a `[…]` console prefix, where this repo puts the provider).
 *
 * The generic is the caller's own usage type. This module deliberately does not declare
 * one: the cost meter's shape belongs to cost/, and http/ has no business importing it.
 */
export async function readChatCompletionStream<TUsage>(
  body: ReadableStream<Uint8Array>,
  onDelta: (chunk: string) => void,
  onText: (chunk: string) => void,
  options?: {
    onReasoning?: (chunk: string) => void;
    label?: string;
  },
): Promise<ChatCompletionStreamResult<TUsage>> {
  const label = options?.label ?? 'openai';
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finishReason: string | undefined;
  let usage: TUsage | undefined;

  try {
    reading: for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      // Bare CR is never meaningful here (a carriage return inside a JSON string is
      // escaped as two characters), so dropping it makes the event separator exactly
      // "\n\n" regardless of how the server framed its lines or where a chunk split.
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
          let chunk: ChatCompletionStreamFrame<TUsage>;
          try {
            chunk = JSON.parse(data) as ChatCompletionStreamFrame<TUsage>;
          } catch {
            // A malformed frame is not worth failing a paid generation over; the
            // completed text is reassembled from the frames that did parse.
            console.warn(`[${label}] skipped an unparseable chat stream frame`);
            continue;
          }
          if (chunk.usage) usage = chunk.usage;
          const choice = chunk.choices?.[0];
          if (choice?.finish_reason) finishReason = choice.finish_reason;
          const reasoning = choice?.delta?.reasoning_content;
          if (reasoning) options?.onReasoning?.(reasoning);
          const delta = choice?.delta?.content;
          if (delta) {
            onText(delta);
            onDelta(delta);
          }
        }
        separator = buffer.indexOf('\n\n');
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  return { finishReason, usage };
}
