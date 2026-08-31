'use client';

import React from 'react';

const MIN_COLUMN_WIDTH = 280;
const MAX_COLUMNS = 5;
const GAP = 18;

/**
 * The media room's gallery layout.
 *
 * Deliberately NOT CSS `columns`, and not a uniform grid.
 *
 *   - A uniform grid is what it replaces: the four output types deliver three
 *     different aspect ratios (4:5 / 16:9 / 3:2), so one fixed cell shape has to
 *     crop, and it was slicing the top off every portrait poster.
 *   - CSS `columns` fills column 1 to the bottom BEFORE starting column 2, so on
 *     a newest-first list the five most recent runs stack down the left edge and
 *     the right of the screen holds last week's work. Wrong for a page whose
 *     whole point is the thing you just generated.
 *
 * So the items are packed here, in order, each one into whichever column is
 * currently SHORTEST. That reads left-to-right for the newest rows (the columns
 * start level, so the first N items land side by side) while still coming out
 * balanced further down.
 *
 * Heights are ESTIMATED, never measured: measuring would mean a render, a layout
 * read and a second render on every poll tick — and the poll runs every 2.5s
 * while anything is generating. `estimateHeight` works in units of column
 * widths, which is why the packer never needs to know the pixel width at all.
 */
export function MasonryGrid<T>({
  items,
  keyOf,
  estimateHeight,
  children,
}: {
  items: readonly T[];
  keyOf: (item: T) => string;
  /**
   * Relative height of an item, in multiples of the column width. Only the
   * ratio between items matters, so `1 / aspect + textAllowance` is the shape of
   * a correct answer.
   */
  estimateHeight: (item: T) => number;
  children: (item: T) => React.ReactNode;
}) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const [columnCount, setColumnCount] = React.useState(1);

  // The column count comes from the container's own width rather than a media
  // query, so the grid is correct inside the sidebar layout at any breakpoint.
  React.useEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    const measure = (width: number) => {
      if (width <= 0) return;
      const fits = Math.floor((width + GAP) / (MIN_COLUMN_WIDTH + GAP));
      setColumnCount(Math.min(MAX_COLUMNS, Math.max(1, fits)));
    };

    measure(node.getBoundingClientRect().width);

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) measure(entry.contentRect.width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const columns = React.useMemo(() => {
    const buckets: T[][] = Array.from({ length: columnCount }, () => []);
    const heights = new Array<number>(columnCount).fill(0);

    for (const item of items) {
      // Ties go to the LEFTMOST column (`<`, not `<=`), which is what makes the
      // first row of a fresh list read in order rather than scattering.
      let target = 0;
      for (let i = 1; i < columnCount; i += 1) {
        if (heights[i]! < heights[target]!) target = i;
      }
      buckets[target]!.push(item);
      heights[target] = heights[target]! + estimateHeight(item);
    }

    return buckets;
  }, [items, columnCount, estimateHeight]);

  return (
    <div
      ref={containerRef}
      className="flex items-start"
      style={{ gap: GAP }}
      role="list"
    >
      {columns.map((column, index) => (
        <div
          key={index}
          className="flex min-w-0 flex-1 flex-col"
          style={{ gap: GAP }}
        >
          {column.map((item) => (
            <div key={keyOf(item)} role="listitem" className="min-w-0">
              {children(item)}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
