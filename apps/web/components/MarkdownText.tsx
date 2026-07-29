'use client';

// A tiny, dependency-free Markdown renderer for the generated article.
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

import { Fragment, type ReactNode } from 'react';

const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET = /^\s*([-*+•])\s+(.*)$/;
const ORDERED = /^\s*(\d+)[.)]\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;

// **bold** | *italic* / _italic_ | `code` | [text](href)
const INLINE =
  /(\*\*[^*]+\*\*|\*[^*\n]+\*|_[^_\n]+_|`[^`\n]+`|\[[^\]\n]+\]\([^)\s]+\))/g;

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

    if (token.startsWith('**')) {
      out.push(<strong key={key}>{token.slice(2, -2)}</strong>);
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
function lines(block: string[], keyPrefix: string): ReactNode[] {
  return block.flatMap((line, index) =>
    index === 0
      ? inline(line, `${keyPrefix}-l${index}`)
      : [
          <br key={`${keyPrefix}-br${index}`} />,
          ...inline(line, `${keyPrefix}-l${index}`),
        ],
  );
}

export function MarkdownText({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const source = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let cursor = 0;
  let key = 0;

  while (cursor < source.length) {
    const line = source[cursor] ?? '';

    if (line.trim() === '') {
      cursor += 1;
      continue;
    }

    if (RULE.test(line)) {
      blocks.push(<hr key={`b${key++}`} />);
      cursor += 1;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      const level = Math.min(heading[1]!.length, 6);
      const Tag = `h${level}` as 'h1';
      blocks.push(
        <Tag key={`b${key++}`}>{inline(heading[2]!.trim(), `b${key}`)}</Tag>,
      );
      cursor += 1;
      continue;
    }

    // Lists: consume every consecutive item of the same kind.
    const listMatch = BULLET.exec(line) ?? ORDERED.exec(line);
    if (listMatch) {
      const ordered = ORDERED.test(line);
      const items: string[] = [];
      while (cursor < source.length) {
        const current = source[cursor] ?? '';
        const item = ordered ? ORDERED.exec(current) : BULLET.exec(current);
        if (!item) break;
        items.push(item[2]!);
        cursor += 1;
      }
      const listKey = `b${key++}`;
      const children = items.map((item, index) => (
        <li key={`${listKey}-${index}`}>
          {inline(item, `${listKey}-${index}`)}
        </li>
      ));
      blocks.push(
        ordered ? (
          <ol key={listKey}>{children}</ol>
        ) : (
          <ul key={listKey}>{children}</ul>
        ),
      );
      continue;
    }

    if (QUOTE.test(line)) {
      const quoted: string[] = [];
      while (cursor < source.length) {
        const item = QUOTE.exec(source[cursor] ?? '');
        if (!item) break;
        quoted.push(item[1]!);
        cursor += 1;
      }
      const quoteKey = `b${key++}`;
      blocks.push(
        <blockquote key={quoteKey}>
          <p>{lines(quoted, quoteKey)}</p>
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
        HEADING.test(current) ||
        BULLET.test(current) ||
        ORDERED.test(current) ||
        QUOTE.test(current) ||
        RULE.test(current)
      ) {
        break;
      }
      paragraph.push(current.trim());
      cursor += 1;
    }
    const paraKey = `b${key++}`;
    blocks.push(<p key={paraKey}>{lines(paragraph, paraKey)}</p>);
  }

  return (
    <div className={className ? `markdown-body ${className}` : 'markdown-body'}>
      {blocks}
    </div>
  );
}
