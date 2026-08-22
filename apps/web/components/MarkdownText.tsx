'use client';

// A tiny, dependency-free Markdown renderer for generated text — the article on a
// generation's detail page, /dlo's output step, and every assistant answer in /chat.
//
// The generator emits ordinary Marathi prose with light Markdown structure —
// `# शीर्षक`, `## उपशीर्षक`, bullet lists, `**ठळक**` — which the detail page used to
// print literally, so an officer saw `# भूसंपादन…` and `##` markers in the finished
// article. This turns that structure into real elements.
//
// Deliberately NOT react-markdown: `apps/web` carries three runtime dependencies, the
// input is our own generator's output (never third-party HTML), and rendering is done
// with React elements — no `dangerouslySetInnerHTML`, so no sanitiser is needed.
//
// It renders for DISPLAY only. Copy, .txt/.md download and the PDF export all keep
// reading the raw string, so nothing the officer circulates changes.
//
// WHAT IT MUST COVER, and why the list grew. It was written for the article, whose shape is
// headings and paragraphs, and /chat then pointed it at a general assistant that answers with
// whatever Markdown fits the question. Everything it did not know printed as literal source —
// a storyboard table came out as a screenful of `|` characters (the reported bug), a code
// fence printed its own backticks, a nested list flattened, and a numbered list with blank
// lines between its items restarted at 1 on every item. Those four are handled here now;
// tables share their parser with ExtractedText (lib/markdownTable.ts) so a table in a chat
// answer and a table in an uploaded document are recognised by one set of rules.

import { Fragment, type ReactNode } from 'react';
import { precomposeCandraVowels } from '../lib/devanagari';
import { readTableRun, type TableRun } from '../lib/markdownTable';

// `(.*?)\s*#*\s*$` also drops an ATX closing sequence (`## शीर्षक ##`).
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
// Indent is CAPTURED, not skipped: it is the only thing that distinguishes a nested list
// item from a sibling.
const BULLET = /^([ \t]*)([-*+•])\s+(.*)$/;
const ORDERED = /^([ \t]*)(\d{1,9})[.)]\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
// An opening code fence, with its optional info string (```ts). Closed by a line of the same
// character, at least as long — the language tag is display-only and is not used.
const FENCE = /^[ \t]*(`{3,}|~{3,})\s*\S*\s*$/;

// **bold** | __bold__ | ~~struck~~ | *italic* / _italic_ | `code` | [text](href)
//
// Ordered longest-marker-first so `**` is never read as two `*`. The scan runs left to right,
// so whichever span STARTS first wins — which is what keeps a URL inside backticks out of the
// link branch.
const INLINE =
  /(\*\*[^*]+\*\*|__[^_]+__|~~[^~\n]+~~|\*[^*\n]+\*|_[^_\n]+_|`[^`\n]+`|\[[^\]\n]+\]\([^)\s]+\))/g;

/** Inline spans inside one line of text. Unmatched text passes through verbatim. */
function inline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  INLINE.lastIndex = 0;
  let i = 0;

  while ((match = INLINE.exec(text)) !== null) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const token = match[0];
    const key = `${keyPrefix}-i${i++}`;

    if (token.startsWith('**') || token.startsWith('__')) {
      out.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('~~')) {
      out.push(<del key={key}>{token.slice(2, -2)}</del>);
    } else if (token.startsWith('`')) {
      out.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith('[')) {
      const split = token.indexOf('](');
      const label = token.slice(1, split);
      const href = token.slice(split + 2, -1);
      // Only http(s) — a generated article has no business emitting javascript: URLs,
      // and this is the one place a link could carry one.
      out.push(
        /^https?:\/\//i.test(href) ? (
          <a key={key} href={href} target="_blank" rel="noreferrer">
            {label}
          </a>
        ) : (
          <Fragment key={key}>{label}</Fragment>
        ),
      );
    } else {
      out.push(<em key={key}>{token.slice(1, -1)}</em>);
    }
    last = match.index + token.length;
  }

  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** One block's worth of lines, with single newlines kept as soft breaks. */
function lines(block: readonly string[], keyPrefix: string): ReactNode[] {
  return block.flatMap((line, index) =>
    index === 0
      ? inline(line, `${keyPrefix}-l${index}`)
      : [
          <br key={`${keyPrefix}-br${index}`} />,
          ...inline(line, `${keyPrefix}-l${index}`),
        ],
  );
}

// ---------- lists ----------

// A tab is worth four columns here. Indent decides nesting, so the two ways of writing it
// have to be measured on the same scale or a tab-indented sub-list reads as a sibling.
function indentOf(line: string): number {
  return (/^[ \t]*/.exec(line)?.[0] ?? '').replace(/\t/g, '    ').length;
}

type ListMarker = Readonly<{
  indent: number;
  ordered: boolean;
  start: number;
  text: string;
}>;

function listMarker(line: string): ListMarker | null {
  const ordered = ORDERED.exec(line);
  if (ordered) {
    return {
      indent: indentOf(line),
      ordered: true,
      start: Number.parseInt(ordered[2] ?? '1', 10),
      text: ordered[3] ?? '',
    };
  }
  const bullet = BULLET.exec(line);
  if (bullet) {
    return {
      indent: indentOf(line),
      ordered: false,
      start: 1,
      text: bullet[3] ?? '',
    };
  }
  return null;
}

type ListItem = { lines: string[]; children: ListNode[] };
type ListNode = Readonly<{
  ordered: boolean;
  start: number;
  items: ListItem[];
}>;

// Consumes one list, nested sub-lists included, and reports where it ended.
//
// Two behaviours worth keeping. A BLANK LINE no longer ends the list when a further item
// follows it (a "loose" list): breaking there restarted `<ol>` numbering at 1 on every item,
// which is how a five-step answer came out as five step ones. And an item's indent is
// compared against the list's own base rather than against a fixed column, so a sub-list
// indented by two spaces, four spaces or a tab all nest the same way.
function readList(
  source: readonly string[],
  start: number,
  baseIndent: number,
): { node: ListNode; next: number } {
  const first = listMarker(source[start] ?? '');
  const items: ListItem[] = [];
  const node: ListNode = {
    ordered: first?.ordered ?? false,
    start: first?.start ?? 1,
    items,
  };
  let cursor = start;

  while (cursor < source.length) {
    const line = source[cursor] ?? '';

    if (line.trim() === '') {
      // Look past the blank run: another item (or an indented continuation) keeps the list
      // open, anything else ends it.
      let ahead = cursor;
      while (ahead < source.length && (source[ahead] ?? '').trim() === '') {
        ahead += 1;
      }
      if (ahead >= source.length) break;
      const next = source[ahead] ?? '';
      const marker = listMarker(next);
      if (
        (marker && marker.indent >= baseIndent) ||
        indentOf(next) >= baseIndent + 2
      ) {
        cursor = ahead;
        continue;
      }
      break;
    }

    const marker = listMarker(line);
    if (marker) {
      // Outdented past this list's own marker column: the item belongs to a parent list.
      if (marker.indent < baseIndent) break;
      if (marker.indent >= baseIndent + 2) {
        const last = items[items.length - 1];
        if (!last) break;
        const sub = readList(source, cursor, marker.indent);
        last.children.push(sub.node);
        cursor = sub.next;
        continue;
      }
      // `1.` under `-` is a different list, not a sibling.
      if (marker.ordered !== node.ordered) break;
      items.push({ lines: [marker.text], children: [] });
      cursor += 1;
      continue;
    }

    // A plain indented line continues the item above it. An unindented one ends the list —
    // deliberately stricter than CommonMark's lazy continuation, which would swallow the
    // paragraph that follows a list.
    const last = items[items.length - 1];
    if (
      last &&
      last.children.length === 0 &&
      indentOf(line) >= baseIndent + 2
    ) {
      last.lines.push(line.trim());
      cursor += 1;
      continue;
    }
    break;
  }

  return { node, next: cursor };
}

function renderList(node: ListNode, key: string): ReactNode {
  const children = node.items.map((item, index) => (
    <li key={`${key}-${index}`}>
      {lines(item.lines, `${key}-${index}`)}
      {item.children.map((child, childIndex) =>
        renderList(child, `${key}-${index}-${childIndex}`),
      )}
    </li>
  ));
  return node.ordered ? (
    // `start` only when it is not 1: an answer that continues "6." after a paragraph should
    // keep counting, and the browser would otherwise renumber it from the top.
    <ol key={key} {...(node.start !== 1 ? { start: node.start } : {})}>
      {children}
    </ol>
  ) : (
    <ul key={key}>{children}</ul>
  );
}

// ---------- tables ----------

// A wide table scrolls INSIDE its own box; the card it sits in must never scroll sideways.
function renderTable(run: TableRun, key: string): ReactNode {
  const columns = Array.from({ length: run.columns }, (_, index) => index);
  return (
    <div className="markdown-table-wrap" key={key}>
      <table className="markdown-table">
        {run.header ? (
          <thead>
            <tr>
              {columns.map((cell) => (
                <th key={cell} scope="col">
                  {inline(run.header?.[cell] ?? '', `${key}-h${cell}`)}
                </th>
              ))}
            </tr>
          </thead>
        ) : null}
        <tbody>
          {run.rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {columns.map((cell) => (
                <td key={cell}>
                  {inline(row[cell] ?? '', `${key}-r${rowIndex}c${cell}`)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------- blocks ----------

// A closing fence: the same character as the opener, at least as long, and nothing else.
function closesFence(line: string, marker: string, length: number): boolean {
  const trimmed = line.trim();
  return (
    trimmed.length >= length && [...trimmed].every((char) => char === marker)
  );
}

function parseBlocks(
  source: readonly string[],
  keyPrefix: string,
): ReactNode[] {
  const blocks: ReactNode[] = [];
  let cursor = 0;
  let key = 0;
  const nextKey = (): string => `${keyPrefix}b${key++}`;

  while (cursor < source.length) {
    const line = source[cursor] ?? '';

    if (line.trim() === '') {
      cursor += 1;
      continue;
    }

    // Fenced code FIRST: everything inside it is literal, so no other rule may look at it.
    // Without this a fenced block printed its own backticks and a `#` inside it became a
    // heading.
    const fence = FENCE.exec(line);
    if (fence) {
      const opener = fence[1] ?? '';
      const marker = opener[0] ?? '`';
      const body: string[] = [];
      cursor += 1;
      while (
        cursor < source.length &&
        !closesFence(source[cursor] ?? '', marker, opener.length)
      ) {
        body.push(source[cursor] ?? '');
        cursor += 1;
      }
      // An unterminated fence (an answer still being streamed) simply runs to the end.
      if (cursor < source.length) cursor += 1;
      blocks.push(
        <pre key={nextKey()}>
          <code>{body.join('\n')}</code>
        </pre>,
      );
      continue;
    }

    if (RULE.test(line)) {
      blocks.push(<hr key={nextKey()} />);
      cursor += 1;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      const level = Math.min(heading[1]?.length ?? 1, 6);
      const Tag = `h${level}` as 'h1';
      const headingKey = nextKey();
      blocks.push(
        <Tag key={headingKey}>{inline(heading[2] ?? '', headingKey)}</Tag>,
      );
      cursor += 1;
      continue;
    }

    const table = readTableRun(source, cursor);
    if (table) {
      blocks.push(renderTable(table, nextKey()));
      cursor = table.next;
      continue;
    }

    const marker = listMarker(line);
    if (marker) {
      const list = readList(source, cursor, marker.indent);
      blocks.push(renderList(list.node, nextKey()));
      cursor = list.next;
      continue;
    }

    if (QUOTE.test(line)) {
      const quoted: string[] = [];
      while (cursor < source.length) {
        const item = QUOTE.exec(source[cursor] ?? '');
        if (!item) break;
        quoted.push(item[1] ?? '');
        cursor += 1;
      }
      const quoteKey = nextKey();
      // Parsed recursively, so a quoted list or table renders as one.
      blocks.push(
        <blockquote key={quoteKey}>
          {parseBlocks(quoted, `${quoteKey}q`)}
        </blockquote>,
      );
      continue;
    }

    // Paragraph: everything up to the next blank line or block-level marker.
    const paragraph: string[] = [];
    while (cursor < source.length) {
      const current = source[cursor] ?? '';
      if (
        current.trim() === '' ||
        FENCE.test(current) ||
        RULE.test(current) ||
        HEADING.test(current) ||
        listMarker(current) !== null ||
        QUOTE.test(current) ||
        // Only a REAL table ends the paragraph — one prose line wrapped in pipes must not
        // split a paragraph in two.
        readTableRun(source, cursor) !== null
      ) {
        break;
      }
      paragraph.push(current.trim());
      cursor += 1;
    }
    // Defensive: a line that matched nothing above and is still rejected here would spin.
    if (paragraph.length === 0) {
      cursor += 1;
      continue;
    }
    const paraKey = nextKey();
    blocks.push(<p key={paraKey}>{lines(paragraph, paraKey)}</p>);
  }

  return blocks;
}

export function MarkdownText({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  // Mukta cannot anchor a candra sign to अ, so अॅ/अॉ become the precomposed ऍ/ऑ here —
  // display only, exactly like the Markdown structure above. See lib/devanagari.ts.
  const source = precomposeCandraVowels(text)
    .replace(/\r\n?/g, '\n')
    .split('\n');

  return (
    <div className={className ? `markdown-body ${className}` : 'markdown-body'}>
      {parseBlocks(source, '')}
    </div>
  );
}
