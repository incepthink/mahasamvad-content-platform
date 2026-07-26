'use client';

import { STR } from '../lib/strings';

type PageItem = number | `gap-${number}`;

function pageWindow(page: number, pageCount: number): PageItem[] {
  const visible = new Set([1, pageCount]);
  for (
    let candidate = Math.max(1, page - 2);
    candidate <= Math.min(pageCount, page + 2);
    candidate += 1
  ) {
    visible.add(candidate);
  }

  const pages = [...visible].sort((a, b) => a - b);
  const items: PageItem[] = [];
  pages.forEach((candidate, index) => {
    const previous = pages[index - 1];
    if (previous !== undefined && candidate - previous > 1) {
      items.push(`gap-${previous}`);
    }
    items.push(candidate);
  });
  return items;
}

export function Pagination({
  page,
  pageCount,
  onChange,
}: {
  page: number;
  pageCount: number;
  onChange: (next: number) => void;
}) {
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
      {pageWindow(page, pageCount).map((item) =>
        typeof item === 'number' ? (
          <button
            key={item}
            type="button"
            className={`pagination-btn pagination-num${item === page ? ' is-active' : ''}`}
            onClick={() => onChange(item)}
            aria-current={item === page ? 'page' : undefined}
          >
            {item}
          </button>
        ) : (
          <span key={item} className="pagination-gap" aria-hidden="true">
            …
          </span>
        ),
      )}
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
