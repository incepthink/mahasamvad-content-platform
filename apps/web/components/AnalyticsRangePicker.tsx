'use client';

// The one filter on the analytics surface, in a single row above everything it affects (the
// filter rule for dashboards). Kept as buttons rather than a <select> so the current window
// is readable across a room — this page is presented, not only browsed.

import { ANALYTICS_RANGE_LABELS } from '../lib/analytics';
import { STR } from '../lib/strings';
import type { AnalyticsRange } from '@dgipr/schemas';

const RANGES: readonly AnalyticsRange[] = ['7d', '30d', '90d', 'all'];

export function AnalyticsRangePicker({
  value,
  onChange,
  busy,
}: {
  value: AnalyticsRange;
  onChange: (range: AnalyticsRange) => void;
  busy: boolean;
}) {
  return (
    <div
      className="analytics-ranges"
      role="group"
      aria-label={STR.analyticsRangeLabel}
    >
      {RANGES.map((range) => (
        <button
          key={range}
          type="button"
          className={
            range === value ? 'analytics-range active' : 'analytics-range'
          }
          // Pressed state rather than a disabled current button: a disabled control drops out
          // of the tab order, and the row is how someone navigates this page by keyboard.
          aria-pressed={range === value}
          onClick={() => onChange(range)}
          disabled={busy && range !== value}
        >
          {ANALYTICS_RANGE_LABELS[range]}
        </button>
      ))}
    </div>
  );
}
