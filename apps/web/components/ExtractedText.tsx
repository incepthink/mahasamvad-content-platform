'use client';

// Renders extracted document text the way it was extracted — which, since every PDF now
// goes through Sarvam's Markdown output (PDF_EXTRACTION_MODE=ocr, pdf-pages.ts), means
// TABLES.
//
// A government PDF's tables are the reason this exists. Shown as raw Markdown in a
// textarea, a five-column table of beneficiary figures is a wall of pipes an officer
// cannot check a single number against; shown as a table, a wrong figure is obvious. The
// text itself is NOT touched — this is a view over the same string that is stored, edited
// and sent to the model, so what the officer approves and what the pipeline receives can
// never differ.
//
// Deliberately hand-rolled rather than a Markdown library: the input is one generator's
// output in one dialect, the only construct that must render is the table, and a full
// Markdown renderer would also interpret Devanagari punctuation and stray underscores in
// OCR text as emphasis — silently changing how the officer reads their own document.

import { Fragment } from 'react';

// A pipe-delimited row: `| a | b |`. Leading/trailing pipes are required — a bare `a | b`
// is far more likely to be prose containing a pipe than a table row.
const TABLE_ROW = /^\s*\|.*\|\s*$/;
// A Markdown table's header separator: `| --- | :---: |`. Cells hold only -, : and space.
const TABLE_DIVIDER = /^\s*\|(\s*:?-{2,}:?\s*\|)+\s*$/;

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

type Block =
  | { kind: 'text'; lines: string[] }
  | { kind: 'table'; header: string[] | null; rows: string[][] };

// Groups the text into runs of table rows and runs of everything else. A table needs at
// least two consecutive rows, so one prose line that happens to be wrapped in pipes stays
// prose.
export function parseExtractedText(text: string): Block[] {
  const blocks: Block[] = [];
  const lines = text.split('\n');
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? '';
    if (TABLE_ROW.test(line)) {
      const rowLines: string[] = [];
      while (index < lines.length && TABLE_ROW.test(lines[index] ?? '')) {
        rowLines.push(lines[index] ?? '');
        index += 1;
      }
      if (rowLines.length >= 2) {
        // A divider on the second line makes the first line a header row; without one
        // every row is a body row, which is what a headerless OCR table looks like.
        const hasHeader = TABLE_DIVIDER.test(rowLines[1] ?? '');
        const body = rowLines
          .filter((row) => !TABLE_DIVIDER.test(row))
          .map(splitRow);
        const header = hasHeader ? (body.shift() ?? null) : null;
        blocks.push({ kind: 'table', header, rows: body });
        continue;
      }
      // Not enough rows to be a table — keep the lines as ordinary text.
      const previous = blocks[blocks.length - 1];
      if (previous?.kind === 'text') previous.lines.push(...rowLines);
      else blocks.push({ kind: 'text', lines: rowLines });
      continue;
    }

    const previous = blocks[blocks.length - 1];
    if (previous?.kind === 'text') previous.lines.push(line);
    else blocks.push({ kind: 'text', lines: [line] });
    index += 1;
  }

  return blocks;
}

// True when the text holds at least one real table — the caller uses this to decide
// whether a rendered view is worth offering at all.
export function hasTable(text: string): boolean {
  return parseExtractedText(text).some((block) => block.kind === 'table');
}

export function ExtractedText({ text }: { text: string }) {
  const blocks = parseExtractedText(text);
  return (
    <div className="extracted-text">
      {blocks.map((block, index) => {
        if (block.kind === 'table') {
          const columns = Math.max(
            block.header?.length ?? 0,
            ...block.rows.map((row) => row.length),
            1,
          );
          return (
            // Blocks are positional and the text is re-parsed on every edit, so the index
            // IS the identity here; there is nothing stabler to key on.
            <div className="extracted-table-wrap" key={index}>
              <table className="extracted-table">
                {block.header ? (
                  <thead>
                    <tr>
                      {Array.from({ length: columns }, (_, cell) => (
                        <th key={cell}>{block.header?.[cell] ?? ''}</th>
                      ))}
                    </tr>
                  </thead>
                ) : null}
                <tbody>
                  {block.rows.map((row, rowIndex) => (
                    <tr key={rowIndex}>
                      {Array.from({ length: columns }, (_, cell) => (
                        <td key={cell}>{row[cell] ?? ''}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        const body = block.lines.join('\n').trim();
        if (body.length === 0) return null;
        return (
          <p className="extracted-para" key={index}>
            {body.split('\n').map((line, lineIndex) => (
              <Fragment key={lineIndex}>
                {lineIndex > 0 ? <br /> : null}
                {line}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}
