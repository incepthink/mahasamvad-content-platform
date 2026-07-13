'use client';

// Thread strip on the generation detail page: every run spawned from the same
// note lineage (the original + all "next step" follow-ups + retries), as a
// horizontal rail of compact cards, oldest first with → connectors. The current
// page's run is highlighted and not a link; every other node navigates to its
// run. Renders nothing for a thread of one, so pre-feature pages are untouched.

import { Fragment } from 'react';
import Link from 'next/link';
import type { ThreadItem } from '@dgipr/schemas';
import { CATEGORY_LABELS, formatDateShort, STR } from '../lib/strings';
import { StatusChip } from './StatusChip';

function ThreadNode({
  item,
  isCurrent,
  isRoot,
}: {
  item: ThreadItem;
  isCurrent: boolean;
  isRoot: boolean;
}) {
  const body = (
    <>
      {item.posterUrl ? (
        <img src={item.posterUrl} alt="" className="thread-thumb" loading="lazy" />
      ) : (
        <div className="thread-thumb thread-thumb-banner" aria-hidden />
      )}
      <div className="thread-node-info">
        <p className="thread-node-category">
          {CATEGORY_LABELS[item.category]}
          {isRoot ? (
            <span className="thread-badge">{STR.threadRootBadge}</span>
          ) : null}
          {item.noteChanged ? (
            <span className="thread-badge">{STR.threadNoteEdited}</span>
          ) : null}
        </p>
        <StatusChip status={item.status} />
        <p className="thread-node-date">
          {isCurrent ? `${STR.threadCurrentBadge} · ` : ''}
          {formatDateShort(item.createdAt)}
        </p>
      </div>
    </>
  );

  const title = item.headline ?? item.noteExcerpt;
  if (isCurrent) {
    return (
      <div className="thread-node is-current" aria-current="page" title={title}>
        {body}
      </div>
    );
  }
  return (
    <Link
      href={`/generations/${item.id}`}
      className="thread-node"
      title={title}
    >
      {body}
    </Link>
  );
}

export function GenerationThread({
  items,
  currentId,
}: {
  items: ThreadItem[];
  currentId: string;
}) {
  if (items.length <= 1) return null;

  return (
    <section className="card thread-card">
      <h2>{STR.threadTitle}</h2>
      <p className="hint">{STR.threadHint}</p>
      <div className="thread-rail">
        {items.map((item, i) => (
          <Fragment key={item.id}>
            {i > 0 ? (
              <span className="thread-connector" aria-hidden>
                →
              </span>
            ) : null}
            <ThreadNode
              item={item}
              isCurrent={item.id === currentId}
              isRoot={i === 0}
            />
          </Fragment>
        ))}
      </div>
    </section>
  );
}
