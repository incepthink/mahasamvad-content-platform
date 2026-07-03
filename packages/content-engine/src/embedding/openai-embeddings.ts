// OpenAI embeddings for Mahasamvad chunks (PROJECT_CONTEXT step 7).
//
// text-embedding-3-large is a strong multilingual model (good on Marathi/Indic).
// We call the REST API directly with fetch — same style as the scraper in
// scraping/mahasamvad-rest.ts — to avoid pulling in the OpenAI SDK.

const EMBEDDINGS_URL = 'https://api.openai.com/v1/embeddings';

export const EMBEDDING_MODEL = 'text-embedding-3-large';
export const EMBEDDING_DIMENSIONS = 3072;

// Keep each request comfortably under the API's per-request input limit.
const DEFAULT_BATCH_SIZE = 100;

type EmbeddingResponse = {
  data: Array<{ index: number; embedding: number[] }>;
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

async function embedBatch(texts: string[], apiKey: string): Promise<number[][]> {
  const response = await fetch(EMBEDDINGS_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: texts }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `OpenAI embeddings request failed: ${response.status} ${response.statusText} — ${detail}`,
    );
  }

  const body = (await response.json()) as EmbeddingResponse;
  // The API may return items out of order; sort by index to realign with input.
  return body.data
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((item) => item.embedding);
}

// Embed texts in input order. Batches to stay within request limits.
export async function embedTexts(
  texts: readonly string[],
  batchSize = DEFAULT_BATCH_SIZE,
): Promise<number[][]> {
  const apiKey = requireApiKey();
  const embeddings: number[][] = [];
  for (let start = 0; start < texts.length; start += batchSize) {
    const batch = texts.slice(start, start + batchSize);
    embeddings.push(...(await embedBatch(batch, apiKey)));
  }
  return embeddings;
}
