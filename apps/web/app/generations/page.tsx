'use client';

import { useEffect, useMemo, useState } from 'react';
import type { GenerationSummary } from '@dgipr/schemas';
import { listGenerations } from '../../lib/api';
import { STR } from '../../lib/strings';
import {
  HistoryCard,
  HistoryEmpty,
  HistorySkeletonGrid,
} from '../../components/HistoryCard';

const PAGE_SIZE = 9;

// Numbered-page control (Prev / 1 2 3 / Next). Client-side only; rendered when
// there is more than one page of results.
function Pagination({
  page,
  pageCount,
  onChange,
}: {
  page: number;
  pageCount: number;
  onChange: (next: number) => void;
}) {
  const pages = Array.from({ length: pageCount }, (_, i) => i + 1);
  return (
    <nav className="pagination" aria-label="pagination">
      <button
        type="button"
        className="pagination-btn"
        onClick={() => onChange(page - 1)}
        disabled={page <= 1}
      >
        ‹ {STR.paginationPrev}
      </button>
      {pages.map((p) => (
        <button
          key={p}
          type="button"
          className={`pagination-btn pagination-num${p === page ? ' is-active' : ''}`}
          onClick={() => onChange(p)}
          aria-current={p === page ? 'page' : undefined}
        >
          {p}
        </button>
      ))}
      <button
        type="button"
        className="pagination-btn"
        onClick={() => onChange(page + 1)}
        disabled={page >= pageCount}
      >
        {STR.paginationNext} ›
      </button>
    </nav>
  );
}

export default function HistoryPage() {
  const [items, setItems] = useState<GenerationSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    listGenerations()
      .then(setItems)
      .catch((e) => setError(e instanceof Error ? e.message : STR.genericError));
  }, []);

  // Debounce the applied query so filtering/paging doesn't thrash on each keystroke.
  useEffect(() => {
    const t = setTimeout(() => setAppliedQuery(query.trim().toLowerCase()), 200);
    return () => clearTimeout(t);
  }, [query]);

  // Case-insensitive match over headline + note excerpt (all Marathi/plain text).
  const filtered = useMemo(() => {
    if (!items) return [];
    if (!appliedQuery) return items;
    return items.filter((item) =>
      `${item.headline ?? ''} ${item.noteExcerpt}`
        .toLowerCase()
        .includes(appliedQuery),
    );
  }, [items, appliedQuery]);

  // A shrinking result set (new search) must not leave `page` out of range.
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  useEffect(() => {
    setPage(1);
  }, [appliedQuery]);
  const safePage = Math.min(page, pageCount);
  const visible = filtered.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE,
  );

  return (
    <main className="page">
      <h1 className="page-title">{STR.historyTitle}</h1>

      {error ? <p className="form-error">{error}</p> : null}

      {items && items.length > 0 ? (
        <div className="history-toolbar">
          <input
            type="text"
            className="history-search"
            value={query}
            placeholder={STR.historySearchPlaceholder}
            onChange={(e) => setQuery(e.target.value)}
          />
          <span className="history-count">
            {STR.historyCount}: {filtered.length}
          </span>
        </div>
      ) : null}

      {!items && !error ? <HistorySkeletonGrid /> : null}

      {items && items.length === 0 ? <HistoryEmpty /> : null}

      {items && items.length > 0 && filtered.length === 0 ? (
        <p className="hint">{STR.historyNoResults}</p>
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
