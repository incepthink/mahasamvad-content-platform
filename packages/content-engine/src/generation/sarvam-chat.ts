// Sarvam chat completions for the optional Marathi editor-polish step.
//
// Sarvam-30B is a strong Indic-language model tuned for Marathi and other Indian
// languages, used here to polish the OpenAI draft's prose (flow / official tone) only.
// Sarvam's Chat Completions API is OpenAI-compatible, so we call the REST endpoint
// directly with fetch and reuse the ChatMessage type — same style as openai-chat.ts —
// to avoid pulling in an SDK.

import type { ChatMessage } from './openai-chat.js';

// Endpoint and model are overridable via env (following the `?? 'default'` idiom used
// for the optional poster-image vars), so a different Sarvam deployment can be swapped
// in without a code change.
const SARVAM_URL =
  process.env.SARVAM_BASE_URL ?? 'https://api.sarvam.ai/v1/chat/completions';

export const SARVAM_MODEL = process.env.SARVAM_MODEL ?? 'sarvam-30b';

// Sarvam's token budget covers the model's reasoning_content AND the reply, and it
// defaults to only 2048. On a hybrid-reasoning model (sarvam-30b/sarvam-m) with thinking
// ON, that default is entirely consumed by chain-of-thought → finish_reason=length and
// empty content. So we send a generous max_tokens (env-overridable) by default.
export const SARVAM_MAX_TOKENS = Number.parseInt(
  // Fall back to the starter-tier ceiling (4096) when unset. A blank fallback here would
  // parse to NaN → `max_tokens: null` in the JSON body → Sarvam's low 2048 default (and the
  // translate path only dodged it by passing maxTokens explicitly).
  process.env.SARVAM_MAX_TOKENS ?? '4096',
  10,
);

// Reasoning ('thinking') is ON by default on these models. For a copy-edit task it adds
// little and just burns the token budget, so we disable it by default. Map the env value:
// unset / none / null / off → null (disabled); low|medium|high → pass through.
function parseReasoningEffort(raw: string | undefined): string | null {
  const value = raw?.trim().toLowerCase();
  if (!value || value === 'none' || value === 'null' || value === 'off') {
    return null;
  }
  return value;
}

export const SARVAM_REASONING_EFFORT_DEFAULT = parseReasoningEffort(
  process.env.SARVAM_REASONING_EFFORT,
);

type ChatResponse = {
  choices?: Array<{
    message?: { content?: string | null; reasoning_content?: string | null };
    finish_reason?: string;
  }>;
  error?: unknown;
};

function requireSarvamApiKey(): string {
  const key = process.env.SARVAM_API_KEY;
  if (!key) {
    throw new Error(
      'Missing required environment variable SARVAM_API_KEY. ' +
        'Copy .env.example to .env and fill it in (needed when ENABLE_SARVAM_POLISH=true).',
    );
  }
  return key;
}

// Sarvam models can be hybrid-reasoning and may prefix the answer with a
// <think>...</think> block; strip any such block so callers get only the final prose.
function stripReasoning(content: string): string {
  return content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

// Returns the assistant's message content for a single Sarvam completion. Same shape as
// chatComplete() in openai-chat.ts (Authorization: Bearer, JSON body) since the Sarvam
// API is OpenAI-compatible. Defaults to a low temperature suited to an editing task.
export async function sarvamChatComplete(
  messages: readonly ChatMessage[],
  options?: {
    temperature?: number;
    model?: string;
    maxTokens?: number;
    reasoningEffort?: string | null;
    // Anti-repetition / nucleus-sampling controls (Sarvam-supported, both -2..2 / 0..1).
    // Only sent when defined, so callers that omit them (e.g. the polish path) get an
    // unchanged request body and Sarvam's defaults (0 / 0 / 1 = no-ops).
    frequencyPenalty?: number;
    presencePenalty?: number;
    topP?: number;
  },
): Promise<string> {
  const apiKey = requireSarvamApiKey();
  const response = await fetch(SARVAM_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: options?.model ?? SARVAM_MODEL,
      messages,
      temperature: options?.temperature ?? 0.3,
      max_tokens: options?.maxTokens ?? SARVAM_MAX_TOKENS,
      // null disables thinking; low|medium|high enables it. Budget covers reasoning + reply.
      reasoning_effort:
        options?.reasoningEffort !== undefined
          ? options.reasoningEffort
          : SARVAM_REASONING_EFFORT_DEFAULT,
      // Spread each sampling control in only when provided, keeping other callers' bodies
      // byte-for-byte identical to before.
      ...(options?.frequencyPenalty !== undefined
        ? { frequency_penalty: options.frequencyPenalty }
        : {}),
      ...(options?.presencePenalty !== undefined
        ? { presence_penalty: options.presencePenalty }
        : {}),
      ...(options?.topP !== undefined ? { top_p: options.topP } : {}),
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `Sarvam chat request failed: ${response.status} ${response.statusText} — ${detail}`,
    );
  }

  const raw = await response.text();

  let body: ChatResponse;
  try {
    body = JSON.parse(raw) as ChatResponse;
  } catch {
    console.error('[sarvam] chat response was not valid JSON:', {
      status: response.status,
      body: raw.slice(0, 2000),
    });
    throw new Error(
      `Sarvam chat response was not valid JSON (status ${response.status}).`,
    );
  }

  // Strip any <think>…</think> block before checking for emptiness, so a response
  // whose content is only a reasoning block (which collapses to '') is treated as
  // "no content" and logged — rather than silently returning a blank article.
  const choice = body.choices?.[0];
  const content = choice?.message?.content
    ? stripReasoning(choice.message.content)
    : '';

  if (!content) {
    const finishReason = choice?.finish_reason;
    // The classic failure: thinking mode consumed the whole token budget, so the model
    // hit the cap before emitting any reply. Point at the exact knobs that fix it.
    const budgetHint =
      finishReason === 'length'
        ? ' The token budget was exhausted (likely by reasoning); ' +
          `raise SARVAM_MAX_TOKENS (currently ${SARVAM_MAX_TOKENS}) or set ` +
          'SARVAM_REASONING_EFFORT=none to disable thinking.'
        : '';
    console.error('[sarvam] chat response contained no usable content:', {
      status: response.status,
      finishReason,
      reasoningContentChars: choice?.message?.reasoning_content?.length ?? 0,
      error: body.error,
      body: raw.slice(0, 2000),
    });
    throw new Error(
      `Sarvam chat response contained no content ` +
        `(status ${response.status}, finish_reason=${finishReason ?? 'n/a'}).` +
        budgetHint +
        ` See the [sarvam] log above for the raw response body.`,
    );
  }

  return content;
}
