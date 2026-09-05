// What a failed Qwen turn IS, as a type rather than as a sentence to grep.
//
// This taxonomy exists because of an operational fact rather than a coding preference: the
// pod costs $2.09/hr and is normally STOPPED, so "the provider is not answering" is this
// lane's ordinary state and not an edge case. The failure path is therefore the provider's
// main user-facing surface, and it has to say something an officer can act on — which of
// "the box is switched off", "the box is on but is serving a different model" and "this
// conversation no longer fits the model's window" is true decides who the officer should
// talk to and whether pressing send again could ever help.
//
// Two messages per failure, deliberately, and they are for different readers:
//
//   * `message` (the ordinary Error message) is English, technical and as long as it needs
//     to be. It goes to the API log, carries the status, the URL and the server's own body,
//     and is what an engineer reads.
//   * `userMessage` is one short Marathi sentence naming what to do next. It is the only
//     part an officer sees.
//
// The split is not cosmetic. `apps/web/lib/errorMessage.ts` runs a WHITELIST over any
// message a route hands it — Devanagari, one line, under 240 characters, no bracket or
// URL punctuation, no unbreakable 40-character token — and replaces anything failing it
// with a canned sentence. So a diagnosis worded for an engineer does not merely read badly
// to an officer, it does not reach them at all. Every string below is written to pass that
// filter, and the test file asserts each one against a copy of its rules; if that filter is
// ever tightened, `qwen-chat.test.ts` is where the mismatch shows up.

export type QwenErrorKind =
  // QWEN_BASE_URL is unset, or the server refused our credentials. From the officer's seat
  // these are one thing — the provider is not correctly set up and only the operator can
  // fix it — so they share a message. The status is in `message` for whoever does.
  | 'notConfigured'
  // Nothing answered: the pod is stopped, the proxy returned a gateway error, or our own
  // clock ran out before a connection was made. The ordinary state of this provider.
  | 'unreachable'
  // Something answered, but it is not serving the model we asked for. vLLM matches the
  // `model` field against its own --model argument and 404s on anything else, so a pod
  // restarted with a different checkpoint — or a stale QWEN_MODEL — lands here.
  | 'modelMissing'
  // The replayed transcript plus the reserved output no longer fit --max-model-len. Made
  // unlikely by qwen-chat.ts's budget, but not impossible: that budget counts CHARACTERS as
  // a proxy for tokens, and a proxy can guess low.
  | 'contextOverflow'
  // Everything else: a stream that broke mid-answer, an empty completion, an unrecognised
  // status. Recoverable-looking, so the officer is told to try again.
  | 'failed';

// One line each, Marathi, naming an action. `Qwen` is left in Latin because it is the name
// the officer will see in the provider picker; the whitelist only requires that SOME of the
// sentence is Devanagari, not all of it.
export const QWEN_USER_MESSAGES: Readonly<Record<QwenErrorKind, string>> = {
  notConfigured:
    'Qwen सेवा अद्याप योग्य प्रकारे सेट केलेली नाही. प्रशासकाला कळवा, किंवा दुसरा प्रदाता निवडून पुन्हा पाठवा.',
  unreachable:
    'Qwen सर्व्हर सध्या बंद आहे. तो सुरू करण्यास प्रशासकाला सांगा, किंवा दुसरा प्रदाता निवडून पुन्हा पाठवा.',
  modelMissing:
    'Qwen सर्व्हर सुरू आहे, पण त्यावर हे मॉडेल उपलब्ध नाही. प्रशासकाला मॉडेलचे नाव तपासण्यास सांगा.',
  contextOverflow:
    'ही चर्चा या मॉडेलच्या मर्यादेपेक्षा मोठी झाली आहे. नवीन चॅट सुरू करा, किंवा कमी मजकूर पाठवा.',
  failed:
    'Qwen कडून उत्तर मिळाले नाही. पुन्हा प्रयत्न करा, किंवा दुसरा प्रदाता निवडा.',
};

/**
 * A Qwen failure the caller can branch on.
 *
 * `instanceof` is the check, following GeminiRequestError and ChromiumUnavailableError: one
 * copy of this package is built and every consumer imports it, so there is no realm to cross.
 * `name` is set for the same reason those set it — a pino log line otherwise says `Error`.
 */
export class QwenChatError extends Error {
  readonly kind: QwenErrorKind;
  /** One Marathi sentence, safe to put straight in front of an officer. */
  readonly userMessage: string;

  constructor(kind: QwenErrorKind, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'QwenChatError';
    this.kind = kind;
    this.userMessage = QWEN_USER_MESSAGES[kind];
  }
}

export function isQwenChatError(error: unknown): error is QwenChatError {
  return error instanceof QwenChatError;
}

// A failure with no HTTP response at all: DNS, a refused connection, a reset socket, or our
// own AbortSignal.timeout firing. undici reports every one of them as a TypeError whose
// message is the unhelpful `fetch failed` and whose real cause hangs off `.cause`, so the
// name is the reliable signal and the text is only a backstop for other runtimes.
function isTransportFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (
    error.name === 'TypeError' ||
    error.name === 'TimeoutError' ||
    error.name === 'AbortError'
  ) {
    return true;
  }
  return /fetch failed|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|socket hang up|timed out|terminated/i.test(
    error.message,
  );
}

// openAiFetch formats a non-ok response as
// `OpenAI <label> request failed: <status> <statusText> — <body>`, and that shape is a
// documented contract shared with every OpenAI caller in this package ("throws with the same
// message shape the bare fetch used to throw"), so it is read here rather than widened there
// for one provider's benefit. THIS FUNCTION IS THE ONLY PLACE IN THE PRODUCT THAT PARSES IT:
// the point of the type above is that the route does not.
const TRANSPORT_STATUS = /request failed: (\d{3})\b/;

function statusOf(error: unknown): number | null {
  if (!(error instanceof Error)) return null;
  const matched = TRANSPORT_STATUS.exec(error.message);
  if (matched === null) return null;
  const status = Number(matched[1]);
  return Number.isFinite(status) ? status : null;
}

// vLLM's own wording when `prompt_tokens + max_tokens` exceeds `--max-model-len`. It
// REFUSES rather than truncating, which is why the budget in qwen-chat.ts exists — this is
// what the officer sees when that budget's character-per-token proxy has guessed low.
//
// Matched on the text and not on the 400, because the status alone cannot tell an overflow
// from any other bad request, and because a proxy in front of the pod is free to rewrite a
// status while leaving the body alone. The phrases are vLLM's across several versions.
const CONTEXT_OVERFLOW =
  /maximum context length|max_model_len|maximum sequence length|reduce the length|longer than the maximum|tokens must be reduced|context_length_exceeded/i;

// vLLM's model-not-found body, which it serves with a 404.
const UNKNOWN_MODEL = /does not exist|model_not_found|NotFoundError/i;

/**
 * Turn anything thrown on the Qwen path into a `QwenChatError`.
 *
 * Deliberately total: every branch ends in a kind, so a caller may assume the result always
 * carries a `userMessage` and never has to invent one. An unrecognised failure is `failed`,
 * which tells the officer to try again — the right default for something we could not name.
 *
 * `fallback` lets a call site say what an unrecognised failure means IN ITS OWN CONTEXT. The
 * preflight passes `unreachable`: it is one GET against a box that is either serving or not,
 * so any failure of it means the pod is not usable, whatever shape the failure took.
 */
export function classifyQwenFailure(
  error: unknown,
  fallback: QwenErrorKind = 'failed',
): QwenChatError {
  if (isQwenChatError(error)) return error;

  const message = error instanceof Error ? error.message : String(error);
  const detail = `Qwen chat request failed: ${message}`;
  const options = error instanceof Error ? { cause: error } : undefined;

  // Checked before the status, because a body naming the context window is a diagnosis and
  // a status is only a category.
  if (CONTEXT_OVERFLOW.test(message)) {
    return new QwenChatError('contextOverflow', detail, options);
  }
  if (isTransportFailure(error)) {
    return new QwenChatError('unreachable', detail, options);
  }

  const status = statusOf(error);
  if (status !== null) {
    // A 404 from an OpenAI-compatible server is about the model, not about the path: the
    // path is fixed and correct, and vLLM's own 404 body names the model it does not have.
    if (status === 404 || UNKNOWN_MODEL.test(message)) {
      return new QwenChatError('modelMissing', detail, options);
    }
    // Credentials, which this pod may or may not want. vLLM started without --api-key
    // serves unauthenticated; started WITH one, it rejects the empty header we send.
    if (status === 401 || status === 403) {
      return new QwenChatError('notConfigured', detail, options);
    }
    // A gateway status is the Runpod proxy answering for a pod that is not there. 5xx from
    // vLLM itself lands here too and means much the same to an officer: nothing usable is
    // serving right now.
    if (status === 502 || status === 503 || status === 504 || status >= 520) {
      return new QwenChatError('unreachable', detail, options);
    }
  }

  return new QwenChatError(fallback, detail, options);
}
