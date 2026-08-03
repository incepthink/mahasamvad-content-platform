'use client';

// One sidebar feature, summarised. The whole card is the link to its drill-down — a small
// "तपशील पाहा" hyperlink would be a poor target on a page meant to be used on a projector
// and on a phone.
//
// The headline metric's unit label is deliberately NOT printed under the number. Every
// feature's headline counts the thing the card is already named after (ध्वनिलेखन → ध्वनिलेखने,
// लेख / बातमी → लेख), so the line only ever restated the heading in smaller grey type. The
// unit is stated once, on the drill-down, where several metrics sit side by side and it
// actually distinguishes them.
//
// The delta line shows only a real rise or fall. `flat` and `new` are both dropped: "नवीन"
// says the previous window was zero, which is a statement about a period the card does not
// show, and it is what every card reads on a young feature — six identical grey lines
// carrying nothing. A card with nothing to compare against simply shows its number.

import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import {
  ANALYTICS_FEATURE_LABELS,
  deltaOf,
  deltaText,
  formatMetric,
} from '../lib/analytics';
import { STR } from '../lib/strings';
import type { AnalyticsFeature, AnalyticsRange } from '@dgipr/schemas';

export function AnalyticsFeatureCard({
  feature,
  range,
}: {
  feature: AnalyticsFeature;
  range: AnalyticsRange;
}) {
  const delta = deltaOf(feature.headline);

  return (
    <Link
      href={`/analytics/${feature.key}?range=${range}`}
      className="feature-card"
    >
      <span className="feature-card-name">
        {ANALYTICS_FEATURE_LABELS[feature.key]}
      </span>
      <span className="feature-card-value">
        {formatMetric(feature.headline)}
      </span>
      {delta && (delta.direction === 'up' || delta.direction === 'down') ? (
        <span className={`stat-delta stat-delta--${delta.direction}`}>
          {deltaText(delta)}
        </span>
      ) : null}
      <span className="feature-card-go">
        {STR.analyticsOpenFeature}
        <ChevronRight size={16} aria-hidden="true" />
      </span>
    </Link>
  );
}
