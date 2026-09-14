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
//   GET    /new-video-workflow/characters                              -> the registry
//   POST   /new-video-workflow/characters                              -> 201 the character
//   PATCH  /new-video-workflow/characters/:id                          -> the character
//   DELETE /new-video-workflow/characters/:id                          -> 204
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
  DEFAULT_NEW_VIDEO_ASPECT,
  NEW_VIDEO_IMAGE_MAX_BYTES,
  NEW_VIDEO_IMAGE_MAX_MB,
  NEW_VIDEO_MAX_CAST,
  NEW_VIDEO_MAX_IMAGES,
  NEW_VIDEO_PROMPT_MAX_CHARS,
  NewVideoCharacterPatchSchema,
  NewVideoCharacterRequestSchema,
  NewVideoTurnRequestSchema,
} from '@dgipr/schemas';
import {
  appendTurn,
  castPortraitCount,
  conversationIsFull,
  createCharacter,
  createConversation,
  editCharacter,
  getCharacter,
  getConversation,
  getConversationCharacters,
  getConversationTurns,
  listCharacters,
  listConversationSummaries,
  removeCharacter,
  removeConversation,
  resolveCharacters,
  resolveForkPoint,
  resolvePortrait,
  resolveReferenceImages,
  setConversationCast,
  startNewVideoTurn,
  storeReferenceImage,
  toCharacterPayload,
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

    if ((body.characterIds ?? []).length > NEW_VIDEO_MAX_CAST) {
      return reply.code(400).send({
        error: {
          message: `एका संभाषणात कमाल ${NEW_VIDEO_MAX_CAST.toLocaleString('mr-IN')} पात्रे निवडता येतात.`,
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

    // The CAST, de-duplicated: the same character named twice would be declared twice and
    // have their portrait attached twice, spending a reference slot to say one thing.
    const requestedCast = [...new Set(body.characterIds ?? [])];
    const { resolved: requestedCharacters, missing: missingCharacters } =
      await resolveCharacters(client, requestedCast);
    if (missingCharacters.length > 0) {
      // An id this API did not mint, or a character deleted since the page was opened.
      // Refused rather than dropped: rendering without a character the officer picked is the
      // "the model ignored my reference" complaint, arriving by a different road.
      return reply.code(400).send({
        error: {
          message: 'निवडलेले एखादे पात्र आता उपलब्ध नाही. कृपया पुन्हा निवडा.',
        },
      });
    }

    // A fork continues from a turn, so it needs a conversation to have one. Refused HERE,
    // before the create below, rather than falling through to 'no such turn': that would
    // leave an empty conversation row behind for a request that was never going to run.
    if (body.fromTurnId !== undefined && body.conversationId === undefined) {
      return reply.code(400).send({
        error: {
          message:
            'जुन्या व्हिडिओवरून बदल करण्यासाठी आधीचे संभाषण उघडावे लागेल.',
        },
      });
    }

    // A fork names the video to continue from, which is by definition an edit of it. Asking
    // for a NEW clip in the same breath is two contradictory instructions, so it is refused
    // before anything is created rather than guessed at.
    if (body.fromTurnId !== undefined && body.intent === 'new') {
      return reply.code(400).send({
        error: {
          message:
            'जुन्या व्हिडिओवरून बदल करताना "नवीन क्लिप" निवडता येत नाही. एकच पर्याय निवडा.',
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

    // FORKING (Step 4). Resolved out of the turns just listed — no extra query — and
    // resolved HERE rather than in the job because a bad id must be refused before anything
    // is billed. What travels on is the INTERACTION id: the browser named a turn, and the
    // provider handle it maps to never goes back the other way.
    let forkFromInteractionId: string | null = null;
    if (body.fromTurnId !== undefined) {
      const fork = resolveForkPoint(turns, body.fromTurnId);
      if (!fork.ok) {
        return reply.code(400).send({
          error: {
            message:
              fork.reason === 'unfinished'
                ? 'या सूचनेतून व्हिडिओ तयार झाला नाही, म्हणून त्यावरून पुढे बदल करता येत नाहीत.'
                : 'निवडलेली सूचना या संभाषणात सापडली नाही. कृपया पान पुन्हा उघडा.',
          },
        });
      }
      forkFromInteractionId = fork.interactionId;
    }

    // THE CAST IS SET ON THE FIRST TURN AND FIXED THEREAFTER. A character's portrait is
    // attached on the turn that establishes them, and stacking a new reference into the
    // middle of an edit chain is a documented failure mode — so changing who is in a video is
    // what starting a new conversation is for, which the registry makes cheap by re-seeding
    // it automatically.
    const settingCast = turns.length === 0;
    let storedCast: Awaited<ReturnType<typeof getConversationCharacters>> = [];
    let castReadFailed = false;
    if (!settingCast) {
      try {
        storedCast = await getConversationCharacters(client, conversation.id);
      } catch (error) {
        // A cast that cannot be read is treated as no cast, so every conversation that never
        // had one keeps working — which is what an un-applied 0054 looks like, and is the
        // whole reason the cast lives in tables of its own rather than in a column on
        // new_video_conversations. A turn that actually NAMES a character is refused just
        // below instead, because there the answer would be a guess.
        request.log.error(
          { err: error, conversationId: conversation.id },
          'could not read the video conversation cast',
        );
        castReadFailed = true;
      }
    }
    if (!settingCast && requestedCast.length > 0) {
      if (castReadFailed) {
        return reply.code(500).send({
          error: {
            message:
              'या संभाषणातील पात्रे वाचता आली नाहीत. कृपया पुन्हा प्रयत्न करा.',
          },
        });
      }
      const stored = storedCast.map((character) => character.id).join(',');
      if (requestedCast.join(',') !== stored) {
        // A well-behaved client echoes the stored cast, so equality passes silently. Anything
        // else is refused rather than ignored: a paid render carrying a different character
        // than the one on screen is the audio-trim rule — a mismatch that would destroy the
        // thing it was pointed at.
        return reply.code(400).send({
          error: {
            message:
              'या संभाषणातील पात्रे बदलता येत नाहीत. वेगळी पात्रे हवी असल्यास नवीन संभाषण सुरू करा.',
          },
        });
      }
    }
    const cast = settingCast ? requestedCharacters : storedCast;

    // A character with a portrait spends one of the turn's reference-image slots, but only on
    // a turn that STARTS a chain — which is exactly the condition the job re-reads. The chain
    // point only ever moves from null to set, never back, so a decision taken here can only
    // over-estimate what the job will attach, never under-estimate it.
    const portraitSlots =
      conversation.lastInteractionId === null ? castPortraitCount(cast) : 0;
    if (portraitSlots + imageIds.length > NEW_VIDEO_MAX_IMAGES) {
      return reply.code(400).send({
        error: {
          message:
            `निवडलेल्या पात्रांची ${portraitSlots.toLocaleString('mr-IN')} चित्रे धरून एका ` +
            `सूचनेत कमाल ${NEW_VIDEO_MAX_IMAGES.toLocaleString('mr-IN')} चित्रे जाऊ शकतात.`,
        },
      });
    }

    if (settingCast && requestedCast.length > 0) {
      // Written BEFORE the render is started, and a failure refuses the turn: if the cast
      // does not land, this turn would still be right and every follow-up would silently lose
      // the voice description — which is the drift the registry exists to stop. Nothing has
      // been billed at this point, so refusing costs the officer a retry and nothing else.
      // (It is also where an un-applied 0054 surfaces, and only for a turn that names a
      // character — every other turn on this page is untouched by it.)
      try {
        await setConversationCast(client, conversation.id, requestedCast);
      } catch (error) {
        request.log.error(
          { err: error, conversationId: conversation.id },
          'failed to store the video conversation cast',
        );
        return reply.code(500).send({
          error: {
            message:
              'निवडलेली पात्रे जतन करता आली नाहीत. कृपया पुन्हा प्रयत्न करा.',
          },
        });
      }
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
    // The shape the officer picked on the composer. Defaulted here rather than in the schema so
    // the wire stays optional — an older client sends no aspect and still gets the landscape
    // render it has always got.
    startNewVideoTurn(
      client,
      conversation,
      turn,
      resolved,
      body.aspect ?? DEFAULT_NEW_VIDEO_ASPECT,
      // Passed rather than re-read, for the reason `aspect` is: nothing re-runs a turn. The
      // cast is on the CONVERSATION, though, so the next turn gets it without the officer
      // picking anyone again — which is the whole of Step 3.
      cast,
      // Null on the ordinary path, where the job reads the conversation's own chain point.
      forkFromInteractionId,
      // Edit the video on screen or make a new clip. `auto` is decided in the job, from the
      // instruction itself, because it is a model call and must not hold this request open.
      body.intent ?? 'auto',
    );

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
      // Read fresh rather than denormalized: an edit to a character's voice reaches the page
      // — and, more usefully, every future turn of this conversation — with no backfill.
      //
      // BEST-EFFORT HERE AND NOWHERE ELSE. This route is a poll that spends nothing, so a
      // cast it cannot read costs a line under the composer; letting the read throw would
      // take the whole conversation down with it, which is exactly the blast radius 0054's
      // link table was shaped to avoid (verified live against a database without it). The
      // TURN route deliberately does NOT do this: there a cast that cannot be read would mean
      // a paid render with no voice description in it, so the turn is refused instead.
      let characters: Awaited<ReturnType<typeof getConversationCharacters>> =
        [];
      try {
        characters = await getConversationCharacters(client, conversation.id);
      } catch (error) {
        request.log.error(
          { err: error, conversationId: conversation.id },
          'could not read the video conversation cast',
        );
      }
      return toConversationDetail(conversation, turns, characters);
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

  // -------------------------------------------------------------------------
  // The character & voice registry (migration 0054)
  // -------------------------------------------------------------------------
  //
  // Department-wide and reusable across conversations, which is the whole feature: seeding a
  // FRESH conversation from the same entry is what reproduces the Gemini app's good case,
  // where consistency comes from the user re-supplying the same portrait and description by
  // hand. There is no auth here, as everywhere else on this surface, so the registry is one
  // shared library.

  app.get('/new-video-workflow/characters', async () => {
    return (await listCharacters(client)).map(toCharacterPayload);
  });

  app.post('/new-video-workflow/characters', async (request, reply) => {
    const body = NewVideoCharacterRequestSchema.parse(request.body);
    // The portrait is named by an id this API minted at upload, exactly as a turn's images
    // are — a browser may never hand a paid render a storage path or a URL of its own.
    const portrait = await resolvePortrait(client, body.portraitImageId);
    if (portrait === 'missing') {
      return reply.code(400).send({
        error: {
          message: 'जोडलेले चित्र आता उपलब्ध नाही. कृपया ते पुन्हा जोडा.',
        },
      });
    }
    const created = await createCharacter(client, {
      name: body.name.trim(),
      appearance: body.appearance ?? '',
      voice: body.voice ?? '',
      portrait,
    });
    return reply.code(201).send(toCharacterPayload(created));
  });

  app.patch<{ Params: { id: string } }>(
    '/new-video-workflow/characters/:id',
    async (request, reply) => {
      const body = NewVideoCharacterPatchSchema.parse(request.body);
      // Three states, the /video scene-reference rule: a path ATTACHES, explicit null
      // REMOVES, and omitting the field leaves the stored portrait alone — so an edit to the
      // voice alone cannot silently detach a picture.
      const portrait =
        body.portraitImageId === undefined
          ? undefined
          : await resolvePortrait(client, body.portraitImageId);
      if (portrait === 'missing') {
        return reply.code(400).send({
          error: {
            message: 'जोडलेले चित्र आता उपलब्ध नाही. कृपया ते पुन्हा जोडा.',
          },
        });
      }
      const updated = await editCharacter(client, request.params.id, {
        ...(body.name !== undefined ? { name: body.name.trim() } : {}),
        ...(body.appearance !== undefined
          ? { appearance: body.appearance }
          : {}),
        ...(body.voice !== undefined ? { voice: body.voice } : {}),
        ...(portrait !== undefined ? { portrait } : {}),
      });
      if (!updated) {
        return reply
          .code(404)
          .send({ error: { message: 'हे पात्र सापडले नाही.' } });
      }
      return toCharacterPayload(updated);
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/new-video-workflow/characters/:id',
    async (request, reply) => {
      const existing = await getCharacter(client, request.params.id);
      if (!existing) {
        return reply
          .code(404)
          .send({ error: { message: 'हे पात्र सापडले नाही.' } });
      }
      // Cascades out of every cast (0054's foreign key), deliberately: a character nobody can
      // describe any more must not keep being re-emitted into future turns. Videos already
      // rendered are untouched, and so is the uploaded portrait object — this repo does not
      // delete stored bytes on a click aimed at a list row.
      await removeCharacter(client, request.params.id);
      return reply.code(204).send();
    },
  );
}
