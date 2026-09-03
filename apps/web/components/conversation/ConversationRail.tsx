'use client';

// The rail of past conversations, shared by /chat and /new-video-workflow.
//
// ONE COMPONENT ON PURPOSE. Both surfaces are the same thing structurally — a list of past
// work on the left, the current one on the right — and they were drifting the moment there
// were two of them. Everything a surface legitimately differs about arrives as a prop: the
// groups and their headings, where "new" goes, what the delete confirmation says. Nothing
// about a chat or a video is known in here.
//
// The groups themselves are ORDERING ONLY (lib/chatDraft.ts, lib/newVideoDraft.ts). Every
// conversation in this rail is readable by anyone in the department, which is exactly why
// EVERYONE's are listed rather than only this browser's own: the rail showing the whole
// department's work is what says the surface is shared.

import Link from 'next/link';
import { useState } from 'react';
import {
  PanelLeftClose,
  PanelLeftOpen,
  SquarePen,
  Trash2,
  X,
} from 'lucide-react';
import { STR } from '../../lib/strings';
import { ErrorNotice } from '../ErrorNotice';

// One row. Deliberately the smallest shape that can be rendered: an id to mark active, a
// title to show, and where clicking it goes. A caller that wants to show a count or a date
// should add it here rather than fork the component.
export type ConversationRailItem = Readonly<{
  id: string;
  title: string;
  href: string;
}>;

export type ConversationRailGroup = Readonly<{
  // Skipped entirely when the group is empty, so a heading never stands over nothing.
  label: string;
  items: readonly ConversationRailItem[];
}>;

function RailLink({
  item,
  activeId,
  onOpen,
  onDelete,
  deleting,
  deleteLabel,
}: {
  item: ConversationRailItem;
  activeId: string | null;
  onOpen: () => void;
  onDelete: ((id: string) => void) | undefined;
  deleting: string | null;
  deleteLabel: string;
}) {
  const isActive = item.id === activeId;
  return (
    <li className={isActive ? 'conv-rail-item active' : 'conv-rail-item'}>
      <Link
        href={item.href}
        className="conv-rail-link"
        onClick={onOpen}
        aria-current={isActive ? 'page' : undefined}
      >
        {item.title}
      </Link>
      {onDelete ? (
        <button
          type="button"
          className="conv-rail-delete"
          onClick={() => onDelete(item.id)}
          disabled={deleting === item.id}
          aria-label={deleteLabel}
          title={deleteLabel}
        >
          <Trash2 size={16} aria-hidden="true" />
        </button>
      ) : null}
    </li>
  );
}

export function ConversationRail({
  groups,
  activeId,
  newHref,
  newLabel,
  emptyLabel,
  listFailedLabel,
  deleteLabel,
  deleteConfirmLabel,
  loading,
  error,
  onRetry,
  open,
  onClose,
  onDelete,
  deleting,
  collapsed,
  onToggleCollapsed,
}: {
  groups: readonly ConversationRailGroup[];
  activeId: string | null;
  newHref: string;
  newLabel: string;
  emptyLabel: string;
  listFailedLabel: string;
  deleteLabel: string;
  deleteConfirmLabel: string;
  loading: boolean;
  // Reported rather than folded into the empty state: "could not load" and "there are none"
  // are different facts, and showing the second when the first is true is a lie.
  error: string | null;
  onRetry?: () => void;
  // Drawer state, used below the two-pane breakpoint only.
  open: boolean;
  onClose: () => void;
  // Omitted by a surface where a conversation cannot be deleted; the row then has no button
  // rather than a disabled one.
  onDelete?: (id: string) => void;
  deleting: string | null;
  // The icon-strip toggle, mirroring the app sidebar's. Wide screens only — see the CSS.
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  const [confirming, setConfirming] = useState<string | null>(null);

  const requestDelete = (id: string) => {
    // Two steps, because a conversation cannot be recovered and the button sits beside the
    // one that opens it. The same stance the publish button takes.
    if (confirming === id) {
      setConfirming(null);
      onDelete?.(id);
      return;
    }
    setConfirming(id);
  };

  const empty = groups.every((group) => group.items.length === 0);

  // `open` is only ever true below the two-pane breakpoint, where the rail is a DRAWER — an
  // overlay the officer has just asked to see. Collapsing is meaningless there and, left
  // unguarded, is actively wrong: the collapsed state is remembered across widths, so an
  // officer who collapsed on a desktop would open the drawer on their phone to an empty
  // strip. So the strip is the collapsed state AND no drawer.
  const iconStrip = collapsed && !open;

  return (
    <aside
      className={['conv-rail', open ? 'open' : '', iconStrip ? 'collapsed' : '']
        .filter(Boolean)
        .join(' ')}
    >
      <div className="conv-rail-head">
        <Link
          href={newHref}
          className="btn conv-rail-new"
          onClick={onClose}
          // Collapsed the label is gone, so the button needs one of its own.
          title={iconStrip ? newLabel : undefined}
          aria-label={iconStrip ? newLabel : undefined}
        >
          <SquarePen size={18} aria-hidden="true" />
          <span className="conv-rail-new-label">{newLabel}</span>
        </Link>

        {/* Wide screens: collapse to an icon strip, remembered across both surfaces
            (useRailCollapse). Narrow screens: the rail is a drawer, where "collapse" has no
            meaning and this control is hidden by CSS in favour of the close button below. */}
        <button
          type="button"
          className="btn-ghost conv-rail-collapse"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? STR.railExpand : STR.railCollapse}
          title={collapsed ? STR.railExpand : STR.railCollapse}
          aria-expanded={!collapsed}
        >
          {collapsed ? (
            <PanelLeftOpen size={20} aria-hidden="true" />
          ) : (
            <PanelLeftClose size={20} aria-hidden="true" />
          )}
        </button>

        <button
          type="button"
          className="btn-ghost conv-rail-close"
          onClick={onClose}
          aria-label={STR.chatCloseList}
        >
          <X size={20} aria-hidden="true" />
        </button>
      </div>

      {/* Collapsed, the list is not rendered at all rather than hidden with CSS: a strip of
          clipped titles is noise, and there is nothing here a screen reader gains from
          reading a list the officer has explicitly put away. */}
      {iconStrip ? null : (
        <div className="conv-rail-scroll">
          {loading ? (
            <p className="conv-rail-empty" role="status">
              <span className="spinner" aria-hidden="true" />
              <span className="visually-hidden">{STR.chatLoading}</span>
            </p>
          ) : null}
          {error !== null ? (
            <ErrorNotice
              className="conv-rail-notice"
              message={error}
              fallback={listFailedLabel}
              onRetry={onRetry}
            />
          ) : null}
          {!loading && error === null && empty ? (
            <p className="conv-rail-empty">{emptyLabel}</p>
          ) : null}

          {groups.map((group) =>
            group.items.length > 0 ? (
              <div key={group.label}>
                <h2 className="conv-rail-group">{group.label}</h2>
                <ul className="conv-rail-list">
                  {group.items.map((item) => (
                    <RailLink
                      key={item.id}
                      item={item}
                      activeId={activeId}
                      onOpen={onClose}
                      onDelete={onDelete ? requestDelete : undefined}
                      deleting={deleting}
                      deleteLabel={deleteLabel}
                    />
                  ))}
                </ul>
              </div>
            ) : null,
          )}

          {confirming !== null ? (
            <p className="conv-rail-confirm" role="alert">
              {deleteConfirmLabel}{' '}
              <button
                type="button"
                className="conv-rail-confirm-cancel"
                onClick={() => setConfirming(null)}
              >
                {STR.railCancel}
              </button>
            </p>
          ) : null}
        </div>
      )}
    </aside>
  );
}
