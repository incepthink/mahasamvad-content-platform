'use client';

// The whole /new-video-workflow surface. Rendered by both routes — `/new-video-workflow` with
// no id (a new conversation) and `/new-video-workflow/[id]` with one — so the two pages are
// three lines each, exactly like /chat's.
//
// The LAYOUT is not here: the rail, the drawer, the collapse toggle and the narrow-screen bar
// all live in components/conversation/ConversationWorkspace, shared with /chat. A change to
// how the rail behaves lands on both surfaces at once, which is the point of that split.
//
// A conversation created by the first turn gets its URL WITHOUT a Next navigation
// (history.replaceState): router.replace would remount this tree in the middle of a
// generation the officer is watching and paying for. The rail is refreshed explicitly
// instead.

import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ConversationWorkspace } from './conversation/ConversationWorkspace';
import type { ConversationRailGroup } from './conversation/ConversationRail';
import { NewVideoConversationView } from './NewVideoConversation';
import { deleteNewVideoConversation } from '../lib/api';
import { forgetMyVideoConversationId } from '../lib/newVideoDraft';
import { STR } from '../lib/strings';
import { useNewVideoConversationList } from '../lib/useNewVideoConversationList';
import { useNewVideoWorkflow } from '../lib/useNewVideoWorkflow';

export function NewVideoWorkspace({
  conversationId,
}: {
  conversationId: string | null;
}) {
  const router = useRouter();
  const list = useNewVideoConversationList();
  const [deleting, setDeleting] = useState<string | null>(null);

  const onConversationCreated = useCallback(
    (id: string) => {
      window.history.replaceState(null, '', `/new-video-workflow/${id}`);
      void list.refresh();
    },
    [list],
  );

  const workflow = useNewVideoWorkflow(conversationId, onConversationCreated);

  const send = useCallback(
    async (prompt: string): Promise<boolean> => {
      const sent = await workflow.send(prompt);
      // The rail's title and ordering only exist once the turn has landed.
      if (sent) void list.refresh();
      return sent;
    },
    [list, workflow],
  );

  const onDelete = useCallback(
    async (id: string) => {
      setDeleting(id);
      try {
        await deleteNewVideoConversation(id);
        forgetMyVideoConversationId(id);
        await list.refresh();
        // Deleting the conversation you are reading leaves you on a dead id, so step back to
        // a new one.
        if (id === workflow.conversationId) router.push('/new-video-workflow');
      } catch {
        // Reported by the rail's own state; a failed delete leaves the conversation where it
        // was — including the deliberate 409 while a render is in flight.
      } finally {
        setDeleting(null);
      }
    },
    [list, router, workflow.conversationId],
  );

  const groups = useMemo<ConversationRailGroup[]>(
    () => [
      {
        label: STR.nvwYours,
        items: list.mine.map((row) => ({
          id: row.id,
          title: row.title || STR.nvwNewConversation,
          href: `/new-video-workflow/${row.id}`,
        })),
      },
      {
        label: STR.nvwOthers,
        items: list.others.map((row) => ({
          id: row.id,
          title: row.title || STR.nvwNewConversation,
          href: `/new-video-workflow/${row.id}`,
        })),
      },
    ],
    [list.mine, list.others],
  );

  return (
    <ConversationWorkspace
      groups={groups}
      activeId={workflow.conversationId}
      title={workflow.conversation?.title || STR.nvwTitle}
      newHref="/new-video-workflow"
      newLabel={STR.nvwNewConversation}
      emptyLabel={STR.nvwNoConversations}
      listFailedLabel={STR.nvwListFailed}
      deleteLabel={STR.nvwDelete}
      deleteConfirmLabel={STR.nvwDeleteConfirm}
      openListLabel={STR.nvwOpenList}
      loading={list.loading}
      error={list.error}
      onRetry={() => void list.refresh()}
      onDelete={(id) => void onDelete(id)}
      deleting={deleting}
    >
      <NewVideoConversationView
        conversation={workflow.conversation}
        images={workflow.images}
        loading={workflow.loading}
        sending={workflow.sending}
        busy={workflow.busy}
        error={workflow.error}
        {...(workflow.conversationId
          ? { onRetry: () => void workflow.refresh() }
          : {})}
        onAddImages={workflow.addImages}
        onRemoveImage={workflow.removeImage}
        onSend={send}
      />
    </ConversationWorkspace>
  );
}
