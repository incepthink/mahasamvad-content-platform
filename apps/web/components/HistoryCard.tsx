import Link from 'next/link';
import type { GenerationSummary } from '@dgipr/schemas';
import { CATEGORY_LABELS, formatCost, formatDate, STR } from '../lib/strings';
import { StatusChip } from './StatusChip';

export function HistoryCard({ item }: { item: GenerationSummary }) {
  return (
    <Link href={`/generations/${item.id}`} className="history-card">
      {item.posterUrl ? (
        <img
          src={item.posterUrl}
          alt=""
          className="history-media"
          loading="lazy"
        />
      ) : (
        // No poster: a brand-gradient banner keeps every card the same shape.
        <div className="history-media history-banner" aria-hidden>
          <span className="history-banner-label">
            {CATEGORY_LABELS[item.category]}
          </span>
        </div>
      )}
      <div className="history-info">
        <StatusChip status={item.status} />
        <p className="history-headline">{item.headline ?? item.noteExcerpt}</p>
        <p className="history-excerpt">{item.noteExcerpt}</p>
        <p className="history-date">
          {formatDate(item.createdAt)}
          {item.costUsd !== null ? (
            <span className="history-cost">
              {' · '}
              {STR.costLabel} {formatCost(item.costUsd)}
            </span>
          ) : null}
        </p>
      </div>
    </Link>
  );
}

export function HistoryEmpty() {
  return (
    <div className="card">
      <p className="hint">{STR.historyEmpty}</p>
      <Link href="/" className="btn btn-primary" style={{ marginTop: 12, display: 'inline-block' }}>
        {STR.historyNew}
      </Link>
    </div>
  );
}

// Placeholder card shown while the history list loads. Mirrors the real card's
// shape (media block on top, then text lines) so the layout doesn't jump.
export function HistoryCardSkeleton() {
  return (
    <div className="history-card is-skeleton" aria-hidden>
      <div className="history-media skeleton" />
      <div className="history-info">
        <div className="skeleton skeleton-line" style={{ width: '35%' }} />
        <div className="skeleton skeleton-line" style={{ width: '90%' }} />
        <div className="skeleton skeleton-line" style={{ width: '70%' }} />
        <div className="skeleton skeleton-line" style={{ width: '45%' }} />
      </div>
    </div>
  );
}

export function HistorySkeletonGrid({ count = 9 }: { count?: number }) {
  return (
    <div className="history-grid" aria-busy>
      {Array.from({ length: count }).map((_, i) => (
        <HistoryCardSkeleton key={i} />
      ))}
    </div>
  );
}
