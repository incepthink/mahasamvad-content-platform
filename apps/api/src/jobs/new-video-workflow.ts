// Job runner for /new-video-workflow — Gemini conversational video.
//
// WAS IN MEMORY, IS NOW A TABLE (migration 0050). This surface shipped as a comparison
// harness: a Map, a 3-hour TTL, 50 conversations, a hard single-process constraint, and no
// history list because there was nothing to list. It is a product surface now, so the state
// of record is `new_video_conversations` / `new_video_turns` — which is what makes a
// conversation survive an API restart, reopen at its own URL, appear in the rail, and behave
// the same on two API instances.
//
// Two rules from the old file are kept verbatim, because they are the ones this lane turns on:
//
//   THE CHAIN RULE — only a turn that produced a video advances `lastInteractionId`. A failed
//   turn leaves the chain where it was, or every later "change the background" would edit
//   something the officer never saw. (The /chat rule: only a completed answer advances state.)
//
//   NOTHING PRIVATE CROSSES THE BOUNDARY — no Gemini interaction id, no authenticated
//   provider URL, no storage path, no API key. `toConversationDetail` is the one place rows
//   become payloads, and it drops all of them.
//
// Sequencing and persistence only, per AGENTS.md: every model decision lives in
// @dgipr/content-engine (video/gemini-interactions-client.ts).

import { randomUUID } from 'node:crypto';
import {
  awaitInteraction,
  createVideoInteraction,
  downloadInteractionVideo,
  interactionErrorMessage,
  interactionOutputOf,
  isTerminalInteractionStatus,
  type InteractionImage,
} from '@dgipr/content-engine';
import {
  POSTERS_BUCKET,
  VIDEOS_BUCKET,
  deleteNewVideoConversation,
  downloadFile,
  getNewVideoConversationRow,
  insertNewVideoConversation,
  insertNewVideoImage,
  insertNewVideoTurn,
  listNewVideoConversations,
  listNewVideoImagesByIds,
  listNewVideoTurns,
  publicUrl,
  publicUrlIn,
  updateNewVideoConversation,
  updateNewVideoTurn,
  uploadFile,
  type NewVideoConversationRow,
  type NewVideoImageRow,
  type NewVideoTurnRow,
  type SupabaseClient,
} from '@dgipr/database';
import {
  newVideoTitleFrom,
  type NewVideoConversation,
  type NewVideoConversationSummary,
  type NewVideoImage,
  type NewVideoTurn,
} from '@dgipr/schemas';

// A conversation is a chain of edits on one video; past this it is a new subject and a new
// chain. Enforced so a single row cannot grow unbounded, not because the model objects.
const MAX_TURNS_PER_CONVERSATION = 60;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isBusyTurn(turn: NewVideoTurnRow): boolean {
  return turn.status === 'queued' || turn.status === 'generating';
}

// ---------------------------------------------------------------------------
// Reference images
// ---------------------------------------------------------------------------

// Stored in the existing PUBLIC posters bucket under its own prefix, exactly as a /chat image
// is: the browser needs to show the thumbnail it just attached, and the job needs the bytes
// back without this process having held them since the upload.
export function newVideoImagePath(name: string): string {
  const safe = name.replace(/[^a-zA-Z0-9._-]/g, '_') || 'image';
  return `new-video-workflow/${Date.now()}-${randomUUID().slice(0, 8)}-${safe}`;
}

export async function storeReferenceImage(
  client: SupabaseClient,
  name: string,
  data: Buffer,
  mimeType: string,
): Promise<NewVideoImage> {
  const path = newVideoImagePath(name);
  await uploadFile(client, POSTERS_BUCKET, path, data, mimeType);
  const row = await insertNewVideoImage(client, {
    displayName: name,
    url: publicUrl(client, path),
    storagePath: path,
    mimeType,
  });
  return { id: row.id, name: row.displayName, url: row.url };
}

// Resolves the ids a turn request carried, PRESERVING THE ORDER THEY WERE SENT IN — a
// database `in` filter answers in whatever order it likes, and the officer attached these
// pictures in a particular one. An id we did not mint resolves to nothing, which is what keeps
// the browser from naming an arbitrary object.
export async function resolveReferenceImages(
  client: SupabaseClient,
  ids: readonly string[],
): Promise<{ resolved: NewVideoImageRow[]; missing: string[] }> {
  const rows = await listNewVideoImagesByIds(client, ids);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const resolved: NewVideoImageRow[] = [];
  const missing: string[] = [];
  for (const id of ids) {
    const row = byId.get(id);
    if (row) resolved.push(row);
    else missing.push(id);
  }
  return { resolved, missing };
}

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

export async function createConversation(
  client: SupabaseClient,
): Promise<NewVideoConversationRow> {
  return insertNewVideoConversation(client);
}

export async function getConversation(
  client: SupabaseClient,
  id: string,
): Promise<NewVideoConversationRow | null> {
  return getNewVideoConversationRow(client, id);
}

export async function getConversationTurns(
  client: SupabaseClient,
  conversationId: string,
): Promise<NewVideoTurnRow[]> {
  return listNewVideoTurns(client, conversationId);
}

// Busy is derived from the TURNS, never cached on the conversation row: the job that would
// have to clear such a flag is the same one that can die, and a stuck "generating" badge on a
// finished conversation is exactly the failure the in-memory version could not have.
export async function conversationIsBusy(
  client: SupabaseClient,
  conversationId: string,
): Promise<boolean> {
  const turns = await listNewVideoTurns(client, conversationId);
  return turns.some(isBusyTurn);
}

export function conversationIsFull(turns: readonly NewVideoTurnRow[]): boolean {
  return turns.length >= MAX_TURNS_PER_CONVERSATION;
}

export async function listConversationSummaries(
  client: SupabaseClient,
): Promise<NewVideoConversationSummary[]> {
  const rows = await listNewVideoConversations(client);
  // A conversation with no turn yet is not in the rail: an untitled row appearing for
  // everyone before a word is typed would be noise (the chat rail's rule). It cannot happen
  // through the turn route, which creates and appends in one request, but a failed insert
  // between the two would leave one behind.
  return rows
    .filter((row) => row.turnCount > 0)
    .map((row) => ({
      id: row.id,
      title: row.title,
      turnCount: row.turnCount,
      lastTurnAt: row.lastTurnAt,
      createdAt: row.createdAt,
    }));
}

export async function removeConversation(
  client: SupabaseClient,
  id: string,
): Promise<void> {
  await deleteNewVideoConversation(client, id);
}

// Appends the turn in `queued` and hands it back. The ROUTE calls this before answering 202,
// so the client's immediate refresh sees a turn that is plainly working rather than an empty
// conversation it would read as finished.
//
// The title and the ordering key are stamped in the same breath, best-effort: losing them
// costs a rail label, never the turn that is already stored.
export async function appendTurn(
  client: SupabaseClient,
  conversation: NewVideoConversationRow,
  prompt: string,
  turnImages: readonly NewVideoImageRow[],
  currentTurnCount: number,
): Promise<NewVideoTurnRow> {
  const turn = await insertNewVideoTurn(client, {
    conversationId: conversation.id,
    prompt,
    images: turnImages.map((image) => ({
      id: image.id,
      name: image.displayName,
      url: image.url,
    })),
  });

  try {
    await updateNewVideoConversation(client, conversation.id, {
      // Set once, from the FIRST prompt: a conversation is a chain of edits on one video, so
      // the thing that names it is what was asked for at the start.
      //
      // Keyed on the turn COUNT, not on `conversation.title === ''` — the row handed to this
      // function was read at the top of the request and a title written by an earlier turn is
      // exactly the field most likely to be stale on it. The count comes from the turns just
      // listed, so it cannot disagree with what is being appended.
      ...(currentTurnCount === 0 ? { title: newVideoTitleFrom(prompt) } : {}),
      turnCount: currentTurnCount + 1,
      lastTurnAt: turn.createdAt,
    });
  } catch (error) {
    console.error(
      `[new-video-workflow ${conversation.id}] failed to stamp conversation:`,
      error,
    );
  }

  return turn;
}

// The polled shape. Nothing private crosses this boundary: no storage path, no Gemini
// interaction id, no authenticated provider URL.
export function toConversationDetail(
  conversation: NewVideoConversationRow,
  turns: readonly NewVideoTurnRow[],
): NewVideoConversation {
  return {
    id: conversation.id,
    title: conversation.title,
    busy: turns.some(isBusyTurn),
    createdAt: conversation.createdAt,
    turns: turns.map((turn): NewVideoTurn => ({
      id: turn.id,
      prompt: turn.prompt,
      images: turn.images.map((image) => ({
        id: image.id,
        name: image.name,
        url: image.url,
      })),
      status: turn.status,
      videoUrl: turn.videoUrl,
      modelText: turn.modelText,
      error: turn.error,
      createdAt: turn.createdAt,
    })),
  };
}

// ---------------------------------------------------------------------------
// The job
// ---------------------------------------------------------------------------

// THE CHAIN RULE, in one place so it cannot be spelled two ways: a turn that produced a video
// becomes the point the next instruction edits from, and a turn that did not leaves the chain
// exactly where it was.
export async function markTurnCompleted(
  client: SupabaseClient,
  conversationId: string,
  turnId: string,
  result: Readonly<{
    interactionId: string;
    videoUrl: string;
    modelText?: string | null;
  }>,
): Promise<void> {
  await updateNewVideoTurn(client, turnId, {
    status: 'completed',
    interactionId: result.interactionId,
    videoUrl: result.videoUrl,
    ...(result.modelText !== undefined ? { modelText: result.modelText } : {}),
    error: null,
  });
  await updateNewVideoConversation(client, conversationId, {
    lastInteractionId: result.interactionId,
  });
}

export async function markTurnFailed(
  client: SupabaseClient,
  turnId: string,
  message: string,
): Promise<void> {
  // The conversation's lastInteractionId is deliberately NOT touched.
  await updateNewVideoTurn(client, turnId, {
    status: 'failed',
    error: message,
  });
}

// Fire and forget: the route has already answered 202 and the client is polling. Every failure
// lands on the TURN ROW, never on the process — which is also what makes a failure survive the
// restart that used to erase it.
export function startNewVideoTurn(
  client: SupabaseClient,
  conversation: NewVideoConversationRow,
  turn: NewVideoTurnRow,
  referenceRows: readonly NewVideoImageRow[],
): void {
  void (async () => {
    try {
      await updateNewVideoTurn(client, turn.id, { status: 'generating' });

      // Downloaded now rather than held since the upload: a reference image may have been
      // attached minutes ago, and holding several of them per conversation is how a page
      // quietly becomes a memory problem.
      const referenceImages: InteractionImage[] = [];
      for (const image of referenceRows) {
        referenceImages.push({
          data: await downloadFile(client, POSTERS_BUCKET, image.storagePath),
          mimeType: image.mimeType,
        });
      }

      // The chain point is read HERE, not at request time: a turn queued while an earlier one
      // was still generating must continue from whatever that one produced. Re-read from the
      // row for the same reason — the value may have moved since this job started.
      const current = await getNewVideoConversationRow(client, conversation.id);
      const previousInteractionId = current?.lastInteractionId ?? null;

      const started = await createVideoInteraction({
        prompt: turn.prompt,
        images: referenceImages,
        previousInteractionId,
      });
      const interactionId = started.id ?? null;
      if (!interactionId) {
        throw new Error(
          `Gemini accepted the request but returned no interaction id: ${JSON.stringify(
            started,
          )}`,
        );
      }
      // Recorded before the wait, so a render that outlives this process is still traceable.
      await updateNewVideoTurn(client, turn.id, { interactionId });

      const finished = isTerminalInteractionStatus(
        started.status ?? 'in_progress',
      )
        ? started
        : await awaitInteraction(interactionId);

      const output = interactionOutputOf(finished);
      const modelText = output.text !== '' ? output.text : null;

      const bytes = output.videoUri
        ? await downloadInteractionVideo(output.videoUri)
        : output.videoData
          ? Buffer.from(output.videoData, 'base64')
          : null;

      if (!bytes || bytes.length === 0) {
        // A refusal or a safety block arrives here, and its own words are the message worth
        // showing — see the `error` field's note in @dgipr/schemas.
        if (modelText !== null) {
          await updateNewVideoTurn(client, turn.id, { modelText });
        }
        throw new Error(
          interactionErrorMessage(finished) ??
            'Gemini finished the interaction without returning a video.',
        );
      }

      // Re-hosted so the browser can play it: the Gemini URI is authenticated by our API key
      // and must never reach a client. Versioned by turn id, so no path is ever reused (the
      // public buckets are CDN-cached).
      const path = `new-video-workflow/${conversation.id}/${turn.id}.mp4`;
      await uploadFile(client, VIDEOS_BUCKET, path, bytes, 'video/mp4');

      await markTurnCompleted(client, conversation.id, turn.id, {
        interactionId: finished.id ?? interactionId,
        videoUrl: publicUrlIn(client, VIDEOS_BUCKET, path),
        modelText,
      });
    } catch (error) {
      console.error(
        `[new-video-workflow ${conversation.id}/${turn.id}] turn failed:`,
        error,
      );
      try {
        await markTurnFailed(client, turn.id, errorMessage(error));
      } catch (writeError) {
        // The row is the only place a failure can be reported, so losing this write is worth
        // a log line of its own: the turn will sit at `generating` until it is re-read.
        console.error(
          `[new-video-workflow ${conversation.id}/${turn.id}] could not record the failure:`,
          writeError,
        );
      }
    }
  })();
}
