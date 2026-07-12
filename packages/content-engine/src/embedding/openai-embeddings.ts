// OpenAI embeddings for Mahasamvad chunks (PROJECT_CONTEXT step 7).
//
// text-embedding-3-large is a strong multilingual model (good on Marathi/Indic).
// We call the REST API directly — same style as the scraper in
// scraping/mahasamvad-rest.ts — to avoid pulling in the OpenAI SDK.
//
// Requests go through openAiFetch (serialized + retried on 429/5xx), which also keeps the
// bulk `embed:news` ingest loop from dying partway through on a single rate-limit blip.

import { openAiFetch } from '../http/openai-request.js';
import { recordEmbeddingUsage, type EmbeddingUsage } from '../cost/cost-meter.js';

const EMBEDDINGS_URL = 'https://api.openai.com/v1/embeddings';

export const EMBEDDING_MODEL = 'text-embedding-3-large';
export const EMBEDDING_DIMENSIONS = 3072;

// Keep each request comfortably under the API's per-request input limit.
const DEFAULT_BATCH_SIZE = 100;

type EmbeddingResponse = {
  data: Array<{ index: number; embedding: number[] }>;
  usage?: EmbeddingUsage;
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
  const response = await openAiFetch(EMBEDDINGS_URL, {
    label: 'embeddings',
    apiKey,
    body: { model: EMBEDDING_MODEL, input: texts },
  });

  const body = (await response.json()) as EmbeddingResponse;
  // Record token usage into the ambient cost meter (no-op outside a metered scope).
  recordEmbeddingUsage(EMBEDDING_MODEL, body.usage);
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
