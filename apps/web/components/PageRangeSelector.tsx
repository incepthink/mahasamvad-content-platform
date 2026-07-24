'use client';

// The page picker, as a range field first and a grid second. A checkbox-per-row list
// (the old shape) is fine for three pages and unusable for fifty — a scanned booklet is
// exactly the case that has to work — so the primary control is a text range ("1-5, 8,
// 10-12", Marathi digits accepted) and the full grid of numbered chips is one tap away.
//
// Like <DocumentPages>, it holds no selection of its own: it asks a predicate and reports
// events, so it fits either selection model in the product (the pages a surface WANTS, or
// the keys it EXCLUDED — see lib/documentSelection.ts). The range field is reconciled by
// TOGGLING only the pages that differ, which is what keeps it model-agnostic: every
// parent's onToggle is a functional update, so a diff of taps composes correctly whichever
// way the parent stores the set.

import { useEffect, useRef, useState } from 'react';
import { formatPageRanges, parsePageRanges } from '../lib/documentSelection';
import { STR } from '../lib/strings';

function marathiNumber(value: number): string {
  return value.toLocaleString('mr-IN');
}

export function PageRangeSelector({
  listed,
  isSelected,
  onToggle,
  onSetAll,
  busy = false,
  showSelectAll = true,
  defaultExpanded,
}: {
  listed: readonly number[];
  isSelected: (page: number) => boolean;
  onToggle: (page: number) => void;
  onSetAll: (pages: number[], include: boolean) => void;
  busy?: boolean | undefined;
  // /dlo turns this off: its card header checkbox is already the file's select-all, and a
  // second one on the same card reads as a bug. The range field and grid stay.
  showSelectAll?: boolean | undefined;
  // Small documents open on the grid (nicer to tap than to type); large ones start folded
  // with the range field primary. Callers can force either.
  defaultExpanded?: boolean | undefined;
}) {
  const selectedListed = listed.filter(isSelected);
  const canonical = formatPageRanges(selectedListed);

  const [expanded, setExpanded] = useState(
    defaultExpanded ?? listed.length <= 12,
  );
  const [rangeText, setRangeText] = useState(canonical);
  // True while the field has focus, so selection changes made elsewhere (a grid tap,
  // select-all, a parent reset) refresh the text without fighting the typist.
  const editing = useRef(false);

  useEffect(() => {
    if (!editing.current) setRangeText(canonical);
  }, [canonical]);

  if (listed.length === 0) return null;

  // Parse the typed range and toggle only the pages whose desired state differs from the
  // current one. See the header for why this is a diff of toggles, not a set.
  const applyRange = () => {
    const target = new Set(parsePageRanges(rangeText, listed));
    for (const page of listed) {
      if (target.has(page) !== isSelected(page)) onToggle(page);
    }
    setRangeText(formatPageRanges([...target].sort((a, b) => a - b)));
    editing.current = false;
  };

  return (
    <div className="page-range">
      <label className="field-label" htmlFor="page-range-input">
        {STR.docRangeLabel}
      </label>
      <p className="hint">{STR.docRangeHint}</p>
      <div className="page-range-row">
        <input
          id="page-range-input"
          type="text"
          className="page-range-input"
          placeholder={STR.docRangePlaceholder}
          value={rangeText}
          disabled={busy}
          onFocus={() => {
            editing.current = true;
          }}
          onChange={(event) => setRangeText(event.target.value)}
          onBlur={applyRange}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              applyRange();
            }
          }}
        />
        <button
          type="button"
          className="btn btn-small"
          disabled={busy}
          onClick={applyRange}
        >
          {STR.docRangeApply}
        </button>
      </div>

      <div className="btn-row" style={{ marginTop: 10 }}>
        {showSelectAll ? (
          <>
            <button
              type="button"
              className="btn btn-small"
              disabled={busy}
              onClick={() => onSetAll([...listed], true)}
            >
              {STR.docSelectAll}
            </button>
            <button
              type="button"
              className="btn btn-small"
              disabled={busy}
              onClick={() => onSetAll([...listed], false)}
            >
              {STR.docClearAll}
            </button>
          </>
        ) : null}
        <button
          type="button"
          className="btn btn-small page-range-expand"
          aria-expanded={expanded}
          onClick={() => setExpanded((prev) => !prev)}
        >
          {expanded ? STR.docRangeCollapse : STR.docRangeExpand}
          <span
            className={`page-range-caret ${expanded ? 'open' : ''}`}
            aria-hidden="true"
          >
            ▾
          </span>
        </button>
      </div>

      <div className={`page-grid-wrap ${expanded ? 'open' : ''}`}>
        {/* Keyed on `expanded` so the chips remount and replay their staggered fade each
            time the grid opens, rather than only on first mount. */}
        <div className="page-grid" key={expanded ? 'open' : 'closed'}>
          {listed.map((page, index) => (
            <button
              key={page}
              type="button"
              className="page-chip"
              aria-pressed={isSelected(page)}
              disabled={busy}
              style={{ animationDelay: `${Math.min(index, 24) * 12}ms` }}
              onClick={() => onToggle(page)}
            >
              {marathiNumber(page)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
