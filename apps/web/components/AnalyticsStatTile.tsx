'use client';

// A single headline number. Not a chart — one value has no shape to plot, and a tile is the
// right form for it (the hero-number rule).
//
// The delta is the whole reason the tile exists rather than a bare figure: "८४ लेख" is a
// number, "८४ लेख, मागील कालावधीपेक्षा ३१% जास्त" is the answer to the question actually
// being asked. Direction is carried by an arrow AND by words, never by colour alone.

import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import {
  deltaOf,
  deltaText,
  formatMetric,
  metricLabel,
} from '../lib/analytics';
import type { Metric } from '@dgipr/schemas';

export function AnalyticsStatTile({
  metric,
  large,
}: {
  metric: Metric;
  large?: boolean;
}) {
  const delta = deltaOf(metric);

  return (
    <div className={large ? 'stat-tile stat-tile--large' : 'stat-tile'}>
      <p className="stat-tile-label">{metricLabel(metric.key)}</p>
      <p className="stat-tile-value">{formatMetric(metric)}</p>
      {delta ? (
        <p
          className={`stat-delta stat-delta--${delta.direction}`}
          // "मागील कालावधीपेक्षा ३१% जास्त" already reads as a sentence; the icon beside it
          // is decoration and must not be announced twice.
        >
          {delta.direction === 'up' ? (
            <ArrowUpRight size={16} aria-hidden="true" />
          ) : delta.direction === 'down' ? (
            <ArrowDownRight size={16} aria-hidden="true" />
          ) : (
            <Minus size={16} aria-hidden="true" />
          )}
          <span>{deltaText(delta)}</span>
        </p>
      ) : null}
    </div>
  );
}
