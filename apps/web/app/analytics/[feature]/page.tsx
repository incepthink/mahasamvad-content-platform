'use client';

// /analytics/[feature] — one sidebar feature in detail.
//
// It re-uses the SAME endpoint as the landing page and reads its own block out of the
// response, which is what guarantees the big number here equals the one on the card that led
// to it. The extra cost is one request; the alternative — a per-feature endpoint — is two
// aggregations that can disagree, on a page whose entire job is to be trusted.

import { Suspense, useCallback } from 'react';
import {
  notFound,
  useParams,
  useRouter,
  useSearchParams,
} from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import {
  AnalyticsFeatureKeySchema,
  AnalyticsRangeSchema,
  ANALYTICS_DEFAULT_RANGE,
  ANALYTICS_INR_PER_USD,
  type AnalyticsDay,
  type AnalyticsFeatureKey,
  type AnalyticsRange,
} from '@dgipr/schemas';
import { AnalyticsBarList } from '../../../components/AnalyticsBarList';
import { AnalyticsServiceList } from '../../../components/AnalyticsServiceList';
import { AnalyticsRangePicker } from '../../../components/AnalyticsRangePicker';
import { AnalyticsStatTile } from '../../../components/AnalyticsStatTile';
import { AnalyticsTrendChart } from '../../../components/AnalyticsTrendChart';
import {
  ANALYTICS_FEATURE_HREFS,
  ANALYTICS_FEATURE_LABELS,
  formatNumber,
  isEstimatedMetric,
  providerLabel,
  serviceLabel,
  sliceLabel,
  unitLabel,
} from '../../../lib/analytics';
import { useAnalytics } from '../../../lib/useAnalytics';
import {
  analyticsCostRateNote,
  analyticsRateLine,
  STR,
} from '../../../lib/strings';

function FeaturePageBody() {
  const router = useRouter();
  const params = useParams<{ feature: string }>();
  const search = useSearchParams();

  const featureKey = AnalyticsFeatureKeySchema.safeParse(params.feature);
  if (!featureKey.success) notFound();
  const key: AnalyticsFeatureKey = featureKey.data;

  const parsedRange = AnalyticsRangeSchema.safeParse(search.get('range'));
  const range: AnalyticsRange = parsedRange.success
    ? parsedRange.data
    : ANALYTICS_DEFAULT_RANGE;

  const { data, loading, error, reload } = useAnalytics(range);
  const feature = data?.features.find((entry) => entry.key === key) ?? null;

  const setRange = useCallback(
    (next: AnalyticsRange) => {
      router.replace(`/analytics/${key}?range=${next}`);
    },
    [router, key],
  );

  return (
    <main className="page">
      <Link href={`/analytics?range=${range}`} className="back-link">
        <ArrowLeft size={18} aria-hidden="true" />
        {STR.analyticsBack}
      </Link>

      <header className="page-head">
        <div className="page-head-text">
          <h1 className="page-title">{ANALYTICS_FEATURE_LABELS[key]}</h1>
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
        <div className="card">
          <p className="form-error">{error}</p>
          <button type="button" className="btn" onClick={() => void reload()}>
            {STR.analyticsRetry}
          </button>
        </div>
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

      {data && feature ? (
        <>
          {/* Said before the numbers, not after: a reader who sees a small figure first has
              already drawn a conclusion by the time a footnote explains it. */}
          {feature.eventBacked ? (
            <p className="analytics-notice">{STR.analyticsEventNotice}</p>
          ) : null}

          <section className="stat-grid stat-grid--detail">
            <AnalyticsStatTile metric={feature.headline} large />
            {feature.stats.map((metric) => (
              <AnalyticsStatTile key={metric.key} metric={metric} />
            ))}
          </section>

          {feature.stats.some((metric) => isEstimatedMetric(metric.key)) ? (
            <p className="hint">{STR.analyticsEstimateNote}</p>
          ) : null}

          {/* Placed directly under the tiles: the service rows are what this feature's
              work actually cost and ran on, which is the question asked straight after
              "how much was produced". The charts below are supporting context. */}
          <section className="card">
            <h2>{STR.analyticsServicesTitle}</h2>
            <p className="hint">{STR.analyticsServicesHint}</p>
            <AnalyticsServiceList services={feature.services} />
            {/* The rates behind every "अंदाजित" row, printed only when this feature has
                one — a rate table on a card with nothing estimated is noise. */}
            {data.rates.length > 0 &&
            feature.services.some(
              (service) =>
                service.costEstimated &&
                data.rates.some((rate) => rate.key === service.key),
            ) ? (
              <details className="service-rates">
                <summary>{STR.analyticsRatesTitle}</summary>
                <ul className="service-rate-list">
                  {data.rates
                    .filter((rate) =>
                      feature.services.some(
                        (service) => service.key === rate.key,
                      ),
                    )
                    .map((rate) => (
                      <li key={rate.key}>
                        {analyticsRateLine(
                          serviceLabel(rate.key),
                          providerLabel(rate.provider),
                          rate.inrPerUnit,
                          rate.per,
                          unitLabel(rate.unit),
                        )}
                      </li>
                    ))}
                </ul>
                <p className="hint">{STR.analyticsRatesHint}</p>
              </details>
            ) : null}
          </section>

          <section className="card">
            <h2>{STR.analyticsTrendTitle}</h2>
            <AnalyticsTrendChart
              points={data.daily.map((day) => ({
                date: day.date,
                value: day[key as keyof AnalyticsDay] as number,
              }))}
              caption={
                range === 'all'
                  ? STR.analyticsTrendAllHint
                  : STR.analyticsTrendHint
              }
              yLabel={STR.analyticsTrendYAxis}
              // The day-by-day fold is dropped here: this page is already one feature's
              // detail, and the numbers behind the bars are what the tiles above state.
              // The table stays in the DOM for screen readers (see the component).
              showTable={false}
            />
          </section>

          {feature.breakdown.length > 0 ? (
            <section className="card">
              <h2>{STR.analyticsBreakdownTitle}</h2>
              <AnalyticsBarList
                rows={feature.breakdown.map((slice) => ({
                  key: slice.key,
                  label: sliceLabel(slice.key),
                  value: slice.value,
                }))}
              />
            </section>
          ) : null}

          {/* <section className="card">
            <h2>{STR.analyticsCostTitle}</h2>
            {feature.costInr === null ? (
              // Not "₹0": these features run on calls that are not billed to a row anywhere
              // in the product, and reporting zero would read as "free" rather than as
              // "not measured".
              <p className="hint">{STR.analyticsCostNone}</p>
            ) : (
              <>
                <dl className="cost-list">
                  <div>
                    <dt>{STR.analyticsCostPerOutput}</dt>
                    <dd>
                      {feature.costPerOutputInr === null
                        ? '—'
                        : `₹${formatNumber(feature.costPerOutputInr)}`}
                    </dd>
                  </div>
                  <div>
                    <dt>{STR.analyticsCostTotal}</dt>
                    <dd>{`₹${formatNumber(feature.costInr)}`}</dd>
                  </div>
                </dl>
                <p className="hint">
                  {analyticsCostRateNote(ANALYTICS_INR_PER_USD)}
                </p>
              </>
            )}
          </section> */}

          {/* Named as an action. The feature's own label alone read as a heading rather than
              as somewhere to go. */}
          <Link
            href={ANALYTICS_FEATURE_HREFS[key]}
            className="btn analytics-open"
          >
            {STR.analyticsOpenTool}
            <ExternalLink size={16} aria-hidden="true" />
          </Link>
        </>
      ) : null}
    </main>
  );
}

export default function AnalyticsFeaturePage() {
  return (
    <Suspense fallback={<main className="page" />}>
      <FeaturePageBody />
    </Suspense>
  );
}
