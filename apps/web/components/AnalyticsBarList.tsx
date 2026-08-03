'use client';

// Ranked horizontal bars — the right form for "which of these is biggest" with named
// categories, and better than a pie at every count (the labels sit on one edge and the
// lengths share a baseline).
//
// Every row is DIRECTLY LABELLED with its name and its value, so the bar is redundant
// reinforcement rather than the only encoding. That is also why a single hue is used
// throughout: colour is carrying magnitude here, not identity, and two similar tints of the
// brand maroon provably cannot be told apart as categories anyway.

import { formatNumber } from '../lib/analytics';
import { STR } from '../lib/strings';

export type BarRow = Readonly<{ key: string; label: string; value: number }>;

export function AnalyticsBarList({
  rows,
  total,
}: {
  rows: readonly BarRow[];
  // Denominator for the bar widths. Passed in rather than derived so several lists on one
  // page can share a scale where that is the honest comparison; omit for a self-scaled list.
  total?: number;
}) {
  if (rows.length === 0) {
    return <p className="hint">{STR.analyticsEmpty}</p>;
  }
  const scale =
    total ?? rows.reduce((peak, row) => Math.max(peak, row.value), 0) ?? 0;

  return (
    <ul className="bar-list">
      {rows.map((row) => (
        <li className="bar-list-row" key={row.key}>
          <span className="bar-list-label">{row.label}</span>
          <span className="bar-list-track">
            <span
              className="bar-list-fill"
              style={{
                width: `${scale === 0 ? 0 : Math.max((row.value / scale) * 100, row.value > 0 ? 1.5 : 0)}%`,
              }}
            />
          </span>
          <span className="bar-list-value">{formatNumber(row.value)}</span>
        </li>
      ))}
    </ul>
  );
}
