// OpenAI chat completions for article generation (PROJECT_CONTEXT step 12).
//
// Every OpenAI text/vision call in this repo runs on the gpt-5.6 family: terra for
// authoring and judgement (long-form Marathi prose, coverage/faithfulness, poster copy,
// reading a poster's pixels), luna for mechanical work (tie-breaks, offline data prep).
// Both handle Devanagari without the Latin-script leakage gpt-4o-mini showed. We call the
// REST API directly — same style as embedding/openai-embeddings.ts — to avoid pulling in
// the OpenAI SDK.
//
// Every request goes through openAiFetch, which serializes calls process-wide and retries
// transient failures (429/5xx). Do not call fetch against api.openai.com directly.

import { openAiFetch } from '../http/openai-request.js';
import { recordChatUsage, type ChatUsage } from '../cost/cost-meter.js';

const CHAT_URL = 'https://api.openai.com/v1/chat/completions';

// The three model tiers, all env-configurable so a future model swap is an .env edit and
// not a code change. Setting all three back to their gpt-4o predecessors
// (OPENAI_CHAT_MODEL=gpt-4o, OPENAI_UTILITY_MODEL=gpt-4o-mini,
// OPENAI_VISION_MODEL=gpt-4o-mini) restores the pre-5.6 behaviour exactly, because the
// pre-gpt-5 request body below is preserved byte-for-byte.

// Authoring + judgement: anything that writes or grades Marathi prose. The default for
// every caller that does not pass `model`.
export const CHAT_MODEL = process.env.OPENAI_CHAT_MODEL ?? 'gpt-5.6-terra';

// Mechanical work whose output is a short structured answer a later deterministic step
// re-checks anyway — ranking tie-breaks, page-instruction parsing, offline corpus prep.
export const UTILITY_MODEL = process.env.OPENAI_UTILITY_MODEL ?? 'gpt-5.6-luna';

// The explainer-video pipeline's authoring tier: planning scenes, writing/grading the
// narration and shortening lines are the judgement-heaviest Marathi work in the repo, so
// the /video TEXT calls are pinned one step up from CHAT_MODEL. TEXT only — the clips
// stay on Kling (VIDEO_CLIP_PROVIDER) and the frames on Nano Banana/Gemini
// (VIDEO_IMAGE_PROVIDER); sol just writes the plan/script/narration and the prompts those
// renderers receive. Rollback is an .env edit (OPENAI_VIDEO_MODEL=gpt-5.6-terra).
export const VIDEO_CHAT_MODEL = process.env.OPENAI_VIDEO_MODEL ?? 'gpt-5.6-sol';

// The simplified article generator's tier (ARTICLE_GENERATION_MODE=simple). That path makes
// exactly ONE call to write the whole publication-ready Marathi article, having deliberately
// dropped the editorial brief, the coverage-revision loop and the faithfulness repair that used
// to grade and rewrite the draft. All of that judgement now happens inside a single call, which
// is why it is pinned one step up from CHAT_MODEL rather than sharing it — the same reasoning
// that pinned the /video text calls. Costs ~2x terra per token but replaces up to fourteen
// calls, so an article gets cheaper, not dearer. Passed EXPLICITLY at the one call site so no
// other caller's default moves; rollback is an .env edit (OPENAI_ARTICLE_MODEL=gpt-5.6-terra),
// or ARTICLE_GENERATION_MODE=full to restore the old model and the old pipeline together.
export const ARTICLE_MODEL = process.env.OPENAI_ARTICLE_MODEL ?? 'gpt-5.6-sol';

// /dlo's key-point summary (generation/extract-pointers.ts). Enumerating every materially
// distinct topic across a 60k-char multi-article document — in source order, keeping names,
// amounts, dates and percentages verbatim, without repeating itself and without padding the
// list — is a judgement-heavy read, not the mechanical extraction it looks like. It is also
// the officer's ONLY readable view of what a 20-page scanned source actually says, and it
// steers nothing downstream that could correct it. So it is pinned one step up from
// CHAT_MODEL for the same reason /video's text calls and the simplified article generator
// are. Passed EXPLICITLY at the one call site so no other caller's default moves; rollback
// is an .env edit (OPENAI_POINTERS_MODEL=gpt-5.6-terra), which halves the per-run cost.
export const POINTERS_MODEL =
  process.env.OPENAI_POINTERS_MODEL ?? 'gpt-5.6-sol';

// Deliberation for that one call. With the separate grading passes gone, the runtime prompt's
// SILENT FINAL CHECK block is the only verification left and it runs in the reasoning stage —
// so this is the knob that replaced them, not a cosmetic default. Env-tunable because 'high'
// is a legitimate quality/latency trade for a surface where one call produces the whole
// deliverable. Values: none | low | medium | high; anything else falls back to 'medium'.
export function articleReasoningEffort(): ReasoningEffort {
  const raw = process.env.OPENAI_ARTICLE_REASONING_EFFORT?.trim().toLowerCase();
  return raw === 'none' || raw === 'low' || raw === 'medium' || raw === 'high'
    ? raw
    : 'medium';
}

// Bound the completion so one runaway generation can't silently cost several times a
// normal run (unbounded, the model defaults to its own ceiling). 4096 is ~2x the
// largest current output (~2,000 tk draft), so it never truncates normal output. Callers
// with a known-tighter (short JSON verifiers) or longer need can override via maxTokens.
//
// NOTE: maxTokens means "room for the ANSWER" at every call site. On gpt-5 the wire field
// max_completion_tokens covers reasoning tokens too, so the request adds REASONING_HEADROOM
// on top rather than making every caller pad its own number.
const DEFAULT_MAX_TOKENS = 4096;

// Headroom for the passes that emit a whole article body (draft, sectioned assembly,
// coverage/faithfulness/feedback rewrites). Now that the citizen-fact guard deliberately
// grows fact-rich articles, 4096 Devanagari tokens can genuinely bind (Marathi tokenizes
// heavily), so these callers opt into a higher ceiling; the JSON verifiers and short
// helpers keep the tight default.
export const ARTICLE_BODY_MAX_TOKENS = 8192;

export type ChatMessage = Readonly<{
  role: 'system' | 'user' | 'assistant';
  content: string;
}>;

// gpt-5.x reasoning effort. Only consulted for gpt-5* models; ignored on gpt-4o.
export type ReasoningEffort = 'none' | 'low' | 'medium' | 'high';

// Deliberation is the quality lever on gpt-5, and it replaces the one we lost: gpt-5
// rejects `temperature`, so the temperature-0 determinism that ~24 call sites relied on
// is no longer available. 'medium' is therefore the default for every caller — this
// pipeline's work is judgement-heavy (write Marathi prose, grade coverage, decide whether
// a fact is preserved), not lookup. Callers whose answer is a short mechanical choice
// pass 'low' explicitly.
const DEFAULT_REASONING_EFFORT: ReasoningEffort = 'medium';

// Extra max_completion_tokens granted purely for reasoning, so a caller's maxTokens keeps
// meaning "room for the answer". Without this, a tight cap (rank-master asks for 200
// tokens of JSON) is consumed entirely by reasoning and the call returns EMPTY content —
// which surfaces as `finish_reason: 'length'` in the error below.
const REASONING_HEADROOM: Readonly<Record<ReasoningEffort, number>> = {
  none: 0,
  low: 2_048,
  medium: 8_192,
  high: 16_384,
};

type ChatResponse = {
  choices: Array<{ message: { content: string | null }; finish_reason?: string }>;
  usage?: ChatUsage;
};

// gpt-5 request params, shared by chatComplete and chatCompleteVision: no `temperature`
// (a non-default value is a 400), `max_completion_tokens` instead of `max_tokens`, and a
// reasoning budget added on top of the caller's answer budget.
function gpt5Params(
  maxTokens: number,
  reasoningEffort: ReasoningEffort | undefined,
): Record<string, unknown> {
  const effort = reasoningEffort ?? DEFAULT_REASONING_EFFORT;
  return {
    max_completion_tokens: maxTokens + REASONING_HEADROOM[effort],
    reasoning_effort: effort,
  };
}

// An empty completion is almost always a budget miss on gpt-5 (reasoning ate the cap), and
// "response contained no content" alone sends the reader looking in the wrong place.
function noContentError(label: string, body: ChatResponse): Error {
  const finish = body.choices[0]?.finish_reason;
  const hint =
    finish === 'length'
      ? ' The completion budget was exhausted (finish_reason: length) — on gpt-5 that ' +
        'usually means reasoning consumed it; raise maxTokens or lower reasoningEffort.'
      : finish
        ? ` (finish_reason: ${finish})`
        : '';
  return new Error(`OpenAI ${label} response contained no content.${hint}`);
}

// The gpt-5 family speaks a different request dialect than gpt-4o — verified against the
// live API: `temperature` other than the default 1 is a 400, the completion cap is
// `max_completion_tokens` (not `max_tokens`), and it accepts an optional `reasoning_effort`.
// Everything before gpt-5 keeps the exact body it sent before, byte-for-byte.
export function isGpt5Model(model: string): boolean {
  return /^gpt-5/.test(model);
}

function requireApiKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    throw new Error(
      'Missing required environment variable OPENAI_API_KEY. ' +
        'Copy .env.example to .env and fill it in.',
    );
  }
  return key;
}

// Returns the assistant's message content for a single completion. Pass
// responseFormat: 'json_object' to force a JSON reply (the prompt must still ask
// for JSON) — used by copy generation, which needs structured output. Pass `model`
// to override the default (e.g. a cheaper model for bulk offline data prep, or the
// fine-tuned model id).
export async function chatComplete(
  messages: readonly ChatMessage[],
  options?: {
    temperature?: number;
    responseFormat?: 'json_object';
    // A strict json_schema (name + schema). Overrides responseFormat when both are
    // given. The poster copy path uses this to force exactly-shaped output.
    jsonSchema?: { name: string; schema: unknown };
    model?: string;
    maxTokens?: number;
    // gpt-5* only; defaults to 'medium'. Ignored on gpt-4o (no reasoning stage).
    reasoningEffort?: ReasoningEffort;
  },
): Promise<string> {
  const model = options?.model ?? CHAT_MODEL;
  const maxTokens = options?.maxTokens ?? DEFAULT_MAX_TOKENS;
  const responseFormat = options?.jsonSchema
    ? {
        response_format: {
          type: 'json_schema' as const,
          json_schema: {
            name: options.jsonSchema.name,
            strict: true,
            schema: options.jsonSchema.schema,
          },
        },
      }
    : options?.responseFormat
      ? { response_format: { type: options.responseFormat } }
      : {};
  // gpt-5* rejects `temperature` and `max_tokens`; gpt-4o keeps its exact prior body.
  const modelParams = isGpt5Model(model)
    ? gpt5Params(maxTokens, options?.reasoningEffort)
    : {
        temperature: options?.temperature ?? 0.4,
        max_tokens: maxTokens,
      };
  const response = await openAiFetch(CHAT_URL, {
    label: 'chat',
    apiKey: requireApiKey(),
    body: {
      model,
      messages,
      ...modelParams,
      ...responseFormat,
    },
  });

  const body = (await response.json()) as ChatResponse;
  // Record token usage into the ambient cost meter (no-op outside a metered scope).
  recordChatUsage(model, body.usage);
  const content = body.choices[0]?.message.content;
  if (!content) {
    throw noContentError('chat', body);
  }
  return content;
}

// Vision variant: one user turn carrying a prompt plus one image. chatComplete's
// ChatMessage.content is a plain string and cannot express the multimodal content
// array, and this is the only caller that needs one — so it lives here rather than
// widening every text call site. Used to read a master template's layout off its pixels
// (references/analyze-template.ts) and to locate the element a feedback marker points at
// (generation/interpret-image-feedback.ts). Both are careful reads of a dense Devanagari
// poster, so the default is the authoring tier, not a cheap one — gpt-4o-mini used to sit
// here and leaked Latin script into Marathi readings.
export const VISION_MODEL = process.env.OPENAI_VISION_MODEL ?? 'gpt-5.6-terra';

export async function chatCompleteVision(
  prompt: string,
  imageDataUrl: string,
  options?: {
    temperature?: number;
    responseFormat?: 'json_object';
    model?: string;
    maxTokens?: number;
    // gpt-5* only; defaults to 'medium'. Ignored on gpt-4o/gpt-4o-mini (no reasoning stage).
    reasoningEffort?: ReasoningEffort;
  },
): Promise<string> {
  const model = options?.model ?? VISION_MODEL;
  const maxTokens = options?.maxTokens ?? 600;
  // gpt-5* rejects `temperature` and `max_tokens`, exactly as in chatComplete; a pre-gpt-5
  // vision model (gpt-4o-mini) keeps the exact body it sent before.
  const modelParams = isGpt5Model(model)
    ? gpt5Params(maxTokens, options?.reasoningEffort)
    : {
        temperature: options?.temperature ?? 0,
        max_tokens: maxTokens,
      };
  const response = await openAiFetch(CHAT_URL, {
    label: 'vision',
    apiKey: requireApiKey(),
    body: {
      model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: imageDataUrl } },
          ],
        },
      ],
      ...modelParams,
      ...(options?.responseFormat
        ? { response_format: { type: options.responseFormat } }
        : {}),
    },
  });

  const body = (await response.json()) as ChatResponse;
  recordChatUsage(model, body.usage);
  const content = body.choices[0]?.message.content;
  if (!content) {
    throw noContentError('vision', body);
  }
  return content;
}
