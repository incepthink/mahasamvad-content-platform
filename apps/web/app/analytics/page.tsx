'use client';

// /analytics — how much the department is using this platform.
//
// Read top to bottom it answers three questions in order: how much was produced (the KPI
// tiles), whether it is being used steadily (the daily chart), and which parts of the product
// the work came from (the share list and the six feature cards). Each card opens that
// feature's own page.
//
// There is no auth in this phase, so every figure here is DEPARTMENT-WIDE. Nothing on this
// page counts or infers individual people, and nothing should be added that does.
//
// The selected range lives in the URL (`?range=`), so a particular view can be linked to or
// left open in a tab — which is what a presentation actually needs.

import { Suspense, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  AnalyticsRangeSchema,
  ANALYTICS_DEFAULT_RANGE,
  type AnalyticsRange,
} from '@dgipr/schemas';
import {
  AnalyticsBarList,
  type BarRow,
} from '../../components/AnalyticsBarList';
import { AnalyticsFeatureCard } from '../../components/AnalyticsFeatureCard';
import { AnalyticsRangePicker } from '../../components/AnalyticsRangePicker';
import { AnalyticsStatTile } from '../../components/AnalyticsStatTile';
import { AnalyticsTrendChart } from '../../components/AnalyticsTrendChart';
import { ANALYTICS_FEATURE_LABELS } from '../../lib/analytics';
import { useAnalytics } from '../../lib/useAnalytics';
import { STR } from '../../lib/strings';
import { ErrorNotice } from '../../components/ErrorNotice';

function AnalyticsPageBody() {
  const router = useRouter();
  const params = useSearchParams();
  const parsed = AnalyticsRangeSchema.safeParse(params.get('range'));
  const range: AnalyticsRange = parsed.success
    ? parsed.data
    : ANALYTICS_DEFAULT_RANGE;
  const { data, loading, error, reload } = useAnalytics(range);

  const setRange = useCallback(
    (next: AnalyticsRange) => {
      // replace, not push: flipping between windows is refining one view, and it should not
      // take four presses of Back to leave the page.
      router.replace(`/analytics?range=${next}`);
    },
    [router],
  );

  return (
    <main className="page">
      <header className="page-head">
        <div className="page-head-text">
          <h1 className="page-title">{STR.analyticsTitle}</h1>
          <p className="page-sub">{STR.analyticsIntro}</p>
        </div>
        <div className="page-head-actions">
          <AnalyticsRangePicker
            value={range}
            onChange={setRange}
            busy={loading}
          />
        </div>
      </header>

      {error ? (
        <ErrorNotice
          message={error}
          fallback={STR.analyticsLoadFailed}
          onRetry={() => void reload()}
          retryLabel={STR.analyticsRetry}
        />
      ) : null}

      {loading && !data ? (
        <div
          className="page-loading"
          role="status"
          aria-label={STR.analyticsLoading}
        >
          <span className="spinner spinner-lg" aria-hidden="true" />
        </div>
      ) : null}

      {data ? (
        <>
          {/* The events table is the only source that can be missing (an un-applied 0043).
              Said plainly, because two of the six cards would otherwise read as unused. */}
          {!data.eventsAvailable ? (
            <p className="analytics-notice">{STR.analyticsEventsUnavailable}</p>
          ) : null}

          <section className="stat-grid" aria-label={STR.analyticsTitle}>
            {data.headline.map((metric) => (
              <AnalyticsStatTile key={metric.key} metric={metric} />
            ))}
          </section>

          {/* Per-feature detail sits directly under the tiles: after "how much was
              produced", the next question an officer asks is "by which part of the
              product", and each card is the way into that feature's own page. The
              trend and share charts are supporting context and follow it. */}
          <section className="analytics-features">
            <h2 className="analytics-section-title">
              {STR.analyticsFeaturesTitle}
            </h2>
            <div className="feature-grid">
              {data.features.map((feature) => (
                <AnalyticsFeatureCard
                  key={feature.key}
                  feature={feature}
                  range={range}
                />
              ))}
            </div>
          </section>

          <section className="card">
            <h2>{STR.analyticsTrendTitle}</h2>
            <AnalyticsTrendChart
              points={data.daily.map((day) => ({
                date: day.date,
                value:
                  day.social +
                  day.article +
                  day.transcribe +
                  day.translate +
                  day.proofread +
                  day.video,
              }))}
              caption={
                range === 'all'
                  ? STR.analyticsTrendAllHint
                  : STR.analyticsTrendHint
              }
            />
          </section>

          <section className="card">
            <h2>{STR.analyticsShareTitle}</h2>
            <p className="hint">{STR.analyticsShareHint}</p>
            <AnalyticsBarList rows={shareRows(data.features)} />
          </section>
        </>
      ) : null}
    </main>
  );
}

// Sorted by size, because the question the list answers is "which parts are actually used".
// Zero-use features are kept rather than filtered out: on this page an empty row is a finding.
function shareRows(
  features: ReadonlyArray<{
    key: keyof typeof ANALYTICS_FEATURE_LABELS;
    headline: { value: number };
  }>,
): BarRow[] {
  return features
    .map((feature) => ({
      key: feature.key,
      label: ANALYTICS_FEATURE_LABELS[feature.key],
      value: feature.headline.value,
    }))
    .sort((a, b) => b.value - a.value);
}

// useSearchParams needs a suspense boundary in the app router.
export default function AnalyticsPage() {
  return (
    <Suspense fallback={<main className="page" />}>
      <AnalyticsPageBody />
    </Suspense>
  );
}
