'use client';

// The shared recent-work list on /dlo, grouped into "तुमचे काम" and "इतर कामे".
//
// The grouping is ORDERING ONLY — see lib/dloDraft. There is no login and no owner column, so
// every intake here is openable by anyone; "तुमचे काम" simply means "ids this browser started",
// kept so an officer does not scan a shared list for their own row. An intake started on
// another machine appears under "इतर कामे" and works exactly the same.

import Link from 'next/link';
import { History } from 'lucide-react';
import type { DloIntakeSummary } from '@dgipr/schemas';
import { formatDate, STR } from '../lib/strings';
import { CardTitle } from './CardTitle';
import { DloStatusChip } from './DloStatusChip';

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
  return (
    <section className="card">
      <CardTitle icon={History}>{STR.dloRecent}</CardTitle>
      {error ? <p className="form-error">{STR.dloListLoadError}</p> : null}
      {loading ? <p className="hint">{STR.dloListLoading}</p> : null}
      {!loading && !error && mine.length === 0 && others.length === 0 ? (
        <p className="hint">{STR.dloListEmpty}</p>
      ) : null}

      {mine.length > 0 ? (
        <>
          <p className="field-label" style={{ marginTop: 14 }}>
            {STR.dloMyWork}
          </p>
          <ul className="dlo-work-list">
            {mine.map((intake) => (
              <IntakeRow key={intake.id} intake={intake} />
            ))}
          </ul>
        </>
      ) : null}

      {others.length > 0 ? (
        <>
          <p className="field-label" style={{ marginTop: 18 }}>
            {STR.dloOtherWork}
          </p>
          <ul className="dlo-work-list">
            {others.map((intake) => (
              <IntakeRow key={intake.id} intake={intake} />
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
