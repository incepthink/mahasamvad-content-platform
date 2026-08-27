'use client';

// The whole /chat surface: the rail on the left, the conversation on the right. Rendered by
// both routes — `/chat` with no id (a new conversation) and `/chat/[id]` with one — so the two
// pages are three lines each and there is exactly one place this layout lives.
//
// A new chat gets its URL WITHOUT a Next navigation (history.replaceState). Router.replace
// would remount this tree and kill the stream the officer is watching; all the URL has to do
// here is become reloadable and shareable, which replaceState achieves on its own. The rail
// still updates, because it is refreshed explicitly rather than by the route changing.

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PanelLeft } from 'lucide-react';
import { ChatConversation } from './ChatConversation';
import { ChatThreadRail } from './ChatThreadRail';
import { deleteChatThread } from '../lib/api';
import { forgetMyChatId } from '../lib/chatDraft';
import { STR } from '../lib/strings';
import { useChatAttachments } from '../lib/useChatAttachments';
import { useChatThread } from '../lib/useChatThread';
import { useChatThreadList } from '../lib/useChatThreadList';

export function ChatWorkspace({ threadId }: { threadId: string | null }) {
  const router = useRouter();
  const list = useChatThreadList();
  const [railOpen, setRailOpen] = useState(false);
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

  // The drawer is a mobile affordance; closing it on Escape matches the sidebar and TasksMenu.
  useEffect(() => {
    if (!railOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setRailOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [railOpen]);

  return (
    <main className="chat-page">
      {railOpen ? (
        <button
          type="button"
          className="chat-rail-scrim"
          aria-label={STR.chatCloseList}
          onClick={() => setRailOpen(false)}
        />
      ) : null}

      <ChatThreadRail
        mine={list.mine}
        others={list.others}
        activeId={chat.threadId}
        loading={list.loading}
        error={list.error}
        onRetry={() => void list.refresh()}
        open={railOpen}
        onClose={() => setRailOpen(false)}
        onDelete={(id) => void onDelete(id)}
        deleting={deleting}
      />

      <div className="chat-main">
        <header className="chat-bar">
          <button
            type="button"
            className="btn-ghost chat-bar-toggle"
            onClick={() => setRailOpen(true)}
            aria-label={STR.chatOpenList}
          >
            <PanelLeft size={20} aria-hidden="true" />
          </button>
          <h1 className="chat-bar-title">
            {chat.thread?.title || STR.chatTitle}
          </h1>
        </header>

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
      </div>
    </main>
  );
}
