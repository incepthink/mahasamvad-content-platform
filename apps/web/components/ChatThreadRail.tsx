'use client';

// The rail of past chats: this browser's own above everyone else's.
//
// The split is ordering only (lib/chatDraft.ts) — every chat here is readable by anyone in the
// department, which is exactly why BOTH groups are listed here rather than only this browser's
// own: the rail showing everyone's chats is what says the surface is shared. It carried a
// sentence saying so too, removed on the officers' request as clutter.

import Link from 'next/link';
import { useState } from 'react';
import type { ChatThreadSummary } from '@dgipr/schemas';
import { MessageSquarePlus, Trash2, X } from 'lucide-react';
import { STR } from '../lib/strings';

function ThreadLink({
  thread,
  activeId,
  onOpen,
  onDelete,
  deleting,
}: {
  thread: ChatThreadSummary;
  activeId: string | null;
  onOpen: () => void;
  onDelete: (id: string) => void;
  deleting: string | null;
}) {
  const isActive = thread.id === activeId;
  return (
    <li className={isActive ? 'chat-rail-item active' : 'chat-rail-item'}>
      <Link
        href={`/chat/${thread.id}`}
        className="chat-rail-link"
        onClick={onOpen}
        aria-current={isActive ? 'page' : undefined}
      >
        {thread.title || STR.chatNew}
      </Link>
      <button
        type="button"
        className="chat-rail-delete"
        onClick={() => onDelete(thread.id)}
        disabled={deleting === thread.id}
        aria-label={STR.chatDelete}
        title={STR.chatDelete}
      >
        <Trash2 size={16} aria-hidden="true" />
      </button>
    </li>
  );
}

export function ChatThreadRail({
  mine,
  others,
  activeId,
  loading,
  error,
  open,
  onClose,
  onDelete,
  deleting,
}: {
  mine: readonly ChatThreadSummary[];
  others: readonly ChatThreadSummary[];
  activeId: string | null;
  loading: boolean;
  // Reported rather than folded into the empty state: "could not load" and "there are none"
  // are different facts, and showing the second when the first is true is a lie.
  error: string | null;
  // Drawer state, used below the two-pane breakpoint only.
  open: boolean;
  onClose: () => void;
  onDelete: (id: string) => void;
  deleting: string | null;
}) {
  const [confirming, setConfirming] = useState<string | null>(null);

  const requestDelete = (id: string) => {
    // Two steps, because a chat cannot be recovered and the button sits beside the one that
    // opens it. The same stance the publish button takes.
    if (confirming === id) {
      setConfirming(null);
      onDelete(id);
      return;
    }
    setConfirming(id);
  };

  const empty = mine.length === 0 && others.length === 0;

  return (
    <aside className={open ? 'chat-rail open' : 'chat-rail'}>
      <div className="chat-rail-head">
        <Link href="/chat" className="btn chat-rail-new" onClick={onClose}>
          <MessageSquarePlus size={18} aria-hidden="true" />
          <span>{STR.chatNew}</span>
        </Link>
        <button
          type="button"
          className="btn-ghost chat-rail-close"
          onClick={onClose}
          aria-label={STR.chatCloseList}
        >
          <X size={20} aria-hidden="true" />
        </button>
      </div>

      <div className="chat-rail-scroll">
        {loading ? (
          <p className="chat-rail-empty" role="status">
            <span className="spinner" aria-hidden="true" />
            <span className="visually-hidden">{STR.chatLoading}</span>
          </p>
        ) : null}
        {error !== null ? (
          <p className="chat-rail-error" role="alert">
            {STR.chatListFailed}
          </p>
        ) : null}
        {!loading && error === null && empty ? (
          <p className="chat-rail-empty">{STR.chatNoThreads}</p>
        ) : null}

        {mine.length > 0 ? (
          <>
            <h2 className="chat-rail-group">{STR.chatYours}</h2>
            <ul className="chat-rail-list">
              {mine.map((thread) => (
                <ThreadLink
                  key={thread.id}
                  thread={thread}
                  activeId={activeId}
                  onOpen={onClose}
                  onDelete={requestDelete}
                  deleting={deleting}
                />
              ))}
            </ul>
          </>
        ) : null}

        {others.length > 0 ? (
          <>
            <h2 className="chat-rail-group">{STR.chatOthers}</h2>
            <ul className="chat-rail-list">
              {others.map((thread) => (
                <ThreadLink
                  key={thread.id}
                  thread={thread}
                  activeId={activeId}
                  onOpen={onClose}
                  onDelete={requestDelete}
                  deleting={deleting}
                />
              ))}
            </ul>
          </>
        ) : null}

        {confirming !== null ? (
          <p className="chat-rail-confirm" role="alert">
            {STR.chatDeleteConfirm}{' '}
            <button
              type="button"
              className="chat-rail-confirm-cancel"
              onClick={() => setConfirming(null)}
            >
              नको
            </button>
          </p>
        ) : null}
      </div>
    </aside>
  );
}
