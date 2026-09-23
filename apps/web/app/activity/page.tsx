'use client';

// /activity — the hidden admin log: which IP and which browser did what, live and historically.
//
// NOT in NAV_LINKS (the /media-room, /new-dlo precedent): reached by URL only. That is
// obscurity, not protection — the product has no login and no PIN, and this page and its API
// are open to anyone who has the URL.
//
// "Who" is an IP plus a browser-scoped device id (lib/deviceId.ts). Neither is identity and
// neither grants anything; the hint in the page head says so, including the ways a device id
// resets.
//
// Filters live in the URL (`router.replace`, the analytics precedent), so a filtered view or
// one actor's journey can be linked to. Clicking an IP or a device opens that actor's journey:
// a header card above the same feed, narrowed to them.

import {
  Suspense,
  useCallback,
  useEffect,
  useState,
  type FormEvent,
} from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ACTIVITY_FEATURES,
  type ActivityActorResponse,
  type ActivityEvent,
} from '@dgipr/schemas';
import { AnalyticsBarList } from '../../components/AnalyticsBarList';
import { ErrorNotice } from '../../components/ErrorNotice';
import { PageShell } from '../../components/common/PageShell';
import { getActivityActor } from '../../lib/api';
import { deviceLabel, subjectHref } from '../../lib/activity';
import { formatNumber } from '../../lib/analytics';
import { errorMessage } from '../../lib/errorMessage';
import {
  ACTIVITY_FEATURE_LABELS,
  ACTIVITY_STATUS_LABELS,
  ACTIVITY_STR,
  activityActionLabel,
  formatDate,
} from '../../lib/strings';
import {
  useActivityFeed,
  type ActivityFilterState,
} from '../../lib/useActivityFeed';

const FILTER_KEYS = [
  'ip',
  'device',
  'feature',
  'status',
  'from',
  'to',
] as const;
type FilterKey = (typeof FILTER_KEYS)[number];

function readFilters(params: URLSearchParams): ActivityFilterState {
  const out: Record<string, string> = {};
  for (const key of FILTER_KEYS) {
    const value = params.get(key)?.trim();
    if (value) out[key] = value;
  }
  return out;
}

function ActivityPageBody() {
  const router = useRouter();
  const params = useSearchParams();
  const filters = readFilters(new URLSearchParams(params.toString()));
  const {
    events,
    summary,
    loading,
    loadingMore,
    error,
    hasMore,
    live,
    loadMore,
    reload,
  } = useActivityFeed(filters);

  const navigate = useCallback(
    (next: ActivityFilterState) => {
      const search = new URLSearchParams();
      for (const key of FILTER_KEYS) {
        const value = next[key];
        if (value) search.set(key, value);
      }
      const text = search.toString();
      router.replace(text ? `/activity?${text}` : '/activity');
    },
    [router],
  );

  const journey = filters.ip || filters.device;

  return (
    <PageShell
      background="activity"
      title={ACTIVITY_STR.title}
      subtitle={ACTIVITY_STR.intro}
    >
      {journey ? (
        <>
          <button
            type="button"
            className="back-link activity-back"
            onClick={() => navigate({})}
          >
            {ACTIVITY_STR.journeyBack}
          </button>
          <JourneyCard
            ip={filters.ip}
            device={filters.device}
            onPickIp={(ip) => navigate({ ip })}
            onPickDevice={(device) => navigate({ device })}
          />
        </>
      ) : summary ? (
        <>
          <section className="stat-grid" aria-label={ACTIVITY_STR.title}>
            <Tile label={ACTIVITY_STR.kpiActiveIps} value={summary.activeIps} />
            <Tile label={ACTIVITY_STR.kpiDevices} value={summary.devices} />
            <Tile label={ACTIVITY_STR.kpiActions} value={summary.actions} />
            <Tile label={ACTIVITY_STR.kpiFailed} value={summary.failed} />
          </section>
          <div className="activity-overview">
            <section className="card">
              <h2>{ACTIVITY_STR.byFeatureTitle}</h2>
              <AnalyticsBarList
                rows={summary.byFeature.map((row) => ({
                  key: row.key,
                  label: ACTIVITY_FEATURE_LABELS[row.key] ?? row.key,
                  value: row.count,
                }))}
              />
            </section>
            <section className="card">
              <h2>{ACTIVITY_STR.busiestTitle}</h2>
              {summary.busiestIps.length === 0 ? (
                <p className="hint">{ACTIVITY_STR.empty}</p>
              ) : (
                <ul className="activity-busy">
                  {summary.busiestIps.map((row) => (
                    <li key={row.ip}>
                      <button
                        type="button"
                        className="activity-link activity-ip"
                        onClick={() => navigate({ ip: row.ip })}
                      >
                        {row.ip}
                      </button>
                      <span className="activity-busy-meta">
                        {ACTIVITY_STR.busiestActions(row.actions)} ·{' '}
                        {ACTIVITY_STR.busiestDevices(row.devices)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </>
      ) : null}

      <Filters value={filters} onApply={navigate} />

      <section className="card activity-feed-card">
        <div className="card-head activity-feed-head">
          <h2>{ACTIVITY_STR.feedTitle}</h2>
          <span className="activity-live">
            {live ? (
              <span className="activity-pulse" aria-hidden="true" />
            ) : null}
            {live ? ACTIVITY_STR.feedLive : ACTIVITY_STR.feedPaused}
          </span>
        </div>

        {error ? (
          <ErrorNotice
            message={error}
            fallback={ACTIVITY_STR.loadFailed}
            onRetry={() => void reload()}
            retryLabel={ACTIVITY_STR.retry}
          />
        ) : null}

        {loading && events.length === 0 ? (
          <div
            className="page-loading"
            role="status"
            aria-label={ACTIVITY_STR.loading}
          >
            <span className="spinner spinner-lg" aria-hidden="true" />
          </div>
        ) : events.length === 0 && !error ? (
          <p className="hint">{ACTIVITY_STR.empty}</p>
        ) : (
          <ol className="activity-feed">
            {events.map((event) => (
              <FeedRow
                key={event.id}
                event={event}
                onPickIp={(ip) => navigate({ ip })}
                onPickDevice={(device) => navigate({ device })}
              />
            ))}
          </ol>
        )}

        {hasMore ? (
          <button
            type="button"
            className="btn btn-ghost activity-more"
            onClick={() => void loadMore()}
            disabled={loadingMore}
          >
            {loadingMore ? (
              <span className="spinner" aria-hidden="true" />
            ) : null}
            {ACTIVITY_STR.loadMore}
          </button>
        ) : null}
      </section>
    </PageShell>
  );
}

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <div className="stat-tile">
      <p className="stat-tile-label">{label}</p>
      <p className="stat-tile-value">{formatNumber(value)}</p>
    </div>
  );
}

function FeedRow({
  event,
  onPickIp,
  onPickDevice,
}: {
  event: ActivityEvent;
  onPickIp: (ip: string) => void;
  onPickDevice: (device: string) => void;
}) {
  const status = ACTIVITY_STATUS_LABELS[event.status] ?? {
    label: event.status,
    chip: 'running' as const,
  };
  const conversation =
    typeof event.detail.conversation === 'string'
      ? event.detail.conversation
      : null;
  const href =
    event.subjectKind === 'nvw_turn' && conversation
      ? `/new-video-workflow/${conversation}`
      : subjectHref(event.subjectKind, event.subjectId);

  return (
    <li className={`activity-row activity-row--${event.status}`}>
      <div className="activity-row-when">
        <time dateTime={event.createdAt}>{formatDate(event.createdAt)}</time>
      </div>
      <div className="activity-row-who">
        <button
          type="button"
          className="activity-link activity-ip"
          onClick={() => onPickIp(event.ip)}
        >
          {event.ip}
        </button>
        {event.deviceId ? (
          <button
            type="button"
            className="activity-link activity-device"
            onClick={() => onPickDevice(event.deviceId!)}
          >
            {deviceLabel(event.deviceId, event.userAgent)}
          </button>
        ) : (
          <span className="activity-device activity-device--none">
            {deviceLabel(null, event.userAgent)}
          </span>
        )}
      </div>
      <div className="activity-row-what">
        <p className="activity-action">
          <span className="activity-feature">
            {ACTIVITY_FEATURE_LABELS[event.feature] ?? event.feature}
          </span>
          {activityActionLabel(event.action, event.detail)}
        </p>
        {event.summary ? (
          <p className="activity-summary">{event.summary}</p>
        ) : null}
        {event.status === 'failed' && event.error ? (
          <p className="activity-error">{event.error}</p>
        ) : null}
        {href ? (
          <Link className="activity-open" href={href}>
            {ACTIVITY_STR.openRun} →
          </Link>
        ) : null}
      </div>
      <div className="activity-row-status">
        <span className={`chip chip-${status.chip}`}>
          {event.status === 'in_progress' ? (
            <span className="activity-pulse" aria-hidden="true" />
          ) : null}
          {status.label}
        </span>
      </div>
    </li>
  );
}

function Filters({
  value,
  onApply,
}: {
  value: ActivityFilterState;
  onApply: (next: ActivityFilterState) => void;
}) {
  const [draft, setDraft] = useState<ActivityFilterState>(value);
  const signature = JSON.stringify(value);
  // Follow the URL when it changes from elsewhere (a click on an IP, the back button).
  useEffect(() => {
    setDraft(JSON.parse(signature) as ActivityFilterState);
  }, [signature]);

  const set = (key: FilterKey, next: string) =>
    setDraft((current) => ({ ...current, [key]: next || undefined }));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onApply(draft);
  };

  return (
    <form
      className="card card-compact history-toolbar activity-filters"
      onSubmit={submit}
    >
      <label className="history-select">
        <span className="history-facet-label">{ACTIVITY_STR.filterIp}</span>
        <input
          type="text"
          inputMode="text"
          value={draft.ip ?? ''}
          placeholder={ACTIVITY_STR.filterIpPlaceholder}
          onChange={(event) => set('ip', event.target.value.trim())}
        />
      </label>
      <label className="history-select">
        <span className="history-facet-label">
          {ACTIVITY_STR.filterFeature}
        </span>
        <select
          value={draft.feature ?? ''}
          onChange={(event) => set('feature', event.target.value)}
        >
          <option value="">{ACTIVITY_STR.filterAll}</option>
          {ACTIVITY_FEATURES.map((feature) => (
            <option key={feature} value={feature}>
              {ACTIVITY_FEATURE_LABELS[feature] ?? feature}
            </option>
          ))}
        </select>
      </label>
      <label className="history-select">
        <span className="history-facet-label">{ACTIVITY_STR.filterStatus}</span>
        <select
          value={draft.status ?? ''}
          onChange={(event) => set('status', event.target.value)}
        >
          <option value="">{ACTIVITY_STR.filterAll}</option>
          {Object.entries(ACTIVITY_STATUS_LABELS).map(([key, entry]) => (
            <option key={key} value={key}>
              {entry.label}
            </option>
          ))}
        </select>
      </label>
      <label className="history-select">
        <span className="history-facet-label">{ACTIVITY_STR.filterFrom}</span>
        <input
          type="date"
          value={draft.from ?? ''}
          onChange={(event) => set('from', event.target.value)}
        />
      </label>
      <label className="history-select">
        <span className="history-facet-label">{ACTIVITY_STR.filterTo}</span>
        <input
          type="date"
          value={draft.to ?? ''}
          onChange={(event) => set('to', event.target.value)}
        />
      </label>
      <div className="activity-filter-actions">
        <button type="submit" className="btn btn-primary">
          {ACTIVITY_STR.filterApply}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => onApply({})}
        >
          {ACTIVITY_STR.filterClear}
        </button>
      </div>
    </form>
  );
}

function JourneyCard({
  ip,
  device,
  onPickIp,
  onPickDevice,
}: {
  ip?: string | undefined;
  device?: string | undefined;
  onPickIp: (ip: string) => void;
  onPickDevice: (device: string) => void;
}) {
  const [data, setData] = useState<ActivityActorResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    getActivityActor(ip ? { ip } : { device })
      .then((next) => {
        if (!cancelled) setData(next);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(errorMessage(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [ip, device]);

  const heading = ip
    ? ACTIVITY_STR.journeyIp(ip)
    : ACTIVITY_STR.journeyDevice(
        deviceLabel(device ?? null, data?.devices[0]?.userAgent ?? null),
      );

  return (
    <section className="card activity-journey">
      <h2>{heading}</h2>
      {error ? (
        <ErrorNotice message={error} fallback={ACTIVITY_STR.loadFailed} />
      ) : null}
      {data ? (
        <>
          <dl className="activity-journey-facts">
            <div>
              <dt>{ACTIVITY_STR.journeyFirst}</dt>
              <dd>{data.firstAt ? formatDate(data.firstAt) : '—'}</dd>
            </div>
            <div>
              <dt>{ACTIVITY_STR.journeyLast}</dt>
              <dd>{data.lastAt ? formatDate(data.lastAt) : '—'}</dd>
            </div>
            <div>
              <dt>{ACTIVITY_STR.journeyActions}</dt>
              <dd>{formatNumber(data.actions)}</dd>
            </div>
          </dl>
          {ip ? (
            <>
              <h3 className="activity-journey-sub">
                {ACTIVITY_STR.journeyDevices}
              </h3>
              <ul className="activity-busy">
                {data.devices.map((entry) => (
                  <li key={entry.deviceId ?? 'none'}>
                    {entry.deviceId ? (
                      <button
                        type="button"
                        className="activity-link activity-device"
                        onClick={() => onPickDevice(entry.deviceId!)}
                      >
                        {deviceLabel(entry.deviceId, entry.userAgent)}
                      </button>
                    ) : (
                      <span className="activity-device activity-device--none">
                        {deviceLabel(null, entry.userAgent)}
                      </span>
                    )}
                    <span className="activity-busy-meta">
                      {ACTIVITY_STR.busiestActions(entry.actions)} ·{' '}
                      {formatDate(entry.lastAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <>
              <h3 className="activity-journey-sub">
                {ACTIVITY_STR.journeyIps}
              </h3>
              <ul className="activity-busy">
                {data.ips.map((entry) => (
                  <li key={entry.key}>
                    <button
                      type="button"
                      className="activity-link activity-ip"
                      onClick={() => onPickIp(entry.key)}
                    >
                      {entry.key}
                    </button>
                    <span className="activity-busy-meta">
                      {ACTIVITY_STR.busiestActions(entry.count)}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      ) : !error ? (
        <div
          className="page-loading"
          role="status"
          aria-label={ACTIVITY_STR.loading}
        >
          <span className="spinner" aria-hidden="true" />
        </div>
      ) : null}
    </section>
  );
}

// useSearchParams needs a suspense boundary in the app router.
export default function ActivityPage() {
  return (
    <Suspense fallback={<PageShell background="activity" />}>
      <ActivityPageBody />
    </Suspense>
  );
}
