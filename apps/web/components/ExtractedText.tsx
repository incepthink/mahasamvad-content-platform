'use client';

// Renders extracted document content the way it was extracted. Sarvam's default PDF lane
// returns semantic HTML from Document AI Digitise; the OpenAI rollback and older in-flight
// jobs may still carry Markdown tables, so both formats remain supported.
//
// A government PDF's tables are the reason this exists. Shown as raw Markdown in a
// textarea, a five-column table of beneficiary figures is a wall of pipes an officer
// cannot check a single number against; shown as a table, a wrong figure is obvious. The
// text itself is NOT touched — this is a view over the same string that is stored, edited
// and sent to the model, so what the officer approves and what the pipeline receives can
// never differ.
//
// Deliberately no `dangerouslySetInnerHTML`: an uploaded document is untrusted input. The
// HTML is parsed and rebuilt as React elements through a small allow-list, with all event
// handlers, styles, links, scripts and embeds discarded. The Markdown fallback stays
// hand-rolled for the same reason.

import { createElement, Fragment, type ReactNode } from 'react';
import { isTableRow, readTableRun } from '../lib/markdownTable';

const HTML_CONTENT =
  /<\/?(?:html|body|article|section|div|span|p|h[1-6]|table|thead|tbody|tfoot|tr|th|td|ul|ol|li|blockquote|pre|code|strong|em|small|header|footer|figure|figcaption|br|hr)\b/i;
const ALLOWED_HTML = new Set([
  'article',
  'section',
  'div',
  'span',
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'table',
  'caption',
  'colgroup',
  'col',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
  'ul',
  'ol',
  'li',
  'blockquote',
  'pre',
  'code',
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'small',
  'header',
  'footer',
  'figure',
  'figcaption',
  'br',
  'hr',
]);
// Void elements take no children. React throws outright when one is created with a
// `children` prop at all — an empty array counts — and Sarvam's HTML is full of `<br>`.
const VOID_HTML = new Set(['br', 'hr', 'col']);
const DROP_HTML = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'svg',
  'math',
  'form',
  'input',
  'button',
  'textarea',
  'select',
  'option',
  'link',
  'meta',
]);

export function isExtractedHtml(text: string): boolean {
  return HTML_CONTENT.test(text);
}

function positiveSpan(value: string | null): number | undefined {
  if (value === null) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function renderHtmlNode(node: Node, key: string): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent;
  if (node.nodeType !== Node.ELEMENT_NODE) return null;

  const element = node as Element;
  const tag = element.tagName.toLowerCase();
  if (DROP_HTML.has(tag)) return null;
  if (tag === 'img') {
    const alt = element.getAttribute('alt')?.trim();
    return alt ? (
      <span className="extracted-image-description" key={key}>
        {alt}
      </span>
    ) : null;
  }

  const isVoid = VOID_HTML.has(tag);
  const children = isVoid
    ? null
    : [...element.childNodes].map((child, index) =>
        renderHtmlNode(child, `${key}:${index}`),
      );
  if (!ALLOWED_HTML.has(tag)) {
    return <Fragment key={key}>{children}</Fragment>;
  }

  const props: Record<string, unknown> = { key };
  const colSpan = positiveSpan(element.getAttribute('colspan'));
  const rowSpan = positiveSpan(element.getAttribute('rowspan'));
  if (colSpan !== undefined) props.colSpan = colSpan;
  if (rowSpan !== undefined) props.rowSpan = rowSpan;
  if (tag === 'th') {
    const scope = element.getAttribute('scope');
    if (scope === 'row' || scope === 'col') props.scope = scope;
  }
  // A void tag must be created with NO children argument, not with an empty one.
  return isVoid
    ? createElement(tag, props)
    : createElement(tag, props, children);
}

function ExtractedHtml({ html }: { html: string }) {
  const document = new DOMParser().parseFromString(html, 'text/html');
  return (
    <div className="extracted-text extracted-html">
      {[...document.body.childNodes].map((node, index) =>
        renderHtmlNode(node, String(index)),
      )}
    </div>
  );
}

// The pipe-table primitives live in lib/markdownTable.ts, shared with MarkdownText — a chat
// answer's table and a document's table must be recognised by exactly the same rules.

type Block =
  | { kind: 'text'; lines: string[] }
  | {
      kind: 'table';
      header: string[] | null;
      rows: string[][];
      columns: number;
    };

// Groups the text into runs of table rows and runs of everything else. A table needs at
// least two consecutive rows, so one prose line that happens to be wrapped in pipes stays
// prose.
export function parseExtractedText(text: string): Block[] {
  const blocks: Block[] = [];
  const lines = text.split('\n');
  let index = 0;

  const pushText = (line: string): void => {
    const previous = blocks[blocks.length - 1];
    if (previous?.kind === 'text') previous.lines.push(line);
    else blocks.push({ kind: 'text', lines: [line] });
  };

  while (index < lines.length) {
    const line = lines[index] ?? '';
    if (isTableRow(line)) {
      const run = readTableRun(lines, index);
      if (run) {
        blocks.push({
          kind: 'table',
          header: run.header,
          rows: run.rows,
          columns: run.columns,
        });
        index = run.next;
        continue;
      }
      // A lone pipe-wrapped line is not enough to be a table — keep it as ordinary text.
      pushText(line);
      index += 1;
      continue;
    }

    pushText(line);
    index += 1;
  }

  return blocks;
}

// True when the text holds at least one real table — the caller uses this to decide
// whether a rendered view is worth offering at all.
export function hasTable(text: string): boolean {
  if (isExtractedHtml(text)) return /<table\b/i.test(text);
  return parseExtractedText(text).some((block) => block.kind === 'table');
}

export function hasRichFormatting(text: string): boolean {
  return isExtractedHtml(text) || hasTable(text);
}

export function ExtractedText({ text }: { text: string }) {
  if (isExtractedHtml(text)) return <ExtractedHtml html={text} />;
  const blocks = parseExtractedText(text);
  return (
    <div className="extracted-text">
      {blocks.map((block, index) => {
        if (block.kind === 'table') {
          const columns = block.columns;
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
