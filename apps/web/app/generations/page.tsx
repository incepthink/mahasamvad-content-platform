'use client';

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import type { GenerationFacetCounts, GenerationSummary } from '@dgipr/schemas';
import { listGenerations } from '../../lib/api';
import { RUN_FORMAT_LABELS, STR, type RunFormatKey } from '../../lib/strings';
import { errorMessage } from '../../lib/errorMessage';
import {
  HistoryCard,
  HistoryEmpty,
  HistorySkeletonGrid,
} from '../../components/HistoryCard';
import { ErrorNotice } from '../../components/ErrorNotice';
import { Pagination } from '../../components/Pagination';
import { PageShell } from '../../components/common/PageShell';

const PAGE_SIZE = 12;

// "Images only" is a per-viewer display preference, so it lives in localStorage rather than
// the URL: it changes how the list LOOKS, not which runs are in it.
const IMAGE_ONLY_KEY = 'dgipr.history.image-only';

function useImageOnly(): [boolean, (next: boolean) => void] {
  const [imageOnly, setImageOnly] = useState(false);
  useEffect(() => {
    try {
      if (window.localStorage.getItem(IMAGE_ONLY_KEY) === '1') setImageOnly(true);
    } catch {
      // A blocked localStorage costs the remembered choice, never the control.
    }
  }, []);
  const update = useCallback((next: boolean) => {
    setImageOnly(next);
    try {
      window.localStorage.setItem(IMAGE_ONLY_KEY, next ? '1' : '0');
    } catch {
      // As above.
    }
  }, []);
  return [imageOnly, update];
}

// ---------------------------------------------------------------------------
// Filter model
//
// Every facet, the sort, the page number and the search term are QUERY PARAMETERS on
// `GET /api/generations`, and the database answers with one screen of cards plus the
// numbers this page needs to draw its pager and its dropdowns.
//
// It used to work the other way round: the endpoint returned the newest 100 runs — every
// column of every one of them, which on this table means the note, the article, both
// translations and a dozen jsonb blobs — and all of this ran in the browser over whatever
// came back. That was megabytes on the wire to render nine cards, and it was also why the
// page could never reach the 101st run.
//
// All of it still lives in the URL, because opening a run and pressing Back is a full
// remount in the app router: without that, every return trip would land on the unfiltered
// first page.
// ---------------------------------------------------------------------------

// queued + running are ONE bucket: "is it still working" is one question, and splitting
// it would put a pill on screen that is empty almost all of the time.
type StatusKey = 'working' | 'completed' | 'failed';

const STATUS_KEYS: readonly StatusKey[] = ['working', 'completed', 'failed'];

const STATUS_FILTER_LABELS: Record<StatusKey, string> = {
  working: STR.historyStatusWorking,
  completed: 'पूर्ण',
  failed: 'अयशस्वी',
};

type DateKey = 'today' | 'week' | 'month';

const DATE_KEYS: readonly DateKey[] = ['today', 'week', 'month'];

const DATE_FILTER_LABELS: Record<DateKey, string> = {
  today: STR.historyDateToday,
  week: STR.historyDateWeek,
  month: STR.historyDateMonth,
};

type SortKey = 'newest' | 'oldest';

type Filters = {
  query: string;
  format: RunFormatKey | null;
  status: StatusKey | null;
  date: DateKey | null;
  sort: SortKey;
};

const EMPTY_FILTERS: Filters = {
  query: '',
  format: null,
  status: null,
  date: null,
  sort: 'newest',
};

function isFiltered(f: Filters): boolean {
  return (
    f.query !== '' || f.format !== null || f.status !== null || f.date !== null
  );
}

// What a request is actually keyed on — everything except the page number. Two views with
// the same key return the same rows in the same order, which is what lets the facet counts
// be fetched once per view and reused across every page of it.
function filterKey(f: Filters): string {
  return [f.query, f.format ?? '', f.status ?? '', f.date ?? '', f.sort].join(
    '|',
  );
}

// ---------------------------------------------------------------------------

type PillOption<T extends string> = {
  key: T;
  label: string;
  count: number;
};

// Each facet is one native <select>, so the whole filter block is a single row of
// dropdowns rather than three wrapping rows of pills. Native on purpose: it is the one
// control that already opens as a full-height list on a phone, needs no focus trap, and
// carries the count in its own option text.
function FacetSelect<T extends string>({
  label,
  options,
  selected,
  onSelect,
}: {
  label: string;
  options: readonly PillOption<T>[];
  selected: T | null;
  onSelect: (next: T | null) => void;
}) {
  return (
    <label className={`history-select${selected ? ' is-active' : ''}`}>
      <span className="history-facet-label">{label}</span>
      <select
        value={selected ?? ''}
        aria-label={label}
        // '' is the "no filter" value, so an empty string can never be a facet key.
        onChange={(e) => onSelect((e.target.value || null) as T | null)}
      >
        <option value="">{STR.historyFilterAll}</option>
        {options.map((option) => (
          <option
            key={option.key}
            value={option.key}
            // An option that would return nothing under the other filters is kept
            // listed but disabled: entries appearing and vanishing between two opens
            // of the same menu are worse than a greyed one that explains itself.
            disabled={option.count === 0 && selected !== option.key}
          >
            {option.label} ({option.count})
          </option>
        ))}
      </select>
    </label>
  );
}

function HistoryPageBody() {
  const router = useRouter();
  const params = useSearchParams();

  const [items, setItems] = useState<GenerationSummary[] | null>(null);
  const [total, setTotal] = useState(0);
  const [totalUnfiltered, setTotalUnfiltered] = useState(0);
  const [facets, setFacets] = useState<GenerationFacetCounts | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Distinct from `items === null`: a refetch keeps the cards it already has on screen and
  // dims them, because swapping a page of results for a skeleton on every keystroke reads
  // as the list breaking rather than as it narrowing.
  const [loading, setLoading] = useState(false);
  const [imageOnly, setImageOnly] = useImageOnly();

  // Read the facets off the URL through primitives, so `filters` keeps a stable identity
  // across re-renders that changed nothing — the debounce below depends on it not
  // churning.
  const rawQuery = params.get('q') ?? '';
  const rawFormat = params.get('format');
  const rawStatus = params.get('status');
  const rawDate = params.get('date');
  const rawSort = params.get('sort');
  const rawPage = params.get('page');

  const filters: Filters = useMemo(
    () => ({
      query: rawQuery.trim().toLowerCase(),
      format:
        rawFormat && rawFormat in RUN_FORMAT_LABELS
          ? (rawFormat as RunFormatKey)
          : null,
      status: STATUS_KEYS.includes(rawStatus as StatusKey)
        ? (rawStatus as StatusKey)
        : null,
      date: DATE_KEYS.includes(rawDate as DateKey)
        ? (rawDate as DateKey)
        : null,
      sort: rawSort === 'oldest' ? 'oldest' : 'newest',
    }),
    [rawQuery, rawFormat, rawStatus, rawDate, rawSort],
  );

  // The page number lives in the URL beside the facets, for the same reason they do:
  // opening a run and pressing Back is a full remount, so a page held in component state
  // would land the officer back on page 1 of a list they had paged three deep into.
  const requestedPage = Math.max(1, Number.parseInt(rawPage ?? '', 10) || 1);

  // The current view, read by callbacks that must not be re-armed when it changes.
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  // The text box stays local state so typing is never a render behind the URL.
  const [query, setQuery] = useState(rawQuery);

  const applyView = useCallback(
    (next: Filters, nextPage: number) => {
      const search = new URLSearchParams();
      if (next.query) search.set('q', next.query);
      if (next.format) search.set('format', next.format);
      if (next.status) search.set('status', next.status);
      if (next.date) search.set('date', next.date);
      if (next.sort !== 'newest') search.set('sort', next.sort);
      if (nextPage > 1) search.set('page', String(nextPage));
      const qs = search.toString();
      // replace, not push: narrowing one list is refining a single view, and it must not
      // take a press of Back per pill to leave the page (the /analytics range precedent).
      router.replace(qs ? `/generations?${qs}` : '/generations');
    },
    [router],
  );

  // Any facet change returns to page 1 — the old page number describes a list that no
  // longer exists.
  const setFilters = useCallback(
    (next: Filters) => applyView(next, 1),
    [applyView],
  );

  const setPage = useCallback(
    (next: number) => applyView(filtersRef.current, next),
    [applyView],
  );

  // Read through a ref by `load`, which must keep a stable identity — it is a dependency
  // of the fetch effect, and re-creating it on every render would refetch forever.
  const applyViewRef = useRef(applyView);
  applyViewRef.current = applyView;

  const key = filterKey(filters);
  // The view whose counts we are currently holding. Facets are requested only when this
  // disagrees with the view being loaded: paging inside one filter set cannot change a
  // count, and each set costs the API thirteen head-only COUNT queries.
  const facetKeyRef = useRef<string | null>(null);
  // A stale response must never overwrite a fresh one — typing three letters starts three
  // requests and they can land in any order.
  const requestIdRef = useRef(0);

  const load = useCallback(
    async (page: number, view: Filters, viewKey: string) => {
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      const wantFacets = facetKeyRef.current !== viewKey;
      setLoading(true);
      setError(null);
      try {
        const result = await listGenerations({
          page,
          pageSize: PAGE_SIZE,
          q: view.query,
          format: view.format,
          status: view.status,
          date: view.date,
          sort: view.sort,
          facets: wantFacets,
        });
        if (requestIdRef.current !== requestId) return;
        // A stale link — a bookmarked page 40 of a list that has since been filtered
        // down — asks for a page past the end and gets an empty one back with the true
        // count. Land on the last real page rather than on an empty grid under a pager
        // that says "1".
        const lastPage = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
        if (result.items.length === 0 && result.total > 0 && page > lastPage) {
          applyViewRef.current(view, lastPage);
          return;
        }
        setItems(result.items);
        setTotal(result.total);
        setTotalUnfiltered(result.totalUnfiltered);
        if (result.facets) {
          setFacets(result.facets);
          facetKeyRef.current = viewKey;
        }
      } catch (e) {
        if (requestIdRef.current !== requestId) return;
        setError(errorMessage(e, STR.genListLoadFailed));
      } finally {
        if (requestIdRef.current === requestId) setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void load(requestedPage, filters, key);
  }, [load, requestedPage, filters, key]);

  // Debounce the search into the URL so filtering/paging doesn't thrash on each
  // keystroke. The current filters are read through a ref so this effect depends only
  // on the typed string — re-arming the timer on every render would never let it fire.
  useEffect(() => {
    const normalized = query.trim().toLowerCase();
    if (normalized === filtersRef.current.query) return;
    const t = setTimeout(
      () => setFilters({ ...filtersRef.current, query: normalized }),
      300,
    );
    return () => clearTimeout(t);
  }, [query, setFilters]);

  // The counts come from the server, already computed with every OTHER filter applied — so
  // a count says what pressing that option would give you rather than how many such runs
  // exist overall.
  const formatOptions = useMemo<PillOption<RunFormatKey>[]>(() => {
    if (!facets) return [];
    return (Object.keys(RUN_FORMAT_LABELS) as RunFormatKey[])
      .filter((formatKey) => facets.format[formatKey] !== undefined)
      .map((formatKey) => ({
        key: formatKey,
        label: RUN_FORMAT_LABELS[formatKey],
        count: facets.format[formatKey] ?? 0,
      }));
  }, [facets]);

  const statusOptions = useMemo<PillOption<StatusKey>[]>(() => {
    if (!facets) return [];
    return STATUS_KEYS.map((statusKey) => ({
      key: statusKey,
      label: STATUS_FILTER_LABELS[statusKey],
      count: facets.status[statusKey] ?? 0,
    }));
  }, [facets]);

  const dateOptions = useMemo<PillOption<DateKey>[]>(() => {
    if (!facets) return [];
    return DATE_KEYS.map((dateKey) => ({
      key: dateKey,
      label: DATE_FILTER_LABELS[dateKey],
      count: facets.date[dateKey] ?? 0,
    }));
  }, [facets]);

  // A shrinking result set (a stale link, or a list that lost rows since it was paged) must
  // not leave the requested page out of range. Clamped for display rather than rewritten,
  // so an out-of-range URL costs no second navigation.
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(requestedPage, pageCount);

  const active = isFiltered(filters);
  const hasAnyRun = totalUnfiltered > 0;
  // A facet whose options this deployment has never varied only ever tells you what the
  // cards already say. Counted against the CURRENT view rather than the whole table, so an
  // option the officer has selected is never the one that hides its own control.
  const showFormatFacet =
    formatOptions.filter((o) => o.count > 0 || o.key === filters.format)
      .length > 1;
  const showStatusFacet =
    statusOptions.filter((o) => o.count > 0 || o.key === filters.status)
      .length > 1;

  return (
    <PageShell
      background="generations"
      title={STR.historyTitle}
      subtitle={STR.historyIntro}
      actions={
        <Link href="/" className="btn btn-small">
          {STR.historyNew}
        </Link>
      }
    >
      {error ? (
        <ErrorNotice
          message={error}
          onRetry={() => void load(requestedPage, filters, key)}
          fallback={STR.genListLoadFailed}
        />
      ) : null}

      {hasAnyRun ? (
        <div className="history-filters glass-card">
          <div className="history-toolbar">
            <input
              type="text"
              className="history-search"
              value={query}
              placeholder={STR.historySearchPlaceholder}
              onChange={(e) => setQuery(e.target.value)}
            />

            {showFormatFacet ? (
              <FacetSelect
                label={STR.historyFilterFormat}
                options={formatOptions}
                selected={filters.format}
                onSelect={(format) => setFilters({ ...filters, format })}
              />
            ) : null}

            {showStatusFacet ? (
              <FacetSelect
                label={STR.historyFilterStatus}
                options={statusOptions}
                selected={filters.status}
                onSelect={(status) => setFilters({ ...filters, status })}
              />
            ) : null}

            {dateOptions.length > 0 ? (
              <FacetSelect
                label={STR.historyFilterDate}
                options={dateOptions}
                selected={filters.date}
                onSelect={(date) => setFilters({ ...filters, date })}
              />
            ) : null}

            <label className="history-select">
              <span className="history-facet-label">{STR.historySort}</span>
              <select
                value={filters.sort}
                aria-label={STR.historySort}
                onChange={(e) =>
                  setFilters({ ...filters, sort: e.target.value as SortKey })
                }
              >
                <option value="newest">{STR.historySortNewest}</option>
                <option value="oldest">{STR.historySortOldest}</option>
              </select>
            </label>
          </div>

          <div className="history-result-row">
            <span className="history-count">
              {STR.historyCount}:{' '}
              {active ? `${total} / ${totalUnfiltered}` : totalUnfiltered}
            </span>
            {active ? (
              <button
                type="button"
                className="btn btn-ghost btn-small"
                onClick={() => {
                  setQuery('');
                  setFilters(EMPTY_FILTERS);
                }}
              >
                {STR.historyClearFilters}
              </button>
            ) : null}
            <label className="history-text-toggle">
              <input
                type="checkbox"
                checked={!imageOnly}
                onChange={(e) => setImageOnly(!e.target.checked)}
              />
              <span>{STR.historyShowCardText}</span>
            </label>
          </div>
        </div>
      ) : null}

      {!items && !error ? <HistorySkeletonGrid /> : null}

      {items && !active && total === 0 ? <HistoryEmpty /> : null}

      {items && active && total === 0 ? (
        <p className="hint">
          {filters.query ? STR.historyNoResults : STR.historyFilterNoResults}
        </p>
      ) : null}

      {items && items.length > 0 ? (
        <div
          className="history-grid"
          // Dimmed rather than replaced while the next page loads: these are the cards the
          // officer was just looking at, and they are about to become real ones again.
          style={loading ? { opacity: 0.55 } : undefined}
          aria-busy={loading || undefined}
        >
          {items.map((item) => (
            <HistoryCard key={item.id} item={item} imageOnly={imageOnly} />
          ))}
        </div>
      ) : null}

      {pageCount > 1 ? (
        <Pagination page={safePage} pageCount={pageCount} onChange={setPage} />
      ) : null}
    </PageShell>
  );
}

// useSearchParams needs a suspense boundary in the app router.
export default function HistoryPage() {
  return (
    <Suspense fallback={<PageShell background="generations" />}>
      <HistoryPageBody />
    </Suspense>
  );
}
