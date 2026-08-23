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
export const CHAT_FILES_TABLE = 'chat_files';

export type ChatRole = 'user' | 'assistant';

// What an attachment became by the time it was sent. Images keep a public URL; native PDFs
// keep a trusted chat_files id; audio, YouTube and legacy documents keep extracted text.
export type ChatAttachmentKind = 'image' | 'document' | 'audio' | 'youtube';

export type ChatAttachmentEntry = Readonly<{
  kind: ChatAttachmentKind;
  // What to call it in the bubble: a file name, or a video's title.
  name: string;
  // 'image' only — the public object URL, which is both what the bubble renders and what the
  // model is given as an image_url part.
  imageUrl?: string;
  // Native PDF only. Resolves server-side through chat_files; no provider URI is accepted
  // from the browser or stored on the message itself.
  documentId?: string;
  // Audio, YouTube and legacy non-PDF documents — extracted/transcribed request text.
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
  interactionId: string | null;
  createdAt: string;
}>;

export type ChatFileRow = Readonly<{
  id: string;
  threadId: string | null;
  displayName: string;
  mimeType: 'application/pdf';
  storagePath: string;
  geminiFileName: string;
  geminiFileUri: string;
  geminiExpiresAt: string;
  createdAt: string;
  updatedAt: string;
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
  gemini_interaction_id: string | null;
  created_at: string;
};

type ChatFileDbRow = {
  id: string;
  thread_id: string | null;
  display_name: string;
  mime_type: 'application/pdf';
  storage_path: string;
  gemini_file_name: string;
  gemini_file_uri: string;
  gemini_expires_at: string;
  created_at: string;
  updated_at: string;
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
    interactionId: row.gemini_interaction_id,
    createdAt: row.created_at,
  };
}

function fileFromDbRow(row: ChatFileDbRow): ChatFileRow {
  return {
    id: row.id,
    threadId: row.thread_id,
    displayName: row.display_name,
    mimeType: row.mime_type,
    storagePath: row.storage_path,
    geminiFileName: row.gemini_file_name,
    geminiFileUri: row.gemini_file_uri,
    geminiExpiresAt: row.gemini_expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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
  interactionId?: string;
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
      ...(message.interactionId !== undefined
        ? { gemini_interaction_id: message.interactionId }
        : {}),
    })
    .select()
    .single();
  if (error) {
    throw new Error(`Failed to insert chat message: ${error.message}`);
  }
  return messageFromDbRow(data as unknown as ChatMessageDbRow);
}

export type NewChatFile = Readonly<{
  displayName: string;
  mimeType: 'application/pdf';
  storagePath: string;
  geminiFileName: string;
  geminiFileUri: string;
  geminiExpiresAt: string;
}>;

export async function insertChatFile(
  client: SupabaseClient,
  file: NewChatFile,
): Promise<ChatFileRow> {
  const { data, error } = await client
    .from(CHAT_FILES_TABLE)
    .insert({
      display_name: file.displayName,
      mime_type: file.mimeType,
      storage_path: file.storagePath,
      gemini_file_name: file.geminiFileName,
      gemini_file_uri: file.geminiFileUri,
      gemini_expires_at: file.geminiExpiresAt,
    })
    .select()
    .single();
  if (error) throw new Error(`Failed to insert chat file: ${error.message}`);
  return fileFromDbRow(data as unknown as ChatFileDbRow);
}

export async function getChatFile(
  client: SupabaseClient,
  id: string,
): Promise<ChatFileRow | null> {
  const { data, error } = await client
    .from(CHAT_FILES_TABLE)
    .select()
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`Failed to fetch chat file ${id}: ${error.message}`);
  return data ? fileFromDbRow(data as unknown as ChatFileDbRow) : null;
}

export async function attachChatFile(
  client: SupabaseClient,
  id: string,
  threadId: string,
): Promise<ChatFileRow | null> {
  const current = await getChatFile(client, id);
  if (!current || (current.threadId !== null && current.threadId !== threadId)) {
    return null;
  }
  if (current.threadId === threadId) return current;
  const { data, error } = await client
    .from(CHAT_FILES_TABLE)
    .update({ thread_id: threadId, updated_at: new Date().toISOString() })
    .eq('id', id)
    .is('thread_id', null)
    .select()
    .maybeSingle();
  if (error) throw new Error(`Failed to attach chat file ${id}: ${error.message}`);
  return data ? fileFromDbRow(data as unknown as ChatFileDbRow) : null;
}

export async function updateChatFileGeminiHandle(
  client: SupabaseClient,
  id: string,
  handle: Readonly<{
    geminiFileName: string;
    geminiFileUri: string;
    geminiExpiresAt: string;
  }>,
): Promise<ChatFileRow> {
  const { data, error } = await client
    .from(CHAT_FILES_TABLE)
    .update({
      gemini_file_name: handle.geminiFileName,
      gemini_file_uri: handle.geminiFileUri,
      gemini_expires_at: handle.geminiExpiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single();
  if (error) throw new Error(`Failed to refresh chat file ${id}: ${error.message}`);
  return fileFromDbRow(data as unknown as ChatFileDbRow);
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
