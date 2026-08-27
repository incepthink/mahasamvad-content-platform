// The general assistant behind /chat.
//
// This is intentionally separate from the publication intake pipeline. A PDF is uploaded
// once to OpenAI Files and supplied directly to the Responses API; it is never transcribed
// page by page before the officer can ask a question. Successful response ids form the chat
// chain, so a follow-up sends only the new turn instead of the document and full transcript.

import { recordChatUsage } from '../cost/cost-meter.js';
import { openAiFetch } from '../http/openai-request.js';

const FILES_URL = 'https://api.openai.com/v1/files';
const RESPONSES_URL = 'https://api.openai.com/v1/responses';

// The top text tier, deliberately. Every other surface here runs on `terra` because a
// deterministic post-filter re-checks its work; /chat has none — no glossary, no coverage
// loop, no faithfulness pass — so the single call IS the product, and the officer compares it
// against whatever consumer assistant they would otherwise open. `sol` is what the article
// generator and the video writer are pinned to for the same reason (see AGENTS.md's tier
// note). Roughly 2x terra per token; the knob below is the way back down.
export const MISC_CHAT_MODEL =
  process.env.OPENAI_MISC_CHAT_MODEL ?? 'gpt-5.6-sol';

// OpenAI's file upload endpoint accepts larger objects, but one Responses request accepts at
// most 50 MB of file input in total. Enforce the binding limit before paying for an upload.
export const MISC_CHAT_PDF_MAX_BYTES = 50 * 1024 * 1024;

export const MISC_CHAT_SYSTEM_INSTRUCTION = `Act as a polished, general-purpose AI chat assistant embedded in Mahasamvad.

Give the user the broad, natural conversational help they would expect from a leading consumer AI chat application. Answer the request directly, be clear and useful, and adapt the depth and format to the task. Match the language the user is using unless they ask for another language. Treat supplied documents and images as context for the user's request.

Do not force requests into a DGIPR article, poster, translation, or other publishing workflow. Do not claim that this is a consumer application, and do not claim access to account data, live web information, or tools that are not actually present in this conversation. Be transparent about uncertainty and never invent facts from an attachment you cannot read.`;

function apiKey(): string {
  const value = process.env.OPENAI_API_KEY?.trim();
  if (!value) {
    throw new Error('Missing required environment variable OPENAI_API_KEY.');
  }
  return value;
}

function reasoningEffort(): 'none' | 'low' | 'medium' | 'high' {
  const raw =
    process.env.OPENAI_MISC_CHAT_REASONING_EFFORT?.trim().toLowerCase();
  return raw === 'none' || raw === 'medium' || raw === 'high' ? raw : 'low';
}

function pdfDetail(): 'auto' | 'low' | 'high' {
  const raw = process.env.OPENAI_MISC_CHAT_PDF_DETAIL?.trim().toLowerCase();
  return raw === 'low' || raw === 'high' ? raw : 'auto';
}

function responseTimeoutMs(): number {
  const configured = Number(process.env.OPENAI_MISC_CHAT_TIMEOUT_MS);
  return Number.isFinite(configured) && configured >= 1_000
    ? configured
    : 300_000;
}

function maxOutputTokens(): number {
  const configured = Number(process.env.OPENAI_MISC_CHAT_MAX_OUTPUT_TOKENS);
  return Number.isFinite(configured) && configured >= 1_024
    ? Math.floor(configured)
    : 16_384;
}

export type OpenAiChatFileHandle = Readonly<{
  id: string;
  bytes: number;
}>;

type OpenAiFileResponse = Readonly<{
  id?: unknown;
  bytes?: unknown;
}>;

// Called when the PDF is selected, concurrently with durable private-storage upload. The
// Files API's `user_data` purpose is the documented choice for model inputs.
export async function uploadOpenAiChatDocument(
  displayName: string,
  data: Buffer,
): Promise<OpenAiChatFileHandle> {
  if (data.length > MISC_CHAT_PDF_MAX_BYTES) {
    throw new Error(
      `OpenAI direct PDF input is limited to 50 MB; ${displayName} is larger.`,
    );
  }

  const formData = new FormData();
  formData.append('purpose', 'user_data');
  formData.append(
    'file',
    new Blob([new Uint8Array(data)], { type: 'application/pdf' }),
    displayName,
  );
  const response = await openAiFetch(FILES_URL, {
    label: 'chat file upload',
    apiKey: apiKey(),
    formData,
    lane: 'chat',
    timeoutMs: responseTimeoutMs(),
  });
  const uploaded = (await response.json()) as OpenAiFileResponse;
  if (typeof uploaded.id !== 'string' || uploaded.id === '') {
    throw new Error(
      'OpenAI accepted the PDF but returned no reusable file id.',
    );
  }
  return {
    id: uploaded.id,
    bytes:
      typeof uploaded.bytes === 'number' && Number.isFinite(uploaded.bytes)
        ? uploaded.bytes
        : data.length,
  };
}

export type MiscChatTurn = Readonly<{
  role: 'user' | 'assistant';
  content: string;
  attachments?: readonly Readonly<{
    kind: 'image' | 'document' | 'audio' | 'youtube';
    name: string;
    imageUrl?: string | undefined;
    text?: string | undefined;
    documentFileId?: string | undefined;
  }>[];
}>;

function attachmentBlock(name: string, text: string): string {
  return `--- ${name} ---\n${text}`;
}

function textOf(turn: MiscChatTurn): string {
  const extracted = (turn.attachments ?? [])
    .filter((attachment) => attachment.text)
    .map((attachment) =>
      attachmentBlock(attachment.name, attachment.text ?? ''),
    );
  const body = [turn.content, ...extracted]
    .filter((part) => part.trim() !== '')
    .join('\n\n');
  return body === '' ? ' ' : body;
}

type OpenAiInputPart =
  | Readonly<{ type: 'input_text'; text: string }>
  | Readonly<{
      type: 'input_image';
      image_url: string;
      detail: 'auto';
    }>
  | Readonly<{
      type: 'input_file';
      file_id: string;
      detail: 'auto' | 'low' | 'high';
    }>;

type OpenAiInputMessage = Readonly<{
  role: 'user' | 'assistant';
  content: string | readonly OpenAiInputPart[];
}>;

function toResponseInput(turn: MiscChatTurn): OpenAiInputMessage {
  // Stored assistant rows never carry model-facing media. Keeping their content as a string
  // also makes transcript replay compatible with the full Responses message union.
  if (turn.role === 'assistant') {
    return { role: 'assistant', content: textOf(turn) };
  }

  const parts: OpenAiInputPart[] = [{ type: 'input_text', text: textOf(turn) }];
  for (const attachment of turn.attachments ?? []) {
    if (attachment.kind === 'image' && attachment.imageUrl) {
      parts.push({
        type: 'input_image',
        image_url: attachment.imageUrl,
        detail: 'auto',
      });
    } else if (attachment.kind === 'document' && attachment.documentFileId) {
      parts.push({
        type: 'input_file',
        file_id: attachment.documentFileId,
        detail: pdfDetail(),
      });
    }
  }
  return { role: 'user', content: parts };
}

// Exported for no-network tests: a stateful turn must carry only the newest user input, while
// a recovery request must faithfully replay the bounded transcript and its file handles.
export function buildOpenAiResponseInput(
  turns: readonly MiscChatTurn[],
  continuing: boolean,
): readonly OpenAiInputMessage[] {
  return (continuing ? turns.slice(-1) : turns).map(toResponseInput);
}

type OpenAiResponseUsage = Readonly<{
  input_tokens?: number;
  input_tokens_details?: Readonly<{ cached_tokens?: number }>;
  output_tokens?: number;
}>;

type OpenAiOutputContent = Readonly<{
  type?: string;
  text?: string;
  refusal?: string;
}>;

type OpenAiResponseBody = Readonly<{
  id?: string;
  model?: string;
  status?: string;
  output?: readonly Readonly<{
    type?: string;
    content?: readonly OpenAiOutputContent[];
  }>[];
  error?: Readonly<{ message?: string }> | null;
  incomplete_details?: Readonly<{ reason?: string }> | null;
  usage?: OpenAiResponseUsage;
}>;

export function textFromOpenAiResponse(response: OpenAiResponseBody): string {
  return (response.output ?? [])
    .flatMap((item) => item.content ?? [])
    .map((part) =>
      part.type === 'output_text'
        ? (part.text ?? '')
        : part.type === 'refusal'
          ? (part.refusal ?? '')
          : '',
    )
    .join('');
}

export type MiscChatReply = Readonly<{
  text: string;
  model: string;
  responseId: string;
}>;

export type MiscChatLifecycleEvent = Readonly<{
  phase: 'request_started' | 'response_completed' | 'response_committed';
  elapsedMs: number;
  answerChars: number;
  model: string;
  responseId?: string | undefined;
  status?: string | undefined;
}>;

// ---------------------------------------------------------------------------
// One native, stateful OpenAI turn
// ---------------------------------------------------------------------------
//
// The answer is STREAMED. This used to wait for an authoritative `completed` response and
// then hand the whole thing over in a single `onDelta`, which is why the officer watched a
// "विचार करत आहे…" pane for the entire answer and then saw it appear at once. The Responses
// API emits the same shape of semantic events the Chat Completions transport already parses
// (`chatCompleteStream`), so the wait was never a provider limitation.
//
// What the old comment was protecting is kept by other means. A turn that never reaches
// `completed` still THROWS, so nothing is stored as a successful answer on the strength of a
// fragment; the route stores whatever streamed alongside the error, because those tokens were
// paid for and the officer watched them arrive. And the final `response.completed` frame is
// still the authority on the text: if a delta frame is dropped, the tail is emitted before the
// turn settles, so what the browser saw is exactly what is persisted.

function requestBody(
  turns: readonly MiscChatTurn[],
  previousResponseId: string | undefined,
  stream: boolean,
): Record<string, unknown> {
  return {
    model: MISC_CHAT_MODEL,
    instructions: MISC_CHAT_SYSTEM_INSTRUCTION,
    input: buildOpenAiResponseInput(turns, previousResponseId !== undefined),
    store: true,
    max_output_tokens: maxOutputTokens(),
    reasoning: { effort: reasoningEffort() },
    ...(stream ? { stream: true } : {}),
    ...(previousResponseId ? { previous_response_id: previousResponseId } : {}),
  };
}

// Note for anyone tuning CHAT_MAX_CONCURRENCY: openAiFetch releases its lane slot when the
// RESPONSE resolves, which on a streamed call is as soon as the headers land — the body is
// then read outside the gate. So the lane still keeps chat out of the pipeline's serialized
// queue (its whole purpose) but no longer bounds how many answers are being written at once.
// `chatCompleteStream` has behaved this way since it was written; the retry ladder is what
// absorbs the resulting TPM bursts.
function requestMiscChat(
  turns: readonly MiscChatTurn[],
  previousResponseId: string | undefined,
  stream: boolean,
): Promise<Response> {
  return openAiFetch(RESPONSES_URL, {
    label: 'chat response',
    apiKey: apiKey(),
    lane: 'chat',
    timeoutMs: responseTimeoutMs(),
    body: requestBody(turns, previousResponseId, stream),
  });
}

// Why a response is not usable, in the wording the route logs behind the browser's Marathi
// failure. Shared so the streaming and blocking paths cannot disagree about it.
function incompleteReason(result: OpenAiResponseBody): string {
  return (
    result.error?.message ??
    result.incomplete_details?.reason ??
    result.status ??
    'unknown status'
  );
}

function recordUsage(
  result: OpenAiResponseBody,
  fallbackModel: string,
): string {
  const billedModel = result.model ?? fallbackModel;
  const cachedTokens = result.usage?.input_tokens_details?.cached_tokens;
  recordChatUsage(
    billedModel,
    result.usage
      ? {
          ...(result.usage.input_tokens !== undefined
            ? { prompt_tokens: result.usage.input_tokens }
            : {}),
          ...(result.usage.output_tokens !== undefined
            ? { completion_tokens: result.usage.output_tokens }
            : {}),
          ...(cachedTokens !== undefined
            ? { prompt_tokens_details: { cached_tokens: cachedTokens } }
            : {}),
        }
      : undefined,
  );
  return billedModel;
}

// One frame of the Responses event stream. Every frame carries its own `type`, so the SSE
// `event:` line is redundant and only `data:` is read — the shape `chatCompleteStream`
// already relies on.
type OpenAiStreamFrame = Readonly<{
  type?: string;
  delta?: string;
  response?: OpenAiResponseBody;
  message?: string;
  error?: Readonly<{ message?: string }> | null;
}>;

// Read the event stream, forwarding text as it is written. Resolves with the authoritative
// final response, or null when the stream ended before one arrived.
//
// Exported for the no-network test: that deltas actually reach the browser one at a time is
// the whole point of this file, and it is not something a running instance shows you twice.
export async function readResponseStream(
  body: ReadableStream<Uint8Array>,
  onDelta: (chunk: string) => void,
  onText: (chunk: string) => void,
): Promise<OpenAiResponseBody | null> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let final: OpenAiResponseBody | null = null;

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
            // A malformed frame is not worth failing a paid turn over: the completed frame
            // is the authority on the text, so a dropped delta is recovered there.
            console.warn('[openai] skipped an unparseable chat stream frame');
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
            final = frame.response ?? null;
            if (final !== null) break reading;
          } else if (frame.type === 'error') {
            const detail =
              frame.error?.message ?? frame.message ?? 'unknown error';
            throw new Error(`OpenAI chat stream failed: ${detail}.`);
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

export async function streamMiscChatReply(
  turns: readonly MiscChatTurn[],
  onDelta: (chunk: string) => void,
  previousResponseId?: string | undefined,
  onLifecycle?: ((event: MiscChatLifecycleEvent) => void) | undefined,
): Promise<MiscChatReply> {
  const startedAt = Date.now();
  const model = MISC_CHAT_MODEL;
  onLifecycle?.({
    phase: 'request_started',
    elapsedMs: 0,
    answerChars: 0,
    model,
  });

  let streamed = '';
  const onText = (chunk: string): void => {
    streamed += chunk;
  };

  // The blocking request, used only when the stream could not be opened at all. Past the
  // first token it is not an option: those tokens are billed and already on screen.
  const blocking = async (reason: unknown): Promise<OpenAiResponseBody> => {
    console.warn(
      `[openai] chat stream unavailable (${String(reason)}); falling back to a non-streaming call`,
    );
    const response = await requestMiscChat(turns, previousResponseId, false);
    return (await response.json()) as OpenAiResponseBody;
  };

  let result: OpenAiResponseBody;
  try {
    const response = await requestMiscChat(turns, previousResponseId, true);
    const body = response.body;
    if (!body) throw new Error('response carried no body');
    const streamedResult = await readResponseStream(body, onDelta, onText);
    if (streamedResult === null) {
      throw new Error('the stream ended before the response completed');
    }
    result = streamedResult;
  } catch (error) {
    if (streamed !== '') throw error;
    result = await blocking(error);
  }

  const firstTokenChars = streamed.length;
  if (result.status !== 'completed') {
    throw new Error(
      `OpenAI chat response did not complete: ${incompleteReason(result)}.`,
    );
  }
  if (!result.id) {
    throw new Error(
      'OpenAI completed the chat response without returning an id.',
    );
  }

  // The completed frame is the authority. Normally it restates exactly what streamed; when a
  // delta frame was lost — or the blocking fallback ran — the difference is emitted here, so
  // the browser's view and the stored row are the same string.
  const authoritative = textFromOpenAiResponse(result);
  let text = streamed;
  if (authoritative !== '' && authoritative !== streamed) {
    if (streamed === '' || authoritative.startsWith(streamed)) {
      const tail = authoritative.slice(streamed.length);
      if (tail !== '') onDelta(tail);
      text = authoritative;
    }
    // Otherwise the two genuinely diverge, which only a corrupted stream produces. What the
    // officer read wins: rewriting the answer under them is worse than a rare drift.
  }
  if (text.trim() === '') {
    throw new Error(
      'OpenAI completed the chat response without returning text.',
    );
  }

  const billedModel = recordUsage(result, model);
  onLifecycle?.({
    phase: 'response_completed',
    elapsedMs: Date.now() - startedAt,
    answerChars: firstTokenChars,
    model: billedModel,
    responseId: result.id,
    status: result.status,
  });
  onLifecycle?.({
    phase: 'response_committed',
    elapsedMs: Date.now() - startedAt,
    answerChars: text.length,
    model: billedModel,
    responseId: result.id,
    status: result.status,
  });
  return { text, model: billedModel, responseId: result.id };
}
