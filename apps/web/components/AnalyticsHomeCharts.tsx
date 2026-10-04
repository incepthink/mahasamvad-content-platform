'use client';

// The /analytics landing page's blocks, top to bottom: the navy hero (total + a current vs
// previous trend line), the share donut, one tile per feature, the stacked daily bars, the
// period comparison, the key figures and the year heatmap.
//
// Every figure here is DEPARTMENT-WIDE — there is no identity in this phase, and nothing in
// this file may count or rank individual people. The design this follows had a "most active
// users" card; it is the key-figures card instead, for exactly that reason.
//
// Charts are inline SVG / CSS boxes with Marathi text in the page's own font. Each chart that
// encodes identity by colour has its legend beside it and every value reachable as text.

import Link from 'next/link';
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import {
  CalendarCheck,
  ChevronRight,
  FileText,
  Image as ImageIcon,
  Mic,
  Video,
  type LucideIcon,
} from 'lucide-react';
import {
  ANALYTICS_FEATURE_KEYS,
  type AnalyticsDay,
  type AnalyticsFeature,
  type AnalyticsFeatureKey,
  type AnalyticsRange,
  type Metric,
} from '@dgipr/schemas';
import {
  ANALYTICS_FEATURE_LABELS,
  formatDay,
  formatMetric,
  formatNumber,
  metricLabel,
} from '../lib/analytics';
import {
  FEATURE_HUE,
  FEATURE_MONO,
  HEAT_LEVELS,
  bucketDays,
  deltaChip,
  heatmapWeeks,
  isWeekly,
  linePoints,
  niceCeiling,
  smoothPath,
  xAt,
  type Bucket,
  type DeltaChip,
} from '../lib/analyticsCharts';
import {
  STR,
  analyticsActiveDaysOf,
  analyticsHeatmapSummary,
  analyticsPreviousTotal,
  analyticsPreviousValue,
  analyticsShareOfTotal,
  analyticsWorkCount,
} from '../lib/strings';

const percentText = (share: number) =>
  `${Math.round(share * 100).toLocaleString('mr-IN')}`;

function bucketLabel(bucket: Bucket, weekly: boolean): string {
  return weekly
    ? `${STR.analyticsHeroWeekPrefix}${formatDay(bucket.start)} – ${formatDay(bucket.end)}`
    : formatDay(bucket.end, true);
}

function Chip({ chip, onDark }: { chip: DeltaChip; onDark?: boolean }) {
  return (
    <span
      className={`an-chip an-chip--${chip.tone}${onDark ? ' an-chip--dark' : ''}`}
      title={chip.label}
      aria-label={chip.label}
    >
      {chip.text}
    </span>
  );
}

function Axis({ buckets, weekly }: { buckets: Bucket[]; weekly: boolean }) {
  if (buckets.length === 0) return null;
  const first = buckets[0]!;
  const mid = buckets[Math.floor(buckets.length / 2)]!;
  const last = buckets[buckets.length - 1]!;
  return (
    <div className="an-axis" aria-hidden="true">
      <span>{formatDay(weekly ? first.start : first.end)}</span>
      <span>{formatDay(mid.end)}</span>
      <span>{formatDay(last.end)}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hero
// ---------------------------------------------------------------------------

const HERO_W = 600;
const HERO_H = 170;

export function AnalyticsHero({
  total,
  daily,
  previousDaily,
  range,
}: {
  total: Metric;
  daily: readonly AnalyticsDay[];
  previousDaily: readonly AnalyticsDay[];
  range: AnalyticsRange;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const weekly = isWeekly(daily);
  const current = useMemo(() => bucketDays(daily, weekly), [daily, weekly]);
  const previous = useMemo(
    () =>
      previousDaily.length === daily.length
        ? bucketDays(previousDaily, weekly)
        : [],
    [previousDaily, daily.length, weekly],
  );
  const hasPrev = previous.length === current.length && previous.length > 0;
  const chip = deltaChip(total);

  const curValues = current.map((b) => b.total);
  const prevValues = hasPrev ? previous.map((b) => b.total) : [];
  const max = Math.max(1, ...curValues, ...prevValues) * 1.15;
  const curPoints = linePoints(curValues, max, HERO_W, HERO_H);
  const line = smoothPath(curPoints);
  const area = line ? `${line} L${HERO_W},${HERO_H} L0,${HERO_H} Z` : '';
  const prevLine = hasPrev
    ? smoothPath(linePoints(prevValues, max, HERO_W, HERO_H))
    : '';

  const n = current.length;
  const onMove = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const i = Math.round(((event.clientX - rect.left) / rect.width) * (n - 1));
    const clamped = Math.min(n - 1, Math.max(0, i));
    if (clamped !== hover) setHover(clamped);
  };

  const hovered = hover !== null && current[hover] ? hover : null;
  const left = hovered !== null ? (xAt(hovered, n, HERO_W) / HERO_W) * 100 : 0;
  const top = hovered !== null ? (curPoints[hovered]![1] / HERO_H) * 100 : 0;

  const chartTitle = weekly
    ? STR.analyticsHeroWeeklyChart
    : STR.analyticsHeroDailyChart;
  const sub =
    range === 'all'
      ? STR.analyticsHeroAllSub
      : total.previous !== undefined
        ? analyticsPreviousTotal(formatNumber(total.previous))
        : '';

  return (
    <section className="an-hero" aria-label={metricLabel(total.key)}>
      <div className="an-hero-head">
        <div className="an-hero-figure">
          <span className="an-hero-label">{metricLabel(total.key)}</span>
          <span className="an-hero-number-row">
            <span className="an-hero-number">{formatMetric(total)}</span>
            {chip ? <Chip chip={chip} onDark /> : null}
          </span>
          {sub ? <span className="an-hero-sub">{sub}</span> : null}
        </div>
        <div className="an-hero-legend">
          <span className="an-hero-chart-name">{chartTitle}</span>
          <span className="an-legend-item">
            <span className="an-legend-line" aria-hidden="true" />
            {STR.analyticsHeroLegendCurrent}
          </span>
          {hasPrev ? (
            <span className="an-legend-item">
              <span
                className="an-legend-line an-legend-line--dashed"
                aria-hidden="true"
              />
              {STR.analyticsHeroLegendPrevious}
            </span>
          ) : null}
        </div>
      </div>

      <div
        className="an-hero-chart"
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        role="img"
        aria-label={`${chartTitle}: ${current
          .map((b) => `${bucketLabel(b, weekly)} ${formatNumber(b.total)}`)
          .join(', ')}`}
      >
        <svg
          viewBox={`0 0 ${HERO_W} ${HERO_H}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id="an-hero-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#ffffff" stopOpacity="0.26" />
              <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[HERO_H / 3, (HERO_H * 2) / 3].map((y) => (
            <line
              key={y}
              x1="0"
              x2={HERO_W}
              y1={y}
              y2={y}
              stroke="rgba(255,255,255,0.1)"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          <line
            x1="0"
            x2={HERO_W}
            y1={HERO_H}
            y2={HERO_H}
            stroke="rgba(255,255,255,0.18)"
            vectorEffect="non-scaling-stroke"
          />
          {prevLine ? (
            <path
              d={prevLine}
              fill="none"
              stroke="#8aa5c8"
              strokeWidth="1.6"
              strokeDasharray="5 5"
              vectorEffect="non-scaling-stroke"
            />
          ) : null}
          <path d={area} fill="url(#an-hero-fill)" />
          <path
            d={line}
            fill="none"
            stroke="#ffffff"
            strokeWidth="2.5"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        {hovered !== null ? (
          <>
            <span className="an-hover-rule" style={{ left: `${left}%` }} />
            <span
              className="an-hover-dot"
              style={{ left: `${left}%`, top: `${top}%` }}
            />
            <span
              className={`an-hover-tip${left > 70 ? ' an-hover-tip--flip' : ''}`}
              style={{ left: `${left}%` }}
            >
              <span className="an-hover-date">
                {bucketLabel(current[hovered]!, weekly)}
              </span>
              <span className="an-hover-value">
                {analyticsWorkCount(formatNumber(current[hovered]!.total))}
              </span>
              {hasPrev ? (
                <span className="an-hover-date">
                  {analyticsPreviousValue(
                    formatNumber(previous[hovered]!.total),
                  )}
                </span>
              ) : null}
            </span>
          </>
        ) : null}
      </div>
      <Axis buckets={current} weekly={weekly} />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Share donut
// ---------------------------------------------------------------------------

const DONUT_R = 54;
const DONUT_C = 2 * Math.PI * DONUT_R;

export function AnalyticsShareDonut({
  features,
}: {
  features: readonly AnalyticsFeature[];
}) {
  const sum = features.reduce((s, f) => s + f.headline.value, 0);
  let cumulative = 0;
  const arcs = features.map((feature) => {
    const length = sum > 0 ? (feature.headline.value / sum) * DONUT_C : 0;
    const arc = {
      key: feature.key,
      dash: `${Math.max(length - 2.5, 0).toFixed(2)} ${DONUT_C.toFixed(2)}`,
      offset: (-cumulative).toFixed(2),
      show: length > 0,
    };
    cumulative += length;
    return arc;
  });

  return (
    <section className="an-card an-donut-card">
      <div>
        <h2 className="an-card-title">{STR.analyticsDonutTitle}</h2>
        <p className="an-card-hint">{STR.analyticsDonutHint}</p>
      </div>
      <div className="an-donut">
        <svg viewBox="0 0 140 140" aria-hidden="true">
          <circle
            cx="70"
            cy="70"
            r={DONUT_R}
            fill="none"
            stroke="#eef1f5"
            strokeWidth="18"
          />
          {arcs.map((arc) =>
            arc.show ? (
              <circle
                key={arc.key}
                cx="70"
                cy="70"
                r={DONUT_R}
                fill="none"
                stroke={FEATURE_MONO[arc.key]}
                strokeWidth="18"
                strokeDasharray={arc.dash}
                strokeDashoffset={arc.offset}
              />
            ) : null,
          )}
        </svg>
        <span className="an-donut-center">
          <span className="an-donut-number">{formatNumber(sum)}</span>
          <span className="an-donut-unit">{STR.analyticsDonutCenter}</span>
        </span>
      </div>
      <ul className="an-share-list">
        {features.map((feature) => (
          <li key={feature.key}>
            <span
              className="an-swatch"
              style={{ background: FEATURE_MONO[feature.key] }}
              aria-hidden="true"
            />
            <span className="an-share-name">
              {ANALYTICS_FEATURE_LABELS[feature.key]}
            </span>
            <span className="an-share-value">
              {sum > 0 ? percentText(feature.headline.value / sum) : '०'}%
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Feature tiles
// ---------------------------------------------------------------------------

export function AnalyticsFeatureTile({
  feature,
  share,
  series,
  range,
}: {
  feature: AnalyticsFeature;
  share: number;
  series: readonly number[];
  range: AnalyticsRange;
}) {
  const chip = deltaChip(feature.headline);
  const down = chip?.tone === 'down';
  const colour = down ? '#b03a2e' : '#1e3a5f';
  const max = Math.max(1, ...series);
  const spark = smoothPath(linePoints(series, max, 120, 36, 4));
  const sparkArea = spark ? `${spark} L120,36 L0,36 Z` : '';

  return (
    <Link
      href={`/analytics/${feature.key}?range=${range}`}
      className="an-card an-feature"
    >
      <span className="an-feature-name">
        <span
          className="an-dot"
          style={{ background: FEATURE_MONO[feature.key] }}
          aria-hidden="true"
        />
        {ANALYTICS_FEATURE_LABELS[feature.key]}
      </span>
      <span className="an-feature-body">
        <span className="an-feature-figure">
          <span className="an-feature-number">
            {formatMetric(feature.headline)}
          </span>
          {chip ? <Chip chip={chip} /> : null}
        </span>
        <svg
          className="an-spark"
          viewBox="0 0 120 36"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path d={sparkArea} fill={colour} fillOpacity="0.08" />
          <path
            d={spark}
            fill="none"
            stroke={colour}
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </span>
      <span className="an-feature-foot">
        <span>{analyticsShareOfTotal(percentText(share))}</span>
        <span className="an-feature-go">
          {STR.analyticsOpenFeature}
          <ChevronRight size={15} aria-hidden="true" />
        </span>
      </span>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Stacked bars
// ---------------------------------------------------------------------------

export function AnalyticsStackedBars({
  daily,
  features,
}: {
  daily: readonly AnalyticsDay[];
  features: readonly AnalyticsFeature[];
}) {
  const weekly = isWeekly(daily);
  const buckets = useMemo(() => bucketDays(daily, weekly), [daily, weekly]);
  const peak = Math.max(0, ...buckets.map((b) => b.total));
  const ceiling = niceCeiling(peak);
  const keys = features.map((f) => f.key);

  return (
    <section className="an-card">
      <div className="an-card-head">
        <h2 className="an-card-title">
          {weekly ? STR.analyticsBarsWeekly : STR.analyticsBarsDaily}
        </h2>
        <ul className="an-legend" aria-label={STR.analyticsDonutTitle}>
          {keys.map((key) => (
            <li key={key}>
              <span
                className="an-swatch"
                style={{ background: FEATURE_HUE[key] }}
                aria-hidden="true"
              />
              {ANALYTICS_FEATURE_LABELS[key]}
            </li>
          ))}
        </ul>
      </div>
      <div className="an-bars-frame">
        <div className="an-bars-y" aria-hidden="true">
          <span>{formatNumber(ceiling)}</span>
          <span>{formatNumber(ceiling / 2)}</span>
          <span>०</span>
        </div>
        <div
          className="an-bars"
          style={{ gap: buckets.length > 20 ? '3px' : '8px' }}
        >
          {buckets.map((bucket) => (
            <div
              key={bucket.end}
              className="an-bar"
              title={`${bucketLabel(bucket, weekly)} · ${analyticsWorkCount(formatNumber(bucket.total))}`}
            >
              {keys.map((key) =>
                bucket.byFeature[key] > 0 ? (
                  <span
                    key={key}
                    style={{
                      height: `${((bucket.byFeature[key] / ceiling) * 100).toFixed(2)}%`,
                      background: FEATURE_HUE[key],
                    }}
                  />
                ) : null,
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="an-bars-axis">
        <Axis buckets={buckets} weekly={weekly} />
      </div>
      <details className="an-table-fold">
        <summary>{STR.analyticsTrendTable}</summary>
        <div className="an-table-scroll">
          <table className="an-table">
            <thead>
              <tr>
                <th scope="col">{STR.analyticsTableDay}</th>
                {keys.map((key) => (
                  <th key={key} scope="col">
                    {ANALYTICS_FEATURE_LABELS[key]}
                  </th>
                ))}
                <th scope="col">{STR.analyticsTableWork}</th>
              </tr>
            </thead>
            <tbody>
              {buckets.map((bucket) => (
                <tr key={bucket.end}>
                  <th scope="row">{bucketLabel(bucket, weekly)}</th>
                  {keys.map((key) => (
                    <td key={key}>{formatNumber(bucket.byFeature[key])}</td>
                  ))}
                  <td>{formatNumber(bucket.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Period comparison
// ---------------------------------------------------------------------------

export function AnalyticsPeriodCompare({
  features,
}: {
  features: readonly AnalyticsFeature[];
}) {
  const hasPrev = features.some((f) => f.headline.previous !== undefined);
  const max = Math.max(
    1,
    ...features.map((f) =>
      Math.max(f.headline.value, f.headline.previous ?? 0),
    ),
  );
  const width = (v: number) => `${((v / max) * 88).toFixed(1)}%`;

  return (
    <section className="an-card">
      <div className="an-card-head">
        <h2 className="an-card-title">{STR.analyticsCompareTitle}</h2>
        {hasPrev ? (
          <ul className="an-legend">
            <li>
              <span
                className="an-swatch an-swatch--current"
                aria-hidden="true"
              />
              {STR.analyticsCompareCurrent}
            </li>
            <li>
              <span
                className="an-swatch an-swatch--previous"
                aria-hidden="true"
              />
              {STR.analyticsComparePrevious}
            </li>
          </ul>
        ) : null}
      </div>
      {hasPrev ? (
        <ul className="an-compare">
          {features.map((feature) => {
            const chip = deltaChip(feature.headline);
            const prev = feature.headline.previous ?? 0;
            return (
              <li key={feature.key}>
                <span className="an-compare-name">
                  {ANALYTICS_FEATURE_LABELS[feature.key]}
                </span>
                <span className="an-compare-bars">
                  <span className="an-compare-row">
                    <span
                      className="an-compare-bar an-compare-bar--current"
                      style={{ width: width(feature.headline.value) }}
                    />
                    <span className="an-compare-current">
                      {formatNumber(feature.headline.value)}
                    </span>
                  </span>
                  <span className="an-compare-row">
                    <span
                      className="an-compare-bar an-compare-bar--previous"
                      style={{ width: width(prev) }}
                    />
                    <span className="an-compare-previous">
                      {formatNumber(prev)}
                    </span>
                  </span>
                </span>
                <span className="an-compare-chip">
                  {chip ? <Chip chip={chip} /> : null}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="an-empty">{STR.analyticsCompareNone}</p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Key figures (in place of the design's per-user ranking — see the header)
// ---------------------------------------------------------------------------

const FIGURE_ICONS: Readonly<Record<string, LucideIcon>> = {
  articles: FileText,
  posters: ImageIcon,
  videos: Video,
  transcripts: Mic,
  activeDays: CalendarCheck,
};

export function AnalyticsKeyFigures({
  headline,
  windowDays,
}: {
  headline: readonly Metric[];
  windowDays: number;
}) {
  const rows = headline.filter((m) => m.key !== 'totalOutputs');
  const countMax = Math.max(
    1,
    ...rows.filter((m) => m.key !== 'activeDays').map((m) => m.value),
  );

  return (
    <section className="an-card">
      <h2 className="an-card-title">{STR.analyticsKeyFiguresTitle}</h2>
      <ul className="an-figures">
        {rows.map((metric, i) => {
          const Icon = FIGURE_ICONS[metric.key] ?? FileText;
          const isDays = metric.key === 'activeDays';
          const ratio = isDays
            ? metric.value / Math.max(1, windowDays)
            : metric.value / countMax;
          const chip = deltaChip(metric);
          return (
            <li key={metric.key}>
              <span
                className={`an-figure-icon${i === 0 ? ' an-figure-icon--lead' : ''}`}
                aria-hidden="true"
              >
                <Icon size={18} />
              </span>
              <span className="an-figure-main">
                <span className="an-figure-line">
                  <span className="an-figure-name">
                    {metricLabel(metric.key)}
                  </span>
                  {isDays ? (
                    <span className="an-figure-note">
                      {analyticsActiveDaysOf(formatNumber(windowDays))}
                    </span>
                  ) : chip ? (
                    <Chip chip={chip} />
                  ) : null}
                </span>
                <span className="an-figure-track">
                  <span style={{ width: `${Math.min(100, ratio * 100)}%` }} />
                </span>
              </span>
              <span className="an-figure-value">{formatMetric(metric)}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Year heatmap
// ---------------------------------------------------------------------------

const MONTH_LABEL = new Intl.DateTimeFormat('mr-IN', {
  month: 'short',
  timeZone: 'Asia/Kolkata',
});

// The tooltip names the weekday and the year: the grid spans two calendar years, and "which
// day of the week" is the first thing anyone reads a heatmap for.
const HEAT_DAY_LABEL = new Intl.DateTimeFormat('mr-IN', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'Asia/Kolkata',
});

type HeatKey = Readonly<{ w: number; d: number }>;
type HeatTipPlace = Readonly<{
  x: number;
  y: number;
  below: boolean;
  shift: number;
}>;

// Room the tip needs above a cell before it flips underneath it.
const HEAT_TIP_CLEARANCE = 72;
// The tip never comes closer than this to either side of the viewport.
const HEAT_TIP_EDGE = 8;

export function AnalyticsYearHeatmap({
  yearDaily,
  loading,
}: {
  yearDaily: readonly AnalyticsDay[] | null;
  loading: boolean;
}) {
  const { weeks, total } = useMemo(
    () => heatmapWeeks(yearDaily ?? []),
    [yearDaily],
  );
  // On a narrow screen the grid scrolls sideways; open it on the recent weeks, which are the
  // ones anyone is looking for, rather than on last year's.
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [weeks.length]);

  // GitHub-style hover card. One tip for the whole grid, driven by delegation, rather than
  // 364 handlers. It is position:fixed because the grid sits in a sideways scroller, whose
  // overflow would clip anything that hangs above the first row.
  const grid = useRef<HTMLDivElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<HeatKey | null>(null);
  const [place, setPlace] = useState<HeatTipPlace | null>(null);
  const [tick, setTick] = useState(0);
  const activeCell =
    active !== null ? (weeks[active.w]?.days[active.d] ?? null) : null;

  // The tip follows its cell, so a scroll or resize re-measures it rather than leaving it
  // floating over the wrong day.
  useEffect(() => {
    if (active === null) return;
    const remeasure = () => setTick((t) => t + 1);
    window.addEventListener('scroll', remeasure, true);
    window.addEventListener('resize', remeasure);
    return () => {
      window.removeEventListener('scroll', remeasure, true);
      window.removeEventListener('resize', remeasure);
    };
  }, [active]);

  useLayoutEffect(() => {
    if (active === null) {
      setPlace(null);
      return;
    }
    const cell = grid.current?.querySelector<HTMLElement>(
      `[data-w="${active.w}"][data-d="${active.d}"]`,
    );
    if (!cell) {
      setPlace(null);
      return;
    }
    const rect = cell.getBoundingClientRect();
    const below = rect.top < HEAT_TIP_CLEARANCE;
    const x = rect.left + rect.width / 2;
    const y = below ? rect.bottom : rect.top;
    // Keep the bubble on screen near either edge; the arrow stays over the cell.
    const width = tip.current?.offsetWidth ?? 0;
    const half = width / 2;
    let shift = 0;
    if (x - half < HEAT_TIP_EDGE) shift = HEAT_TIP_EDGE - (x - half);
    else if (x + half > window.innerWidth - HEAT_TIP_EDGE)
      shift = window.innerWidth - HEAT_TIP_EDGE - (x + half);
    setPlace({ x, y, below, shift });
  }, [active, tick, activeCell]);

  const keyOf = (target: EventTarget | null): HeatKey | null => {
    const el = (target as HTMLElement | null)?.closest<HTMLElement>('[data-w]');
    if (!el) return null;
    return { w: Number(el.dataset.w), d: Number(el.dataset.d) };
  };

  const onPointer = (event: PointerEvent<HTMLDivElement>) => {
    const key = keyOf(event.target);
    if (key) setActive(key);
  };

  // Arrow keys walk the grid the way it reads: up/down through the week, left/right across
  // weeks. Empty cells (before the series, after today) are skipped over.
  const step = (from: HeatKey, dw: number, dd: number): HeatKey => {
    let w = from.w;
    let d = from.d;
    for (let i = 0; i < 400; i++) {
      d += dd;
      w += dw;
      if (d < 0) {
        d = 6;
        w -= 1;
      } else if (d > 6) {
        d = 0;
        w += 1;
      }
      if (w < 0 || w >= weeks.length) return from;
      if (weeks[w]!.days[d]) return { w, d };
    }
    return from;
  };

  const lastKey = (): HeatKey | null => {
    for (let w = weeks.length - 1; w >= 0; w--)
      for (let d = 6; d >= 0; d--) if (weeks[w]!.days[d]) return { w, d };
    return null;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    if (event.key === 'Escape') {
      setActive(null);
      return;
    }
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    const from = active ?? lastKey();
    if (!from) return;
    const next = active ? step(from, move[0], move[1]) : from;
    setActive(next);
    grid.current
      ?.querySelector<HTMLElement>(`[data-w="${next.w}"][data-d="${next.d}"]`)
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };

  const dayLabels = [
    STR.analyticsHeatmapMon,
    '',
    STR.analyticsHeatmapWed,
    '',
    STR.analyticsHeatmapFri,
    '',
    '',
  ];

  return (
    <section className="an-card">
      <div className="an-card-head">
        <div>
          <h2 className="an-card-title">{STR.analyticsHeatmapTitle}</h2>
          {weeks.length > 0 ? (
            <p className="an-card-hint">
              {analyticsHeatmapSummary(formatNumber(total))}
            </p>
          ) : null}
        </div>
        <span className="an-heat-legend" aria-hidden="true">
          {STR.analyticsHeatmapLess}
          {HEAT_LEVELS.map((colour) => (
            <span key={colour} style={{ background: colour }} />
          ))}
          {STR.analyticsHeatmapMore}
        </span>
      </div>
      {weeks.length === 0 ? (
        loading ? (
          <div className="an-heat-loading" role="status">
            <span className="spinner" aria-hidden="true" />
            {STR.analyticsHeatmapLoading}
          </div>
        ) : (
          <p className="an-empty">{STR.analyticsEmpty}</p>
        )
      ) : (
        <div className="an-heat-scroll" ref={scroller}>
          <div className="an-heat">
            <div className="an-heat-days" aria-hidden="true">
              <span />
              {dayLabels.map((label, i) => (
                <span key={i}>{label}</span>
              ))}
            </div>
            <div
              className="an-heat-grid"
              ref={grid}
              tabIndex={0}
              aria-label={STR.analyticsHeatmapKeyboardHint}
              onPointerOver={onPointer}
              onPointerDown={onPointer}
              onPointerLeave={(event) => {
                // A finger lifting is not a "leave": keep a tapped day's tip until the next tap.
                if (event.pointerType === 'mouse') setActive(null);
              }}
              onKeyDown={onKeyDown}
              onBlur={() => setActive(null)}
            >
              {weeks.map((week, w) => (
                <div key={w} className="an-heat-week">
                  <span className="an-heat-month" aria-hidden="true">
                    {week.monthStart
                      ? MONTH_LABEL.format(
                          new Date(`${week.monthStart}T12:00:00+05:30`),
                        )
                      : ''}
                  </span>
                  {week.days.map((cell, d) =>
                    cell ? (
                      <span
                        key={d}
                        data-w={w}
                        data-d={d}
                        className={`an-heat-cell${
                          active?.w === w && active.d === d ? ' is-active' : ''
                        }`}
                        style={{ background: HEAT_LEVELS[cell.level] }}
                      />
                    ) : (
                      <span
                        key={d}
                        className="an-heat-cell an-heat-cell--empty"
                      />
                    ),
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      {activeCell ? (
        <div
          ref={tip}
          className={`an-heat-tip${place?.below ? ' an-heat-tip--below' : ''}`}
          role="status"
          style={{
            left: place?.x ?? 0,
            top: place?.y ?? 0,
            visibility: place ? 'visible' : 'hidden',
            ['--an-heat-tip-shift' as string]: `${place?.shift ?? 0}px`,
          }}
        >
          <strong>
            {activeCell.value === 0
              ? STR.analyticsHeatmapNoWork
              : analyticsWorkCount(formatNumber(activeCell.value))}
          </strong>
          <span>
            {HEAT_DAY_LABEL.format(
              new Date(`${activeCell.date}T12:00:00+05:30`),
            )}
          </span>
        </div>
      ) : null}
    </section>
  );
}

// Per-feature series for the tile sparklines, bucketed like the charts above them.
export function featureSeries(
  daily: readonly AnalyticsDay[],
): Readonly<Record<AnalyticsFeatureKey, number[]>> {
  const buckets = bucketDays(daily, isWeekly(daily));
  return Object.fromEntries(
    ANALYTICS_FEATURE_KEYS.map((key) => [
      key,
      buckets.map((b) => b.byFeature[key]),
    ]),
  ) as Record<AnalyticsFeatureKey, number[]>;
}
