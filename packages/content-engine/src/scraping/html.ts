// Safe HTML -> text / paragraph extraction shared by the scraper and the chunker.
//
// jsdom's CSS parser can THROW while merely parsing certain inline `style` attributes — a
// `<p style="background:…">` with a shorthand it mishandles raises
// "Cannot read properties of undefined (reading 'length')" from shorthand-properties.js.
// Across ~25k real posts some will trip this, and an uncaught throw kills a whole ingest
// run on one bad post. We only ever read TEXT from this HTML, so styles are irrelevant:
//   (a) strip `style` attributes before parsing — removes the trigger entirely, and
//   (b) wrap parsing in try/catch with a regex fallback as a final safety net.

import { JSDOM } from 'jsdom';

// Remove inline style="…" / style='…' attributes only. Narrow on purpose: it drops the one
// attribute jsdom chokes on without disturbing the element structure we still parse.
function stripStyleAttributes(html: string): string {
  return html
    .replace(/\sstyle\s*=\s*"[^"]*"/gi, '')
    .replace(/\sstyle\s*=\s*'[^']*'/gi, '');
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, ' ');
}

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

// Plain text of an HTML fragment, whitespace-collapsed and entity-decoded. Never throws.
export function htmlToPlainText(html: string): string {
  if (!html) return '';
  try {
    const { document } = new JSDOM(`<body>${stripStyleAttributes(html)}</body>`).window;
    return collapse(document.body.textContent ?? '');
  } catch {
    // Last resort if jsdom still throws: crude tag strip (entities may survive, but a
    // rare degraded post beats aborting the whole run).
    return collapse(stripTags(html));
  }
}

// Paragraph texts with <p> boundaries preserved (empty paragraphs dropped). Never throws.
export function htmlToParagraphs(html: string): string[] {
  if (!html) return [];
  try {
    const { document } = new JSDOM(`<body>${stripStyleAttributes(html)}</body>`).window;
    return Array.from(document.querySelectorAll('p'))
      .map((p) => collapse(p.textContent ?? ''))
      .filter((text) => text.length > 0);
  } catch {
    // Fallback: split on paragraph boundaries, strip remaining tags.
    return html
      .split(/<\/p>/i)
      .map((segment) => collapse(stripTags(segment)))
      .filter((text) => text.length > 0);
  }
}
