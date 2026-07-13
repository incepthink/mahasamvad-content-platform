// OpenAI chat completions for article generation (PROJECT_CONTEXT step 12).
//
// gpt-4o is a strong multilingual model and handles long-form Marathi (Devanagari)
// prose well. We call the REST API directly — same style as
// embedding/openai-embeddings.ts — to avoid pulling in the OpenAI SDK.
//
// Every request goes through openAiFetch, which serializes calls process-wide and retries
// transient failures (429/5xx). Do not call fetch against api.openai.com directly.

import { openAiFetch } from '../http/openai-request.js';
import { recordChatUsage, type ChatUsage } from '../cost/cost-meter.js';

const CHAT_URL = 'https://api.openai.com/v1/chat/completions';

export const CHAT_MODEL = 'gpt-4o';

// Bound the completion so one runaway generation can't silently cost several times a
// normal run (unbounded, gpt-4o defaults to its 16,384-token ceiling). 4096 is ~2x the
// largest current output (~2,000 tk draft), so it never truncates normal output. Callers
// with a known-tighter (short JSON verifiers) or longer need can override via maxTokens.
const DEFAULT_MAX_TOKENS = 4096;

export type ChatMessage = Readonly<{
  role: 'system' | 'user' | 'assistant';
  content: string;
}>;

type ChatResponse = {
  choices: Array<{ message: { content: string | null } }>;
  usage?: ChatUsage;
};

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
    model?: string;
    maxTokens?: number;
  },
): Promise<string> {
  const model = options?.model ?? CHAT_MODEL;
  const response = await openAiFetch(CHAT_URL, {
    label: 'chat',
    apiKey: requireApiKey(),
    body: {
      model,
      messages,
      temperature: options?.temperature ?? 0.4,
      max_tokens: options?.maxTokens ?? DEFAULT_MAX_TOKENS,
      ...(options?.responseFormat
        ? { response_format: { type: options.responseFormat } }
        : {}),
    },
  });

  const body = (await response.json()) as ChatResponse;
  // Record token usage into the ambient cost meter (no-op outside a metered scope).
  recordChatUsage(model, body.usage);
  const content = body.choices[0]?.message.content;
  if (!content) {
    throw new Error('OpenAI chat response contained no content.');
  }
  return content;
}

// Vision variant: one user turn carrying a prompt plus one image. chatComplete's
// ChatMessage.content is a plain string and cannot express the multimodal content
// array, and this is the only caller that needs one — so it lives here rather than
// widening every text call site. Used to read a master template's layout off its
// pixels (references/analyze-template.ts). Cheap model by default: the answer is a
// three-field JSON description, not prose.
export const VISION_MODEL = 'gpt-4o-mini';

export async function chatCompleteVision(
  prompt: string,
  imageDataUrl: string,
  options?: {
    temperature?: number;
    responseFormat?: 'json_object';
    model?: string;
    maxTokens?: number;
  },
): Promise<string> {
  const model = options?.model ?? VISION_MODEL;
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
      temperature: options?.temperature ?? 0,
      max_tokens: options?.maxTokens ?? 600,
      ...(options?.responseFormat
        ? { response_format: { type: options.responseFormat } }
        : {}),
    },
  });

  const body = (await response.json()) as ChatResponse;
  recordChatUsage(model, body.usage);
  const content = body.choices[0]?.message.content;
  if (!content) {
    throw new Error('OpenAI vision response contained no content.');
  }
  return content;
}
