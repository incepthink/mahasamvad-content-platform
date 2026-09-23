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
  authorNewVideoPrompt,
  awaitInteraction,
  buildNewVideoScaffold,
  classifyNewVideoIntent,
  createVideoInteraction,
  downloadInteractionVideo,
  interactionErrorMessage,
  interactionModeFor,
  interactionOutputOf,
  isTerminalInteractionStatus,
  newVideoPromptMode,
  newVideoTaskFor,
  promptModeAuthors,
  type InteractionImage,
  type NewVideoIntentDecision,
  type ScaffoldCharacter,
} from '@dgipr/content-engine';
import {
  POSTERS_BUCKET,
  VIDEOS_BUCKET,
  deleteNewVideoConversation,
  downloadFile,
  getNewVideoConversationRow,
  insertNewVideoConversation,
  insertNewVideoCharacter,
  insertNewVideoImage,
  insertNewVideoTurn,
  deleteNewVideoCharacter,
  getNewVideoCharacterRow,
  listNewVideoCharacters,
  listNewVideoCharactersByIds,
  listNewVideoConversationCastIds,
  listNewVideoConversations,
  listNewVideoImagesByIds,
  listNewVideoTurns,
  publicUrl,
  publicUrlIn,
  setNewVideoConversationCast,
  updateNewVideoCharacter,
  updateNewVideoConversation,
  updateNewVideoTurn,
  uploadFile,
  type NewVideoCharacterRow,
  type NewVideoConversationRow,
  type NewVideoImageRow,
  type NewVideoTurnRow,
  type SupabaseClient,
} from '@dgipr/database';
import { settleJobActivity } from '../activity/actor.js';
import {
  NEW_VIDEO_MAX_IMAGES,
  newVideoTitleFrom,
  type NewVideoAspect,
  type NewVideoCharacter,
  type NewVideoConversation,
  type NewVideoConversationSummary,
  type NewVideoImage,
  type NewVideoTurn,
  type NewVideoTurnIntentChoice,
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
// The cast (migration 0054)
// ---------------------------------------------------------------------------
//
// A conversation's characters come from the DEPARTMENT-WIDE registry, which is what makes a
// fresh conversation reproduce the same person: in the Gemini app "switching chats" carries
// nothing over, and consistency there comes from the user re-supplying the same portrait and
// description by hand. A stored cast does that automatically.

// The wire shape. `portraitPath` and `portraitMime` stay behind, exactly as an image row's do
// — the browser gets a public URL and an id this API minted, and nothing else.
export function toCharacterPayload(
  row: NewVideoCharacterRow,
): NewVideoCharacter {
  return {
    id: row.id,
    name: row.name,
    appearance: row.appearance,
    voice: row.voice,
    portraitUrl: row.portraitUrl,
    createdAt: row.createdAt,
  };
}

// Resolves the ids a turn request carried, preserving the order they were SENT in — which is
// the order their portraits are attached in, so a database-chosen order would bind a picture
// to the wrong name. An id we did not mint resolves to nothing and is reported, never
// silently dropped: rendering without a character the officer picked is exactly the "the
// model ignored my reference" complaint.
export async function resolveCharacters(
  client: SupabaseClient,
  ids: readonly string[],
): Promise<{ resolved: NewVideoCharacterRow[]; missing: string[] }> {
  const rows = await listNewVideoCharactersByIds(client, ids);
  const present = new Set(rows.map((row) => row.id));
  return {
    resolved: rows,
    missing: ids.filter((id) => !present.has(id)),
  };
}

// A conversation's stored cast, in the order it was picked. Two reads rather than a join,
// which is this repo's standing shape — and it also means the registry row is read FRESH, so
// a character edited after the conversation started is emitted as it is now.
export async function getConversationCharacters(
  client: SupabaseClient,
  conversationId: string,
): Promise<NewVideoCharacterRow[]> {
  const ids = await listNewVideoConversationCastIds(client, conversationId);
  if (ids.length === 0) return [];
  return listNewVideoCharactersByIds(client, ids);
}

// Written once, on the conversation's FIRST turn. There is no route that changes it later:
// a character's portrait is attached on the turn that establishes them, and stacking a new
// reference into the middle of an edit chain is a documented failure mode — so changing the
// cast is what starting a new conversation is for, which the registry makes cheap.
export async function setConversationCast(
  client: SupabaseClient,
  conversationId: string,
  characterIds: readonly string[],
): Promise<void> {
  await setNewVideoConversationCast(client, conversationId, characterIds);
}

// How many of a cast will spend one of the turn's reference-image slots. Only characters with
// a stored portrait do, and only on a turn that STARTS a chain — see the job below.
export function castPortraitCount(
  characters: readonly NewVideoCharacterRow[],
): number {
  return characters.filter((character) => character.portraitPath !== null)
    .length;
}

// The registry's own CRUD. Thin, like the conversation helpers above: the route parses and
// guards, this sequences, and @dgipr/database owns the query.

export async function listCharacters(
  client: SupabaseClient,
): Promise<NewVideoCharacterRow[]> {
  return listNewVideoCharacters(client);
}

export async function getCharacter(
  client: SupabaseClient,
  id: string,
): Promise<NewVideoCharacterRow | null> {
  return getNewVideoCharacterRow(client, id);
}

// What a character's portrait is, once an uploaded image id has been resolved to the object
// behind it. The three fields move together or not at all — a URL the page can show with
// bytes the job cannot fetch would be a character that renders on screen and vanishes from
// the video.
export type ResolvedPortrait = Readonly<{
  url: string;
  path: string;
  mimeType: string;
}>;

/**
 * Turns an uploaded image id into a portrait.
 *
 * `undefined` in means "not asked about" and comes straight back; explicit `null` means the
 * officer cleared it. `'missing'` is an id this API did not mint — reported rather than
 * dropped, because a character silently losing the picture that defines them is the exact
 * complaint this registry exists to answer.
 */
export async function resolvePortrait(
  client: SupabaseClient,
  imageId: string | null | undefined,
): Promise<ResolvedPortrait | null | 'missing'> {
  if (imageId === null || imageId === undefined) return null;
  const { resolved } = await resolveReferenceImages(client, [imageId]);
  const row = resolved[0];
  if (!row) return 'missing';
  return { url: row.url, path: row.storagePath, mimeType: row.mimeType };
}

export async function createCharacter(
  client: SupabaseClient,
  input: Readonly<{
    name: string;
    appearance: string;
    voice: string;
    portrait: ResolvedPortrait | null;
  }>,
): Promise<NewVideoCharacterRow> {
  return insertNewVideoCharacter(client, {
    name: input.name,
    appearance: input.appearance,
    voice: input.voice,
    portraitUrl: input.portrait?.url ?? null,
    portraitPath: input.portrait?.path ?? null,
    portraitMime: input.portrait?.mimeType ?? null,
  });
}

export async function editCharacter(
  client: SupabaseClient,
  id: string,
  patch: Readonly<{
    name?: string;
    appearance?: string;
    voice?: string;
    portrait?: ResolvedPortrait | null;
  }>,
): Promise<NewVideoCharacterRow | null> {
  return updateNewVideoCharacter(client, id, patch);
}

export async function removeCharacter(
  client: SupabaseClient,
  id: string,
): Promise<void> {
  await deleteNewVideoCharacter(client, id);
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

// ---------------------------------------------------------------------------
// Forking (Step 4)
// ---------------------------------------------------------------------------
//
// Independent testing reports character drift by turn 5, with turn 4 the reliable editing
// ceiling, and the API's own answer is to reference an OLDER interaction id with a new
// prompt. Every turn already stores the interaction that produced it, so the whole of this
// feature is choosing which one the next instruction continues from.
//
// A FORK IS NAMED BY A TURN ID, NOT AN INTERACTION ID. The provider handle never crosses the
// boundary — that is the rule the whole surface is built on — so the browser names a turn it
// can see and this resolves it against the turns of THAT conversation. An id from somewhere
// else resolves to nothing, which is what keeps a request from pointing a paid render at an
// interaction this conversation never made.

export type ForkPoint =
  | Readonly<{ ok: true; interactionId: string }>
  // 'unknown' is an id that is not a turn of this conversation; 'unfinished' is one that is,
  // but never produced a video — a failed turn, or one still rendering. They are told apart
  // because the answers an officer needs are different: re-open the page, versus wait.
  | Readonly<{ ok: false; reason: 'unknown' | 'unfinished' }>;

/**
 * Which interaction a fork continues from, out of the turns the caller has already listed.
 *
 * Pure, and deliberately so: it decides where a paid render starts from, and the two ways it
 * can be wrong are both silent — a turn from another conversation would edit a video the
 * officer is not looking at, and an unfinished one would continue from a render that has no
 * video yet. Both are cheaper to test than to reproduce.
 *
 * Forking from the CURRENT chain point is deliberately allowed: it resolves to the same
 * interaction the ordinary path would have used, so it is a no-op rather than an error. The
 * page does not offer it, but refusing a client that echoed it back would buy nothing.
 */
export function resolveForkPoint(
  turns: readonly NewVideoTurnRow[],
  fromTurnId: string,
): ForkPoint {
  const turn = turns.find((candidate) => candidate.id === fromTurnId);
  if (!turn) return { ok: false, reason: 'unknown' };
  // BOTH conditions, not just the status: the job records an interaction id BEFORE it waits
  // for the render, so a turn that is still generating has one and has no video behind it.
  if (turn.status !== 'completed' || turn.interactionId === null) {
    return { ok: false, reason: 'unfinished' };
  }
  return { ok: true, interactionId: turn.interactionId };
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
  characters: readonly NewVideoCharacterRow[] = [],
): NewVideoConversation {
  return {
    id: conversation.id,
    title: conversation.title,
    // Read fresh from the registry rather than denormalized onto the conversation, so an
    // edit to a character shows here — and so the composer can tell that this conversation's
    // cast is already fixed.
    characters: characters.map(toCharacterPayload),
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
//
// A FORK IS NO EXCEPTION, deliberately. A turn that continued from an older video still
// becomes the chain point when it succeeds, so the next plain instruction edits what the fork
// produced — the officer went back, made a change, and is now on that branch. Leaving the
// chain on the abandoned turn instead would mean every subsequent edit silently ignored the
// fork, which is the drift they were escaping.
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
  settleJobActivity(
    client,
    { kind: 'nvw_turn', id: turnId },
    'nvw_turn',
    'success',
  );
}

// Edit the video on screen, or a new clip — see video/new-video-intent.ts. Exported so the
// offline check can drive the non-model branches. Never throws: the classifier degrades to a
// deterministic fallback, and the turn-list read that feeds it is best-effort.
export async function decideTurnIntent(
  client: SupabaseClient,
  input: Readonly<{
    conversationId: string;
    turn: NewVideoTurnRow;
    chainPoint: string | null;
    forked: boolean;
    choice: NewVideoTurnIntentChoice;
    imageCount: number;
  }>,
): Promise<NewVideoIntentDecision> {
  if (input.chainPoint === null) {
    // Nothing on screen to edit: every such turn is a first turn, whatever was chosen.
    return { intent: 'new', source: 'first-turn', reason: '' };
  }
  if (input.forked) {
    return { intent: 'edit', source: 'fork', reason: '' };
  }
  if (input.choice !== 'auto') {
    return { intent: input.choice, source: 'officer', reason: '' };
  }
  // The instruction that produced the video on screen, so the classifier can tell "change
  // this" from "and now a different scene". Best-effort: the call still runs without it.
  let previousPrompt: string | null = null;
  try {
    const turns = await listNewVideoTurns(client, input.conversationId);
    previousPrompt =
      turns.find(
        (t) => t.status === 'completed' && t.interactionId === input.chainPoint,
      )?.prompt ?? null;
  } catch {
    previousPrompt = null;
  }
  return classifyNewVideoIntent({
    prompt: input.turn.prompt,
    previousPrompt,
    imageCount: input.imageCount,
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
  settleJobActivity(
    client,
    { kind: 'nvw_turn', id: turnId },
    'nvw_turn',
    'failed',
    message,
  );
}

// Fire and forget: the route has already answered 202 and the client is polling. Every failure
// lands on the TURN ROW, never on the process — which is also what makes a failure survive the
// restart that used to erase it.
//
// `aspect` is a JOB ARGUMENT rather than a column, which is the opposite of the choice the
// Dynamic Poster lane made for `motion_aspect` (0053) — and the difference is that there is no
// server-side retry here. That column exists because startPosterRegenerateJob re-reads the row,
// so a shape held only in the request would be lost on the first redo. Nothing re-runs a turn:
// a failed one is followed by a new turn the officer sends, carrying its own choice. So this
// needs no migration.
export function startNewVideoTurn(
  client: SupabaseClient,
  conversation: NewVideoConversationRow,
  turn: NewVideoTurnRow,
  referenceRows: readonly NewVideoImageRow[],
  aspect: NewVideoAspect,
  // The conversation's cast, resolved by the route from the registry. A job argument for the
  // same reason `aspect` is one: nothing re-runs a turn, so there is no redo that would have
  // to re-read it. It is stored on the CONVERSATION though, so the turn after this one gets
  // the same cast without the officer picking it again.
  characters: readonly NewVideoCharacterRow[] = [],
  // FORKING (Step 4): the interaction to continue from, RESOLVED BY THE ROUTE out of a turn
  // id the officer clicked. Null is the ordinary case — continue from whatever last
  // succeeded. A job argument for the reason `aspect` and `characters` are: nothing re-runs
  // a turn, so there is no redo that would have to re-read it, and a fork is a choice about
  // ONE instruction rather than a property of the conversation.
  forkFromInteractionId: string | null = null,
  // Edit the video on screen, or make a NEW clip. `auto` is decided below, per turn; see
  // video/new-video-intent.ts for why every follow-up can no longer be assumed to be an edit.
  intentChoice: NewVideoTurnIntentChoice = 'auto',
): void {
  void (async () => {
    try {
      await updateNewVideoTurn(client, turn.id, { status: 'generating' });

      // Read per turn rather than at boot, and read INSIDE the try: a typo in
      // NEW_VIDEO_PROMPT_MODE throws, and that belongs on the turn row where the officer can
      // see it, not on a process nobody is watching.
      const promptMode = newVideoPromptMode();

      // The chain point is read HERE, not at request time: a turn queued while an earlier one
      // was still generating must continue from whatever that one produced. Re-read from the
      // row for the same reason — the value may have moved since this job started. It is read
      // FIRST because it decides whether the cast's portraits are attached at all.
      //
      // A FORK OVERRIDES IT, and that override is the whole of Step 4: the officer picked an
      // OLDER turn to continue from, so re-reading the row here would faithfully undo the one
      // thing they asked for. The id was resolved by the route out of a turn of this very
      // conversation that actually produced a video, so it is never a guess. Everything
      // downstream follows from the result rather than from how it was chosen — a fork is
      // still an edit, so the cast's portraits stay unattached and no task field is sent.
      const current = await getNewVideoConversationRow(client, conversation.id);
      const chainPoint =
        forkFromInteractionId ?? current?.lastInteractionId ?? null;

      // EDIT OR NEW CLIP. Only a turn that HAS a video to continue from has a question to
      // answer. A "new" verdict drops the chain point for THIS request — Gemini then renders
      // it as a first turn, with a declared task and the cast's portraits — while the chain
      // rule is untouched: when the new clip succeeds it becomes the video the next plain
      // instruction edits, which is what the officer is now looking at.
      const intent = await decideTurnIntent(client, {
        conversationId: conversation.id,
        turn,
        chainPoint,
        forked: forkFromInteractionId !== null,
        choice: intentChoice,
        imageCount: referenceRows.length,
      });
      const previousInteractionId = intent.intent === 'new' ? null : chainPoint;
      const isEdit = previousInteractionId !== null;

      // A CHARACTER'S PORTRAIT IS ATTACHED ONLY ON THE TURN THAT ESTABLISHES THEM — the turn
      // that starts a chain. On a follow-up the character is already in the video the model
      // is editing, and re-sending their picture is the documented "stacking references in
      // one edit" failure; it would also re-index every <IMAGE_REF_n> tag mid-chain. Their
      // VOICE is still restated every turn, in the scaffold below, because a voice cannot be
      // repaired by a later instruction at all.
      //
      // On a NEW CLIP inside an existing conversation the portraits come back — the new clip
      // has never seen the character — but only as many as still fit beside the pictures the
      // officer attached. The route budgeted portrait slots only for a conversation's first
      // turn, so the cap is applied here, and the officer's own pictures win: they were
      // attached for this very clip. Trailing portraits are dropped, never re-ordered, so the
      // scaffold's tag arithmetic still counts from the front.
      const portraitCharacters = isEdit
        ? []
        : characters
            .filter((character) => character.portraitPath !== null)
            .slice(0, Math.max(0, NEW_VIDEO_MAX_IMAGES - referenceRows.length));

      // Downloaded now rather than held since the upload: a reference image may have been
      // attached minutes ago, and holding several of them per conversation is how a page
      // quietly becomes a memory problem.
      //
      // CAST PORTRAITS COME FIRST, IN CAST ORDER, and that ordering is load-bearing: the
      // scaffold assigns <IMAGE_REF_n> tags to characters by counting portraits from 0, so a
      // picture placed anywhere else would bind a tag to the wrong person.
      const referenceImages: InteractionImage[] = [];
      for (const character of portraitCharacters) {
        referenceImages.push({
          data: await downloadFile(
            client,
            POSTERS_BUCKET,
            character.portraitPath as string,
          ),
          mimeType: character.portraitMime ?? 'image/png',
        });
      }
      for (const image of referenceRows) {
        referenceImages.push({
          data: await downloadFile(client, POSTERS_BUCKET, image.storagePath),
          mimeType: image.mimeType,
        });
      }

      // What this lane wraps the officer's prompt in, built from two facts this function
      // already holds and never from the prompt itself. `isEdit` is read off the CHAIN POINT
      // rather than off the turn's position in the conversation: a turn whose predecessor
      // failed continues from whatever last succeeded, and a turn following only failures is
      // a fresh start that must not be told to preserve a video nobody has seen.
      //
      // Composed under `verbatim` too, and deliberately: passing it is what makes that mode
      // REFUSE rather than silently run a scaffolded turn through the comparison stance and
      // report the result as though the scaffolding had been tried. The only way to run this
      // lane verbatim is to mean it, and then there is nothing here to compare against.
      //
      // The cast travels with it on EVERY turn — first or follow-up — which is the whole of
      // Step 3: the voice description has to be restated each time or it is stated once and
      // never again, and this model cannot edit a voice afterwards.
      const scaffoldCharacters: ScaffoldCharacter[] = characters.map(
        (character): ScaffoldCharacter => ({
          name: character.name,
          appearance: character.appearance,
          voice: character.voice,
          hasPortrait: portraitCharacters.includes(character),
        }),
      );
      const scaffold =
        promptMode !== 'verbatim'
          ? buildNewVideoScaffold({
              imageCount: referenceImages.length,
              isEdit,
              characters: scaffoldCharacters,
            })
          : null;

      // STEP 5 — the one place on this lane that reads the officer's prompt. Everything above
      // is composed from a count, a boolean and registry rows; this turns their intent into
      // the Omni prompt language the two remedies that are about the SENTENCE require — a
      // spoken line in the colon form so the model does not burn it on as a subtitle, a
      // quoted scheme name left alone, timing blocks where they described a sequence.
      //
      // IT REPLACES THE TEXT IN THE MIDDLE AND NOTHING ELSE. The scaffold above still wraps
      // it, the tags are still ours, the voices are still verbatim from the registry — so
      // the two things a model must not be trusted with stay out of its hands.
      //
      // BEST-EFFORT, NEVER A GATE. A failure falls back to the officer's own words, which is
      // exactly the known-good `scaffolded` turn — so the worst case of this step is the
      // behaviour of the step before it, never a lost turn. That is the opposite call from
      // the client's refusal of a scaffold under `verbatim`, and the difference is that this
      // one cannot misreport anything: the log line below says which text was actually sent.
      //
      // The officer's original stays on the turn row and on the page. This is what was SENT,
      // not what was said, and the log is the only record of it: storing it would mean a new
      // column in TURN_COLUMNS, which is read on every poll, so an un-applied migration would
      // take the whole page down — the blast radius Step 4 declined for the same reason.
      let promptText = turn.prompt;
      let authored = false;
      if (promptModeAuthors(promptMode)) {
        try {
          promptText = await authorNewVideoPrompt({
            prompt: turn.prompt,
            isEdit,
            imageCount: referenceImages.length,
            characters: characters.map((character) => ({
              name: character.name,
            })),
          });
          authored = true;
          console.log(
            `[new-video-workflow ${conversation.id}/${turn.id}] authored prompt ` +
              `(${turn.prompt.length} -> ${promptText.length} chars):\n${promptText}`,
          );
        } catch (error) {
          console.warn(
            `[new-video-workflow ${conversation.id}/${turn.id}] prompt authoring ` +
              `failed, sending the officer's own words: ${
                error instanceof Error ? error.message : String(error)
              }`,
          );
        }
      }

      // The request-field half of the same decision the scaffold states in prose: an attached
      // picture is a REFERENCE to hold steady, not the clip's opening frame. Derived from the
      // same two facts so the tags and the declared task cannot describe different requests,
      // and sent in BOTH prompt modes — a field adds no character to the officer's prompt, so
      // it leaves the scaffolded-vs-verbatim comparison about the text alone (the
      // aspect-ratio precedent). Null on a follow-up, where a task breaks the edit chain.
      const videoTask = newVideoTaskFor({
        imageCount: referenceImages.length,
        isEdit,
      });

      console.log(
        `[new-video-workflow ${conversation.id}/${turn.id}] mode=${promptMode} ` +
          `images=${referenceImages.length} edit=${isEdit} ` +
          `intent=${intent.intent}(${intent.source}${intent.reason !== '' ? `: ${intent.reason}` : ''}) ` +
          `${forkFromInteractionId !== null ? 'forked ' : ''}` +
          `cast=${characters.length} portraits=${portraitCharacters.length} ` +
          `task=${videoTask ?? '(inferred)'} ` +
          `prompt=${authored ? 'authored' : "officer's"}`,
      );

      const started = await createVideoInteraction({
        // The officer's own string on every stance but `authored`, where it is the
        // instruction the pass above wrote from it. Either way the client inserts it
        // UNTOUCHED between the scaffold's blocks.
        prompt: promptText,
        images: referenceImages,
        previousInteractionId,
        // Sent as a request field, never appended to the prompt: the officer's shape is the
        // output's, not something the model has to be talked into.
        aspectRatio: aspect,
        // This lane's stance on scaffolding, and the blocks that fill it. The text above
        // still travels UNTOUCHED inside the composed result — the scaffold is built from a
        // count, a boolean and registry rows, and cannot see the prompt at all.
        //
        // Mapped down to the client's two values: it only ever decides whether IT adds text,
        // so an `authored` turn is a `scaffolded` one as far as it is concerned. Where the
        // text came from is this lane's business, not the client's.
        mode: interactionModeFor(promptMode),
        scaffold,
        videoTask,
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
