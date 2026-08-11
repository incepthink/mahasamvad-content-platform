'use client';

// The shared recent-work list on /dlo, grouped into "तुमचे काम" and "इतर कामे".
//
// The grouping is ORDERING ONLY — see lib/dloDraft. There is no login and no owner column, so
// every intake here is openable by anyone; "तुमचे काम" simply means "ids this browser started",
// kept so an officer does not scan a shared list for their own row. An intake started on
// another machine appears under "इतर कामे" and works exactly the same.
//
// It is folded shut by default and paged, because it grows without limit: the API returns
// every intake the department has ever created, and an unbounded list under a form pushed the
// form's own inputs off the screen within a week of use. The fold follows the house rule that
// a collapsed row may hide the control but never the answer, so the head states the count.
//
// Paging runs over the two groups as ONE ordered sequence (mine first, then everyone else's)
// rather than per group. Two independent pagers under one heading would ask the officer to
// track two positions, and the groups are not two lists — they are one list with the rows
// that are probably theirs pulled to the front.

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { History } from 'lucide-react';
import type { DloIntakeSummary } from '@dgipr/schemas';
import { formatDate, STR } from '../lib/strings';
import { Disclosure } from './Disclosure';
import { DloStatusChip } from './DloStatusChip';
import { Pagination } from './Pagination';

// Enough that a day's work is one page, small enough that the folded-open list does not
// become the page again.
const PAGE_SIZE = 8;

function IntakeRow({ intake }: { intake: DloIntakeSummary }) {
  return (
    <li className="dlo-work-row">
      <DloStatusChip status={intake.status} />
      <Link className="dlo-work-title" href={`/dlo/${intake.id}`}>
        {intake.title}
      </Link>
      <span className="dlo-work-meta">
        {intake.sourceCount.toLocaleString('mr-IN')} {STR.dloSourceCountSuffix}
        {intake.generationCount > 0 ? (
          <>
            {' · '}
            <span className="dlo-work-done">
              {intake.generationCount > 1
                ? `${intake.generationCount.toLocaleString('mr-IN')} ${STR.dloArticleCount}`
                : STR.dloArticleReady}{' '}
              ✓
            </span>
          </>
        ) : null}
        {' · '}
        {formatDate(intake.createdAt)}
      </span>
    </li>
  );
}

function IntakeGroup({
  label,
  intakes,
  first,
}: {
  label: string;
  intakes: readonly DloIntakeSummary[];
  // The first group ON THIS PAGE, which may be either one — a later page holds only "इतर
  // कामे", and its heading should not be pushed down as though something sat above it.
  first: boolean;
}) {
  return (
    <>
      <p className="field-label" style={{ marginTop: first ? 4 : 18 }}>
        {label}
      </p>
      <ul className="dlo-work-list">
        {intakes.map((intake) => (
          <IntakeRow key={intake.id} intake={intake} />
        ))}
      </ul>
    </>
  );
}

export function DloIntakeList({
  mine,
  others,
  loading,
  error,
}: {
  mine: readonly DloIntakeSummary[];
  others: readonly DloIntakeSummary[];
  loading: boolean;
  error: string | null;
}) {
  const [page, setPage] = useState(1);

  // One sequence, each row remembering which group it belongs to, so a page can be sliced out
  // of it and the headings re-derived from whatever landed on that page.
  const rows = useMemo(
    () => [
      ...mine.map((intake) => ({ intake, mine: true })),
      ...others.map((intake) => ({ intake, mine: false })),
    ],
    [mine, others],
  );

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  // The list polls while this browser's own run is going, so it can SHRINK under the reader
  // (a row moving groups, an intake disappearing). Clamping on read rather than resetting
  // keeps the officer where they were whenever that page still exists.
  const safePage = Math.min(page, pageCount);
  const visible = rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const visibleMine = visible
    .filter((row) => row.mine)
    .map((row) => row.intake);
  const visibleOthers = visible
    .filter((row) => !row.mine)
    .map((row) => row.intake);

  const empty = !loading && !error && rows.length === 0;

  return (
    <section className="card">
      <Disclosure
        title={STR.dloRecent}
        icon={History}
        summary={
          loading
            ? STR.dloListLoading
            : rows.length > 0
              ? `${rows.length.toLocaleString('mr-IN')} ${STR.dloWorkCountSuffix}`
              : STR.dloWorkCountNone
        }
        summarySet={rows.length > 0}
      >
        {error ? <p className="form-error">{STR.dloListLoadError}</p> : null}
        {loading ? <p className="hint">{STR.dloListLoading}</p> : null}
        {empty ? <p className="hint">{STR.dloListEmpty}</p> : null}

        {visibleMine.length > 0 ? (
          <IntakeGroup label={STR.dloMyWork} intakes={visibleMine} first />
        ) : null}

        {visibleOthers.length > 0 ? (
          <IntakeGroup
            label={STR.dloOtherWork}
            intakes={visibleOthers}
            first={visibleMine.length === 0}
          />
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
