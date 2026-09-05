// The general assistant at /chat. Thin handlers, per AGENTS.md: persist the turn, ask
// @dgipr/content-engine for the answer, stream it out. The route assembles no prompt; the
// content engine owns the one general-purpose chat instruction and OpenAI provider input.
//
// Eight routes: create/list/detail/delete a thread, send a turn (the only streaming route in
// this API), upload an image or a native PDF, and report which model providers this
// deployment offers.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  DLO_UPLOADS_BUCKET,
  POSTERS_BUCKET,
  attachChatFile,
  deleteChatThread,
  downloadFile,
  downloadFileRange,
  getChatFile,
  getChatThread,
  insertChatFile,
  insertChatMessage,
  insertChatThread,
  listChatMessages,
  listChatThreads,
  markChatFileIndexed,
  publicUrl,
  removeObjectsIn,
  updateChatThread,
  updateChatFileOpenAiHandle,
  uploadFile,
  uploadStream,
  type ChatAttachmentEntry,
  type ChatFileRow,
  type ChatMessageRow,
  type ChatThreadRow,
  type SupabaseClient,
} from '@dgipr/database';
import {
  CHAT_ATTACHMENT_TEXT_MAX_CHARS,
  CHAT_HISTORY_TURNS,
  CHAT_MAX_ATTACHMENTS,
  DEFAULT_CHAT_PROVIDER,
  SendChatMessageRequestSchema,
  chatTitleFrom,
  imageMimeForFileName,
  isImageFileName,
  type ChatAttachment,
  type ChatMessage,
  type ChatProviderInfo,
  type ChatStreamEvent,
  type ChatThreadDetail,
  type ChatThreadSummary,
} from '@dgipr/schemas';
import {
  attachChatDocument,
  awaitChatDocumentIndexed,
  chatProviderCapabilities,
  chatProviders,
  createChatVectorStore,
  createCostAccumulator,
  deleteChatVectorStore,
  isQwenChatError,
  MISC_CHAT_PDF_MAX_BYTES,
  runInCostScope,
  streamMiscChatReply,
  streamQwenChatReply,
  totalCostUsd,
  uploadOpenAiChatDocument,
  type MiscChatTurn,
  type OpenAiChatFileHandle,
  type QwenChatLifecycleEvent,
} from '@dgipr/content-engine';
import { isAllowedOrigin } from '../cors-origins.js';

// Images retain the repository's unlimited upload posture. A chat PDF is bounded by the
// backend that reads it — OpenAI File Search accepts 512 MB per file — so the route refuses
// only what the provider itself would. Publishing intake keeps its chunk/OCR contract.
const ATTACHMENT_MAX_BYTES = Number.POSITIVE_INFINITY;

// Storage object names must be ASCII-safe (the transcriptions precedent); a display name may
// be entirely Devanagari. The random prefix is what keeps two photographs called `IMG_1.jpg`
// apart — chat images are not versioned, so a collision would silently show one officer
// another's picture.
function imagePathFor(name: string): string {
  const safe = name.replace(/[^a-zA-Z0-9._-]/g, '_') || 'image';
  const token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `chat/${token}-${safe}`;
}

function documentPathFor(name: string): string {
  const safe = name.replace(/[^a-zA-Z0-9._-]/g, '_') || 'document.pdf';
  const token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `chat-documents/${token}-${safe}`;
}

function toSummary(row: ChatThreadRow): ChatThreadSummary {
  return {
    id: row.id,
    title: row.title,
    messageCount: row.messageCount,
    lastMessageAt: row.lastMessageAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toMessage(row: ChatMessageRow): ChatMessage {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    attachments: row.attachments.map((attachment) => ({
      kind: attachment.kind,
      name: attachment.name,
      ...(attachment.imageUrl !== undefined
        ? { imageUrl: attachment.imageUrl }
        : {}),
      // The extracted text is NOT sent back. It can be a whole scanned booklet, the bubble
      // renders a chip rather than the text, and the model reads it from the row server-side.
      // `chars` is what the chip shows instead.
      ...(attachment.chars !== undefined ? { chars: attachment.chars } : {}),
      ...(attachment.sourceUrl !== undefined
        ? { sourceUrl: attachment.sourceUrl }
        : {}),
    })),
    model: row.model,
    costUsd: row.costUsd,
    error: row.error,
    createdAt: row.createdAt,
  };
}

// Store only what each kind actually needs, and never trust the client for the rest. An
// `imageUrl` is accepted ONLY if it points at our own public bucket: the field is otherwise a
// standing invitation to make the model fetch an arbitrary URL on the caller's behalf.
async function toStoredAttachment(
  client: SupabaseClient,
  threadId: string,
  attachment: ChatAttachment,
  imageUrlPrefix: string,
): Promise<ChatAttachmentEntry | null> {
  if (attachment.kind === 'image') {
    if (!attachment.imageUrl?.startsWith(imageUrlPrefix)) return null;
    return {
      kind: 'image',
      name: attachment.name,
      imageUrl: attachment.imageUrl,
    };
  }

  if (attachment.kind === 'document' && attachment.documentId) {
    const file = await attachChatFile(client, attachment.documentId, threadId);
    if (!file) return null;
    return {
      kind: 'document',
      name: file.displayName,
      documentId: file.id,
    };
  }

  // Old clients and non-PDF documents still use extracted text. Native PDFs deliberately
  // carry no text: OpenAI reads the stored Files API object directly.
  const text = attachment.text ?? '';
  if (text.trim() === '') return null;
  return {
    kind: attachment.kind,
    name: attachment.name,
    text,
    chars: text.length,
    ...(attachment.sourceUrl !== undefined
      ? { sourceUrl: attachment.sourceUrl }
      : {}),
  };
}

// A stored PDF, read out of the private bucket one slice at a time. This is what keeps a
// 512 MB document from ever being assembled in this process — the 2026-08-30 recording rule
// applied to the one upload path that still buffered.
function storedChunkReader(
  client: SupabaseClient,
  storagePath: string,
): (start: number, endExclusive: number) => Promise<Buffer> {
  // S3 ranges are inclusive; the engine speaks the half-open convention. Converted here, at
  // the storage boundary, and nowhere else.
  return (start, endExclusive) =>
    downloadFileRange(
      client,
      DLO_UPLOADS_BUCKET,
      storagePath,
      start,
      endExclusive - 1,
    );
}

async function ensureOpenAiFile(
  client: SupabaseClient,
  file: ChatFileRow,
): Promise<ChatFileRow> {
  if (file.openAiFileId !== null) return file;

  // Gemini-era rows have only the durable private copy. Upgrade them lazily so an old chat
  // remains usable without asking the officer to upload its PDF again. Read whole rather than
  // in parts: every row that can reach this branch predates File Search and is therefore
  // inside the 50 MB ceiling that was in force when it was accepted.
  const data = await downloadFile(client, DLO_UPLOADS_BUCKET, file.storagePath);
  const handle = await uploadOpenAiChatDocument(
    file.displayName,
    data.length,
    async (start, endExclusive) => data.subarray(start, endExclusive),
  );
  return updateChatFileOpenAiHandle(client, file.id, {
    openAiFileId: handle.id,
    bytes: handle.bytes,
  });
}

// Index one file into the thread's store, re-uploading it first if OpenAI refuses to ATTACH
// it.
//
// THE REFUSAL THIS EXISTS FOR IS THE 0048 MIGRATION. Files uploaded before this change carry
// `purpose: 'user_data'`, which the Responses file-input path required and which File Search
// rejects outright — so every PDF in every chat that predates this deploy would otherwise be
// permanently unreadable. The durable object is still in the private bucket, so the recovery
// is simply to upload it again under the right purpose.
//
// ONLY the attach is retried, which is why file-search.ts splits attaching from waiting. A
// failure past the attach is about the document itself or about time, and re-sending half a
// gigabyte to meet it would spend the officer's bandwidth to reproduce the same error.
async function indexIntoStore(
  client: SupabaseClient,
  vectorStoreId: string,
  file: ChatFileRow,
): Promise<ChatFileRow> {
  if (file.vectorStoreId === vectorStoreId) return file;
  const fileId = file.openAiFileId;
  if (fileId === null) return file;

  let current = file;
  try {
    await attachChatDocument(vectorStoreId, fileId);
  } catch (error) {
    console.warn(
      `[chat] re-uploading ${file.id} for file search: ${String(error)}`,
    );
    const bytes =
      file.bytes ??
      (await downloadFile(client, DLO_UPLOADS_BUCKET, file.storagePath)).length;
    const handle = await uploadOpenAiChatDocument(
      file.displayName,
      bytes,
      storedChunkReader(client, file.storagePath),
    );
    current = await updateChatFileOpenAiHandle(client, file.id, {
      openAiFileId: handle.id,
      bytes: handle.bytes,
    });
    await attachChatDocument(vectorStoreId, handle.id);
  }

  await awaitChatDocumentIndexed(vectorStoreId, current.openAiFileId as string);
  await markChatFileIndexed(client, current.id, vectorStoreId);
  return { ...current, vectorStoreId };
}

// The thread's File Search store, created on the first turn that carries a document.
//
// Re-read immediately before creating, so two turns racing in the same thread are very
// unlikely to mint two stores. Not a lock — there is no row to lock and a chat has one person
// typing into it — and the cost of losing that race is one empty vector store, not a wrong
// answer.
async function ensureThreadVectorStore(
  client: SupabaseClient,
  thread: ChatThreadRow,
): Promise<string> {
  if (thread.vectorStoreId !== null) return thread.vectorStoreId;
  const fresh = await getChatThread(client, thread.id);
  if (fresh?.vectorStoreId) return fresh.vectorStoreId;
  const vectorStoreId = await createChatVectorStore(`chat-${thread.id}`);
  await updateChatThread(client, thread.id, { vectorStoreId });
  return vectorStoreId;
}

type ThreadDocuments = Readonly<{
  // Passed to the model as the file_search tool's one store. Null when the thread has never
  // carried a document, which offers no tool at all.
  vectorStoreId: string | null;
  // chat_files id -> OpenAI file id, for documents that are searchable RIGHT NOW. Only these
  // are named to the model: a file listed but not indexed is one the model would search for
  // and fail to find, which is worse than not mentioning it at all.
  searchable: ReadonlyMap<string, string>;
}>;

// Make every document in these rows searchable, creating the store if this is the first one.
//
// Called with the WHOLE recent transcript rather than only the new turn, deliberately: a
// follow-up question can be about a PDF attached three turns ago, and the tool reaches it
// only because it is in the same store. After the first time this is nearly free — a file
// already carrying this store's id is skipped without a request.
async function prepareThreadDocuments(
  client: SupabaseClient,
  thread: ChatThreadRow,
  rows: readonly ChatMessageRow[],
): Promise<ThreadDocuments> {
  const documentIds = [
    ...new Set(
      rows.flatMap((row) =>
        row.attachments.flatMap((attachment) =>
          attachment.documentId ? [attachment.documentId] : [],
        ),
      ),
    ),
  ];
  if (documentIds.length === 0) {
    // No documents in view, but an earlier turn may still have put one in the store — keep
    // offering the tool so "what did that PDF say about X?" works with nothing attached.
    return { vectorStoreId: thread.vectorStoreId, searchable: new Map() };
  }

  const vectorStoreId = await ensureThreadVectorStore(client, thread);
  const searchable = new Map<string, string>();
  // Serial: indexing is a poll loop against OpenAI, and running several at once would put
  // this request's slowest document behind the others rather than beside them.
  for (const id of documentIds) {
    const row = await getChatFile(client, id);
    if (!row || row.threadId !== thread.id) continue;
    const uploaded = await ensureOpenAiFile(client, row);
    const indexed = await indexIntoStore(client, vectorStoreId, uploaded);
    if (indexed.vectorStoreId === vectorStoreId && indexed.openAiFileId) {
      searchable.set(indexed.id, indexed.openAiFileId);
    }
  }
  return { vectorStoreId, searchable };
}

function isMissingPreviousResponse(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    /OpenAI chat response request failed: (?:400|404)\b/.test(message) &&
    /previous_response_id|response.+(?:not found|does not exist|expired)/i.test(
      message,
    )
  );
}

// A stored row as the model should see it. Note `content` and the attachments stay separate —
// misc-chat.ts folds them together, because how a turn is presented to the model is its
// business, not the route's. A document's `documentFileId` is now a PRESENCE marker: its
// bytes reach the model through file search, and this is what says the file is in the index.
function toTurn(
  row: ChatMessageRow,
  documentFileIds: ReadonlyMap<string, string>,
): MiscChatTurn {
  return {
    role: row.role,
    content: row.content,
    attachments: row.attachments.map((attachment) => ({
      kind: attachment.kind,
      name: attachment.name,
      imageUrl: attachment.imageUrl,
      text: attachment.text,
      documentFileId:
        attachment.documentId !== undefined
          ? documentFileIds.get(attachment.documentId)
          : undefined,
    })),
  };
}

// ---------------------------------------------------------------------------
// SSE
// ---------------------------------------------------------------------------
//
// Writing to `reply.raw` bypasses Fastify's reply pipeline entirely, which costs two things
// that must be put back by hand or the stream fails in ways that look nothing like their cause:
//
//   1. CORS. @fastify/cors sets its header on the Fastify reply, and a raw writeHead never
//      sends it — so the browser rejects a stream the server is producing perfectly. The
//      origin is echoed only if it is one the app already allows.
//   2. Buffering. Without `X-Accel-Buffering: no` a reverse proxy (our Caddy) may hold the
//      whole response and deliver it in one lump — which streams fine locally and arrives all
//      at once in production, the worst place to discover it.
function openEventStream(request: FastifyRequest, reply: FastifyReply): void {
  const origin = request.headers.origin;
  const headers: Record<string, string> = {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  };
  if (origin !== undefined && isAllowedOrigin(origin)) {
    headers['access-control-allow-origin'] = origin;
    headers.vary = 'Origin';
  }
  reply.hijack();
  reply.raw.writeHead(200, headers);
  // Flush the headers immediately so the browser's fetch resolves and the client can start
  // reading, rather than waiting for the model's first token.
  reply.raw.flushHeaders?.();
}

function sendEvent(reply: FastifyReply, event: ChatStreamEvent): void {
  if (reply.raw.writableEnded) return;
  reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
}

export function registerChatRoutes(
  app: FastifyInstance,
  client: SupabaseClient,
): void {
  // The prefix every accepted image URL must carry. Derived from the same helper that
  // produced it, so a storage or bucket reconfiguration cannot leave the guard behind.
  const imageUrlPrefix = publicUrl(client, 'chat/');

  // Which model providers this deployment offers, and what each may be given. Fetched once
  // by the composer, exactly as GET /api/canva/accounts is, and for the same reason: which
  // providers exist is a runtime server fact, and a NEXT_PUBLIC_* build-time duplicate drifts
  // the moment .env changes on the API box. Ids, labels and capabilities only — a self-hosted
  // endpoint's URL and key never leave the server.
  //
  // The list is always non-empty (OpenAI is what the rest of the product runs on), so an
  // empty answer means the request failed rather than that chat is unavailable.
  app.get('/chat/providers', async () => {
    const providers: ChatProviderInfo[] = chatProviders();
    return providers;
  });

  app.post('/chat/threads', async (_request, reply) => {
    const row = await insertChatThread(client);
    return reply.code(201).send({ id: row.id });
  });

  // The rail. Every chat, most recently talked to first — there is no auth and no owner
  // column, so this is deliberately everyone's; the web splits it for ordering only.
  app.get('/chat/threads', async () => {
    const rows = await listChatThreads(client);
    return rows.map(toSummary);
  });

  app.get<{ Params: { id: string } }>(
    '/chat/threads/:id',
    async (request, reply) => {
      const thread = await getChatThread(client, request.params.id);
      if (!thread) {
        return reply
          .code(404)
          .send({ error: { message: 'ही चॅट सापडली नाही.' } });
      }
      const messages = await listChatMessages(client, thread.id);
      const detail: ChatThreadDetail = {
        ...toSummary(thread),
        messages: messages.map(toMessage),
      };
      return detail;
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/chat/threads/:id',
    async (request, reply) => {
      const thread = await getChatThread(client, request.params.id);
      if (!thread) {
        return reply
          .code(404)
          .send({ error: { message: 'ही चॅट सापडली नाही.' } });
      }
      // The messages and chat_files rows go with it (0044/0046 cascades). Uploaded source
      // objects are deliberately left in storage: deleting objects on a user action is how a
      // shared bucket loses something it should not have.
      //
      // The VECTOR STORE is the exception, and the difference is billing, not principle: a
      // stored object costs a fraction of a cent a month and might still be wanted, while a
      // vector store is charged per gigabyte per day for an index nothing can reach any more.
      // Best-effort and FIRST, so a provider outage costs an orphaned index rather than a
      // thread the officer asked to delete and which is still sitting in their rail.
      if (thread.vectorStoreId !== null) {
        try {
          await deleteChatVectorStore(thread.vectorStoreId);
        } catch (error) {
          request.log.warn(
            { err: error, threadId: thread.id },
            'chat vector store could not be deleted',
          );
        }
      }
      await deleteChatThread(client, thread.id);
      return reply.code(204).send();
    },
  );

  // One image, stored and handed back as a public URL. Separate from the turn route so a
  // photograph uploads while the officer is still typing — by send time the attachment is
  // already a URL and the turn is an ordinary JSON request.
  app.post('/chat/attachments/image', async (request, reply) => {
    const file = await request.file({
      limits: { fileSize: ATTACHMENT_MAX_BYTES, files: 1 },
    });
    if (!file) {
      return reply.code(400).send({ error: { message: 'फाईल मिळाली नाही.' } });
    }
    const name = file.filename ?? '';
    if (!isImageFileName(name)) {
      return reply.code(400).send({
        error: { message: 'फक्त JPG, PNG किंवा WEBP चित्रे स्वीकारली जातात.' },
      });
    }
    let data: Buffer;
    try {
      data = await file.toBuffer();
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'FST_REQ_FILE_TOO_LARGE'
      ) {
        return reply
          .code(413)
          .send({ error: { message: 'चित्र खूप मोठे आहे.' } });
      }
      throw error;
    }

    const path = imagePathFor(name);
    await uploadFile(
      client,
      POSTERS_BUCKET,
      path,
      data,
      // Extension-driven rather than the browser's reported type, exactly as the audio and
      // photograph paths elsewhere do; isImageFileName above guarantees a hit.
      imageMimeForFileName(name) ?? 'image/jpeg',
    );
    return { name, imageUrl: publicUrl(client, path) };
  });

  // A PDF is staged as soon as it is selected, before the officer presses Send, so the slow
  // part overlaps with the time they spend typing.
  //
  // TWO HOPS, AND NEITHER HOLDS THE FILE. The part streams from the wire straight into the
  // private bucket, and the bucket then feeds OpenAI one range at a time. Until this change
  // the route did `await file.toBuffer()` and posted the result — fine at the old 50 MB
  // ceiling, and ~1 GB of resident memory at File Search's 512 MB one, which is precisely
  // how a 239.6 MB recording OOM-killed this container on 2026-08-30.
  //
  // The durable private copy is not a convenience here either: it is what `ensureOpenAiFile`
  // re-uploads from for a legacy row, and what `indexIntoStore` re-uploads from when OpenAI
  // refuses a file uploaded under the old `user_data` purpose.
  app.post('/chat/attachments/document', async (request, reply) => {
    const file = await request.file({
      limits: { fileSize: MISC_CHAT_PDF_MAX_BYTES, files: 1 },
    });
    if (!file) {
      return reply.code(400).send({ error: { message: 'फाईल मिळाली नाही.' } });
    }
    const name = file.filename ?? '';
    if (!name.toLowerCase().endsWith('.pdf')) {
      return reply.code(400).send({
        error: { message: 'या जलद दस्तऐवज मार्गावर फक्त PDF स्वीकारली जाते.' },
      });
    }

    const storagePath = documentPathFor(name);
    // Anything already written for a row that may still never exist. The transcriptions
    // precedent: an abandoned object is invisible to the product and nothing comes back for it.
    const discardStaged = async (): Promise<void> => {
      try {
        await removeObjectsIn(client, DLO_UPLOADS_BUCKET, [storagePath]);
      } catch (error) {
        request.log.warn(
          { err: error, storagePath },
          'chat document could not be discarded',
        );
      }
    };

    let bytes: number;
    try {
      bytes = await uploadStream(
        client,
        DLO_UPLOADS_BUCKET,
        storagePath,
        file.file,
        'application/pdf',
      );
    } catch (error) {
      await discardStaged();
      // Reached by a browser that vanished mid-upload as well as by the size limit above.
      // The MESSAGE is checked as well as the code because uploadStream wraps whatever
      // failed the pipe in its own Error, which carries the text but not the property.
      if (
        (typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          error.code === 'FST_REQ_FILE_TOO_LARGE') ||
        (error instanceof Error &&
          error.message.includes('FST_REQ_FILE_TOO_LARGE'))
      ) {
        return reply.code(413).send({
          error: { message: 'PDF ५१२ MB पेक्षा मोठी असू शकत नाही.' },
        });
      }
      throw error;
    }

    // busboy TRUNCATES a part that hits the size limit rather than erroring, so without this
    // an over-long PDF would be stored and indexed as if it were the whole document — and the
    // officer would get confident answers from a document missing its second half.
    if (file.file.truncated) {
      await discardStaged();
      return reply.code(413).send({
        error: { message: 'PDF ५१२ MB पेक्षा मोठी असू शकत नाही.' },
      });
    }
    if (bytes === 0) {
      await discardStaged();
      return reply
        .code(400)
        .send({ error: { message: 'ही फाईल रिकामी आहे.' } });
    }

    let handle: OpenAiChatFileHandle;
    try {
      handle = await uploadOpenAiChatDocument(
        name,
        bytes,
        storedChunkReader(client, storagePath),
      );
    } catch (error) {
      await discardStaged();
      throw error;
    }

    // The row is inserted LAST, so a rejected or abandoned upload leaves no attachment the
    // composer could offer. The vector store is not touched here: the file joins the thread's
    // index at send time, which is the first moment there is a thread to index it into.
    const row = await insertChatFile(client, {
      displayName: name,
      mimeType: 'application/pdf',
      storagePath,
      openAiFileId: handle.id,
      bytes: handle.bytes,
    });
    return reply.code(201).send({ documentId: row.id, name: row.displayName });
  });

  // The turn. The ONLY streaming route in this API.
  app.post<{ Params: { id: string } }>(
    '/chat/threads/:id/messages',
    async (request, reply) => {
      const thread = await getChatThread(client, request.params.id);
      if (!thread) {
        return reply
          .code(404)
          .send({ error: { message: 'ही चॅट सापडली नाही.' } });
      }

      const body = SendChatMessageRequestSchema.parse(request.body);
      const content = body.content.trim();
      // Absent = Qwen. Whether this
      // deployment has the named provider SET UP is deliberately not asked here — see the
      // guard below and chat-providers.ts.
      const provider = body.provider ?? DEFAULT_CHAT_PROVIDER;
      const capabilities = chatProviderCapabilities(provider);
      const submitted = body.attachments ?? [];

      // What the answering model can actually read. The composer greys these controls out,
      // and this is the backstop — a browser is never the last word on what reaches a
      // provider, and an old tab is exactly the client that would offer a picture to a text
      // model. Attaching a file the model cannot see produces a confident answer that ignores
      // it, which is worse than any error, and the fix is the officer's to make in the
      // composer.
      //
      // Read off the CLIENT'S OWN CLAIM, above, so the refusal costs no database round trip:
      // resolving an attachment reads chat_files and binds the file to this thread, which is
      // work done on behalf of a turn that is not going to happen (the /canva/generations
      // precedent, where the account is resolved before the row is read). It is refused
      // before the turn is persisted too, unlike a provider failure — this is a request the
      // officer must change, not one they can retry.
      //
      // Audio and YouTube are absent by construction: both arrive as extracted text, which
      // every provider reads.
      const unreadable = submitted.find(
        (attachment) =>
          (attachment.kind === 'image' && !capabilities.supportsImages) ||
          (attachment.kind === 'document' &&
            (attachment.documentId !== undefined
              ? !capabilities.supportsPdf
              : !capabilities.supportsTextDocuments)),
      );
      if (unreadable) {
        return reply.code(400).send({
          error: {
            message:
              unreadable.kind === 'image'
                ? `${capabilities.label} चित्रे वाचू शकत नाही. चित्र काढून टाका, किंवा दुसरा प्रदाता निवडा.`
                : `${capabilities.label} ही फाईल वाचू शकत नाही. ती काढून टाका, किंवा दुसरा प्रदाता निवडा.`,
          },
        });
      }

      const resolvedAttachments = await Promise.all(
        submitted.map((attachment) =>
          toStoredAttachment(client, thread.id, attachment, imageUrlPrefix),
        ),
      );
      const attachments = resolvedAttachments.filter(
        (entry): entry is ChatAttachmentEntry => entry !== null,
      );

      if (content === '' && attachments.length === 0) {
        return reply
          .code(400)
          .send({ error: { message: 'काहीतरी लिहा किंवा फाईल जोडा.' } });
      }
      if (attachments.length < submitted.length) {
        return reply.code(400).send({
          error: { message: 'जोडलेली फाईल वाचता आली नाही. पुन्हा जोडा.' },
        });
      }
      if (attachments.length > CHAT_MAX_ATTACHMENTS) {
        return reply.code(400).send({
          error: {
            message: `एका संदेशाला जास्तीत जास्त ${CHAT_MAX_ATTACHMENTS.toLocaleString('mr-IN')} फाईल्स जोडता येतात.`,
          },
        });
      }
      const attachedChars = attachments.reduce(
        (total, attachment) => total + (attachment.text?.length ?? 0),
        0,
      );
      if (attachedChars > CHAT_ATTACHMENT_TEXT_MAX_CHARS) {
        return reply.code(400).send({
          error: {
            message:
              'जोडलेला मजकूर खूप मोठा आहे. कमी पृष्ठे निवडा, किंवा एवढ्या मोठ्या दस्तऐवजासाठी लेख-बातमी वापरा.',
          },
        });
      }

      // Persist the officer's turn BEFORE anything can fail. A stream that dies must never
      // lose what was typed — and on a reload the question is already in the conversation
      // with the answer missing, which is a state they can retry from.
      const userRow = await insertChatMessage(client, {
        threadId: thread.id,
        role: 'user',
        content,
        attachments,
      });

      const history = await listChatMessages(client, thread.id);
      const previousMessage = history.at(-2);
      // OpenAI's stored-response chain, and read only by that lane. A Qwen turn never writes
      // one, so this is null whenever the previous answer came from the other provider — and
      // an OpenAI turn following a Qwen one therefore replays the transcript statelessly
      // rather than chaining past a turn OpenAI never saw.
      const previousResponseId =
        previousMessage?.role === 'assistant'
          ? previousMessage.responseId
          : null;
      // Newest CHAT_HISTORY_TURNS, oldest first. A chat is unbounded; a request is not.
      // A stored OpenAI response already owns the earlier context, so misc-chat.ts sends only
      // the newest turn when it is continuing one; the whole slice is kept here because it is
      // also the stateless fallback for an old conversation or an expired response.
      const recentHistory = history.slice(-CHAT_HISTORY_TURNS);

      openEventStream(request, reply);

      const accumulator = createCostAccumulator();
      let answer = '';
      let failure: string | null = null;
      // A Marathi sentence the provider itself supplied, when it has one. Kept apart from
      // `failure`, which is the English diagnosis stored on the row for whoever reads the log.
      let userFacing: string | null = null;
      let model: string | null = null;
      let responseId: string | null = null;

      try {
        const onDelta = (delta: string): void => {
          answer += delta;
          sendEvent(reply, { type: 'delta', text: delta });
        };
        // Thinking, not answer: streamed so the pane shows progress instead of sitting dead
        // while a reasoning model deliberates, never added to `answer` and never stored.
        // Only the Qwen lane produces these today.
        const onReasoning = (chunk: string): void => {
          sendEvent(reply, { type: 'reasoning', text: chunk });
        };
        // Typed against the WIDER event, which is assignable in both directions — every field
        // the Qwen lane adds is optional, so this handler is still what streamMiscChatReply
        // asks for. Typing it here rather than at the base is what makes `context` (a
        // transcript this provider had to shorten) and `preflight` (the pod's real
        // max_model_len) visibly part of what gets logged, instead of fields that happen to
        // survive because pino serialises whatever object it is handed.
        const onLifecycle = (event: QwenChatLifecycleEvent): void => {
          request.log.info(
            { threadId: thread.id, provider, chat: event },
            `${capabilities.label} chat ${event.phase}`,
          );
        };
        const result = await runInCostScope(accumulator, async () => {
          if (provider === 'qwen') {
            // prepareThreadDocuments is SKIPPED, and that is the load-bearing line of this
            // branch rather than an optimisation. It creates an OpenAI vector store and
            // chunks every document in view into it — real, per-gigabyte-per-day spend — to
            // serve a File Search tool this provider does not have and could not be given.
            // Running it here would bill the officer for an index nothing will ever read.
            //
            // The empty map is the same statement one level down: `toTurn` maps a document
            // attachment to a `documentFileId` only when the file is searchable RIGHT NOW,
            // and nothing is, so no PDF leaves a trace in the transcript. The guard above has
            // already refused one anyway; this is what keeps the two agreeing if it ever
            // does not.
            const reply_ = await streamQwenChatReply({
              turns: recentHistory.map((row) => toTurn(row, new Map())),
              onDelta,
              onReasoning,
              onLifecycle,
            });
            // No response id, ever. vLLM stores nothing to chain onto, and never writing one
            // is what keeps a later OpenAI turn replaying the transcript instead of chaining
            // past an answer OpenAI never produced.
            return { model: reply_.model, responseId: null };
          }

          // Indexing runs HERE — after the stream is open and inside the cost scope — rather
          // than before the 200. Chunking a large scan is minutes of provider work, and doing
          // it above would hold a plain HTTP request open with nothing to show for it; here a
          // failure takes the same path a model failure does, so the officer gets a message
          // and the turn they typed is already stored.
          const documents = await prepareThreadDocuments(
            client,
            thread,
            recentHistory,
          );
          const turns = recentHistory.map((row) =>
            toTurn(row, documents.searchable),
          );
          const request_ = {
            turns,
            onDelta,
            onLifecycle,
            ...(documents.vectorStoreId !== null
              ? { vectorStoreId: documents.vectorStoreId }
              : {}),
          };
          try {
            return await streamMiscChatReply({
              ...request_,
              ...(previousResponseId !== null ? { previousResponseId } : {}),
            });
          } catch (error) {
            if (
              previousResponseId === null ||
              answer !== '' ||
              !isMissingPreviousResponse(error)
            ) {
              throw error;
            }
            // A stored response may be deleted or age out. Rebuild the bounded conversation
            // once from our own rows and the thread's own index instead of breaking the chat.
            // The same `turns` serve both: misc-chat.ts is what decides that a continuation
            // sends only the newest one, and this call is not a continuation.
            return streamMiscChatReply(request_);
          }
        });
        model = result.model;
        responseId = result.responseId;
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error);
        // A provider that words its own failures keeps the two apart on purpose: `failure` is
        // the English diagnosis with the status and URL in it, for the log and the row, and
        // this is the one Marathi sentence naming the officer's next move. The web's
        // officer-readability whitelist REPLACES anything that fails it, so an untyped
        // failure's English message would never have reached the screen at all — which is why
        // the fallback below stays for the lanes that do not carry one.
        userFacing = isQwenChatError(error) ? error.userMessage : null;
        request.log.error({ err: error, provider }, 'chat reply failed');
      }

      // The answer streams, so `answer` holds whatever reached the browser. A failed turn
      // therefore stores that fragment ALONGSIDE its error rather than an empty string: those
      // tokens are paid for and the officer watched them arrive, so discarding them would be
      // the surprising behaviour. The error column is what marks the row incomplete, and the
      // response id is only written on a clean finish — so a broken turn can never become the
      // `previous_response_id` a follow-up chains onto.
      const costUsd = totalCostUsd(accumulator);
      let assistantRow: ChatMessageRow | null = null;
      try {
        assistantRow = await insertChatMessage(client, {
          threadId: thread.id,
          role: 'assistant',
          content: answer,
          ...(model !== null ? { model } : {}),
          ...(responseId !== null ? { responseId } : {}),
          ...(costUsd > 0 ? { costUsd } : {}),
          ...(failure !== null ? { error: failure } : {}),
        });
      } catch (error) {
        request.log.error({ err: error }, 'chat reply could not be persisted');
      }

      // Thread bookkeeping is best-effort and last: a failure here costs the rail's ordering
      // and its title, never the conversation (the 0028 principle).
      let title: string | undefined;
      try {
        const isFirstTurn = thread.messageCount === 0 || thread.title === '';
        if (isFirstTurn) {
          // A turn can be an image with no words at all, in which case the file's name is
          // the only thing there is to call the chat.
          title = chatTitleFrom(
            content || (attachments[0]?.name ?? ''),
            'नवीन चॅट',
          );
        }
        await updateChatThread(client, thread.id, {
          messageCount: thread.messageCount + (assistantRow ? 2 : 1),
          lastMessageAt: new Date().toISOString(),
          ...(title !== undefined ? { title } : {}),
        });
      } catch (error) {
        request.log.warn({ err: error }, 'chat thread bookkeeping failed');
      }

      if (failure !== null) {
        sendEvent(reply, {
          type: 'error',
          message:
            userFacing ?? 'उत्तर तयार करता आले नाही. पुन्हा प्रयत्न करा.',
        });
      } else {
        sendEvent(reply, {
          type: 'done',
          messageId: assistantRow?.id ?? '',
          userMessageId: userRow.id,
          ...(title !== undefined ? { title } : {}),
        });
      }
      reply.raw.end();
      return reply;
    },
  );
}
