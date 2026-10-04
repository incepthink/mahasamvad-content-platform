// Pure geometry and bucketing for the /analytics landing page's charts.
//
// Everything here is a function of the API payload alone — no DOM, no React — so what a
// chart draws can be reasoned about (and checked) without a browser.
//
// UNITS: `daily` counts COMPLETED RUNS per feature per day (see buildDaily in
// apps/api/src/jobs/analytics.ts). The headline numbers count ARTIFACTS. The charts built
// from these helpers therefore speak of कामे, never of साहित्य.

import {
  ANALYTICS_FEATURE_KEYS,
  type AnalyticsDay,
  type AnalyticsFeatureKey,
  type Metric,
} from '@dgipr/schemas';
import { deltaOf, deltaText, formatNumber } from './analytics';

// ---------------------------------------------------------------------------
// Colours. The design's two scales, keyed by feature so a feature keeps its colour whatever
// order the payload lists it in.
// ---------------------------------------------------------------------------

// Navy steps: the donut and the small identity dots. Ordered dark → light so the biggest
// lanes (listed first by the API) carry the most ink.
export const FEATURE_MONO: Readonly<Record<AnalyticsFeatureKey, string>> = {
  social: '#1e3a5f',
  article: '#3d6292',
  transcribe: '#6b8cb8',
  translate: '#97b0d2',
  proofread: '#bccbe1',
  video: '#d9e2ee',
};

// Distinct hues: the stacked bars, where adjacent segments must be told apart. Every bar is
// also reachable as text (the column title and the table under the chart).
export const FEATURE_HUE: Readonly<Record<AnalyticsFeatureKey, string>> = {
  social: '#1e3a5f',
  article: '#4f7cac',
  transcribe: '#4f9488',
  translate: '#c49a2c',
  proofread: '#c06a4e',
  video: '#8a6fae',
};

export const HEAT_LEVELS = [
  '#e6ebf2',
  '#c2cfe1',
  '#8fa6c7',
  '#52709b',
  '#1e3a5f',
] as const;

// ---------------------------------------------------------------------------
// Buckets
// ---------------------------------------------------------------------------

export type Bucket = Readonly<{
  start: string;
  end: string;
  total: number;
  byFeature: Readonly<Record<AnalyticsFeatureKey, number>>;
}>;

export function dayTotal(day: AnalyticsDay): number {
  return ANALYTICS_FEATURE_KEYS.reduce((sum, key) => sum + day[key], 0);
}

// Past a month, one point per day is a comb nobody can read on a 600-unit-wide chart; the
// series becomes weekly. Buckets are cut from the END, so the last one always ends today and
// only the first may be short.
export const isWeekly = (days: readonly AnalyticsDay[]): boolean =>
  days.length > 31;

export function bucketDays(
  days: readonly AnalyticsDay[],
  weekly: boolean,
): Bucket[] {
  const size = weekly ? 7 : 1;
  const buckets: Bucket[] = [];
  for (let end = days.length; end > 0; end -= size) {
    const slice = days.slice(Math.max(0, end - size), end);
    const byFeature = Object.fromEntries(
      ANALYTICS_FEATURE_KEYS.map((key) => [
        key,
        slice.reduce((sum, day) => sum + day[key], 0),
      ]),
    ) as Record<AnalyticsFeatureKey, number>;
    buckets.unshift({
      start: slice[0]!.date,
      end: slice[slice.length - 1]!.date,
      total: ANALYTICS_FEATURE_KEYS.reduce(
        (sum, key) => sum + byFeature[key],
        0,
      ),
      byFeature,
    });
  }
  return buckets;
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

// A smooth line through the points with horizontal tangents at each one, so the curve never
// overshoots a value (a dip below zero on a count chart would be a small lie).
export function smoothPath(
  points: ReadonlyArray<readonly [number, number]>,
): string {
  if (points.length === 0) return '';
  const f = (n: number) => n.toFixed(1);
  let d = `M${f(points[0]![0])},${f(points[0]![1])}`;
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1]!;
    const [x1, y1] = points[i]!;
    const cx = f((x0 + x1) / 2);
    d += ` C${cx},${f(y0)} ${cx},${f(y1)} ${f(x1)},${f(y1)}`;
  }
  return d;
}

// x for point i of n across a `width`-wide box. A single point sits in the middle rather
// than dividing by zero.
export const xAt = (i: number, n: number, width: number): number =>
  n < 2 ? width / 2 : (i / (n - 1)) * width;

export function linePoints(
  values: readonly number[],
  max: number,
  width: number,
  height: number,
  pad = 0,
): Array<[number, number]> {
  const top = max > 0 ? max : 1;
  return values.map((value, i) => [
    xAt(i, values.length, width),
    height - pad - (value / top) * (height - pad),
  ]);
}

// A round ceiling for a bar chart's y-axis, so the top label is a number someone would say.
export function niceCeiling(peak: number): number {
  if (peak <= 0) return 10;
  const target = peak * 1.1;
  const step = target <= 10 ? 2 : target <= 50 ? 10 : target <= 200 ? 20 : 50;
  return Math.ceil(target / step) * step;
}

// ---------------------------------------------------------------------------
// Delta chip
// ---------------------------------------------------------------------------

export type DeltaChip = Readonly<{
  text: string;
  tone: 'up' | 'down' | 'flat';
  // The long, read-aloud form for title/aria-label.
  label: string;
}>;

// The compact "↑ १२%" the design shows, built from the SAME deltaOf the rest of the surface
// uses, so a chip and a sentence can never describe one change differently.
export function deltaChip(metric: Metric): DeltaChip | null {
  const delta = deltaOf(metric);
  if (!delta) return null;
  const label = deltaText(delta);
  if (delta.direction === 'new') return { text: label, tone: 'up', label };
  if (delta.direction === 'flat') return { text: '०%', tone: 'flat', label };
  const arrow = delta.direction === 'up' ? '↑' : '↓';
  if (delta.absolute !== undefined) {
    return {
      text: `${arrow} ${formatNumber(delta.absolute)}`,
      tone: delta.direction,
      label,
    };
  }
  return {
    text: `${arrow} ${formatNumber(delta.percent ?? 0)}%`,
    tone: delta.direction,
    label,
  };
}

// ---------------------------------------------------------------------------
// Year heatmap
// ---------------------------------------------------------------------------

export type HeatCell = Readonly<{
  date: string;
  value: number;
  level: number;
}> | null;
export type HeatWeek = Readonly<{
  monthStart: string | null;
  days: HeatCell[];
}>;

// Monday = 0. Noon IST is the same calendar day in UTC, so getUTCDay is exact.
function mondayIndex(date: string): number {
  return (new Date(`${date}T12:00:00+05:30`).getUTCDay() + 6) % 7;
}

// 52 Monday-first columns, the last one holding today; days after today are null (not
// drawn), as are days older than the series. Levels scale to the busiest day in the year so
// the darkest step always means "a peak day", whatever the department's volume.
export function heatmapWeeks(days: readonly AnalyticsDay[]): {
  weeks: HeatWeek[];
  total: number;
} {
  if (days.length === 0) return { weeks: [], total: 0 };
  const values = days.map(dayTotal);
  const peak = Math.max(...values);
  const total = values.reduce((sum, v) => sum + v, 0);
  const last = days.length - 1;
  const todayIndex = mondayIndex(days[last]!.date);
  const level = (v: number) =>
    v === 0 || peak === 0
      ? 0
      : Math.min(4, Math.max(1, Math.ceil((v / peak) * 4)));

  const weeks: HeatWeek[] = [];
  let previousMonth = '';
  for (let w = 0; w < 52; w++) {
    const cells: HeatCell[] = [];
    for (let d = 0; d < 7; d++) {
      const back = (51 - w) * 7 + (todayIndex - d);
      const index = last - back;
      if (back < 0 || index < 0) {
        cells.push(null);
        continue;
      }
      const v = values[index]!;
      cells.push({ date: days[index]!.date, value: v, level: level(v) });
    }
    // A column is labelled with its month where the month changes reading left to right,
    // judged by the column's first drawn day.
    const first = cells.find((cell) => cell !== null);
    const month = first ? first.date.slice(0, 7) : '';
    const monthStart = first && month !== previousMonth ? first.date : null;
    if (month) previousMonth = month;
    weeks.push({ monthStart, days: cells });
  }
  return { weeks, total };
}
