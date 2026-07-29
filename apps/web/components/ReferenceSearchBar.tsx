'use client';

// The one search control over the master-template library, shared by /references and by
// the create form's संदर्भ टेम्पलेट picker — the same rule the upload flow follows, where
// one <DocumentIntake> makes the capability look identical on every surface.
//
// It holds no state of its own: both surfaces already own a query and a filter set (the
// admin page persists nothing, the picker resets its query when the fold closes), so a
// controlled input keeps "what is typed" and "what is shown" from ever disagreeing.

import { Search, X } from 'lucide-react';
import { useId } from 'react';
import {
  NO_FILTERS,
  filtersAreActive,
  type ReferenceFilters,
} from '../lib/referenceSearch';
import { STR } from '../lib/strings';

// The slot floor behind the "४+ मुद्दे" chip. A note with several points needs a master
// whose body actually has the rows to hold them — the one structural mismatch that
// silently produces a bad poster.
export const SLOT_FILTER_MIN = 4;

export function ReferenceSearchBar({
  query,
  onQueryChange,
  filters,
  onFiltersChange,
  resultCount,
  total,
  hint,
  autoFocus = false,
}: {
  query: string;
  onQueryChange: (next: string) => void;
  filters: ReferenceFilters;
  onFiltersChange: (next: ReferenceFilters) => void;
  resultCount: number;
  total: number;
  /** The picker keeps its own one-line hint above the gallery, so it opts out. */
  hint?: boolean;
  autoFocus?: boolean;
}) {
  const inputId = useId();
  const active = query.trim().length > 0 || filtersAreActive(filters);

  // Each chip is a toggle, and the two photo chips are mutually exclusive — pressing one
  // while the other is on swaps rather than combining into an empty set.
  const togglePhoto = (value: 'photo' | 'text') =>
    onFiltersChange({
      ...filters,
      photo: filters.photo === value ? 'any' : value,
    });

  return (
    <div className="ref-search">
      <div className="ref-search-field">
        <span className="ref-search-icon" aria-hidden="true">
          <Search size={18} strokeWidth={2} />
        </span>
        <input
          id={inputId}
          type="search"
          className="ref-search-input"
          value={query}
          autoFocus={autoFocus}
          aria-label={STR.refSearchLabel}
          placeholder={STR.refSearchPlaceholder}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && query) {
              event.stopPropagation();
              onQueryChange('');
            }
          }}
        />
        {query ? (
          <button
            type="button"
            className="ref-search-clear"
            aria-label={STR.refSearchClear}
            onClick={() => onQueryChange('')}
          >
            <X size={16} strokeWidth={2.25} aria-hidden="true" />
          </button>
        ) : null}
      </div>

      <div className="ref-search-row">
        <div className="ref-search-chips">
          <button
            type="button"
            className="ref-search-chip"
            aria-pressed={filters.photo === 'photo'}
            onClick={() => togglePhoto('photo')}
          >
            {STR.refFilterPhoto}
          </button>
          <button
            type="button"
            className="ref-search-chip"
            aria-pressed={filters.photo === 'text'}
            onClick={() => togglePhoto('text')}
          >
            {STR.refFilterTextOnly}
          </button>
          <button
            type="button"
            className="ref-search-chip"
            aria-pressed={filters.minSlots > 0}
            onClick={() =>
              onFiltersChange({
                ...filters,
                minSlots: filters.minSlots > 0 ? 0 : SLOT_FILTER_MIN,
              })
            }
          >
            {STR.refFilterSlots}
          </button>
          {active ? (
            <button
              type="button"
              className="ref-search-reset"
              onClick={() => {
                onQueryChange('');
                onFiltersChange(NO_FILTERS);
              }}
            >
              {STR.refFilterClearAll}
            </button>
          ) : null}
        </div>
        {active ? (
          <span className="ref-search-count" aria-live="polite">
            {total} {STR.refSearchCountOf} {resultCount}{' '}
            {STR.refSearchCountSuffix}
          </span>
        ) : null}
      </div>

      {hint ? (
        <p className="hint ref-search-hint">{STR.refSearchHint}</p>
      ) : null}
    </div>
  );
}

/**
 * A summary line with the matched words marked.
 *
 * The ranges are computed against this exact string by `searchReferences`, so they are
 * rendered by slicing rather than by searching the text again — re-searching in the view
 * is what puts a mark on the wrong word when a query word appears more than once.
 */
export function HighlightedText({
  text,
  highlights,
}: {
  text: string;
  highlights: readonly { start: number; end: number }[];
}) {
  if (highlights.length === 0) return <>{text}</>;

  const parts: React.ReactNode[] = [];
  let cursor = 0;
  highlights.forEach((range, index) => {
    if (range.start < cursor) return; // defensive: never render an overlap twice
    if (range.start > cursor) parts.push(text.slice(cursor, range.start));
    parts.push(
      <mark className="ref-search-mark" key={`${range.start}-${index}`}>
        {text.slice(range.start, range.end)}
      </mark>,
    );
    cursor = range.end;
  });
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts}</>;
}

/**
 * The trailing note for masters that carry no analysed subject line. They are listed
 * rather than hidden: an operator who cannot find a template they know exists must be
 * told it is undescribed, not left to conclude it was deleted.
 */
export function UnanalyzedNote({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <div className="ref-search-unanalyzed">
      <p className="ref-search-unanalyzed-title">
        {count} {STR.refSearchUnanalyzed}
      </p>
      <p className="hint">{STR.refSearchUnanalyzedHint}</p>
    </div>
  );
}
