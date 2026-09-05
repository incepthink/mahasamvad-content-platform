// The general assistant behind /chat.
//
// This is intentionally separate from the publication intake pipeline. A PDF is uploaded once
// to OpenAI and read through the FILE SEARCH tool; it is never transcribed page by page
// before the officer can ask a question. Successful response ids form the chat chain, so a
// follow-up sends only the new turn instead of the document and the full transcript.
//
// The document half — uploading, the thread's vector store, indexing — lives in
// file-search.ts, whose header explains why it replaced the Responses file-input path and
// what that trade costs. What matters HERE is the consequence for the request: a document is
// no longer a `content` part at all. The model is TOLD which documents are attached and
// given a `file_search` tool over the thread's store, so an attachment it is never asked
// about costs nothing, and one it is asked about is retrieved rather than re-sent.

import { recordChatUsage } from '../cost/cost-meter.js';
import { openAiFetch } from '../http/openai-request.js';
import { readResponseStream as readOpenAiResponseStream } from '../http/openai-response-stream.js';

const RESPONSES_URL = 'https://api.openai.com/v1/responses';

// The top text tier, deliberately. Every other surface here runs on `terra` because a
// deterministic post-filter re-checks its work; /chat has none — no glossary, no coverage
// loop, no faithfulness pass — so the single call IS the product, and the officer compares it
// against whatever consumer assistant they would otherwise open. `sol` is what the article
// generator and the video writer are pinned to for the same reason (see AGENTS.md's tier
// note). Roughly 2x terra per token; the knob below is the way back down.
export const MISC_CHAT_MODEL =
  process.env.OPENAI_MISC_CHAT_MODEL ?? 'gpt-5.6-sol';

export const MISC_CHAT_SYSTEM_INSTRUCTION = `Act as a polished, general-purpose AI chat assistant embedded in Mahasamvad.

Give the user the broad, natural conversational help they would expect from a leading consumer AI chat application. Answer the request directly, be clear and useful, and adapt the depth and format to the task. Match the language the user is using unless they ask for another language. Treat supplied documents and images as context for the user's request.

Attached documents are not shown to you in full. A line listing their file names means those documents are in your file search index: use the file_search tool to read them before answering anything that depends on their contents, search again with different wording if the first result is thin, and say plainly when the document does not contain what was asked for. Images and transcribed text are supplied directly and need no search.

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

function responseTimeoutMs(): number {
  const configured = Number(process.env.OPENAI_MISC_CHAT_TIMEOUT_MS);
  return Number.isFinite(configured) && configured >= 1_000
    ? configured
    : 300_000;
}

// How many retrieved passages the model may pull per search. The default is OpenAI's, which
// is tuned for short factual lookups; a chat about a 400-page compendium wants more of the
// document in view. Every passage is billed as input tokens, so this is the cost dial.
function fileSearchMaxResults(): number {
  const configured = Number(process.env.CHAT_FILE_SEARCH_MAX_RESULTS);
  return Number.isFinite(configured) && configured >= 1
    ? Math.min(50, Math.floor(configured))
    : 20;
}

function maxOutputTokens(): number {
  const configured = Number(process.env.OPENAI_MISC_CHAT_MAX_OUTPUT_TOKENS);
  return Number.isFinite(configured) && configured >= 1_024
    ? Math.floor(configured)
    : 16_384;
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

// Exported so /chat's Qwen provider folds attachments into a turn the same way, rather
// than growing a second copy that drifts. It is also, for free, the "strip what the
// provider cannot read" rule that lane needs: only an attachment carrying extracted `text`
// contributes anything here, so an image (which reaches OpenAI as an `input_image` part)
// and a PDF (which reaches it through File Search) both fall out of the replayed
// transcript without a provider test.
export function textOf(turn: MiscChatTurn): string {
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

// The one thing a document contributes to the message now that it is not a content part: its
// NAME. Without this the model has a file_search tool and no idea there is anything in it —
// it would answer "I cannot see an attachment" about a document sitting in its own index. A
// separate part rather than appended prose, so it reads as metadata rather than as something
// the officer typed.
export function searchableDocumentsLine(turn: MiscChatTurn): string | null {
  const names = (turn.attachments ?? [])
    .filter(
      (attachment) =>
        attachment.kind === 'document' &&
        attachment.documentFileId !== undefined,
    )
    .map((attachment) => attachment.name);
  return names.length === 0
    ? null
    : `Attached documents, searchable with the file_search tool: ${names.join(', ')}`;
}

type OpenAiInputPart =
  | Readonly<{ type: 'input_text'; text: string }>
  | Readonly<{
      type: 'input_image';
      image_url: string;
      detail: 'auto';
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
  const documents = searchableDocumentsLine(turn);
  if (documents !== null) {
    parts.push({ type: 'input_text', text: documents });
  }
  for (const attachment of turn.attachments ?? []) {
    if (attachment.kind === 'image' && attachment.imageUrl) {
      parts.push({
        type: 'input_image',
        image_url: attachment.imageUrl,
        detail: 'auto',
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

// Exported for the no-network test: which tool a turn is given is the whole of this change,
// and a request that quietly stopped carrying it would look exactly like a model that had
// stopped reading attachments.
export function fileSearchTools(
  vectorStoreId: string | undefined,
): readonly Record<string, unknown>[] {
  return vectorStoreId === undefined
    ? []
    : [
        {
          type: 'file_search',
          // ONE id. The field is an array and the API accepts several, but only the first is
          // actually searched — see file-search.ts. The thread's own store is that one id.
          vector_store_ids: [vectorStoreId],
          max_num_results: fileSearchMaxResults(),
        },
      ];
}

function requestBody(
  turns: readonly MiscChatTurn[],
  previousResponseId: string | undefined,
  vectorStoreId: string | undefined,
  stream: boolean,
): Record<string, unknown> {
  const tools = fileSearchTools(vectorStoreId);
  return {
    model: MISC_CHAT_MODEL,
    instructions: MISC_CHAT_SYSTEM_INSTRUCTION,
    input: buildOpenAiResponseInput(turns, previousResponseId !== undefined),
    store: true,
    max_output_tokens: maxOutputTokens(),
    reasoning: { effort: reasoningEffort() },
    // Tools do NOT carry over on a `previous_response_id` continuation, so this is sent on
    // every turn of a thread that has documents — not only on the turn that attached one.
    // That is also what lets a follow-up question reach a PDF from three turns ago.
    ...(tools.length > 0 ? { tools, tool_choice: 'auto' } : {}),
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
  vectorStoreId: string | undefined,
  stream: boolean,
): Promise<Response> {
  return openAiFetch(RESPONSES_URL, {
    label: 'chat response',
    apiKey: apiKey(),
    lane: 'chat',
    timeoutMs: responseTimeoutMs(),
    body: requestBody(turns, previousResponseId, vectorStoreId, stream),
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

// Reading the Responses event stream is the PROVIDER's contract, not this feature's, so the
// loop lives in http/openai-response-stream.ts and the article lane's source-file call reads
// its stream with the same one. This is the /chat-shaped view of it — the generic pinned to
// this module's own response body — kept under this name because the no-network test imports
// it from here: that deltas actually reach the browser one at a time is the whole point of
// this file, and it is not something a running instance shows you twice.
export function readResponseStream(
  body: ReadableStream<Uint8Array>,
  onDelta: (chunk: string) => void,
  onText: (chunk: string) => void,
): Promise<OpenAiResponseBody | null> {
  return readOpenAiResponseStream<OpenAiResponseBody>(body, onDelta, onText);
}

// An options object rather than four positional arguments: `vectorStoreId` and
// `previousResponseId` are both optional strings, and a caller that transposed them would
// compile cleanly and search nothing.
export type MiscChatRequest = Readonly<{
  turns: readonly MiscChatTurn[];
  onDelta: (chunk: string) => void;
  previousResponseId?: string | undefined;
  // The thread's File Search store, when it has documents. Absent = no tool is offered.
  vectorStoreId?: string | undefined;
  onLifecycle?: ((event: MiscChatLifecycleEvent) => void) | undefined;
}>;

export async function streamMiscChatReply({
  turns,
  onDelta,
  previousResponseId,
  vectorStoreId,
  onLifecycle,
}: MiscChatRequest): Promise<MiscChatReply> {
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
    const response = await requestMiscChat(
      turns,
      previousResponseId,
      vectorStoreId,
      false,
    );
    return (await response.json()) as OpenAiResponseBody;
  };

  let result: OpenAiResponseBody;
  try {
    const response = await requestMiscChat(
      turns,
      previousResponseId,
      vectorStoreId,
      true,
    );
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
