// What a document's extracted page text IS, and how to get readable prose back out of it.
//
// A page read by Sarvam Document AI comes back as semantic HTML (`output_format=html`, see
// the 2026-08-22 milestone in AGENTS.md), not as plain text. That is right for the REVIEW
// surfaces — <ExtractedText> parses it and rebuilds it as React elements, so an OCR'd table
// still reads as a table — and quietly wrong for every surface that hands the same string to
// a MODEL: /translate and /proofread were sending `<div class="page-body-container"><p>…`
// verbatim as the text to work on, so the model spent its attention on markup and the
// officer got tags back in their output. Since PDF_EXTRACTION_MODE=ocr every PDF is read
// this way, so that was every PDF, not only a scan.
//
// So the two questions are separated here: `isExtractedHtml` says which representation a
// page is in (it is also what <ExtractedText> switches on), and `extractedPlainText` turns
// one into prose — block elements become line breaks, a table row becomes its cells joined
// by " | ", and entities are decoded.
//
// HAND-ROLLED, deliberately, exactly as <ExtractedText>'s Markdown fallback and
// lib/markdownTable are. DOMParser would be shorter and is available on both surfaces, but
// this is the string that is sent to a paid model, and a function that can only run inside a
// browser cannot be checked by a harness — see extractedText.check.ts, which is free and
// runs in Node. Nothing here is rendered, so none of the sanitising <ExtractedText> has to
// do applies: the output is a plain string.

// The tags Sarvam's page HTML actually uses, plus the wrappers a whole-document read can
// carry. A page matching none of them is already prose (a text-layer read, Gemini's
// Markdown, a .txt or .docx read locally) and is returned untouched.
const HTML_CONTENT =
  /<\/?(?:html|body|article|section|div|span|p|h[1-6]|table|thead|tbody|tfoot|tr|th|td|ul|ol|li|blockquote|pre|code|strong|em|small|header|footer|figure|figcaption|br|hr)\b/i;

export function isExtractedHtml(text: string): boolean {
  return HTML_CONTENT.test(text);
}

// Everything that ends the line it is on. `li` and `tr` are here so a list or a table does
// not collapse into one paragraph; the inline tags (span, strong, em, code, a) are
// deliberately absent, since a break inside a sentence would split a Marathi clause in two.
const BLOCK_TAGS = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'body',
  'caption',
  'dd',
  'div',
  'dl',
  'dt',
  'figcaption',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'html',
  'main',
  'nav',
  'ol',
  'p',
  'pre',
  'section',
  'table',
  'ul',
]);

// `thead`/`tbody`/`tfoot` are deliberately NOT blocks: they group rows without being a break
// of their own, and counting them would put a blank line between a table's header row and
// its first row of figures.

// Ends its line but does NOT open a blank one. A block emits a break at both its opening and
// its closing tag, which is right between two paragraphs and wrong between two list items or
// two table rows — those would come out double-spaced. So these break on the way IN only.
const LINE_TAGS = new Set(['li', 'tr']);

// Carries no reading content — and `script`/`style` bodies would otherwise be translated.
const DROP_TAGS = new Set(['script', 'style', 'head', 'title']);

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
};

function decodeEntities(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,
    (whole, body: string) => {
      if (body.startsWith('#x') || body.startsWith('#X')) {
        const code = Number.parseInt(body.slice(2), 16);
        return Number.isNaN(code) ? whole : String.fromCodePoint(code);
      }
      if (body.startsWith('#')) {
        const code = Number.parseInt(body.slice(1), 10);
        return Number.isNaN(code) ? whole : String.fromCodePoint(code);
      }
      return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
    },
  );
}

// One run of text between two tags. Its own newlines are flattened, because a line break in
// the SOURCE is not a line break in the document — real page HTML is pretty-printed, and
// keeping those would put a blank line between a table's header row and its first row of
// figures purely because the two tags were written on separate lines. Only tags break lines.
function textChunk(raw: string): string {
  return decodeEntities(raw).replace(/[\r\n\t]+/g, ' ');
}

// HTML's own whitespace is meaningless (the indentation between two tags is a text node), so
// every line is collapsed and trimmed, and a run of blank lines becomes one — which is what
// keeps a paragraph break meaningful after the block tags have each added their own.
function tidy(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/[ \t\u00a0]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * The reading text of an extracted page, whatever representation it arrived in.
 *
 * Plain text is returned UNCHANGED — this must never touch a string that is already prose.
 * Only something that looks like HTML is converted.
 */
export function extractedPlainText(text: string): string {
  if (!isExtractedHtml(text)) return text;

  const out: string[] = [];
  // Which table cell of the current row is being written, so cells are joined by " | "
  // rather than run together: three columns of a budget table concatenated into one number
  // is worse than no table at all.
  let cell = 0;
  let index = 0;

  while (index < text.length) {
    const open = text.indexOf('<', index);
    if (open === -1) {
      out.push(textChunk(text.slice(index)));
      break;
    }
    if (open > index) out.push(textChunk(text.slice(index, open)));

    // A '<' that is not the start of a tag is CONTENT — an OCR'd page reads "५ < १०" and a
    // parser that swallowed everything up to the next '>' would eat the sentence with it.
    const after = text[open + 1] ?? '';
    if (!/[a-zA-Z!/]/.test(after)) {
      out.push('<');
      index = open + 1;
      continue;
    }

    // A comment may legitimately contain '>', so it is closed on its own terminator.
    if (text.startsWith('<!--', open)) {
      const end = text.indexOf('-->', open);
      index = end === -1 ? text.length : end + 3;
      continue;
    }

    const close = text.indexOf('>', open);
    // An unterminated tag at the end of the page is markup that never closed, not content:
    // printing `<div class="x` into the officer's text would be worse than dropping it.
    if (close === -1) break;

    const raw = text.slice(open + 1, close);
    index = close + 1;

    // A doctype carries nothing to read.
    if (raw.startsWith('!')) continue;

    const closing = raw.startsWith('/');
    const name = (closing ? raw.slice(1) : raw)
      .trim()
      .split(/[\s/>]/, 1)[0]
      ?.toLowerCase();
    if (!name) continue;

    if (DROP_TAGS.has(name)) {
      if (closing) continue;
      // Skip the element's whole body: its text is markup, not reading matter.
      const end = text.toLowerCase().indexOf(`</${name}`, index);
      index = end === -1 ? text.length : end;
      continue;
    }

    if (name === 'br' || name === 'hr') {
      out.push('\n');
      continue;
    }
    if (LINE_TAGS.has(name)) {
      if (!closing) {
        if (name === 'tr') cell = 0;
        out.push('\n');
      }
      continue;
    }
    if (name === 'td' || name === 'th') {
      if (!closing) {
        if (cell > 0) out.push(' | ');
        cell += 1;
      }
      continue;
    }
    if (BLOCK_TAGS.has(name)) out.push('\n');
  }

  return tidy(out.join(''));
}
