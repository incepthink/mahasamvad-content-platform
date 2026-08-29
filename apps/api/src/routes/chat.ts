// The general assistant at /chat. Thin handlers, per AGENTS.md: persist the turn, ask
// @dgipr/content-engine for the answer, stream it out. The route assembles no prompt; the
// content engine owns the one general-purpose chat instruction and OpenAI provider input.
//
// Seven routes: create/list/detail/delete a thread, send a turn (the only streaming route in
// this API), and upload an image or a native PDF.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  DLO_UPLOADS_BUCKET,
  POSTERS_BUCKET,
  attachChatFile,
  deleteChatThread,
  downloadFile,
  getChatFile,
  getChatThread,
  insertChatFile,
  insertChatMessage,
  insertChatThread,
  listChatMessages,
  listChatThreads,
  publicUrl,
  updateChatThread,
  updateChatFileOpenAiHandle,
  uploadFile,
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
  SendChatMessageRequestSchema,
  chatTitleFrom,
  imageMimeForFileName,
  isImageFileName,
  type ChatAttachment,
  type ChatMessage,
  type ChatStreamEvent,
  type ChatThreadDetail,
  type ChatThreadSummary,
} from '@dgipr/schemas';
import {
  createCostAccumulator,
  MISC_CHAT_PDF_MAX_BYTES,
  runInCostScope,
  streamMiscChatReply,
  totalCostUsd,
  uploadOpenAiChatDocument,
  type MiscChatLifecycleEvent,
  type MiscChatTurn,
} from '@dgipr/content-engine';
import { isAllowedOrigin } from '../cors-origins.js';

// Images retain the repository's unlimited upload posture. Direct PDF chat is different:
// OpenAI Responses documents a hard 50 MB combined file-input limit, so that route refuses
// a file the provider cannot answer against. Publishing intake keeps its chunk/OCR contract.
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

async function ensureOpenAiFile(
  client: SupabaseClient,
  file: ChatFileRow,
): Promise<ChatFileRow> {
  if (file.openAiFileId !== null) return file;

  // Gemini-era rows have only the durable private copy. Upgrade them lazily so an old chat
  // remains usable without asking the officer to upload its PDF again.
  const data = await downloadFile(client, DLO_UPLOADS_BUCKET, file.storagePath);
  const handle = await uploadOpenAiChatDocument(file.displayName, data);
  return updateChatFileOpenAiHandle(client, file.id, {
    openAiFileId: handle.id,
    bytes: handle.bytes,
  });
}

async function documentFileIdsFor(
  client: SupabaseClient,
  threadId: string,
  rows: readonly ChatMessageRow[],
): Promise<ReadonlyMap<string, string>> {
  const documentIds = new Set(
    rows.flatMap((row) =>
      row.attachments.flatMap((attachment) =>
        attachment.documentId ? [attachment.documentId] : [],
      ),
    ),
  );
  const documentRows = await Promise.all(
    [...documentIds].map(async (id) => {
      const file = await getChatFile(client, id);
      if (!file || file.threadId !== threadId) return null;
      return ensureOpenAiFile(client, file);
    }),
  );
  return new Map(
    documentRows
      .filter((file): file is ChatFileRow => file !== null)
      .filter((file) => file.openAiFileId !== null)
      .map((file) => [file.id, file.openAiFileId as string] as const),
  );
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
// business, not the route's.
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

  // A PDF uploads to OpenAI as soon as it is selected, before the officer presses Send. The
  // durable private copy remains the fallback source for legacy rows and provider migration.
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
        return reply.code(413).send({
          error: {
            message:
              'OpenAI च्या थेट PDF चॅटसाठी PDF ५० MB पेक्षा मोठी असू शकत नाही.',
          },
        });
      }
      throw error;
    }

    const storagePath = documentPathFor(name);
    const [handle] = await Promise.all([
      uploadOpenAiChatDocument(name, data),
      uploadFile(
        client,
        DLO_UPLOADS_BUCKET,
        storagePath,
        data,
        'application/pdf',
      ),
    ]);
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
      const submitted = body.attachments ?? [];
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
      const previousResponseId =
        previousMessage?.role === 'assistant'
          ? previousMessage.responseId
          : null;
      const recentHistory = history.slice(-CHAT_HISTORY_TURNS);
      // A stored OpenAI response already owns the earlier context. Only the new user turn
      // and its files need provider handles; the complete recent transcript is retained solely
      // as the stateless fallback for old conversations or an expired provider response.
      const inputRows = previousResponseId
        ? recentHistory.slice(-1)
        : recentHistory;
      const documentFileIds = await documentFileIdsFor(
        client,
        thread.id,
        inputRows,
      );
      // Newest CHAT_HISTORY_TURNS, oldest first. A chat is unbounded; a request is not.
      const turns = recentHistory.map((row) => toTurn(row, documentFileIds));

      openEventStream(request, reply);

      const accumulator = createCostAccumulator();
      let answer = '';
      let failure: string | null = null;
      let model: string | null = null;
      let responseId: string | null = null;

      try {
        const onDelta = (delta: string): void => {
          answer += delta;
          sendEvent(reply, { type: 'delta', text: delta });
        };
        const onLifecycle = (event: MiscChatLifecycleEvent): void => {
          request.log.info(
            { threadId: thread.id, openAiChat: event },
            `OpenAI chat ${event.phase}`,
          );
        };
        const result = await runInCostScope(accumulator, async () => {
          try {
            return await streamMiscChatReply(
              turns,
              onDelta,
              previousResponseId ?? undefined,
              onLifecycle,
            );
          } catch (error) {
            if (
              previousResponseId === null ||
              answer !== '' ||
              !isMissingPreviousResponse(error)
            ) {
              throw error;
            }
            // A stored response may be deleted or age out. Rebuild the bounded conversation
            // once from our own rows and durable OpenAI Files instead of breaking the chat.
            const fallbackFileIds = await documentFileIdsFor(
              client,
              thread.id,
              recentHistory,
            );
            const fallbackTurns = recentHistory.map((row) =>
              toTurn(row, fallbackFileIds),
            );
            return streamMiscChatReply(
              fallbackTurns,
              onDelta,
              undefined,
              onLifecycle,
            );
          }
        });
        model = result.model;
        responseId = result.responseId;
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error);
        request.log.error({ err: error }, 'chat reply failed');
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
          message: 'उत्तर तयार करता आले नाही. पुन्हा प्रयत्न करा.',
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
