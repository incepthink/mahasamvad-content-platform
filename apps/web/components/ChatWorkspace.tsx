'use client';

// The whole /chat surface. Rendered by both routes — `/chat` with no id (a new conversation)
// and `/chat/[id]` with one — so the two pages are three lines each.
//
// The LAYOUT is not here: the rail, the drawer, the collapse toggle and the narrow-screen bar
// all live in components/conversation/ConversationWorkspace, shared with
// /new-video-workflow. What is here is chat's own data — the threads, the turn being
// streamed, the attachments — and the labels it gives that shell.
//
// A new chat gets its URL WITHOUT a Next navigation (history.replaceState). Router.replace
// would remount this tree and kill the stream the officer is watching; all the URL has to do
// here is become reloadable and shareable, which replaceState achieves on its own. The rail
// still updates, because it is refreshed explicitly rather than by the route changing.

import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChatConversation } from './ChatConversation';
import { ConversationWorkspace } from './conversation/ConversationWorkspace';
import type { ConversationRailGroup } from './conversation/ConversationRail';
import { deleteChatThread } from '../lib/api';
import { forgetMyChatId } from '../lib/chatDraft';
import { STR } from '../lib/strings';
import { useChatAttachments } from '../lib/useChatAttachments';
import { useChatThread } from '../lib/useChatThread';
import { useChatThreadList } from '../lib/useChatThreadList';

export function ChatWorkspace({ threadId }: { threadId: string | null }) {
  const router = useRouter();
  const list = useChatThreadList();
  const [deleting, setDeleting] = useState<string | null>(null);

  const onThreadCreated = useCallback(
    (id: string) => {
      window.history.replaceState(null, '', `/chat/${id}`);
      void list.refresh();
    },
    [list],
  );

  const chat = useChatThread(threadId, onThreadCreated);
  const attachments = useChatAttachments();

  const send = useCallback(
    async (content: string): Promise<boolean> => {
      // Nothing is awaited here on purpose. The turn is committed now — box cleared, question
      // on screen — and `prepare` runs inside it, so picking a large PDF and asking about it
      // in the same breath no longer means waiting for the upload before Send will even fire.
      // The tray empties itself as each attachment is carried (see useChatAttachments), which
      // is also what leaves a failed one behind with its message.
      const preview = attachments.preview();
      if (preview.length === 0 && content.trim() === '') return false;
      void chat
        .send({ content, preview, prepare: attachments.prepare })
        .then(() => {
          // The rail's title and ordering only exist once the turn has landed.
          void list.refresh();
        });
      return true;
    },
    [attachments, chat, list],
  );

  const onDelete = useCallback(
    async (id: string) => {
      setDeleting(id);
      try {
        await deleteChatThread(id);
        forgetMyChatId(id);
        await list.refresh();
        // Deleting the chat you are reading leaves you on a dead id, so step back to a new one.
        if (id === chat.threadId) router.push('/chat');
      } catch {
        // Reported by the rail's own state; a failed delete leaves the chat where it was.
      } finally {
        setDeleting(null);
      }
    },
    [chat.threadId, list, router],
  );

  const groups = useMemo<ConversationRailGroup[]>(
    () => [
      {
        label: STR.chatYours,
        items: list.mine.map((thread) => ({
          id: thread.id,
          title: thread.title || STR.chatNew,
          href: `/chat/${thread.id}`,
        })),
      },
      {
        label: STR.chatOthers,
        items: list.others.map((thread) => ({
          id: thread.id,
          title: thread.title || STR.chatNew,
          href: `/chat/${thread.id}`,
        })),
      },
    ],
    [list.mine, list.others],
  );

  return (
    <ConversationWorkspace
      groups={groups}
      activeId={chat.threadId}
      title={chat.thread?.title || STR.chatTitle}
      newHref="/chat"
      newLabel={STR.chatNew}
      emptyLabel={STR.chatNoThreads}
      listFailedLabel={STR.chatListFailed}
      deleteLabel={STR.chatDelete}
      deleteConfirmLabel={STR.chatDeleteConfirm}
      openListLabel={STR.chatOpenList}
      loading={list.loading}
      error={list.error}
      onRetry={() => void list.refresh()}
      onDelete={(id) => void onDelete(id)}
      deleting={deleting}
    >
      <ChatConversation
        thread={chat.thread}
        messages={chat.messages}
        streaming={chat.streaming}
        sending={chat.sending}
        loading={chat.loading}
        error={chat.error}
        attachments={attachments.attachments}
        preparing={attachments.preparing}
        full={attachments.full}
        onAddImages={attachments.addImages}
        onAddDocuments={attachments.addDocuments}
        onAddAudio={attachments.addAudio}
        onAddYouTube={attachments.addYouTube}
        onRemoveAttachment={attachments.remove}
        onSend={send}
        onStop={chat.stop}
      />
    </ConversationWorkspace>
  );
}
