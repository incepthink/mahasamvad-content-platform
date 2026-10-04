'use client';

// /analytics — how much the department is using this platform.
//
// Read top to bottom: how much was produced and whether it is rising (the navy hero, with
// the previous period drawn dashed under the current one), where it came from (the share
// donut and one tile per feature — each tile opens that feature's own page), how steady the
// use is (the stacked daily bars), how each feature moved against the last period, the other
// headline figures, and a year of daily use as a heatmap.
//
// There is no auth in this phase, so every figure here is DEPARTMENT-WIDE. Nothing on this
// page counts or infers individual people, and nothing should be added that does.
//
// The selected range lives in the URL (`?range=`), so a particular view can be linked to or
// left open in a tab — which is what a presentation actually needs. The heatmap always reads
// the `all` response (the only one whose rows already cover a year); useAnalytics caches and
// de-duplicates it, so on `all` the two reads are one request.

import { Suspense, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  AnalyticsRangeSchema,
  ANALYTICS_DEFAULT_RANGE,
  type AnalyticsRange,
} from '@dgipr/schemas';
import { AnalyticsRangePicker } from '../../components/AnalyticsRangePicker';
import {
  AnalyticsFeatureTile,
  AnalyticsHero,
  AnalyticsKeyFigures,
  AnalyticsPeriodCompare,
  AnalyticsShareDonut,
  AnalyticsStackedBars,
  AnalyticsYearHeatmap,
  featureSeries,
} from '../../components/AnalyticsHomeCharts';
import { formatWindow } from '../../lib/analytics';
import { useAnalytics } from '../../lib/useAnalytics';
import { STR } from '../../lib/strings';
import { ErrorNotice } from '../../components/ErrorNotice';
import { PageShell } from '../../components/common/PageShell';

function AnalyticsPageBody() {
  const router = useRouter();
  const params = useSearchParams();
  const parsed = AnalyticsRangeSchema.safeParse(params.get('range'));
  const range: AnalyticsRange = parsed.success
    ? parsed.data
    : ANALYTICS_DEFAULT_RANGE;
  const { data, loading, error, reload } = useAnalytics(range);
  const year = useAnalytics('all');

  const setRange = useCallback(
    (next: AnalyticsRange) => {
      // replace, not push: flipping between windows is refining one view, and it should not
      // take four presses of Back to leave the page.
      router.replace(`/analytics?range=${next}`);
    },
    [router],
  );

  const total = data?.headline.find((m) => m.key === 'totalOutputs');
  const shareSum =
    data?.features.reduce((sum, f) => sum + f.headline.value, 0) ?? 0;
  const series = data ? featureSeries(data.daily) : null;

  return (
    <PageShell
      background="analytics"
      className="an-home"
      title={STR.analyticsTitle}
      subtitle={STR.analyticsIntro}
      actions={
        <AnalyticsRangePicker
          value={range}
          onChange={setRange}
          busy={loading}
        />
      }
    >
      {data ? (
        <p className="an-window">
          {range === 'all'
            ? STR.analyticsWindowAll
            : formatWindow(data.from, data.to)}
        </p>
      ) : null}

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

      {data && series ? (
        <div className="an-stack">
          {/* The events table is the only source that can be missing (an un-applied 0043).
              Said plainly, because two of the six features would otherwise read as unused. */}
          {!data.eventsAvailable ? (
            <p className="analytics-notice">{STR.analyticsEventsUnavailable}</p>
          ) : null}

          <div className="an-top">
            {total ? (
              <AnalyticsHero
                total={total}
                daily={data.daily}
                previousDaily={data.previousDaily}
                range={range}
              />
            ) : null}
            <AnalyticsShareDonut features={data.features} />
          </div>

          <section aria-labelledby="an-features-title">
            <h2 id="an-features-title" className="an-section-title">
              {STR.analyticsFeaturesTitle}
            </h2>
            <div className="an-feature-grid">
              {data.features.map((feature) => (
                <AnalyticsFeatureTile
                  key={feature.key}
                  feature={feature}
                  share={shareSum > 0 ? feature.headline.value / shareSum : 0}
                  series={series[feature.key]}
                  range={range}
                />
              ))}
            </div>
          </section>

          <AnalyticsStackedBars daily={data.daily} features={data.features} />

          <div className="an-pair">
            <AnalyticsPeriodCompare features={data.features} />
            <AnalyticsKeyFigures
              headline={data.headline}
              windowDays={data.daily.length}
            />
          </div>

          <AnalyticsYearHeatmap
            yearDaily={year.data?.yearDaily ?? null}
            loading={year.loading}
          />
        </div>
      ) : null}
    </PageShell>
  );
}

// useSearchParams needs a suspense boundary in the app router.
export default function AnalyticsPage() {
  return (
    <Suspense fallback={<PageShell background="analytics" />}>
      <AnalyticsPageBody />
    </Suspense>
  );
}
