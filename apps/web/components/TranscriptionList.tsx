'use client';

// The recent-run list on /transcribe. Every run is visible and openable by anyone — same
// story as /dlo's shared list: there is no login and no owner column.
//
// It is folded shut by default and paged, for the reason /dlo's list is: the API returns
// every transcription the department has ever made, and an unbounded list under a form
// pushes the form's own inputs off the screen within a week of use. The fold follows the
// house rule that a collapsed row may hide the CONTROL but never the ANSWER, so the head
// states how many runs are in there.
//
// A row OPENS IN PLACE (it sets the page's selected id) rather than linking to its own
// address: the result is a single block of text with nothing to do to it, so a whole route
// for it would be a navigation the officer has to come back from. That is the one thing
// this list does differently from /dlo's, and it is why the title is a <button>.

import { useState } from 'react';
import { History } from 'lucide-react';
import type { TranscriptionSummary } from '@dgipr/schemas';
import { formatDate, STR, TRANSCRIPTION_STATUS_LABELS } from '../lib/strings';
import { Disclosure } from './Disclosure';
import { ErrorNotice } from './ErrorNotice';
import { FileName } from './FileName';
import { Pagination } from './Pagination';
import { FILE_TITLE_MAX_CHARS } from '../lib/fileName';

// Enough that a day's work is one page, small enough that the folded-open list does not
// become the page again. /dlo's list uses the same number.
const PAGE_SIZE = 8;

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
        {/* A transcription is titled with its first recording's file name. */}
        <FileName name={item.title} max={FILE_TITLE_MAX_CHARS} />
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
  onRetry,
}: {
  items: readonly TranscriptionSummary[];
  loading: boolean;
  error: string | null;
  selectedId: string | null;
  onOpen: (id: string) => void;
  onRetry?: () => void;
}) {
  const [page, setPage] = useState(1);

  const pageCount = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  // The list polls while this browser's own run is going, so it can grow and shrink under
  // the reader. Clamping on read rather than resetting keeps the officer where they were
  // whenever that page still exists.
  const safePage = Math.min(page, pageCount);
  const visible = items.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const empty = !loading && !error && items.length === 0;

  return (
    // .dlo-recent is the extra air above it: this card closes the page under the whole
    // form, so it is not another of the form's cards and should not sit at a field's
    // distance. Shared with /dlo, which ends the same way.
    <section className="card dlo-recent">
      <Disclosure
        title={STR.transcribeRecent}
        icon={History}
        summary={
          loading
            ? STR.transcribeListLoading
            : items.length > 0
              ? `${items.length.toLocaleString('mr-IN')} ${STR.transcribeRunCountSuffix}`
              : STR.dloWorkCountNone
        }
        summarySet={items.length > 0}
      >
        {error ? (
          <ErrorNotice
            message={error}
            fallback={STR.transcribeListLoadError}
            onRetry={onRetry}
          />
        ) : null}
        {loading ? <p className="hint">{STR.transcribeListLoading}</p> : null}
        {empty ? <p className="hint">{STR.transcribeListEmpty}</p> : null}

        {visible.length > 0 ? (
          <ul className="dlo-work-list">
            {visible.map((item) => (
              <Row
                key={item.id}
                item={item}
                active={item.id === selectedId}
                onOpen={() => onOpen(item.id)}
              />
            ))}
          </ul>
        ) : null}

        {pageCount > 1 ? (
          <Pagination
            page={safePage}
            pageCount={pageCount}
            onChange={setPage}
          />
        ) : null}
      </Disclosure>
    </section>
  );
}
