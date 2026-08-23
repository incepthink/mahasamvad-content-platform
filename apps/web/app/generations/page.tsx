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
import type { GenerationSummary } from '@dgipr/schemas';
import { listGenerations } from '../../lib/api';
import {
  RUN_FORMAT_LABELS,
  STR,
  runFormatKey,
  type RunFormatKey,
} from '../../lib/strings';
import {
  HistoryCard,
  HistoryEmpty,
  HistorySkeletonGrid,
} from '../../components/HistoryCard';
import { Pagination } from '../../components/Pagination';

const PAGE_SIZE = 9;

// ---------------------------------------------------------------------------
// Filter model
//
// Every facet runs over the <=100 runs the list endpoint already returned, so filtering
// is free and instant and no API change was needed. The three facets answer the three
// questions an officer actually arrives with — what kind of thing was it, did it work,
// and how recent — and all of them live in the URL, because opening a run and pressing
// Back is a full remount in the app router: without that, every return trip would land
// on the unfiltered first page.
// ---------------------------------------------------------------------------

// queued + running are ONE bucket: "is it still working" is one question, and splitting
// it would put a pill on screen that is empty almost all of the time.
type StatusKey = 'working' | 'completed' | 'failed';

const STATUS_KEYS: readonly StatusKey[] = ['working', 'completed', 'failed'];

function statusKeyOf(item: GenerationSummary): StatusKey {
  if (item.status === 'completed') return 'completed';
  if (item.status === 'failed') return 'failed';
  return 'working';
}

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

// Day boundaries are the BROWSER's, deliberately: this is one officer narrowing a list
// in front of them, so "आज" has to mean their own today. (The analytics aggregation pins
// Asia/Kolkata for the opposite reason — it reports one number for everyone.)
function withinDateWindow(iso: string, key: DateKey, now: Date): boolean {
  const created = new Date(iso).getTime();
  if (Number.isNaN(created)) return false;
  if (key === 'today') {
    const midnight = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    ).getTime();
    return created >= midnight;
  }
  const days = key === 'week' ? 7 : 30;
  return created >= now.getTime() - days * 24 * 60 * 60 * 1000;
}

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

// `skip` is what makes a facet's pill counts honest: they are computed with every OTHER
// filter applied, so a count says what pressing that pill would give you rather than how
// many such runs exist overall.
function matches(
  item: GenerationSummary,
  f: Filters,
  now: Date,
  skip?: keyof Filters,
): boolean {
  if (skip !== 'query' && f.query) {
    // Case-insensitive match over headline + note excerpt (all Marathi/plain text).
    const haystack = `${item.headline ?? ''} ${item.noteExcerpt}`.toLowerCase();
    if (!haystack.includes(f.query)) return false;
  }
  if (
    skip !== 'format' &&
    f.format &&
    runFormatKey(item.category, item.outputType) !== f.format
  ) {
    return false;
  }
  if (skip !== 'status' && f.status && statusKeyOf(item) !== f.status) {
    return false;
  }
  if (
    skip !== 'date' &&
    f.date &&
    !withinDateWindow(item.createdAt, f.date, now)
  ) {
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------

type PillOption<T extends string> = {
  key: T;
  label: string;
  count: number;
};

function FacetRow<T extends string>({
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
    <div className="history-facet">
      <span className="history-facet-label">{label}</span>
      <div className="history-pills" role="group" aria-label={label}>
        <button
          type="button"
          className={`history-pill${selected === null ? ' active' : ''}`}
          aria-pressed={selected === null}
          onClick={() => onSelect(null)}
        >
          {STR.historyFilterAll}
        </button>
        {options.map((option) => (
          <button
            key={option.key}
            type="button"
            className={`history-pill${selected === option.key ? ' active' : ''}`}
            aria-pressed={selected === option.key}
            // A pill that would return nothing under the other filters is kept
            // visible but disabled: options appearing and vanishing under the
            // cursor are worse than a greyed one that explains itself.
            disabled={option.count === 0 && selected !== option.key}
            onClick={() =>
              onSelect(selected === option.key ? null : option.key)
            }
          >
            {option.label}
            <span className="history-pill-count">{option.count}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function HistoryPageBody() {
  const router = useRouter();
  const params = useSearchParams();

  const [items, setItems] = useState<GenerationSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // One clock for the whole view, taken when the list lands, so two date pills evaluated
  // milliseconds apart can never disagree about where "आज" starts.
  const [loadedAt, setLoadedAt] = useState<Date>(() => new Date());
  const [page, setPage] = useState(1);

  // Read the facets off the URL through primitives, so `filters` keeps a stable identity
  // across re-renders that changed nothing — the debounce and the page reset below both
  // depend on it not churning.
  const rawQuery = params.get('q') ?? '';
  const rawFormat = params.get('format');
  const rawStatus = params.get('status');
  const rawDate = params.get('date');
  const rawSort = params.get('sort');

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

  // The text box stays local state so typing is never a render behind the URL.
  const [query, setQuery] = useState(rawQuery);

  const setFilters = useCallback(
    (next: Filters) => {
      const search = new URLSearchParams();
      if (next.query) search.set('q', next.query);
      if (next.format) search.set('format', next.format);
      if (next.status) search.set('status', next.status);
      if (next.date) search.set('date', next.date);
      if (next.sort !== 'newest') search.set('sort', next.sort);
      const qs = search.toString();
      // replace, not push: narrowing one list is refining a single view, and it must not
      // take a press of Back per pill to leave the page (the /analytics range precedent).
      router.replace(qs ? `/generations?${qs}` : '/generations');
    },
    [router],
  );

  useEffect(() => {
    listGenerations()
      .then((rows) => {
        setItems(rows);
        setLoadedAt(new Date());
      })
      .catch((e) =>
        setError(e instanceof Error ? e.message : STR.genericError),
      );
  }, []);

  // Debounce the search into the URL so filtering/paging doesn't thrash on each
  // keystroke. The current filters are read through a ref so this effect depends only
  // on the typed string — re-arming the timer on every render would never let it fire.
  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  useEffect(() => {
    const normalized = query.trim().toLowerCase();
    if (normalized === filtersRef.current.query) return;
    const t = setTimeout(
      () => setFilters({ ...filtersRef.current, query: normalized }),
      200,
    );
    return () => clearTimeout(t);
  }, [query, setFilters]);

  const filtered = useMemo(() => {
    if (!items) return [];
    const kept = items.filter((item) => matches(item, filters, loadedAt));
    // The API already returns newest first; only the other direction needs work.
    return filters.sort === 'oldest' ? [...kept].reverse() : kept;
  }, [items, filters, loadedAt]);

  const formatOptions = useMemo<PillOption<RunFormatKey>[]>(() => {
    if (!items) return [];
    const present = new Set(
      items.map((item) => runFormatKey(item.category, item.outputType)),
    );
    return (
      (Object.keys(RUN_FORMAT_LABELS) as RunFormatKey[])
        // Only formats this deployment has actually produced — a pill for a lane nobody
        // here uses is a permanently empty control.
        .filter((key) => present.has(key))
        .map((key) => ({
          key,
          label: RUN_FORMAT_LABELS[key],
          count: items.filter(
            (item) =>
              matches(item, filters, loadedAt, 'format') &&
              runFormatKey(item.category, item.outputType) === key,
          ).length,
        }))
    );
  }, [items, filters, loadedAt]);

  const statusOptions = useMemo<PillOption<StatusKey>[]>(() => {
    if (!items) return [];
    const present = new Set(items.map(statusKeyOf));
    return STATUS_KEYS.filter((key) => present.has(key)).map((key) => ({
      key,
      label: STATUS_FILTER_LABELS[key],
      count: items.filter(
        (item) =>
          matches(item, filters, loadedAt, 'status') &&
          statusKeyOf(item) === key,
      ).length,
    }));
  }, [items, filters, loadedAt]);

  const dateOptions = useMemo<PillOption<DateKey>[]>(() => {
    if (!items) return [];
    return DATE_KEYS.map((key) => ({
      key,
      label: DATE_FILTER_LABELS[key],
      count: items.filter(
        (item) =>
          matches(item, filters, loadedAt, 'date') &&
          withinDateWindow(item.createdAt, key, loadedAt),
      ).length,
    }));
  }, [items, filters, loadedAt]);

  // A shrinking result set (a new filter) must not leave `page` out of range. Keyed on a
  // string rather than the object so a stray re-render can never reset the page.
  const filterKey = `${filters.query}|${filters.format}|${filters.status}|${filters.date}|${filters.sort}`;
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  useEffect(() => {
    setPage(1);
  }, [filterKey]);
  const safePage = Math.min(page, pageCount);
  const visible = filtered.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE,
  );

  const total = items?.length ?? 0;
  const active = isFiltered(filters);
  // A facet with one option only ever tells you what the cards already say.
  const showFormatFacet = formatOptions.length > 1;
  const showStatusFacet = statusOptions.length > 1;

  return (
    <main className="page">
      <header className="page-head">
        <div className="page-head-text">
          <h1 className="page-title">{STR.historyTitle}</h1>
          <p className="page-sub">{STR.historyIntro}</p>
        </div>
        <div className="page-head-actions">
          <Link href="/" className="btn btn-small">
            {STR.historyNew}
          </Link>
        </div>
      </header>

      {error ? <p className="form-error">{error}</p> : null}

      {items && items.length > 0 ? (
        <div className="history-filters">
          <div className="history-toolbar">
            <input
              type="text"
              className="history-search"
              value={query}
              placeholder={STR.historySearchPlaceholder}
              onChange={(e) => setQuery(e.target.value)}
            />
            <label className="history-sort">
              <span className="history-facet-label">{STR.historySort}</span>
              <select
                value={filters.sort}
                onChange={(e) =>
                  setFilters({ ...filters, sort: e.target.value as SortKey })
                }
              >
                <option value="newest">{STR.historySortNewest}</option>
                <option value="oldest">{STR.historySortOldest}</option>
              </select>
            </label>
          </div>

          {showFormatFacet ? (
            <FacetRow
              label={STR.historyFilterFormat}
              options={formatOptions}
              selected={filters.format}
              onSelect={(format) => setFilters({ ...filters, format })}
            />
          ) : null}

          {showStatusFacet ? (
            <FacetRow
              label={STR.historyFilterStatus}
              options={statusOptions}
              selected={filters.status}
              onSelect={(status) => setFilters({ ...filters, status })}
            />
          ) : null}

          <FacetRow
            label={STR.historyFilterDate}
            options={dateOptions}
            selected={filters.date}
            onSelect={(date) => setFilters({ ...filters, date })}
          />

          <div className="history-result-row">
            <span className="history-count">
              {STR.historyCount}:{' '}
              {active ? `${filtered.length} / ${total}` : total}
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
          </div>
        </div>
      ) : null}

      {!items && !error ? <HistorySkeletonGrid /> : null}

      {items && items.length === 0 ? <HistoryEmpty /> : null}

      {items && items.length > 0 && filtered.length === 0 ? (
        <p className="hint">
          {filters.query ? STR.historyNoResults : STR.historyFilterNoResults}
        </p>
      ) : null}

      {visible.length > 0 ? (
        <div className="history-grid">
          {visible.map((item) => (
            <HistoryCard key={item.id} item={item} />
          ))}
        </div>
      ) : null}

      {pageCount > 1 ? (
        <Pagination page={safePage} pageCount={pageCount} onChange={setPage} />
      ) : null}
    </main>
  );
}

// useSearchParams needs a suspense boundary in the app router.
export default function HistoryPage() {
  return (
    <Suspense fallback={<main className="page" />}>
      <HistoryPageBody />
    </Suspense>
  );
}
