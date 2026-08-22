// Pipe-table primitives, shared by the two renderers that must agree about what a table is.
//
// There are two of them for good reasons that are not going away: `ExtractedText` renders an
// uploaded document's extracted text (Sarvam HTML, or Markdown from the OpenAI/Gemini OCR
// lanes) and `MarkdownText` renders the model's own prose in a chat answer or an article. They
// differ in everything except this one question — "are these lines a table?" — and when that
// question was answered in only one of them, a chat answer holding a table printed as a wall of
// pipes while the same table in a document printed as a table.
//
// So the answer lives here once. Deliberately in `lib/` and dependency-free: both callers build
// React elements themselves, and neither may reach for a Markdown library (see the header of
// MarkdownText.tsx for why).

// A pipe-delimited row: `| a | b |`. Leading and trailing pipes are REQUIRED — a bare `a | b` is
// far more likely to be prose containing a pipe than a table row.
const TABLE_ROW = /^\s*\|.*\|\s*$/;
// A Markdown table's header separator: `| --- | :---: |`. Cells hold only -, : and space.
const TABLE_DIVIDER = /^\s*\|(\s*:?-{2,}:?\s*\|)+\s*$/;

export function isTableRow(line: string): boolean {
  return TABLE_ROW.test(line);
}

export function isTableDivider(line: string): boolean {
  return TABLE_DIVIDER.test(line);
}

/** `| a | b |` → ['a', 'b']. The outer pipes are structure, not content. */
export function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

export type TableRun = Readonly<{
  // null when the run carried no `| --- |` divider, which is what a headerless OCR table looks
  // like. Rendering then skips the <thead> rather than promoting a data row into one.
  header: string[] | null;
  rows: string[][];
  // How many columns to draw: the widest row wins, so a short row is padded rather than
  // silently dropping the cells of the rows beside it.
  columns: number;
  // Index of the first line AFTER the run.
  next: number;
}>;

/**
 * Reads the run of table rows starting at `start`, or null when there is no table there.
 *
 * A table needs at least TWO consecutive pipe rows: one prose line that happens to be wrapped
 * in pipes stays prose. A GFM table always has a divider, but a model — and an OCR read of a
 * printed table — routinely omits it, so a divider makes a header rather than making a table.
 */
export function readTableRun(
  lines: readonly string[],
  start: number,
): TableRun | null {
  let index = start;
  const rowLines: string[] = [];
  while (index < lines.length && TABLE_ROW.test(lines[index] ?? '')) {
    rowLines.push(lines[index] ?? '');
    index += 1;
  }
  if (rowLines.length < 2) return null;

  const hasHeader = TABLE_DIVIDER.test(rowLines[1] ?? '');
  const body = rowLines
    .filter((row) => !TABLE_DIVIDER.test(row))
    .map(splitTableRow);
  const header = hasHeader ? (body.shift() ?? null) : null;
  // A divider-only pair (`| a |` then `| --- |`) leaves no body rows at all; that is a header
  // with nothing under it, which is still a table and still worth showing.
  const columns = Math.max(
    header?.length ?? 0,
    ...body.map((row) => row.length),
    1,
  );
  return { header, rows: body, columns, next: index };
}
