'use client';

// The recent-run list on /transcribe. Every run is visible and openable by anyone — same
// story as /dlo's shared list: there is no login and no owner column.
//
// A row OPENS IN PLACE (it sets the page's selected id) rather than linking to its own
// address: the result is a single block of text with nothing to do to it, so a whole route
// for it would be a navigation the officer has to come back from.

import type { TranscriptionSummary } from '@dgipr/schemas';
import { formatDate, STR, TRANSCRIPTION_STATUS_LABELS } from '../lib/strings';

function Row({
  item,
  active,
  onOpen,
}: {
  item: TranscriptionSummary;
  active: boolean;
  onOpen: () => void;
}) {
  const status = TRANSCRIPTION_STATUS_LABELS[item.status] ?? {
    label: item.status,
    chip: 'queued' as const,
  };
  return (
    <li className="dlo-work-row">
      <span className={`chip chip-${status.chip}`}>{status.label}</span>
      <button
        type="button"
        className="dlo-work-title transcribe-open"
        aria-current={active ? 'true' : undefined}
        onClick={onOpen}
      >
        {item.title}
      </button>
      <span className="dlo-work-meta">
        {item.fileCount > 1
          ? `${item.fileCount.toLocaleString('mr-IN')} ${STR.transcribeFileCountSuffix} · `
          : ''}
        {item.charCount > 0
          ? `${item.charCount.toLocaleString('mr-IN')} ${STR.transcribeCharsSuffix} · `
          : ''}
        {formatDate(item.createdAt)}
      </span>
    </li>
  );
}

export function TranscriptionList({
  items,
  loading,
  error,
  selectedId,
  onOpen,
}: {
  items: readonly TranscriptionSummary[];
  loading: boolean;
  error: string | null;
  selectedId: string | null;
  onOpen: (id: string) => void;
}) {
  return (
    <section className="card">
      <h2>{STR.transcribeRecent}</h2>
      {error ? (
        <p className="form-error">{STR.transcribeListLoadError}</p>
      ) : null}
      {loading ? <p className="hint">{STR.transcribeListLoading}</p> : null}
      {!loading && !error && items.length === 0 ? (
        <p className="hint">{STR.transcribeListEmpty}</p>
      ) : null}
      {items.length > 0 ? (
        <ul className="dlo-work-list">
          {items.map((item) => (
            <Row
              key={item.id}
              item={item}
              active={item.id === selectedId}
              onOpen={() => onOpen(item.id)}
            />
          ))}
        </ul>
      ) : null}
    </section>
  );
}
