// /chat's second provider: a self-hosted Qwen served by vLLM on a Runpod pod.
//
// A TWIN of misc-chat.ts rather than a branch inside it. The two lanes agree on what a turn
// looks like and on what a finished reply is — which is why this file takes the same request
// shape, returns the same reply shape and reuses that module's `textOf` — but they disagree
// about almost everything between: OpenAI is a STATEFUL Responses call that chains on
// `previous_response_id` and reads documents through a File Search tool, while this is a
// stateless Chat Completions call that replays the transcript every turn and has no tool at
// all. Folding both into one function would mean a parameter for each of those differences
// and a body that is mostly `if (provider === …)`.
//
// What is deliberately ABSENT, and why each absence is correct rather than unfinished:
//
//   * `previousResponseId` — vLLM stores nothing, so there is no chain to continue. This is
//     also what keeps a MIXED thread honest: only the OpenAI lane writes
//     `openai_response_id`, so an OpenAI turn following a Qwen one finds a null and replays
//     the transcript instead of chaining past a turn OpenAI never saw.
//   * `vectorStoreId` — there is no File Search equivalent behind vLLM. A PDF is rejected
//     for this provider at the route; DOCX and TXT arrive as extracted text like a
//     transcript does, and `textOf` folds them in.
//   * images — `Qwen/Qwen3.8-27B` is a text model, not a VL variant.
//   * a blocking fallback — misc-chat and chatCompleteStream both retry non-streaming when
//     the stream cannot be opened, on the grounds that nothing was billed yet. Here the pod
//     is normally STOPPED, so "cannot open the stream" is the ordinary case rather than a
//     blip, and a second full-timeout attempt would only double the wait in front of the
//     error the officer actually needs to read.
//
// THINKING arrives in one of two wire shapes and the pod's start command decides which, so
// both are handled here and neither reaches the answer:
//
//   * `delta.reasoning_content`, when vLLM runs a reasoning parser. Already separated by the
//     server; the shared reader hands it over as its own channel.
//   * inline `<think>…</think>` inside the content stream, when it does not. Stripped below,
//     across chunk boundaries — the tags WILL arrive split, because nothing aligns an SSE
//     frame to them.
//
// Either way it surfaces through `onReasoning` and is never stored, which is also what keeps
// us right about history: Qwen3's own guidance is that a previous turn's thinking must not be
// replayed into a later one.

import { recordChatUsage, type ChatUsage } from '../cost/cost-meter.js';
import { QWEN_COST_PROVIDER } from '../cost/pricing.js';
import { openAiFetch } from '../http/openai-request.js';
import {
  readChatCompletionStream,
  type ChatCompletionStreamResult,
} from '../http/openai-chat-stream.js';
import {
  textOf,
  type MiscChatLifecycleEvent,
  type MiscChatTurn,
} from './misc-chat.js';
import { QwenChatError, classifyQwenFailure } from './qwen-errors.js';

// The exact string the pod's `--model` argument carries. vLLM matches the `model` field
// against it and 404s on anything else, so this is not a cosmetic default.
export const QWEN_DEFAULT_MODEL = 'Qwen/Qwen3.8-27B';

// Thinking is left ENABLED (the operator wants the model's full capability), and on Qwen3 it
// can run long before the first answer token. It is billed against the SAME `max_tokens`
// ceiling as the answer — exactly the gpt-5 `max_completion_tokens` trap — so a budget sized
// for the answer alone returns an empty completion with `finish_reason: 'length'`.
//
// This is REASONING_HEADROOM from generation/openai-chat.ts, pinned to its 'high' rung
// because there is no effort dial to read: vLLM exposes no `reasoning_effort`, and thinking
// is always on. QWEN_MAX_OUTPUT_TOKENS therefore keeps meaning "room for the ANSWER" at the
// call site, as maxTokens does everywhere else in this package.
const THINKING_HEADROOM = 16_384;

// The one read of QWEN_BASE_URL. Both the throwing accessor below and the predicate the
// provider listing needs go through it, so "configured" cannot come to mean two things.
function configuredBaseUrl(): string {
  return process.env.QWEN_BASE_URL?.trim() ?? '';
}

// Whether this deployment can offer Qwen at all.
//
// A separate question from `qwenBaseUrl()`, which answers by THROWING — right for a turn
// that is about to be sent, and wrong for a listing whose job is to report what exists. An
// unset variable is an ordinary answer there, not a failure (the GET /canva/accounts
// precedent).
export function isQwenConfigured(): boolean {
  return configuredBaseUrl() !== '';
}

// No default: a base URL cannot be guessed, and the pod id is IN it (the Runpod proxy serves
// at https://{podid}-8000.proxy.runpod.net/v1), so recreating the pod means editing this.
export function qwenBaseUrl(): string {
  const value = configuredBaseUrl();
  if (!value) {
    // Typed rather than bare, so a deployment that simply has not set this variable reaches
    // the officer as the provider being unavailable and not as an internal failure. It is
    // also the one failure here that is certain BEFORE any network call.
    throw new QwenChatError(
      'notConfigured',
      'Missing required environment variable QWEN_BASE_URL. Point it at the ' +
        "OpenAI-compatible base of the Qwen server, ending in '/v1'.",
    );
  }
  return value.replace(/\/+$/, '');
}

export function qwenChatCompletionsUrl(): string {
  return `${qwenBaseUrl()}/chat/completions`;
}

// The reachability probe below, and the one place a served model list can be read.
export function qwenModelsUrl(): string {
  return `${qwenBaseUrl()}/models`;
}

// OPTIONAL, unlike every OpenAI key in this package. vLLM started without `--api-key` serves
// unauthenticated, which is how this pod is configured, and openAiFetch reads an empty key as
// "send no authorization header" rather than as an empty bearer.
export function qwenApiKey(): string {
  return process.env.QWEN_API_KEY?.trim() ?? '';
}

export function qwenModel(): string {
  const configured = process.env.QWEN_MODEL?.trim();
  return configured ? configured : QWEN_DEFAULT_MODEL;
}

function timeoutMs(): number {
  const configured = Number(process.env.QWEN_TIMEOUT_MS);
  return Number.isFinite(configured) && configured >= 1_000
    ? Math.floor(configured)
    : 300_000;
}

// The reachability probe's own, much shorter clock. It asks one question of a box that is
// either serving or not, so a slow answer is not a slow answer — it is no answer.
function preflightTimeoutMs(): number {
  const configured = Number(process.env.QWEN_PREFLIGHT_TIMEOUT_MS);
  return Number.isFinite(configured) && configured >= 500
    ? Math.floor(configured)
    : 4_000;
}

// Room for the ANSWER. THINKING_HEADROOM is added on top when the request is built.
function maxAnswerTokens(): number {
  const configured = Number(process.env.QWEN_MAX_OUTPUT_TOKENS);
  return Number.isFinite(configured) && configured >= 1_024
    ? Math.floor(configured)
    : 8_192;
}

// The same broad assistant brief the OpenAI lane sends, minus its file_search paragraph:
// there is no such tool here, and telling a model to search an index it does not have is how
// it comes to claim it read a document it never saw. The rest is deliberately identical, so
// switching provider changes who answers and not what the assistant is.
export const QWEN_CHAT_SYSTEM_INSTRUCTION = `Act as a polished, general-purpose AI chat assistant embedded in Mahasamvad.

Give the user the broad, natural conversational help they would expect from a leading consumer AI chat application. Answer the request directly, be clear and useful, and adapt the depth and format to the task. Match the language the user is using unless they ask for another language. Treat supplied documents as context for the user's request.

Text extracted from the user's attachments is included directly in their message under the file's name. You cannot see images and cannot open files yourself; work only from the text you were given, and say plainly when it does not contain what was asked for.

Do not force requests into a DGIPR article, poster, translation, or other publishing workflow. Do not claim that this is a consumer application, and do not claim access to account data, live web information, or tools that are not actually present in this conversation. Be transparent about uncertainty and never invent facts from an attachment you cannot read.`;

// ---------------------------------------------------------------------------
// Boundary-safe <think> stripping
// ---------------------------------------------------------------------------
//
// This lives HERE, in the caller, and not in http/openai-chat-stream.ts. That module is
// strictly wire-level: `<think>` is a convention of one model family, invisible to the
// endpoint's own contract, and a stripper inside the reader would be a policy every other
// caller silently inherits. It is a caller's job to decide what its model's text means.

const THINK_OPEN = '<think>';
const THINK_CLOSE = '</think>';

// How many characters at the end of `text` could still turn out to be the start of `tag`
// once the next frame arrives. Longest match first, so `<think` holds six rather than one.
function partialTagTail(text: string, tag: string): number {
  for (let k = Math.min(tag.length - 1, text.length); k > 0; k--) {
    if (text.endsWith(tag.slice(0, k))) return k;
  }
  return 0;
}

export type ThinkingStripper = Readonly<{
  push: (chunk: string) => void;
  // A real reasoning_content frame proves that ordinary content is already the answer.
  separatedReasoning: () => void;
  // Emits whatever is still held back. A tail that never became a tag is ordinary text and
  // is delivered as such; a stream that ended inside a `<think>` block delivers the
  // remainder as thinking, which is what it was.
  flush: () => void;
}>;

/**
 * Split a content stream into answer text and thinking, tolerating a tag that arrives
 * across any number of chunks.
 *
 * Exported for the no-network test. The failure this guards against is silent: a `<think>`
 * split as `<thi` + `nk>` would leave both halves in the answer AND leave the block's whole
 * body there too, and it only shows up on the wire, under load, against the one endpoint
 * that costs money to exercise.
 *
 * Known and accepted: an answer that legitimately contains the literal `<think>` — a
 * question about these very tags — is read as a thinking block. Weighed against the
 * alternative (a model whose thinking leaks into published-facing text on every turn where
 * the pod runs no reasoning parser) that is the right way round.
 */
export function createThinkingStripper(
  onAnswer: (chunk: string) => void,
  onThinking: (chunk: string) => void,
): ThinkingStripper {
  let buffer = '';
  let inside = false;
  // Some Qwen/vLLM combinations omit the opening tag and emit only
  // `reasoning</think>answer`. Hold the initial content until its shape is known.
  let initial = true;

  const emit = (text: string): void => {
    if (text === '') return;
    if (inside) onThinking(text);
    else onAnswer(text);
  };

  return {
    push(chunk: string): void {
      buffer += chunk;
      for (;;) {
        if (initial) {
          const openAt = buffer.indexOf(THINK_OPEN);
          const closeAt = buffer.indexOf(THINK_CLOSE);
          if (openAt !== -1 && (closeAt === -1 || openAt < closeAt)) {
            const prefix = buffer.slice(0, openAt);
            if (prefix !== '') onAnswer(prefix);
            buffer = buffer.slice(openAt + THINK_OPEN.length);
            initial = false;
            inside = true;
            continue;
          }
          if (closeAt !== -1) {
            const prefix = buffer.slice(0, closeAt);
            if (prefix !== '') onThinking(prefix);
            buffer = buffer.slice(closeAt + THINK_CLOSE.length);
            initial = false;
            inside = false;
            continue;
          }
          break;
        }
        const tag = inside ? THINK_CLOSE : THINK_OPEN;
        const at = buffer.indexOf(tag);
        if (at === -1) break;
        emit(buffer.slice(0, at));
        buffer = buffer.slice(at + tag.length);
        inside = !inside;
      }
      // Everything that cannot be the beginning of the tag we are waiting for is settled
      // and goes out now; the rest waits for the next frame.
      if (initial) return;
      const hold = partialTagTail(buffer, inside ? THINK_CLOSE : THINK_OPEN);
      emit(buffer.slice(0, buffer.length - hold));
      buffer = buffer.slice(buffer.length - hold);
    },
    separatedReasoning(): void {
      if (!initial) return;
      initial = false;
      emit(buffer);
      buffer = '';
    },
    flush(): void {
      // A provider that emitted no thinking marker still gets an ordinary answer. It was
      // buffered only until the stream proved which of the two Qwen shapes it used.
      if (initial) initial = false;
      emit(buffer);
      buffer = '';
    },
  };
}

// ---------------------------------------------------------------------------
// The context budget
// ---------------------------------------------------------------------------
//
// This provider is STATELESS, so it replays the whole bounded transcript on EVERY turn where
// the OpenAI lane normally sends only the newest one and chains on `previous_response_id`.
// A limit that lane meets once, in a rare fallback, this one meets on every turn of a long
// chat — and the route's numbers are not close: it replays CHAT_HISTORY_TURNS (40) messages,
// each allowed CHAT_MESSAGE_MAX_CHARS (60,000) of typed text plus up to
// CHAT_ATTACHMENT_TEXT_MAX_CHARS (200,000) of extracted attachment text. Unbudgeted, a chat
// that has been working simply starts answering 400: vLLM validates
// `prompt_tokens + max_tokens <= max_model_len` and REFUSES, rather than quietly dropping the
// front of the prompt.
//
// CHARACTERS, NOT TOKENS, deliberately. There is no tokenizer in this package, and adding a
// dependency for one on the lane whose whole point is that it is free is the wrong trade. A
// character count is therefore an admitted PROXY, calibrated at the pessimistic end: Marathi
// runs roughly 1 token per 1.2-1.8 characters (AGENTS.md's pointer-budget note), so 1.2 is
// assumed and an English-heavy chat simply gets more headroom than it needed. Leaving part of
// the window unused costs a shorter memory; overrunning it costs the whole turn.

// A GUESS, and the one number here that ought to be replaced by a measurement. The pod's
// start command reads `--model Qwen/Qwen3.8-27B --host 0.0.0.0 --port 8000 --max-model-len …`
// and that value was truncated in the Runpod UI, so nobody has read it. 40,960 is Qwen3's
// native context length and what vLLM derives when the flag is absent, which makes it the
// smallest plausible window — assume it until someone reads the real one, and then set
// QWEN_MAX_INPUT_CHARS rather than editing this.
const ASSUMED_CONTEXT_WINDOW_TOKENS = 40_960;

const CONSERVATIVE_CHARS_PER_TOKEN = 1.2;

// The floor a configured budget is clamped to, and what makes the truncation branch below
// safe: it comfortably exceeds the system instruction plus the notice, so there is always
// room left over for a usable head of the officer's own turn.
const MIN_INPUT_CHARS = 4_000;

/**
 * How many characters of prompt this provider may send, system instruction included.
 *
 * The default is DERIVED rather than chosen, because this budget and step 3's output budget
 * spend the SAME window: `max_tokens` is reserved out of `--max-model-len` before the prompt
 * is measured, so two independently picked constants would drift into overflowing it with
 * nothing to make the coupling visible. Raise QWEN_MAX_OUTPUT_TOKENS and this shrinks by the
 * same amount on its own.
 *
 * `observedContextTokens` is the pod's REAL window, as `max_model_len` on the model entry the
 * preflight below just read. It replaces the assumption when there is one, which is the whole
 * reason the probe parses that response rather than only checking that it arrived: it turns
 * the one guessed number here into a measurement, on a round trip already being made.
 *
 * IT NEVER OVERRIDES AN EXPLICIT QWEN_MAX_INPUT_CHARS. An operator who has set that has said
 * something about this deployment that a served field cannot contradict — perhaps the pod is
 * shared, perhaps they want shorter history for latency — and silently substituting a
 * different number would make the knob look broken. Where the two disagree in the dangerous
 * direction the configured value still wins and the disagreement is logged instead, because
 * the request that follows will 400 and the officer will be told the conversation is too long.
 */
export function qwenMaxInputChars(
  observedContextTokens?: number | null,
): number {
  const windowTokens =
    typeof observedContextTokens === 'number' && observedContextTokens > 0
      ? Math.floor(observedContextTokens)
      : ASSUMED_CONTEXT_WINDOW_TOKENS;
  const reservedForOutput = maxAnswerTokens() + THINKING_HEADROOM;
  const derived = Math.max(
    MIN_INPUT_CHARS,
    Math.floor(
      (windowTokens - reservedForOutput) * CONSERVATIVE_CHARS_PER_TOKEN,
    ),
  );

  const configured = Number(process.env.QWEN_MAX_INPUT_CHARS);
  if (Number.isFinite(configured) && configured >= MIN_INPUT_CHARS) {
    const explicit = Math.floor(configured);
    // Warned about only against a MEASURED window. Warning against the assumption would cry
    // wolf on every turn of a correctly configured deployment whose pod is simply larger
    // than 40,960 — which is the case this argument exists to discover.
    if (
      typeof observedContextTokens === 'number' &&
      observedContextTokens > 0 &&
      explicit > derived
    ) {
      console.warn(
        `[qwen] QWEN_MAX_INPUT_CHARS is ${explicit}, but the pod serves a ` +
          `${windowTokens}-token window and ${reservedForOutput} tokens are reserved for ` +
          `the answer, which leaves room for about ${derived}. The configured value is ` +
          'being used as set; lower it, or lower QWEN_MAX_OUTPUT_TOKENS, if turns start ' +
          'failing as too long.',
      );
    }
    return explicit;
  }
  return derived;
}

// Addressed to the MODEL, in the language the system instruction is written in, and present
// at all because the alternative is an answer built confidently on half a document with
// nothing anywhere saying so.
const TRUNCATION_NOTICE =
  '\n\n[TRUNCATED: this message was too long to send in full and has been cut off here. ' +
  'Answer from what is above, and tell the user plainly that the supplied material is ' +
  'incomplete if the answer depends on the part that is missing.]';

// Devanagari dependent signs. A cut must never end on one: a matra separated from its
// consonant renders as a stray mark, which is the class of damage the poster and PDF paths
// exist to avoid (apps/web/lib/fileName.ts makes the same trim for the same reason).
const TRAILING_COMBINING =
  /[\u0900-\u0903\u093A-\u094D\u0951-\u0957\u0962\u0963\u200C\u200D]+$/;

// What was left out, for the log and the lifecycle. `chars` is what is actually being sent,
// so `chars <= budgetChars` is the invariant this whole section exists to hold.
export type QwenContextReport = Readonly<{
  budgetChars: number;
  chars: number;
  turnsSent: number;
  turnsDropped: number;
  // Characters removed from the newest turn. The notice is not counted here: this is how much
  // of the officer's own material did not travel.
  truncatedChars: number;
}>;

export type QwenContextFit = Readonly<{
  turns: readonly MiscChatTurn[];
  report: QwenContextReport;
}>;

/**
 * Drop whole turns, oldest first, until the request fits `budgetChars`.
 *
 * Pure and exported for the no-network test, the `combineIntakeSources` / `applyProofreadFixes`
 * shape: the budget arrives as an argument rather than being read from the environment here,
 * so every branch is reachable without setting anything.
 *
 * It measures `textOf(turn)`, which is WHAT IS ACTUALLY SENT — a turn's typed content with
 * its readable attachments folded in — and not the stored `content` column. A DOCX transcript
 * is 60,000 characters on its own and lives entirely in the attachment, so budgeting the
 * column would miss the single thing most likely to overrun the window.
 *
 * WHOLE turns, because half a pair is worse than one turn less: an answer with no question
 * above it reads to the model as something it asserted unprompted.
 */
export function fitTurnsToBudget(
  turns: readonly MiscChatTurn[],
  budgetChars: number,
): QwenContextFit {
  const budget = Math.max(MIN_INPUT_CHARS, Math.floor(budgetChars));
  // The system instruction is part of every request and is not optional, so it comes off the
  // top. This is also the decisive reason the fit lives in this module and not in the route:
  // the route would have to import another provider's prompt to budget correctly.
  let remaining = budget - QWEN_CHAT_SYSTEM_INSTRUCTION.length;

  const texts = turns.map((turn) => textOf(turn));
  const kept: { turn: MiscChatTurn; chars: number }[] = [];
  let truncatedChars = 0;

  for (let index = turns.length - 1; index >= 0; index--) {
    const turn = turns[index] as MiscChatTurn;
    const text = texts[index] as string;
    if (text.length <= remaining) {
      remaining -= text.length;
      kept.unshift({ turn, chars: text.length });
      continue;
    }
    // THE NEWEST TURN IS NEVER DROPPED. It is what the officer just typed, and a request
    // without it is not the conversation they asked for. It is CUT instead, keeping the head:
    // textOf puts their own words first and the attachments after, so the head is the question
    // and the tail is the material they can most easily reduce by attaching fewer pages.
    //
    // Refusing outright was considered and rejected. CHAT_MESSAGE_MAX_CHARS alone (60,000) can
    // exceed a conservative budget, and the schema documents pasting a whole GR into the box
    // as a normal thing to do here — so a refusal would make the free provider turn away
    // requests the paid one accepts, over a limit the officer cannot see. Delivering and
    // REPORTING is what this repo does with work it could not do in full (translate's
    // `unpreservedNames`, the article's `LengthWarning`); the cut is marked in the prompt so
    // the model can say the material is incomplete, and in the report so the log can.
    if (index === turns.length - 1) {
      const room = Math.max(1, remaining - TRUNCATION_NOTICE.length);
      const head = text.slice(0, room).replace(TRAILING_COMBINING, '');
      truncatedChars = text.length - head.length;
      const content = `${head}${TRUNCATION_NOTICE}`;
      remaining -= content.length;
      // A turn carrying only `content` and no attachments re-renders through textOf as
      // exactly this string, so the fitted transcript stays one honest MiscChatTurn[].
      kept.unshift({
        turn: { role: turn.role, content },
        chars: content.length,
      });
    }
    // Anything older ends the walk. Skipping it to try a still older turn would leave a hole
    // in the middle of the conversation, which reads worse than a shorter one.
    break;
  }

  // A transcript must not open on an answer with no question above it. The budget freed by
  // dropping the orphan is deliberately NOT refilled with the older turn that would not fit:
  // that turn is the question this very answer belonged to, so restoring it without its
  // answer would be the same defect the other way round.
  while (kept.length > 1 && kept[0]?.turn.role === 'assistant') {
    kept.shift();
  }

  return {
    turns: kept.map((entry) => entry.turn),
    report: {
      budgetChars: budget,
      chars:
        QWEN_CHAT_SYSTEM_INSTRUCTION.length +
        kept.reduce((total, entry) => total + entry.chars, 0),
      turnsSent: kept.length,
      turnsDropped: turns.length - kept.length,
      truncatedChars,
    },
  };
}

// ---------------------------------------------------------------------------
// The reachability preflight
// ---------------------------------------------------------------------------
//
// One GET of /v1/models, on a four-second clock and with no retries, before the streamed
// answer is opened.
//
// WHY AT ALL. The pod costs $2.09/hr and is stopped between sessions, so "not running" is
// this provider's ordinary state rather than an outage. Without a probe that state is
// discovered by the answer request itself, which is on a five-minute clock inside a retry
// ladder built for a rate-limited server — so an officer who picks Qwen while the box is off
// watches an empty answer for minutes before being told anything. The probe converts that
// into about a second, and into a sentence naming who can start the pod.
//
// WHY ON EVERY TURN, rather than remembering that the pod answered a minute ago. A cache
// would be wrong in exactly one direction, and it is the expensive one: it can only ever say
// "still up", and the case it would be wrong about is the operator stopping the pod by hand
// — at a moment nothing here can predict, and the moment this whole mechanism exists for. In
// the case a cache WOULD help, the pod is running and the probe is already one cheap round
// trip against a box in the same request path as the answer that follows, next to a
// generation measured in tens of seconds. Paying that every turn to never be wrong in the
// slow direction is the right way round.
//
// IT MUST NOT BECOME A NEW WAY TO REFUSE A WORKING POD. Everything it reads past "something
// answered" is treated as advisory: an unparseable body, an empty model list or a missing
// max_model_len all pass, because the probe's job is to catch a dead box quickly and not to
// second-guess a live one over a response shape we do not recognise.

// What the probe learned. Both facts are optional in effect — `maxModelLen` improves the
// context budget when present and changes nothing when absent — and both ride the lifecycle
// event, which is how the pod's real --max-model-len finally reaches the API log.
export type QwenPreflightReport = Readonly<{
  // `max_model_len` off the served model entry: the number qwenMaxInputChars() otherwise
  // has to assume. Null when the server did not report one.
  maxModelLen: number | null;
  // How many model ids the server listed. 0 means it answered in a shape we did not
  // recognise, which is deliberately not a refusal.
  modelsSeen: number;
  elapsedMs: number;
}>;

type ModelEntry = Readonly<{ id?: unknown; max_model_len?: unknown }>;

function readModelEntries(payload: unknown): readonly ModelEntry[] {
  if (typeof payload !== 'object' || payload === null) return [];
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];
  return data.filter(
    (entry): entry is ModelEntry => typeof entry === 'object' && entry !== null,
  );
}

function readMaxModelLen(entry: ModelEntry | undefined): number | null {
  const raw = entry?.max_model_len;
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return null;
  return Math.floor(raw);
}

/**
 * Confirm the pod is serving, and serving the model we are about to ask for.
 *
 * Throws a `QwenChatError` — `notConfigured`, `unreachable` or `modelMissing` — so the caller
 * never has to decide what a probe failure means. Resolves with what the response said.
 */
export async function preflightQwen(): Promise<QwenPreflightReport> {
  const url = qwenModelsUrl();
  const model = qwenModel();
  const startedAt = Date.now();

  let response: Response;
  try {
    response = await openAiFetch(url, {
      label: 'qwen preflight',
      apiKey: qwenApiKey(),
      method: 'GET',
      // The same lane the answer takes, so the probe and the request it guards queue as one
      // piece of work rather than the probe passing and the answer then waiting behind
      // somebody else's.
      lane: 'chat',
      timeoutMs: preflightTimeoutMs(),
      // NO RETRIES. A box that is switched off will still be switched off in a second, and
      // every attempt spends the whole clock in front of an officer who is watching.
      maxRetries: 0,
    });
  } catch (error) {
    // Any failure of this one GET means the pod is not usable, whatever shape it took — so
    // an unrecognised one falls back to `unreachable` rather than to the generic `failed`.
    throw classifyQwenFailure(error, 'unreachable');
  }

  let entries: readonly ModelEntry[] = [];
  try {
    entries = readModelEntries(await response.json());
  } catch {
    // A 200 whose body is not JSON is a proxy or a login page answering for the pod, not
    // vLLM. Treated as unreachable, which is what it means.
    throw new QwenChatError(
      'unreachable',
      `Qwen preflight: ${url} answered ${response.status} with a body that is not JSON, ` +
        'so nothing OpenAI-compatible is serving there.',
    );
  }

  const ids = entries
    .map((entry) => (typeof entry.id === 'string' ? entry.id : ''))
    .filter((id) => id !== '');

  // Only refuse on a list we actually read. An empty or unrecognised list is a shape
  // question, and the answer request is a better judge of it than this probe is.
  if (ids.length > 0 && !ids.includes(model)) {
    throw new QwenChatError(
      'modelMissing',
      `Qwen preflight: the server at ${url} does not serve '${model}'. ` +
        `It serves: ${ids.join(', ')}. Set QWEN_MODEL to one of those, or restart the pod ` +
        'with the model this deployment expects.',
    );
  }

  const served = entries.find((entry) => entry.id === model) ?? entries[0];
  return {
    maxModelLen: readMaxModelLen(served),
    modelsSeen: ids.length,
    elapsedMs: Date.now() - startedAt,
  };
}

// ---------------------------------------------------------------------------
// The request
// ---------------------------------------------------------------------------

type QwenMessage = Readonly<{
  role: 'system' | 'user' | 'assistant';
  content: string;
}>;

// Exported for the no-network test: that an image or a PDF leaves no trace in a replayed
// Qwen transcript is the whole of "strip what this provider cannot read", and a turn that
// quietly regrew one would look exactly like a model hallucinating about an attachment.
export function buildQwenMessages(
  turns: readonly MiscChatTurn[],
): readonly QwenMessage[] {
  return [
    { role: 'system', content: QWEN_CHAT_SYSTEM_INSTRUCTION },
    ...turns.map((turn) => ({ role: turn.role, content: textOf(turn) })),
  ];
}

// Exported for the no-network test, which is the only place the wire body is visible: the
// usage option and the headroom are both the kind of field that costs nothing to drop and
// is not noticed until an analytics figure or a long answer goes missing.
//
// `turns` are expected to be already fitted — streamQwenChatReply, the module's one entry
// point, runs fitTurnsToBudget before it calls this. Fitting here instead would mean either
// doing it twice per request or hiding from the caller how much was left out.
export function buildQwenRequestBody(
  turns: readonly MiscChatTurn[],
): Record<string, unknown> {
  return {
    model: qwenModel(),
    messages: buildQwenMessages(turns),
    stream: true,
    // Usage is otherwise absent from a streamed completion, and without it every Qwen turn
    // would be invisible to the cost meter — which counts tokens even though the rate is
    // zero (see pricing.ts).
    stream_options: { include_usage: true },
    max_tokens: maxAnswerTokens() + THINKING_HEADROOM,
  };
}

// An empty completion on a thinking model is almost always the budget trap above, and
// "contained no content" alone sends the reader looking in the wrong place. This is
// noContentError from generation/openai-chat.ts, saying the Qwen-shaped version of it.
function noAnswerError(
  finishReason: string | undefined,
  thinkingChars: number,
  contentChars: number,
): QwenChatError {
  const hint =
    finishReason === 'length'
      ? ' The completion budget was exhausted (finish_reason: length) — on a thinking ' +
        'model that usually means the reasoning consumed it; raise QWEN_MAX_OUTPUT_TOKENS.'
      : finishReason
        ? ` (finish_reason: ${finishReason})`
        : '';
  const emitted =
    thinkingChars > 0
      ? ` The model emitted ${thinkingChars} characters of thinking and no answer.`
      : contentChars > 0
        ? ` The model emitted ${contentChars} characters, none of them answer text.`
        : ' Nothing arrived on the stream.';
  // 'failed' rather than a kind of its own: the two causes here — an exhausted output budget
  // and a stream that said nothing — are an operator's knob and a transient, and the officer's
  // move in both cases is to send again or switch provider.
  return new QwenChatError(
    'failed',
    `Qwen chat response contained no content.${hint}${emitted}`,
  );
}

// misc-chat's MiscChatReply minus `responseId`. Written out rather than derived with Omit
// because the missing field is the point: there is no id to write, and never storing one on
// a Qwen turn is what keeps a mixed thread's OpenAI replay correct.
export type QwenChatReply = Readonly<{
  text: string;
  model: string;
}>;

// misc-chat's event plus what the context budget had to leave out. The route's handler is
// typed against the base event and logs the whole object, so the report reaches the API log
// with no route change — which is the point: a conversation this provider silently shortened
// has to be visible somewhere before an officer reports that the chat "forgot" something.
export type QwenChatLifecycleEvent = MiscChatLifecycleEvent &
  Readonly<{
    context?: QwenContextReport | undefined;
    // What the reachability probe saw, including the pod's real max_model_len. Carried here
    // rather than logged separately because this is how that number — the one value step 4's
    // budget currently has to assume — reaches an operator who can then set the knob.
    preflight?: QwenPreflightReport | undefined;
  }>;

// The MiscChatRequest shape, minus the two stateful/document options this provider has no
// use for, plus the thinking channel. An options object for the same reason misc-chat uses
// one: several same-typed callbacks that a caller could transpose and still compile.
export type QwenChatRequest = Readonly<{
  turns: readonly MiscChatTurn[];
  onDelta: (chunk: string) => void;
  // The model's deliberation, in whichever of the two wire shapes it arrived. Optional: a
  // caller that ignores it must still get an answer identical to one from a server that
  // never sent any.
  onReasoning?: ((chunk: string) => void) | undefined;
  onLifecycle?: ((event: QwenChatLifecycleEvent) => void) | undefined;
}>;

export async function streamQwenChatReply({
  turns,
  onDelta,
  onReasoning,
  onLifecycle,
}: QwenChatRequest): Promise<QwenChatReply> {
  const startedAt = Date.now();
  const model = qwenModel();

  // Before anything else, and before a single token of the officer's transcript is sent: is
  // the pod even on? This throws a QwenChatError carrying a Marathi sentence, in about a
  // second, where the answer request would have taken minutes to reach the same conclusion.
  const preflight = await preflightQwen();

  // The trim runs HERE rather than in the route, so no future caller can send an unbudgeted
  // transcript: the route's 40-turn slice is provider-agnostic and shared with the OpenAI
  // lane, where it is nearly free, while this budget is a property of THIS request. The
  // system instruction is also counted, and it is this module's constant.
  //
  // The probe's max_model_len is passed in, so a pod larger than the assumed 40,960 tokens
  // gets the history it can actually hold — measured on this very request rather than
  // configured from memory. An explicit QWEN_MAX_INPUT_CHARS still wins over both.
  const fit = fitTurnsToBudget(turns, qwenMaxInputChars(preflight.maxModelLen));
  if (fit.report.turnsDropped > 0 || fit.report.truncatedChars > 0) {
    console.warn(
      `[qwen] context trimmed to ${fit.report.chars}/${fit.report.budgetChars} characters: ` +
        `${fit.report.turnsDropped} older turn(s) dropped, ` +
        `${fit.report.truncatedChars} character(s) cut from the newest.`,
    );
  }
  onLifecycle?.({
    phase: 'request_started',
    // Real elapsed, not zero: the probe above has already spent some of the officer's wait,
    // and a phase that reports 0 having taken a round trip hides exactly the cost that
    // decision has to be judged on.
    elapsedMs: Date.now() - startedAt,
    answerChars: 0,
    model,
    context: fit.report,
    preflight,
  });

  let answer = '';
  let thinkingChars = 0;
  let contentChars = 0;
  const noteThinking = (chunk: string): void => {
    thinkingChars += chunk.length;
    onReasoning?.(chunk);
  };
  const stripper = createThinkingStripper((chunk) => {
    answer += chunk;
    onDelta(chunk);
  }, noteThinking);

  let response: Response;
  try {
    response = await openAiFetch(qwenChatCompletionsUrl(), {
      label: 'qwen chat',
      apiKey: qwenApiKey(),
      // The same lane as the OpenAI chat provider: a watched answer must not queue behind an
      // article generation, and an article must not queue behind it.
      lane: 'chat',
      timeoutMs: timeoutMs(),
      // ONE retry, not the transport's five. The probe above has just proved the pod is
      // serving, so a failure here is a blip or a short server-requested wait rather than a
      // switched-off box — worth one automatic attempt. Five would put up to six full
      // timeouts in front of an officer who is watching a chat and who can, unlike a pipeline
      // job, simply press send again.
      maxRetries: 1,
      body: buildQwenRequestBody(fit.turns),
    });
  } catch (error) {
    // Everything this function throws is a QwenChatError, so the route can read a Marathi
    // sentence off it without inspecting a message. A 400 naming the context window is
    // recognised HERE — the budget above counts characters as a proxy for tokens, and a proxy
    // can guess low.
    throw classifyQwenFailure(error);
  }
  const body = response.body;
  if (!body) {
    throw new QwenChatError('failed', 'Qwen chat response carried no body.');
  }

  let result: ChatCompletionStreamResult<ChatUsage>;
  try {
    result = await readChatCompletionStream<ChatUsage>(
      body,
      // The live view. What the officer sees is the STRIPPED text, so the raw stream goes
      // through the splitter and the caller's onDelta is called from its answer channel.
      (chunk) => stripper.push(chunk),
      // The accumulator. The answer is accumulated by the splitter instead, so what is kept
      // here is the size of the raw content channel — which is what distinguishes "the model
      // said nothing at all" from "the model said something, none of it an answer".
      (chunk) => {
        contentChars += chunk.length;
      },
      {
        onReasoning: (chunk) => {
          stripper.separatedReasoning();
          noteThinking(chunk);
        },
        label: 'qwen',
      },
    );
  } catch (error) {
    // A stream that breaks part-way. The pod dying mid-answer classifies as `unreachable`,
    // which is both true and the sentence that tells the officer what happened.
    throw classifyQwenFailure(error);
  } finally {
    // Even on a stream that failed part-way: a held-back tail is text the officer was shown
    // nothing of, and the route stores the partial answer because those tokens were spent.
    stripper.flush();
  }

  const { finishReason, usage } = result;
  // Counted even though a self-hosted pod is not billed per token, so the token totals still
  // report how much work went through this provider. The third argument is what keeps that
  // free: 'qwen' is in pricing.ts's UNBILLED_TEXT_PROVIDERS, so every model the pod serves
  // prices at zero — where the model id alone would fall through priceText's unknown-model
  // fallback and be charged at gpt-5.6-terra rates. It is also the row's provider wherever a
  // cost TASK is open, so this lane's work is never filed under OpenAI's name.
  recordChatUsage(model, usage, QWEN_COST_PROVIDER);
  if (answer.trim() === '') {
    throw noAnswerError(finishReason, thinkingChars, contentChars);
  }

  const elapsedMs = Date.now() - startedAt;
  // There is no second, authoritative copy of the answer to reconcile against the way the
  // Responses lane has: on Chat Completions the deltas ARE the response, so what the browser
  // saw and what is stored are the same string by construction.
  for (const phase of ['response_completed', 'response_committed'] as const) {
    onLifecycle?.({
      phase,
      elapsedMs,
      answerChars: answer.length,
      model,
      ...(finishReason !== undefined ? { status: finishReason } : {}),
    });
  }
  return { text: answer, model };
}
