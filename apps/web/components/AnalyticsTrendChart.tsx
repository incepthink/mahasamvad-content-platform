'use client';

// Daily activity, as a single-series bar chart.
//
// WHY ONE SERIES AND NOT A STACK BY FEATURE. The question this chart answers is "is the
// platform used, and how steadily" — one magnitude per day. Stacking six features across
// thirty thin bars would encode identity by colour six ways at a size where no palette
// separates reliably, to answer a question the feature cards below already answer better.
// One series also means no legend is needed and no categorical palette is in play, so there
// is nothing here that colour-blind readers can lose.
//
// Built from HTML rather than SVG on purpose: the bars are a flex row that reflows at any
// width, and the labels are ordinary text in the page's Marathi font — an SVG <text> would
// need its own font handling for Devanagari.

import { formatDay, formatNumber } from '../lib/analytics';
import { analyticsDayWork, STR } from '../lib/strings';

export type TrendPoint = Readonly<{ date: string; value: number }>;

export function AnalyticsTrendChart({
  points,
  caption,
}: {
  points: readonly TrendPoint[];
  caption: string;
}) {
  const max = points.reduce((peak, point) => Math.max(peak, point.value), 0);
  const total = points.reduce((sum, point) => sum + point.value, 0);

  if (points.length === 0 || total === 0) {
    return <p className="hint">{STR.analyticsEmpty}</p>;
  }

  // Gridlines at the top and the midpoint only. More would compete with the bars, which are
  // the data; the axis is meant to recede.
  const gridValues = [max, Math.round(max / 2)];
  // Three x labels — first, middle, last. Labelling all thirty days would be unreadable and
  // labelling none would leave the window unstated.
  const labelled = new Set([
    0,
    Math.floor((points.length - 1) / 2),
    points.length - 1,
  ]);

  return (
    <figure className="chart">
      <div className="chart-plot">
        <div className="chart-grid" aria-hidden="true">
          {gridValues.map((value, index) => (
            <div
              key={value + '-' + index}
              className="chart-grid-line"
              style={{ bottom: `${max === 0 ? 0 : (value / max) * 100}%` }}
            >
              <span className="chart-grid-label">{formatNumber(value)}</span>
            </div>
          ))}
        </div>
        <div
          className="chart-bars"
          role="img"
          aria-label={`${caption}. ${STR.analyticsTrendTable}`}
        >
          {points.map((point) => (
            <div className="chart-bar-slot" key={point.date}>
              <div
                className="chart-bar"
                // A zero day still shows a 2px stub: an entirely absent bar reads as missing
                // data, while a visible floor reads as "nothing happened", which is the truth.
                style={{
                  height: `${max === 0 ? 0 : Math.max((point.value / max) * 100, point.value > 0 ? 2 : 0)}%`,
                }}
              />
              {/* Hover/focus tooltip. tabIndex makes the same information reachable without a
                  pointer, which is what stops the tooltip being a decoration. */}
              <span className="chart-hit" tabIndex={0}>
                <span className="chart-tip">
                  {analyticsDayWork(formatDay(point.date, true), point.value)}
                </span>
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="chart-axis" aria-hidden="true">
        {points.map((point, index) => (
          <span className="chart-axis-label" key={point.date}>
            {labelled.has(index) ? formatDay(point.date) : ''}
          </span>
        ))}
      </div>
      <figcaption className="hint">{caption}</figcaption>

      {/* The table view. Every chart in this product needs one: it is how the numbers are
          read by a screen reader, and how they are copied into a report. */}
      <details className="chart-table">
        <summary>{STR.analyticsTrendTable}</summary>
        <table>
          <thead>
            <tr>
              <th scope="col">{STR.analyticsTableDay}</th>
              <th scope="col">{STR.analyticsTableWork}</th>
            </tr>
          </thead>
          <tbody>
            {points.map((point) => (
              <tr key={point.date}>
                <th scope="row">{formatDay(point.date, true)}</th>
                <td>{formatNumber(point.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
