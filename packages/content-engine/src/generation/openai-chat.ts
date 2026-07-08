// OpenAI chat completions for article generation (PROJECT_CONTEXT step 12).
//
// gpt-4o is a strong multilingual model and handles long-form Marathi (Devanagari)
// prose well. We call the REST API directly with fetch — same style as
// embedding/openai-embeddings.ts — to avoid pulling in the OpenAI SDK.

const CHAT_URL = 'https://api.openai.com/v1/chat/completions';

export const CHAT_MODEL = 'gpt-4o';

export type ChatMessage = Readonly<{
  role: 'system' | 'user' | 'assistant';
  content: string;
}>;

type ChatResponse = {
  choices: Array<{ message: { content: string | null } }>;
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
  },
): Promise<string> {
  const apiKey = requireApiKey();
  const response = await fetch(CHAT_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: options?.model ?? CHAT_MODEL,
      messages,
      temperature: options?.temperature ?? 0.4,
      ...(options?.responseFormat
        ? { response_format: { type: options.responseFormat } }
        : {}),
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `OpenAI chat request failed: ${response.status} ${response.statusText} — ${detail}`,
    );
  }

  const body = (await response.json()) as ChatResponse;
  const content = body.choices[0]?.message.content;
  if (!content) {
    throw new Error('OpenAI chat response contained no content.');
  }
  return content;
}
