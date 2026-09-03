// /new-video-workflow — Gemini conversational video.
//
// Thin handlers only (per AGENTS.md): parse, guard, and let jobs/new-video-workflow.ts
// sequence the work. Every model decision lives in @dgipr/content-engine.
//
// Five routes:
//   POST   /new-video-workflow/images             one reference image  -> { id, name, url }
//   POST   /new-video-workflow/turns              prompt (+ image ids) -> 202 { conversationId, turnId }
//   GET    /new-video-workflow/conversations                           -> the rail's list
//   GET    /new-video-workflow/conversations/:id                       -> the conversation, polled
//   DELETE /new-video-workflow/conversations/:id                       -> 204
//
// There is deliberately no "new conversation" route: omitting `conversationId` on a turn IS a
// new conversation, so the button on the page cannot get out of step with the server.
//
// WHAT NEVER CROSSES THIS BOUNDARY: the Gemini API key, a Gemini interaction id, an
// authenticated Gemini file URL, or a storage path. The browser sees public bucket URLs and
// ids this API minted, and a turn request may name only those ids.

import type { FastifyInstance } from 'fastify';
import type { SupabaseClient } from '@dgipr/database';
import {
  NEW_VIDEO_IMAGE_MAX_BYTES,
  NEW_VIDEO_IMAGE_MAX_MB,
  NEW_VIDEO_MAX_IMAGES,
  NEW_VIDEO_PROMPT_MAX_CHARS,
  NewVideoTurnRequestSchema,
} from '@dgipr/schemas';
import {
  appendTurn,
  conversationIsFull,
  createConversation,
  getConversation,
  getConversationTurns,
  listConversationSummaries,
  removeConversation,
  resolveReferenceImages,
  startNewVideoTurn,
  storeReferenceImage,
  toConversationDetail,
} from '../jobs/new-video-workflow.js';

// Extension-driven, exactly like every other upload path here (the browser's reported type is
// not trusted). PNG, JPEG and WebP.
const IMAGE_MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

function imageMimeFor(fileName: string): string | null {
  const dot = fileName.lastIndexOf('.');
  if (dot === -1) return null;
  return IMAGE_MIME_BY_EXTENSION[fileName.slice(dot).toLowerCase()] ?? null;
}

// Since 0050 a conversation is a row, so this genuinely means "no such conversation" — a
// deleted one, or an id that was never minted. It is no longer the "your work expired" answer
// the in-memory version had to give.
function conversationGoneError() {
  return {
    error: { message: 'हे संभाषण सापडले नाही. कदाचित ते काढून टाकले असावे.' },
  };
}

export function registerNewVideoWorkflowRoutes(
  app: FastifyInstance,
  client: SupabaseClient,
): void {
  app.post('/new-video-workflow/images', async (request, reply) => {
    // Per-request limits: the global multipart config is 10 MiB, so this states the real one
    // rather than inheriting a number chosen for something else.
    const file = await request.file({
      limits: { fileSize: NEW_VIDEO_IMAGE_MAX_BYTES, files: 1 },
    });
    if (!file) {
      return reply.code(400).send({ error: { message: 'फाईल मिळाली नाही.' } });
    }
    const name = file.filename ?? '';
    const mimeType = imageMimeFor(name);
    if (!mimeType) {
      return reply.code(400).send({
        error: { message: 'फक्त PNG, JPEG किंवा WEBP चित्रे स्वीकारली जातात.' },
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
            message: `चित्र खूप मोठे आहे. प्रत्येक चित्र कमाल ${NEW_VIDEO_IMAGE_MAX_MB} MB असावे.`,
          },
        });
      }
      throw error;
    }
    if (data.length === 0) {
      return reply
        .code(400)
        .send({ error: { message: 'हे चित्र रिकामे आहे.' } });
    }

    return storeReferenceImage(client, name, data, mimeType);
  });

  app.post('/new-video-workflow/turns', async (request, reply) => {
    const body = NewVideoTurnRequestSchema.parse(request.body);

    // The prompt is sent to Gemini VERBATIM, so the only thing checked here is that there is
    // one. No trimming, no normalising, no rewriting — that is the whole point of this page.
    if (body.prompt.trim() === '') {
      return reply.code(400).send({
        error: { message: 'कृपया प्रॉम्प्ट लिहा.' },
      });
    }
    if (body.prompt.length > NEW_VIDEO_PROMPT_MAX_CHARS) {
      return reply.code(400).send({
        error: {
          message: `प्रॉम्प्ट कमाल ${NEW_VIDEO_PROMPT_MAX_CHARS.toLocaleString('mr-IN')} अक्षरांचा असावा.`,
        },
      });
    }

    const imageIds = body.imageIds ?? [];
    if (imageIds.length > NEW_VIDEO_MAX_IMAGES) {
      return reply.code(400).send({
        error: {
          message: `एका संदेशात कमाल ${NEW_VIDEO_MAX_IMAGES.toLocaleString('mr-IN')} चित्रे जोडता येतात.`,
        },
      });
    }
    const { resolved, missing } = await resolveReferenceImages(
      client,
      imageIds,
    );
    if (missing.length > 0) {
      // An id this API did not mint. Refused rather than silently dropped: generating without
      // a reference the officer attached would look like the model ignoring them.
      return reply.code(400).send({
        error: {
          message: 'जोडलेले एखादे चित्र आता उपलब्ध नाही. कृपया ते पुन्हा जोडा.',
        },
      });
    }

    // Omitting conversationId starts a new, independent conversation.
    const conversation = body.conversationId
      ? await getConversation(client, body.conversationId)
      : await createConversation(client);
    if (!conversation) {
      return reply.code(404).send(conversationGoneError());
    }

    const turns = await getConversationTurns(client, conversation.id);
    // One generation at a time per conversation: the next turn's `previous_interaction_id` is
    // whatever this one produces, so two in flight would race for the same chain point.
    if (turns.some((t) => t.status === 'queued' || t.status === 'generating')) {
      return reply.code(409).send({
        error: {
          message:
            'या संभाषणात आधीच व्हिडिओ तयार होत आहे. तो पूर्ण होईपर्यंत थांबा.',
        },
      });
    }
    if (conversationIsFull(turns)) {
      return reply.code(409).send({
        error: {
          message: 'हे संभाषण खूप मोठे झाले आहे. कृपया नवीन संभाषण सुरू करा.',
        },
      });
    }

    // Appended as `queued` BEFORE the 202: the client refreshes the instant the 202 lands,
    // and a conversation with no new turn in it would read as finished.
    const turn = await appendTurn(
      client,
      conversation,
      body.prompt,
      resolved,
      turns.length,
    );
    startNewVideoTurn(client, conversation, turn, resolved);

    return reply
      .code(202)
      .send({ conversationId: conversation.id, turnId: turn.id });
  });

  // The rail. Summaries only — never a prompt and never a turn; see the column list in
  // @dgipr/database's new-video.ts for why that is a hard rule here.
  app.get('/new-video-workflow/conversations', async () => {
    return listConversationSummaries(client);
  });

  app.get<{ Params: { id: string } }>(
    '/new-video-workflow/conversations/:id',
    async (request, reply) => {
      const conversation = await getConversation(client, request.params.id);
      if (!conversation) return reply.code(404).send(conversationGoneError());
      const turns = await getConversationTurns(client, conversation.id);
      return toConversationDetail(conversation, turns);
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/new-video-workflow/conversations/:id',
    async (request, reply) => {
      const conversation = await getConversation(client, request.params.id);
      if (!conversation) return reply.code(404).send(conversationGoneError());
      // Refused while a render is in flight: the job writes back to a row it expects to find,
      // and a deleted conversation would turn a paid generation into a log line.
      const turns = await getConversationTurns(client, conversation.id);
      if (
        turns.some((t) => t.status === 'queued' || t.status === 'generating')
      ) {
        return reply.code(409).send({
          error: {
            message:
              'व्हिडिओ तयार होत असताना हे संभाषण काढता येत नाही. तो पूर्ण होईपर्यंत थांबा.',
          },
        });
      }
      await removeConversation(client, conversation.id);
      return reply.code(204).send();
    },
  );
}
