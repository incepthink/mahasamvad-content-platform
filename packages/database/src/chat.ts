// Persistence for the general assistant at /chat (see
// supabase/migrations/0044_chat_threads.sql).
//
// Same idioms as transcriptions.ts — camelCase rows, a fromDbRow mapper, a SUMMARY_COLUMNS
// list for the list query, patch updates that stamp updated_at. The one structural difference
// is that a chat's items live in their OWN table rather than a jsonb array, because a
// conversation grows a turn at a time; the migration header explains why that matters.
//
// The rail's list query must never read chat_messages. That is what the denormalized title,
// message_count and last_message_at columns are for.

import type { SupabaseClient } from '@supabase/supabase-js';

export const CHAT_THREADS_TABLE = 'chat_threads';
export const CHAT_MESSAGES_TABLE = 'chat_messages';

export type ChatRole = 'user' | 'assistant';

// What an attachment became by the time it was sent. Only 'image' keeps bytes (a public URL);
// the other three are reduced to TEXT before the message is ever posted, which is what makes
// reopening a chat free — nothing is re-extracted and nothing is re-transcribed.
export type ChatAttachmentKind = 'image' | 'document' | 'audio' | 'youtube';

export type ChatAttachmentEntry = Readonly<{
  kind: ChatAttachmentKind;
  // What to call it in the bubble: a file name, or a video's title.
  name: string;
  // 'image' only — the public object URL, which is both what the bubble renders and what the
  // model is given as an image_url part.
  imageUrl?: string;
  // Every non-image kind — the extracted or transcribed text folded into the request.
  text?: string;
  chars?: number;
  // 'youtube' only — the canonical watch URL, so the bubble can link the source.
  sourceUrl?: string;
}>;

export type ChatMessageRow = Readonly<{
  id: string;
  threadId: string;
  role: ChatRole;
  content: string;
  attachments: readonly ChatAttachmentEntry[];
  model: string | null;
  costUsd: number | null;
  error: string | null;
  createdAt: string;
}>;

export type ChatThreadRow = Readonly<{
  id: string;
  title: string;
  messageCount: number;
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
}>;

type ChatThreadDbRow = {
  id: string;
  title: string | null;
  message_count: number | null;
  last_message_at: string | null;
  created_at: string;
  updated_at: string;
};

type ChatMessageDbRow = {
  id: string;
  thread_id: string;
  role: ChatRole;
  content: string | null;
  attachments: ChatAttachmentEntry[] | null;
  model: string | null;
  cost_usd: number | string | null;
  error: string | null;
  created_at: string;
};

function threadFromDbRow(row: ChatThreadDbRow): ChatThreadRow {
  return {
    id: row.id,
    title: row.title ?? '',
    messageCount: row.message_count ?? 0,
    lastMessageAt: row.last_message_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function messageFromDbRow(row: ChatMessageDbRow): ChatMessageRow {
  return {
    id: row.id,
    threadId: row.thread_id,
    role: row.role,
    content: row.content ?? '',
    attachments: row.attachments ?? [],
    model: row.model,
    // PostgREST returns `numeric` as a string, which would otherwise reach the payload as
    // "0.004200" and sum as concatenation.
    costUsd: row.cost_usd === null ? null : Number(row.cost_usd),
    error: row.error,
    createdAt: row.created_at,
  };
}

// Everything the rail shows and nothing more — never `content` or `attachments`, which is the
// whole reason the counters above are columns.
const THREAD_COLUMNS =
  'id,title,message_count,last_message_at,created_at,updated_at';

export async function insertChatThread(
  client: SupabaseClient,
): Promise<ChatThreadRow> {
  const { data, error } = await client
    .from(CHAT_THREADS_TABLE)
    .insert({})
    .select(THREAD_COLUMNS)
    .single();
  if (error) {
    throw new Error(`Failed to insert chat thread: ${error.message}`);
  }
  return threadFromDbRow(data as unknown as ChatThreadDbRow);
}

export type ChatThreadPatch = Partial<
  Pick<ChatThreadRow, 'title' | 'messageCount' | 'lastMessageAt'>
>;

export async function updateChatThread(
  client: SupabaseClient,
  id: string,
  patch: ChatThreadPatch,
): Promise<void> {
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.title !== undefined) row.title = patch.title;
  if (patch.messageCount !== undefined) row.message_count = patch.messageCount;
  if (patch.lastMessageAt !== undefined) {
    row.last_message_at = patch.lastMessageAt;
  }
  const { error } = await client
    .from(CHAT_THREADS_TABLE)
    .update(row)
    .eq('id', id);
  if (error) {
    throw new Error(`Failed to update chat thread ${id}: ${error.message}`);
  }
}

export async function getChatThread(
  client: SupabaseClient,
  id: string,
): Promise<ChatThreadRow | null> {
  const { data, error } = await client
    .from(CHAT_THREADS_TABLE)
    .select(THREAD_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to fetch chat thread ${id}: ${error.message}`);
  }
  return data ? threadFromDbRow(data as unknown as ChatThreadDbRow) : null;
}

// The rail. Most recently talked to first — `last_message_at` rather than `updated_at`, which
// also moves when the title is backfilled. There is no auth and no owner column, so this is
// deliberately every chat; the web splits it into "yours" and "others" for ordering only.
export async function listChatThreads(
  client: SupabaseClient,
  limit = 50,
): Promise<ChatThreadRow[]> {
  const { data, error } = await client
    .from(CHAT_THREADS_TABLE)
    .select(THREAD_COLUMNS)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    throw new Error(`Failed to list chat threads: ${error.message}`);
  }
  return (data ?? []).map((row) =>
    threadFromDbRow(row as unknown as ChatThreadDbRow),
  );
}

// The messages cascade (0044's foreign key), so this is one statement.
export async function deleteChatThread(
  client: SupabaseClient,
  id: string,
): Promise<void> {
  const { error } = await client.from(CHAT_THREADS_TABLE).delete().eq('id', id);
  if (error) {
    throw new Error(`Failed to delete chat thread ${id}: ${error.message}`);
  }
}

export type NewChatMessage = Readonly<{
  threadId: string;
  role: ChatRole;
  content: string;
  attachments?: readonly ChatAttachmentEntry[];
  model?: string;
  costUsd?: number;
  error?: string;
}>;

export async function insertChatMessage(
  client: SupabaseClient,
  message: NewChatMessage,
): Promise<ChatMessageRow> {
  const { data, error } = await client
    .from(CHAT_MESSAGES_TABLE)
    .insert({
      thread_id: message.threadId,
      role: message.role,
      content: message.content,
      attachments: message.attachments ?? [],
      // Omitted rather than sent as null so a column added later cannot be clobbered by an
      // older caller (the insertGeneration idiom).
      ...(message.model !== undefined ? { model: message.model } : {}),
      ...(message.costUsd !== undefined ? { cost_usd: message.costUsd } : {}),
      ...(message.error !== undefined ? { error: message.error } : {}),
    })
    .select()
    .single();
  if (error) {
    throw new Error(`Failed to insert chat message: ${error.message}`);
  }
  return messageFromDbRow(data as unknown as ChatMessageDbRow);
}

// A whole conversation, oldest first — both what the page renders and what the next request to
// the model is built from. Paged because PostgREST silently caps a select at 1000 rows, and a
// long-running chat is exactly the shape that would hit it and then quietly lose its own
// beginning (the listUsageEvents precedent).
export async function listChatMessages(
  client: SupabaseClient,
  threadId: string,
): Promise<ChatMessageRow[]> {
  const pageSize = 1_000;
  const rows: ChatMessageDbRow[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await client
      .from(CHAT_MESSAGES_TABLE)
      .select()
      .eq('thread_id', threadId)
      .order('created_at', { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) {
      throw new Error(
        `Failed to list chat messages for ${threadId}: ${error.message}`,
      );
    }
    const page = (data ?? []) as unknown as ChatMessageDbRow[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows.map(messageFromDbRow);
}
