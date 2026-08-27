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
import { errorMessage } from '../../lib/errorMessage';
import {
  HistoryCard,
  HistoryEmpty,
  HistorySkeletonGrid,
} from '../../components/HistoryCard';
import { ErrorNotice } from '../../components/ErrorNotice';
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
  const [error, setError] = useState<string | null>(null);
  // One clock for the whole view, taken when the list lands, so two date pills evaluated
  // milliseconds apart can never disagree about where "आज" starts.
  const [loadedAt, setLoadedAt] = useState<Date>(() => new Date());

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
  // longer exists. This is what the removed reset effect used to guarantee.
  const setFilters = useCallback(
    (next: Filters) => applyView(next, 1),
    [applyView],
  );

  const setPage = useCallback(
    (next: number) => applyView(filtersRef.current, next),
    [applyView],
  );

  // Extracted from the effect so the failure notice has something to call. The list is
  // the officer's way back to every finished run, so "it did not load" with no button
  // was a dead end that only a manual browser refresh got out of.
  const load = useCallback(async () => {
    setError(null);
    try {
      const rows = await listGenerations();
      setItems(rows);
      setLoadedAt(new Date());
    } catch (e) {
      setError(errorMessage(e, STR.genListLoadFailed));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Debounce the search into the URL so filtering/paging doesn't thrash on each
  // keystroke. The current filters are read through a ref so this effect depends only
  // on the typed string — re-arming the timer on every render would never let it fire.
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

  // A shrinking result set (a stale link, or a list that lost rows since it was paged)
  // must not leave the requested page out of range. Clamped for display rather than
  // rewritten, so an out-of-range URL costs no second navigation.
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(requestedPage, pageCount);
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

      {error ? (
        <ErrorNotice
          message={error}
          onRetry={() => void load()}
          fallback={STR.genListLoadFailed}
        />
      ) : null}

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

            <FacetSelect
              label={STR.historyFilterDate}
              options={dateOptions}
              selected={filters.date}
              onSelect={(date) => setFilters({ ...filters, date })}
            />

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
