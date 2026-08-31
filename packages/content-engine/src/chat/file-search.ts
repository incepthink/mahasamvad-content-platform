// /chat's document backend: OpenAI Files + a File Search vector store.
//
// WHY THIS EXISTS. /chat used to hand a PDF to the Responses API as an `input_file` part,
// which puts the whole document in the request and is capped at 50 MB of file input per
// request. Officers routinely attach compendiums, scanned booklets and consolidated GRs well
// past that, and there is nothing they can do about a refusal at the door. File Search is a
// different product with a different ceiling: 512 MB per file, 5,000,000 tokens per file,
// 10,000 files per vector store.
//
// WHAT IS GIVEN UP, deliberately. `input_file` puts the ENTIRE document in the model's
// context; File Search is retrieval, so the model sees the chunks it asked for. A question
// about the whole document ("summarise this booklet") is answered from retrieved passages
// rather than from every page, and a verbatim question ("what is the exact heading on page
// 1") is a search away rather than a read away. That is the trade the size limit buys, and it
// is why the assistant instruction in misc-chat.ts tells the model to search an attachment
// before answering about it rather than assuming it can already see the whole thing.
//
// ONE VECTOR STORE PER THREAD. The `file_search` tool takes a `vector_store_ids` ARRAY, but
// in practice only the first id is searched — so a chat with three PDFs must keep all three
// in ONE store, or two of them silently stop existing. The store is created lazily on the
// first document turn (chat_threads.vector_store_id, 0049) and deleted with the thread.
//
// NOTHING HERE EVER HOLDS A WHOLE DOCUMENT. The bytes are already in the private bucket by
// the time this module is called, and they arrive as a `ChunkReader` the caller backs with a
// ranged read — see uploadOpenAiChatDocument below. Buffering a 512 MB PDF to feed a single
// multipart POST is exactly the failure the 2026-08-30 streaming work removed from the
// recording paths, and it would come straight back here.

import { openAiFetch } from '../http/openai-request.js';

const FILES_URL = 'https://api.openai.com/v1/files';
const UPLOADS_URL = 'https://api.openai.com/v1/uploads';
const VECTOR_STORES_URL = 'https://api.openai.com/v1/vector_stores';

// OpenAI's documented File Search ceiling. This is NOT our number — it is the limit of the
// backend that now reads every chat document, the same stance schemas/document.ts takes about
// its own 50 MB: a limit belongs to whoever imposes it.
export const MISC_CHAT_PDF_MAX_BYTES = 512 * 1024 * 1024;

// File Search reads a file only if it was uploaded for this purpose. `user_data` — what the
// Responses file-input path used — is silently the wrong one here: the upload succeeds and
// the vector store then refuses the file.
const FILE_SEARCH_PURPOSE = 'assistants';

// The Uploads API's own part ceiling. A part may be smaller; it may never be larger.
const MAX_PART_BYTES = 64 * 1024 * 1024;

function apiKey(): string {
  const value = process.env.OPENAI_API_KEY?.trim();
  if (!value) {
    throw new Error('Missing required environment variable OPENAI_API_KEY.');
  }
  return value;
}

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

// How much of a document is moved per request, and — because a part is read into memory to be
// posted — the ceiling on what this process holds at once. 32 MB rather than the permitted 64:
// the API box also runs Chromium and the poster renderer, and halving the part size costs one
// extra round trip per 32 MB while halving the peak.
export function uploadPartBytes(): number {
  return Math.min(
    MAX_PART_BYTES,
    readPositiveInt('OPENAI_UPLOAD_PART_BYTES', 32 * 1024 * 1024),
  );
}

function uploadTimeoutMs(): number {
  // A 32 MB part on a slow uplink is a real transfer, not a hung request.
  return readPositiveInt('OPENAI_UPLOAD_TIMEOUT_MS', 600_000);
}

// How long to wait for OpenAI to chunk and embed a document. Generous: a 400 MB scan is
// genuinely minutes of work, and the alternative to waiting is answering about a document
// that is not searchable yet — which reads as the platform ignoring the attachment.
function indexTimeoutMs(): number {
  return readPositiveInt('CHAT_VECTOR_STORE_TIMEOUT_MS', 900_000);
}

function indexPollIntervalMs(): number {
  return readPositiveInt('CHAT_VECTOR_STORE_POLL_INTERVAL_MS', 2_000);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type OpenAiChatFileHandle = Readonly<{
  id: string;
  bytes: number;
}>;

// One slice of the document, `[start, endExclusive)`. JavaScript's half-open convention, not
// S3's inclusive one — the caller converts, once, at the storage boundary.
export type ChunkReader = (
  start: number,
  endExclusive: number,
) => Promise<Buffer>;

type OpenAiFileResponse = Readonly<{ id?: unknown; bytes?: unknown }>;

function fileIdOf(payload: OpenAiFileResponse, displayName: string): string {
  if (typeof payload.id !== 'string' || payload.id === '') {
    throw new Error(
      `OpenAI accepted ${displayName} but returned no reusable file id.`,
    );
  }
  return payload.id;
}

// The whole document in one multipart POST. Used only at or below the part size, where
// holding it costs no more than a single part does anyway.
async function uploadWhole(
  displayName: string,
  data: Buffer,
): Promise<OpenAiChatFileHandle> {
  const formData = new FormData();
  formData.append('purpose', FILE_SEARCH_PURPOSE);
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
    timeoutMs: uploadTimeoutMs(),
  });
  const uploaded = (await response.json()) as OpenAiFileResponse;
  return {
    id: fileIdOf(uploaded, displayName),
    bytes:
      typeof uploaded.bytes === 'number' && Number.isFinite(uploaded.bytes)
        ? uploaded.bytes
        : data.length,
  };
}

type OpenAiUploadResponse = Readonly<{
  id?: unknown;
  file?: OpenAiFileResponse | null;
}>;

type OpenAiUploadPartResponse = Readonly<{ id?: unknown }>;

// Which slice each part covers, as half-open `[start, endExclusive)` ranges.
//
// Pulled out of the upload loop so it can be checked without a network call, because the two
// ways this can be wrong are both silent: a gap loses a stretch of the document and the
// officer gets confident answers from a file missing its middle, while an overlap makes
// Complete reject a byte count the parts do not add up to.
export function planUploadParts(
  totalBytes: number,
  partSize: number,
): readonly (readonly [number, number])[] {
  const parts: (readonly [number, number])[] = [];
  for (let offset = 0; offset < totalBytes; offset += partSize) {
    parts.push([offset, Math.min(offset + partSize, totalBytes)] as const);
  }
  return parts;
}

// The document in parts, so a 512 MB PDF costs one part of memory rather than 512 MB.
//
// Three things about this API worth not re-deriving. `bytes` is declared UP FRONT and must be
// exact — Complete fails otherwise, which is why the caller passes the byte count S3 counted
// as the file streamed in rather than anything the browser said. The parts are ordered by the
// `part_ids` array at Complete, not by the order they were sent, so this could be
// parallelised later without changing the result. And an Upload EXPIRES an hour after it is
// created, so a document slow enough to outlast that must be re-uploaded, not resumed.
async function uploadInParts(
  displayName: string,
  totalBytes: number,
  read: ChunkReader,
): Promise<OpenAiChatFileHandle> {
  const created = await openAiFetch(UPLOADS_URL, {
    label: 'chat upload create',
    apiKey: apiKey(),
    lane: 'chat',
    body: {
      bytes: totalBytes,
      filename: displayName,
      mime_type: 'application/pdf',
      purpose: FILE_SEARCH_PURPOSE,
    },
  });
  const upload = (await created.json()) as OpenAiUploadResponse;
  if (typeof upload.id !== 'string' || upload.id === '') {
    throw new Error(`OpenAI did not return an upload id for ${displayName}.`);
  }
  const uploadId = upload.id;

  const partIds: string[] = [];
  // Serial, deliberately: parts are read from S3 one at a time, so peak memory is ONE part
  // whatever the document's size. Firing them concurrently would multiply that by the
  // concurrency, for a transfer that is bandwidth-bound either way.
  for (const [offset, end] of planUploadParts(totalBytes, uploadPartBytes())) {
    const chunk = await read(offset, end);
    if (chunk.length === 0) {
      throw new Error(
        `Read an empty part of ${displayName} at ${offset}; the stored object is shorter than ${totalBytes} bytes.`,
      );
    }
    const formData = new FormData();
    formData.append(
      'data',
      new Blob([new Uint8Array(chunk)], { type: 'application/octet-stream' }),
      `${displayName}.part`,
    );
    const response = await openAiFetch(`${UPLOADS_URL}/${uploadId}/parts`, {
      label: 'chat upload part',
      apiKey: apiKey(),
      formData,
      lane: 'chat',
      timeoutMs: uploadTimeoutMs(),
    });
    const part = (await response.json()) as OpenAiUploadPartResponse;
    if (typeof part.id !== 'string' || part.id === '') {
      throw new Error(
        `OpenAI accepted a part of ${displayName} without returning its id.`,
      );
    }
    partIds.push(part.id);
  }

  const completed = await openAiFetch(`${UPLOADS_URL}/${uploadId}/complete`, {
    label: 'chat upload complete',
    apiKey: apiKey(),
    lane: 'chat',
    body: { part_ids: partIds },
  });
  const finished = (await completed.json()) as OpenAiUploadResponse;
  return { id: fileIdOf(finished.file ?? {}, displayName), bytes: totalBytes };
}

// Put a stored PDF in front of OpenAI, whatever its size.
//
// `totalBytes` is authoritative — it is what S3 counted as the file streamed through — and
// `read` hands back one slice at a time. Neither this function nor its caller ever holds the
// document whole.
export async function uploadOpenAiChatDocument(
  displayName: string,
  totalBytes: number,
  read: ChunkReader,
): Promise<OpenAiChatFileHandle> {
  if (totalBytes <= 0) {
    throw new Error(`${displayName} is empty.`);
  }
  if (totalBytes > MISC_CHAT_PDF_MAX_BYTES) {
    throw new Error(
      `OpenAI File Search is limited to 512 MB per file; ${displayName} is larger.`,
    );
  }
  return totalBytes <= uploadPartBytes()
    ? uploadWhole(displayName, await read(0, totalBytes))
    : uploadInParts(displayName, totalBytes, read);
}

// ---------------------------------------------------------------------------
// The thread's vector store
// ---------------------------------------------------------------------------

type OpenAiVectorStoreResponse = Readonly<{ id?: unknown }>;

type OpenAiVectorStoreFileResponse = Readonly<{
  id?: unknown;
  status?: unknown;
  last_error?: Readonly<{ message?: unknown }> | null;
}>;

export async function createChatVectorStore(name: string): Promise<string> {
  const response = await openAiFetch(VECTOR_STORES_URL, {
    label: 'chat vector store create',
    apiKey: apiKey(),
    lane: 'chat',
    // No `expires_after`. An expiring store would leave chat_threads.vector_store_id pointing
    // at something that no longer exists, and the next turn would then fail on a document the
    // officer can still see in the conversation. Cleanup is the thread's deletion instead.
    body: { name },
  });
  const store = (await response.json()) as OpenAiVectorStoreResponse;
  if (typeof store.id !== 'string' || store.id === '') {
    throw new Error('OpenAI did not return a vector store id.');
  }
  return store.id;
}

async function vectorStoreFileStatus(
  vectorStoreId: string,
  fileId: string,
): Promise<OpenAiVectorStoreFileResponse> {
  const response = await openAiFetch(
    `${VECTOR_STORES_URL}/${vectorStoreId}/files/${fileId}`,
    {
      label: 'chat vector store file status',
      apiKey: apiKey(),
      method: 'GET',
      lane: 'chat',
      timeoutMs: 60_000,
    },
  );
  return (await response.json()) as OpenAiVectorStoreFileResponse;
}

// ATTACHING AND WAITING ARE SEPARATE, and the reason is what each failure means. An attach
// refusal is about the FILE — most importantly, a file uploaded under the old `user_data`
// purpose, which File Search will not take — and is recoverable by uploading it again. A
// failure past that point is about the DOCUMENT or about time, and re-sending 500 MB would
// buy nothing. The caller retries only the first.
export async function attachChatDocument(
  vectorStoreId: string,
  fileId: string,
): Promise<void> {
  try {
    await openAiFetch(`${VECTOR_STORES_URL}/${vectorStoreId}/files`, {
      label: 'chat vector store attach',
      apiKey: apiKey(),
      lane: 'chat',
      body: { file_id: fileId },
    });
  } catch (error) {
    // A retried turn may be re-attaching a file that is already there, which OpenAI rejects.
    // Ask whether it IS there before treating the refusal as a failure; a genuinely absent
    // file makes this throw too, carrying the original attach error rather than the lookup's.
    await vectorStoreFileStatus(vectorStoreId, fileId).catch(() => {
      throw error;
    });
  }
}

// Wait until the file is actually searchable.
//
// The wait is the point. Attaching returns immediately with `in_progress`; a turn sent before
// the chunking finishes searches an empty document, and the model answers that it cannot find
// anything — which reads as the platform ignoring the attachment rather than as a race.
export async function awaitChatDocumentIndexed(
  vectorStoreId: string,
  fileId: string,
): Promise<void> {
  const deadline = Date.now() + indexTimeoutMs();
  for (;;) {
    const file = await vectorStoreFileStatus(vectorStoreId, fileId);
    const status = typeof file.status === 'string' ? file.status : 'unknown';
    if (status === 'completed') return;
    if (status === 'failed' || status === 'cancelled') {
      const detail =
        typeof file.last_error?.message === 'string'
          ? file.last_error.message
          : status;
      throw new Error(`OpenAI could not index the document: ${detail}.`);
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `OpenAI is still indexing the document after ${Math.round(
          indexTimeoutMs() / 1000,
        )}s.`,
      );
    }
    await sleep(indexPollIntervalMs());
  }
}

// Best-effort, called when a thread is deleted. Unlike the source objects in storage — which
// are deliberately left alone, because deleting objects on a user action is how a shared
// bucket loses something it should not have — a vector store is billed per gigabyte per day
// and nothing would ever look at this one again.
export async function deleteChatVectorStore(
  vectorStoreId: string,
): Promise<void> {
  await openAiFetch(`${VECTOR_STORES_URL}/${vectorStoreId}`, {
    label: 'chat vector store delete',
    apiKey: apiKey(),
    method: 'DELETE',
    lane: 'chat',
    timeoutMs: 60_000,
  });
}
