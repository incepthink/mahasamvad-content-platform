'use client';

// The layout every conversation surface sits in: the rail on the left, the current
// conversation on the right. Shared by /chat and /new-video-workflow.
//
// What lives here is everything neither surface should have to re-decide — the full-viewport
// grid, the drawer and its scrim below the two-pane breakpoint, Escape closing that drawer,
// the collapse state, and the narrow-screen bar that carries the drawer toggle and the title.
// What does NOT live here is anything about messages or videos: the body is `children`.
//
// The grid is a DEFINITE height (see .conv-page) so the two scrollers inside it bound
// themselves instead of growing the document. That is why a conversation surface opts out of
// the ordinary `.page` layout, and why the body it is handed must manage its own scrolling.

import { useEffect, useState, type ReactNode } from 'react';
import { PanelLeft } from 'lucide-react';
import {
  ConversationRail,
  type ConversationRailGroup,
} from './ConversationRail';
import { STR } from '../../lib/strings';
import { useRailCollapse } from '../../lib/useRailCollapse';

export function ConversationWorkspace({
  groups,
  activeId,
  title,
  newHref,
  newLabel,
  emptyLabel,
  listFailedLabel,
  deleteLabel,
  deleteConfirmLabel,
  openListLabel,
  loading,
  error,
  onRetry,
  onDelete,
  deleting,
  children,
}: {
  groups: readonly ConversationRailGroup[];
  activeId: string | null;
  // Named for the narrow-screen bar and for screen readers at every width; the wide layout
  // hides it visually because the rail already says which conversation is open.
  title: string;
  newHref: string;
  newLabel: string;
  emptyLabel: string;
  listFailedLabel: string;
  deleteLabel: string;
  deleteConfirmLabel: string;
  openListLabel: string;
  loading: boolean;
  error: string | null;
  onRetry?: () => void;
  onDelete?: (id: string) => void;
  deleting: string | null;
  children: ReactNode;
}) {
  const [railOpen, setRailOpen] = useState(false);
  const { collapsed, toggle } = useRailCollapse();

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
    <main className={collapsed ? 'conv-page rail-collapsed' : 'conv-page'}>
      {railOpen ? (
        <button
          type="button"
          className="conv-scrim"
          aria-label={STR.chatCloseList}
          onClick={() => setRailOpen(false)}
        />
      ) : null}

      <ConversationRail
        groups={groups}
        activeId={activeId}
        newHref={newHref}
        newLabel={newLabel}
        emptyLabel={emptyLabel}
        listFailedLabel={listFailedLabel}
        deleteLabel={deleteLabel}
        deleteConfirmLabel={deleteConfirmLabel}
        loading={loading}
        error={error}
        {...(onRetry ? { onRetry } : {})}
        open={railOpen}
        onClose={() => setRailOpen(false)}
        {...(onDelete ? { onDelete } : {})}
        deleting={deleting}
        collapsed={collapsed}
        onToggleCollapsed={toggle}
      />

      <div className="conv-main">
        <header className="conv-bar">
          <button
            type="button"
            className="btn-ghost conv-bar-toggle"
            onClick={() => setRailOpen(true)}
            aria-label={openListLabel}
          >
            <PanelLeft size={20} aria-hidden="true" />
          </button>
          <h1 className="conv-bar-title">{title}</h1>
        </header>

        {children}
      </div>
    </main>
  );
}
