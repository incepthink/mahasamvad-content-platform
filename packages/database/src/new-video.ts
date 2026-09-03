// Persistence for /new-video-workflow — Gemini conversational video (see
// supabase/migrations/0050_new_video_conversations.sql).
//
// Same idioms as chat.ts, which this is modelled on: camelCase rows, a fromDbRow mapper,
// explicit column lists, patch updates that stamp updated_at. The structural point is the
// same one 0044 makes — a conversation grows a turn at a time, so its turns live in their own
// table rather than a jsonb array on the parent row.
//
// The rail's list query must never read new_video_turns. That is what the denormalized title,
// turn_count and last_turn_at columns are for: one prompt can be 20,000 characters, and the
// list is polled while a render runs.
//
// WHAT NEVER CROSSES INTO A PAYLOAD, and is why these rows carry more than the wire shapes do:
// `lastInteractionId` and `interactionId` (provider handles authenticated by our API key) and
// an image's `storagePath`/`mimeType`. The API maps rows to @dgipr/schemas shapes and drops
// those fields there.

import type { SupabaseClient } from '@supabase/supabase-js';

export const NEW_VIDEO_CONVERSATIONS_TABLE = 'new_video_conversations';
export const NEW_VIDEO_TURNS_TABLE = 'new_video_turns';
export const NEW_VIDEO_IMAGES_TABLE = 'new_video_images';

export type NewVideoTurnStatusValue =
  'queued' | 'generating' | 'completed' | 'failed';

// What a stored turn remembers about a reference picture. Denormalized off new_video_images so
// re-opening an old conversation needs no join — and still renders if the image row is gone.
export type NewVideoTurnImage = Readonly<{
  id: string;
  name: string;
  url: string;
}>;

export type NewVideoConversationRow = Readonly<{
  id: string;
  title: string;
  turnCount: number;
  lastTurnAt: string | null;
  lastInteractionId: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type NewVideoTurnRow = Readonly<{
  id: string;
  conversationId: string;
  prompt: string;
  images: readonly NewVideoTurnImage[];
  status: NewVideoTurnStatusValue;
  videoUrl: string | null;
  interactionId: string | null;
  modelText: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type NewVideoImageRow = Readonly<{
  id: string;
  displayName: string;
  url: string;
  storagePath: string;
  mimeType: string;
  createdAt: string;
}>;

type ConversationDbRow = {
  id: string;
  title: string | null;
  turn_count: number | null;
  last_turn_at: string | null;
  last_interaction_id: string | null;
  created_at: string;
  updated_at: string;
};

type TurnDbRow = {
  id: string;
  conversation_id: string;
  prompt: string | null;
  images: NewVideoTurnImage[] | null;
  status: NewVideoTurnStatusValue;
  video_url: string | null;
  interaction_id: string | null;
  model_text: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
};

type ImageDbRow = {
  id: string;
  display_name: string;
  url: string;
  storage_path: string;
  mime_type: string;
  created_at: string;
};

function conversationFromDbRow(
  row: ConversationDbRow,
): NewVideoConversationRow {
  return {
    id: row.id,
    title: row.title ?? '',
    turnCount: row.turn_count ?? 0,
    lastTurnAt: row.last_turn_at ?? null,
    lastInteractionId: row.last_interaction_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function turnFromDbRow(row: TurnDbRow): NewVideoTurnRow {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    prompt: row.prompt ?? '',
    images: row.images ?? [],
    status: row.status,
    videoUrl: row.video_url ?? null,
    interactionId: row.interaction_id ?? null,
    modelText: row.model_text ?? null,
    error: row.error ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function imageFromDbRow(row: ImageDbRow): NewVideoImageRow {
  return {
    id: row.id,
    displayName: row.display_name,
    url: row.url,
    storagePath: row.storage_path,
    mimeType: row.mime_type,
    createdAt: row.created_at,
  };
}

// Everything the rail shows and nothing more — never a prompt, which is the whole reason the
// counters above are columns.
const CONVERSATION_COLUMNS =
  'id,title,turn_count,last_turn_at,last_interaction_id,created_at,updated_at';

const TURN_COLUMNS =
  'id,conversation_id,prompt,images,status,video_url,interaction_id,model_text,error,created_at,updated_at';

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

export async function insertNewVideoConversation(
  client: SupabaseClient,
): Promise<NewVideoConversationRow> {
  const { data, error } = await client
    .from(NEW_VIDEO_CONVERSATIONS_TABLE)
    .insert({})
    .select(CONVERSATION_COLUMNS)
    .single();
  if (error) {
    throw new Error(`Failed to insert video conversation: ${error.message}`);
  }
  return conversationFromDbRow(data as unknown as ConversationDbRow);
}

export type NewVideoConversationPatch = Partial<
  Pick<
    NewVideoConversationRow,
    'title' | 'turnCount' | 'lastTurnAt' | 'lastInteractionId'
  >
>;

export async function updateNewVideoConversation(
  client: SupabaseClient,
  id: string,
  patch: NewVideoConversationPatch,
): Promise<void> {
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.title !== undefined) row.title = patch.title;
  if (patch.turnCount !== undefined) row.turn_count = patch.turnCount;
  if (patch.lastTurnAt !== undefined) row.last_turn_at = patch.lastTurnAt;
  if (patch.lastInteractionId !== undefined) {
    row.last_interaction_id = patch.lastInteractionId;
  }
  const { error } = await client
    .from(NEW_VIDEO_CONVERSATIONS_TABLE)
    .update(row)
    .eq('id', id);
  if (error) {
    throw new Error(
      `Failed to update video conversation ${id}: ${error.message}`,
    );
  }
}

export async function getNewVideoConversationRow(
  client: SupabaseClient,
  id: string,
): Promise<NewVideoConversationRow | null> {
  const { data, error } = await client
    .from(NEW_VIDEO_CONVERSATIONS_TABLE)
    .select(CONVERSATION_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (error) {
    throw new Error(
      `Failed to fetch video conversation ${id}: ${error.message}`,
    );
  }
  return data
    ? conversationFromDbRow(data as unknown as ConversationDbRow)
    : null;
}

// The rail. Most recently asked-for first. There is no auth and no owner column, so this is
// deliberately every conversation; the web splits it into "yours" and "others" for ORDERING
// only (lib/newVideoDraft.ts), exactly as the chat rail does.
export async function listNewVideoConversations(
  client: SupabaseClient,
  limit = 50,
): Promise<NewVideoConversationRow[]> {
  const { data, error } = await client
    .from(NEW_VIDEO_CONVERSATIONS_TABLE)
    .select(CONVERSATION_COLUMNS)
    .order('last_turn_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    throw new Error(`Failed to list video conversations: ${error.message}`);
  }
  return (data ?? []).map((row) =>
    conversationFromDbRow(row as unknown as ConversationDbRow),
  );
}

// The turns cascade (0050's foreign key), so this is one statement. The generated MP4s are
// deliberately left in the bucket: they are paid renders, and this repo does not delete those
// on a click aimed at a list row.
export async function deleteNewVideoConversation(
  client: SupabaseClient,
  id: string,
): Promise<void> {
  const { error } = await client
    .from(NEW_VIDEO_CONVERSATIONS_TABLE)
    .delete()
    .eq('id', id);
  if (error) {
    throw new Error(
      `Failed to delete video conversation ${id}: ${error.message}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Turns
// ---------------------------------------------------------------------------

export type NewNewVideoTurn = Readonly<{
  conversationId: string;
  prompt: string;
  images?: readonly NewVideoTurnImage[];
}>;

export async function insertNewVideoTurn(
  client: SupabaseClient,
  turn: NewNewVideoTurn,
): Promise<NewVideoTurnRow> {
  const { data, error } = await client
    .from(NEW_VIDEO_TURNS_TABLE)
    .insert({
      conversation_id: turn.conversationId,
      prompt: turn.prompt,
      images: turn.images ?? [],
      status: 'queued',
    })
    .select(TURN_COLUMNS)
    .single();
  if (error) {
    throw new Error(`Failed to insert video turn: ${error.message}`);
  }
  return turnFromDbRow(data as unknown as TurnDbRow);
}

export type NewVideoTurnPatch = Partial<
  Pick<
    NewVideoTurnRow,
    'status' | 'videoUrl' | 'interactionId' | 'modelText' | 'error'
  >
>;

export async function updateNewVideoTurn(
  client: SupabaseClient,
  id: string,
  patch: NewVideoTurnPatch,
): Promise<void> {
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.videoUrl !== undefined) row.video_url = patch.videoUrl;
  if (patch.interactionId !== undefined) {
    row.interaction_id = patch.interactionId;
  }
  if (patch.modelText !== undefined) row.model_text = patch.modelText;
  if (patch.error !== undefined) row.error = patch.error;
  const { error } = await client
    .from(NEW_VIDEO_TURNS_TABLE)
    .update(row)
    .eq('id', id);
  if (error) {
    throw new Error(`Failed to update video turn ${id}: ${error.message}`);
  }
}

// A whole conversation, oldest first. Paged because PostgREST silently caps a select at 1000
// rows (the listChatMessages precedent) — a conversation cannot realistically reach that, but
// a silently truncated one would lose its own beginning, which is the chain the next turn
// continues from.
export async function listNewVideoTurns(
  client: SupabaseClient,
  conversationId: string,
): Promise<NewVideoTurnRow[]> {
  const pageSize = 1_000;
  const rows: TurnDbRow[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await client
      .from(NEW_VIDEO_TURNS_TABLE)
      .select(TURN_COLUMNS)
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) {
      throw new Error(
        `Failed to list video turns for ${conversationId}: ${error.message}`,
      );
    }
    const page = (data ?? []) as unknown as TurnDbRow[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows.map(turnFromDbRow);
}

// ---------------------------------------------------------------------------
// Reference images
// ---------------------------------------------------------------------------

export type NewNewVideoImage = Readonly<{
  displayName: string;
  url: string;
  storagePath: string;
  mimeType: string;
}>;

export async function insertNewVideoImage(
  client: SupabaseClient,
  image: NewNewVideoImage,
): Promise<NewVideoImageRow> {
  const { data, error } = await client
    .from(NEW_VIDEO_IMAGES_TABLE)
    .insert({
      display_name: image.displayName,
      url: image.url,
      storage_path: image.storagePath,
      mime_type: image.mimeType,
    })
    .select()
    .single();
  if (error) {
    throw new Error(`Failed to insert video reference image: ${error.message}`);
  }
  return imageFromDbRow(data as unknown as ImageDbRow);
}

// Resolves the ids a turn request carried. An id this API did not mint resolves to nothing,
// which is what keeps a browser from pointing the model at an arbitrary object. The caller
// compares the returned set against what it asked for and refuses the difference.
export async function listNewVideoImagesByIds(
  client: SupabaseClient,
  ids: readonly string[],
): Promise<NewVideoImageRow[]> {
  if (ids.length === 0) return [];
  const { data, error } = await client
    .from(NEW_VIDEO_IMAGES_TABLE)
    .select()
    .in('id', [...ids]);
  if (error) {
    throw new Error(`Failed to fetch video reference images: ${error.message}`);
  }
  return (data ?? []).map((row) =>
    imageFromDbRow(row as unknown as ImageDbRow),
  );
}
