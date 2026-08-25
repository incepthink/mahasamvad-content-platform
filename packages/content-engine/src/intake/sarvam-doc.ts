// Marathi PDF OCR via Sarvam Document AI's Digitise pipeline. The request deliberately uses
// output_format=html and content_type=printed: government PDFs are typeset documents, and
// structured HTML preserves their headings, paragraphs and tables for the officer's review.
// pdf-pages.ts owns the policy around when this paid backend runs; this file is the transport
// and output reassembly only.
//
// Local pdf-parse was rejected for this job for a reason that still holds: government
// PDFs are routinely SCANNED, and a text-layer parser yields nothing there, while this
// OCRs Devanagari with no language hint (see the request builder — sending one fails the job). One async Digitise job per chunk: multipart submit →
// poll → download.
//
// CHUNKING. Sarvam validates "Page/image count must not exceed 10" at job start and takes
// no page-range parameter, so a longer document is split into ≤10-page PDFs
// (pdf-split.ts), OCR'd one job at a time, and stitched back with each chunk's original
// page numbers. Sequential, not parallel: Sarvam's concurrency behaviour under a burst of
// jobs is untested, and a page-range in an error message is worth more than a few saved
// minutes. A chunk failure fails the whole extraction — silently missing middle pages
// would be far worse than an error naming the pages that could not be read.
//
// The output ZIP contains the requested HTML plus metadata/page_NNN.json per page. Page
// identity is recovered from per-page HTML files or explicit page wrappers when Sarvam emits
// them; metadata is the final authority if a future HTML template changes its wrapper shape.
//
//   document.html            structured whole-document HTML (or per-page HTML entries)
//   metadata/page_001.json   per page: page_num + blocks[] of { text,
//   metadata/page_002.json   layout_tag, reading_order, coordinates }
//   …
//
// The exact-count rule is non-negotiable: a guessed split could shift every original page
// number after it. The metadata fallback keeps layout tags and turns them back into safe,
// semantic HTML instead of flattening tables into prose.

import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import AdmZip from 'adm-zip';
import { JSDOM } from 'jsdom';
import { requireSarvamApiKey } from './sarvam-client.js';
import {
  OCR_MAX_TOTAL_PAGES,
  SARVAM_DOC_MAX_PAGES,
  formatPageRanges,
  splitPdfPages,
} from './pdf-split.js';
import { type ExtractPdfOptions, type PdfPage } from './pdf-shared.js';

// Ceiling on ONE job, i.e. at most 10 pages; default 10 min. Overridable per call.
const DOC_TIMEOUT_MS = Number.parseInt(
  process.env.SARVAM_DOC_TIMEOUT_MS ?? `${10 * 60_000}`,
  10,
);
const DOC_POLL_MS = 5_000;

// Page order from an output-ZIP entry name (metadata/page_001.json …). Sorting
// lexicographically would put page 10 before page 2, so order on the LAST number
// in the base name instead; an entry with no number sorts last.
function pageOrderKey(entryName: string): number {
  const matches = basename(entryName).match(/\d+/g);
  const last = matches?.[matches.length - 1];
  return last ? Number.parseInt(last, 10) : Number.MAX_SAFE_INTEGER;
}

// One page's metadata: OCR blocks in reading order. Only the fields used here are
// declared — the file also carries coordinates, confidence and layout tags.
type PageMetadata = {
  page_num?: number;
  blocks?: Array<{
    text?: unknown;
    reading_order?: unknown;
    layout_tag?: unknown;
    tag?: unknown;
  }>;
};

// Does this block hold a table? Sarvam's layout tags are not contractually documented, so
// the test is deliberately loose (anything containing 'table') and is BACKED UP by looking
// at the text itself — a block whose lines are pipe-delimited or which carries an HTML
// table is one whatever it is labelled. Getting this wrong in either direction is cheap:
// a false positive keeps a paragraph's line breaks, a false negative loses a table's
// columns exactly as the old code did for every block.
function blockTag(block: { layout_tag?: unknown; tag?: unknown }): string {
  if (typeof block.tag === 'string') return block.tag.toLowerCase();
  return typeof block.layout_tag === 'string'
    ? block.layout_tag.toLowerCase()
    : '';
}

function isTableBlock(block: {
  text?: unknown;
  layout_tag?: unknown;
  tag?: unknown;
}): boolean {
  const tag = blockTag(block);
  if (tag.includes('table')) return true;
  const text = typeof block.text === 'string' ? block.text : '';
  if (/<\/?(table|tr|td|th)\b/i.test(text)) return true;
  // Two or more lines that both open and close with a pipe: a Markdown table.
  const piped = text
    .split('\n')
    .filter((line) => /^\s*\|.*\|\s*$/.test(line)).length;
  return piped >= 2;
}

function metadataEntries(zip: AdmZip) {
  return zip
    .getEntries()
    .filter(
      (entry) =>
        !entry.isDirectory &&
        entry.entryName.endsWith('.json') &&
        basename(entry.entryName).startsWith('page_'),
    )
    .sort((a, b) => pageOrderKey(a.entryName) - pageOrderKey(b.entryName));
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function markdownTableHtml(text: string): string | null {
  const rows = text
    .split('\n')
    .filter((line) => /^\s*\|.*\|\s*$/.test(line))
    .map((line) =>
      line
        .trim()
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((cell) => cell.trim()),
    );
  if (rows.length < 2) return null;
  const divider = rows[1]?.every((cell) => /^:?-{2,}:?$/.test(cell));
  const header = divider ? rows[0] : null;
  const body = divider ? rows.slice(2) : rows;
  const cells = (row: string[], tag: 'th' | 'td') =>
    `<tr>${row.map((cell) => `<${tag}>${escapeHtml(cell)}</${tag}>`).join('')}</tr>`;
  return `<table>${header ? `<thead>${cells(header, 'th')}</thead>` : ''}<tbody>${body
    .map((row) => cells(row, 'td'))
    .join('')}</tbody></table>`;
}

function metadataBlockHtml(block: {
  text: string;
  table: boolean;
  tag: string;
}): string {
  // Sarvam may put ready-made HTML in a metadata block. Keep that structure; the web view
  // renders through an element allow-list and never injects this string into the DOM.
  if (
    /<\/?(?:table|thead|tbody|tr|th|td|p|h[1-6]|ul|ol|li)\b/i.test(block.text)
  ) {
    return block.text;
  }
  if (block.table) {
    return (
      markdownTableHtml(block.text) ?? `<pre>${escapeHtml(block.text)}</pre>`
    );
  }

  const content = escapeHtml(block.text).replaceAll('\n', '<br>');
  if (block.tag.includes('headline') && !block.tag.includes('sub')) {
    return `<h1>${content}</h1>`;
  }
  if (block.tag.includes('sub-headline')) return `<h2>${content}</h2>`;
  if (block.tag.includes('section-title')) return `<h3>${content}</h3>`;
  if (block.tag.includes('header')) return `<header>${content}</header>`;
  if (block.tag.includes('footer')) return `<footer>${content}</footer>`;
  if (block.tag.includes('footnote')) return `<small>${content}</small>`;
  return `<p>${content}</p>`;
}

// Rebuild a page from its OCR blocks, in reading order, and take the page's own number with
// it. This is the fallback when Sarvam's primary HTML cannot be split into the exact number
// of pages. Layout tags still become semantic HTML, and tables stay tables.
function pageFromMetadata(
  raw: string,
  fallbackPage: number,
): PdfPage & { hasTable: boolean } {
  let parsed: PageMetadata;
  try {
    parsed = JSON.parse(raw) as PageMetadata;
  } catch {
    return { page: fallbackPage, text: '', hasTable: false };
  }
  const blocks = (parsed.blocks ?? [])
    .map((block, index) => ({
      text: typeof block.text === 'string' ? block.text.trim() : '',
      table: isTableBlock(block),
      tag: blockTag(block),
      order:
        typeof block.reading_order === 'number' ? block.reading_order : index,
    }))
    .filter((block) => block.text.length > 0)
    .sort((a, b) => a.order - b.order);
  const text = blocks.map(metadataBlockHtml).join('\n');
  return {
    hasTable: blocks.some((block) => block.table),
    page:
      typeof parsed.page_num === 'number' && parsed.page_num > 0
        ? parsed.page_num
        : fallbackPage,
    text,
  };
}

function bodyHtml(raw: string): string {
  const document = new JSDOM(raw).window.document;
  return document.body.innerHTML.trim() || raw.trim();
}

// Sarvam may return one HTML entry per page or one whole-document entry. A whole-document
// split is accepted only when explicit page wrappers (or top-level HR separators) produce
// exactly the page count reported by the job; otherwise metadata owns page identity.
function splitWholeDocumentHtml(
  raw: string,
  expectedPages: number,
): string[] | null {
  if (expectedPages === 1) return [bodyHtml(raw)];
  const document = new JSDOM(raw).window.document;
  // `.page-body-container` is the wrapper the live Digitise HTML template actually emits,
  // one per page (measured 2026-08-24 on a 4-page scan). `.page` is an exact class-token
  // match and does not cover it, so every real document was falling through to the metadata
  // fallback — correct output, but it throws away Sarvam's own headline/section-title/table
  // classes and warns on every run. The exact-count rule below still guards page identity.
  const selector =
    '[data-page-number], [data-page-num], .page, .page-body-container, [id^="page-"], [id^="page_"]';
  const wrappers = [...document.querySelectorAll(selector)].filter(
    (element) => !element.parentElement?.closest(selector),
  );
  if (wrappers.length === expectedPages) {
    return wrappers.map((element) => element.outerHTML.trim());
  }

  const groups: globalThis.Node[][] = [[]];
  for (const node of document.body.childNodes) {
    if (node.nodeType === document.defaultView?.Node.ELEMENT_NODE) {
      const element = node as globalThis.Element;
      if (element.tagName.toLowerCase() === 'hr') {
        groups.push([]);
        continue;
      }
    }
    groups[groups.length - 1]!.push(node);
  }
  if (groups.length === expectedPages) {
    return groups.map((nodes) => {
      const holder = document.createElement('div');
      for (const node of nodes) holder.append(node.cloneNode(true));
      return holder.innerHTML.trim();
    });
  }
  return null;
}

// The chunk's pages, in order and numbered from 1 within the chunk (the caller offsets
// them to the document's own numbering). See the file header for the ZIP layout this reads.
//
// Empty pages are KEPT. Dropping them and renumbering — which this used to do — shifts
// every later page number, so one blank page in a 20-page document silently made "translate
// pages 11-14" translate the wrong pages.
function pagesFromOutputZip(data: Buffer, expectedPages: number): PdfPage[] {
  const zip = new AdmZip(data);
  if (process.env.SARVAM_DOC_DEBUG) {
    console.log(
      `[sarvam-doc] output zip entries: ${zip
        .getEntries()
        .map((entry) => entry.entryName)
        .join(', ')}`,
    );
  }

  const metadata = metadataEntries(zip);
  const htmlEntries = zip
    .getEntries()
    .filter(
      (entry) =>
        !entry.isDirectory && entry.entryName.toLowerCase().endsWith('.html'),
    )
    .sort((a, b) => pageOrderKey(a.entryName) - pageOrderKey(b.entryName));
  const known = metadata.length > 0 ? metadata.length : expectedPages;
  if (htmlEntries.length === known) {
    return htmlEntries.map((entry, index) => ({
      page: index + 1,
      text: bodyHtml(entry.getData().toString('utf8')),
    }));
  }
  if (htmlEntries.length === 1) {
    const parts = splitWholeDocumentHtml(
      htmlEntries[0]!.getData().toString('utf8'),
      known,
    );
    if (parts && parts.some((part) => part.length > 0)) {
      return parts.map((text, index) => ({ page: index + 1, text }));
    }
  }

  // Fallback: the metadata blocks, which own the real page boundaries and page numbers.
  if (metadata.length > 0) {
    const pages = metadata.map((entry, index) =>
      pageFromMetadata(entry.getData().toString('utf8'), index + 1),
    );
    console.warn(
      `[sarvam-doc] HTML page split did not match ${metadata.length} page(s); using page metadata instead.${
        pages.some((page) => page.hasTable)
          ? ' Some pages contain tables — check their columns survived.'
          : ''
      }`,
    );
    return pages.map(({ page, text }) => ({ page, text }));
  }

  // Neither shape available: only a one-page result can be mapped without guessing.
  const whole = htmlEntries
    .map((entry) => bodyHtml(entry.getData().toString('utf8')))
    .join('\n');
  return expectedPages === 1 && whole.length > 0
    ? [{ page: 1, text: whole }]
    : [];
}

const TERMINAL_STATUSES = new Set([
  'completed',
  'partially_completed',
  'failed',
  'rejected',
]);

type DigitiseJob = { job_id?: unknown; status?: unknown };
type DigitiseStatus = {
  status?: unknown;
  usage?: {
    pages_total?: unknown;
    pages_processed?: unknown;
    pages_succeeded?: unknown;
    pages_failed?: unknown;
  };
};
type DownloadTarget = {
  method?: unknown;
  url?: unknown;
  headers?: unknown;
};

const DOCUMENT_AI_BASE_URL = 'https://api.sarvam.ai/doc-ai/v1/job';

async function fetchUntil(
  input: string,
  init: RequestInit,
  deadline: number,
): Promise<Response> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error('Sarvam Document AI timed out.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), remaining);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function sarvamJson<T>(
  url: string,
  init: RequestInit,
  deadline: number,
): Promise<T> {
  const response = await fetchUntil(
    url,
    {
      ...init,
      headers: {
        'api-subscription-key': requireSarvamApiKey(),
        ...init.headers,
      },
    },
    deadline,
  );
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(
      `Sarvam Document AI request failed: ${response.status} ${response.statusText} — ${raw.slice(0, 1_000)}`,
    );
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(
      `Sarvam Document AI returned invalid JSON (status ${response.status}).`,
    );
  }
}

async function waitForDigitise(jobId: string, deadline: number): Promise<void> {
  while (true) {
    const status = await sarvamJson<DigitiseStatus>(
      `${DOCUMENT_AI_BASE_URL}/${encodeURIComponent(jobId)}/status`,
      { method: 'GET' },
      deadline,
    );
    const state =
      typeof status.status === 'string' ? status.status.toLowerCase() : '';
    if (TERMINAL_STATUSES.has(state)) {
      if (state !== 'completed') {
        // Report the job id and the WHOLE usage block, not just pages_failed. A rejected
        // request fails with every counter at 0, so "0 page(s) failed" read as a bug in our
        // own page splitting and cost a bisect to disprove; `pages_total: 0` says plainly
        // that Sarvam never opened the document, and the id is what makes the job
        // retrievable from their side.
        const usage = status.usage
          ? ` usage=${JSON.stringify(status.usage)}`
          : '';
        throw new Error(
          `Sarvam Document AI ended with status ${state} (job ${jobId}).${usage}`,
        );
      }
      return;
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('Sarvam Document AI timed out.');
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(DOC_POLL_MS, remaining)),
    );
  }
}

// One Sarvam job: at most SARVAM_DOC_MAX_PAGES pages, numbered 1..n within the chunk.
async function extractChunkPages(
  label: string,
  data: Buffer,
  expectedPages: number,
  timeoutMs: number,
): Promise<PdfPage[]> {
  const deadline = Date.now() + timeoutMs;
  const form = new FormData();
  form.append(
    'file',
    new Blob([new Uint8Array(data)], { type: 'application/pdf' }),
    'input.pdf',
  );
  // NO `language` FIELD, and that is a measured fact about the live API rather than an
  // omission (2026-08-24). Sending `language=mr-IN` makes the job fail in ~4 seconds with
  // `status: failed` and `pages_total: 0` — Sarvam never opens the PDF, so `pages_failed`
  // is 0 too and the error says nothing. Bisected on one real 4-page scanned GR: with no
  // language it completes 4/4; `output_format` and `content_type` are each fine on their
  // own; `mr-IN`, `mr`, `hi-IN`, `auto` and `unknown` all fail instantly and only `en-IN`
  // passes. Omitting it lets Sarvam detect the script, and the Marathi comes back correct
  // (verified against that document's Devanagari headings, numerals and tables). Set
  // SARVAM_DOC_LANGUAGE only if Sarvam fixes the code path.
  const language = process.env.SARVAM_DOC_LANGUAGE?.trim();
  if (language) form.append('language', language);
  form.append('output_format', 'html');
  form.append('content_type', 'printed');

  const created = await sarvamJson<DigitiseJob>(
    `${DOCUMENT_AI_BASE_URL}/digitise`,
    { method: 'POST', body: form },
    deadline,
  );
  if (typeof created.job_id !== 'string' || created.job_id.length === 0) {
    throw new Error(`Sarvam Document AI returned no job id for ${label}.`);
  }
  await waitForDigitise(created.job_id, deadline);

  const target = await sarvamJson<DownloadTarget>(
    `${DOCUMENT_AI_BASE_URL}/${encodeURIComponent(created.job_id)}/download-url`,
    { method: 'GET' },
    deadline,
  );
  if (typeof target.url !== 'string' || target.url.length === 0) {
    throw new Error(
      `Sarvam Document AI returned no download URL for ${label}.`,
    );
  }
  const headers =
    target.headers && typeof target.headers === 'object'
      ? Object.fromEntries(
          Object.entries(target.headers).filter(
            (entry): entry is [string, string] => typeof entry[1] === 'string',
          ),
        )
      : undefined;
  const response = await fetchUntil(
    target.url,
    {
      method: typeof target.method === 'string' ? target.method : 'GET',
      ...(headers ? { headers } : {}),
    },
    deadline,
  );
  if (!response.ok) {
    throw new Error(
      `Sarvam Document AI output download failed for ${label}: ${response.status} ${response.statusText}.`,
    );
  }
  return pagesFromOutputZip(
    Buffer.from(await response.arrayBuffer()),
    expectedPages,
  );
}

// OCRs a PDF, splitting it into ≤10-page jobs as needed. Throws with a descriptive
// message on any failure — the DLO caller records it as that FILE's error without failing
// the whole intake; the translate caller fails the (single-file) job.
//
// `options.pages` restricts this to the user's selection, and doing so is the whole reason
// the option exists: OCR is billed per page, so a page the user did not select must never
// reach Sarvam. That selection is now the ONLY spend gate — the page-count ceiling below is
// off unless SARVAM_DOC_MAX_TOTAL_PAGES is set, because every page here was ticked on
// purpose and a real booklet runs past any round number worth defaulting to.
export async function extractPdfPagesViaOcr(
  name: string,
  data: Buffer,
  options?: ExtractPdfOptions,
): Promise<PdfPage[]> {
  const timeoutMs = options?.timeoutMs ?? DOC_TIMEOUT_MS;
  const chunks = await splitPdfPages(
    data,
    SARVAM_DOC_MAX_PAGES,
    options?.pages,
  );
  const totalPages = chunks.reduce(
    (sum, chunk) => sum + chunk.originalPages.length,
    0,
  );

  if (totalPages > OCR_MAX_TOTAL_PAGES) {
    throw new Error(
      `${name}: ${totalPages} पृष्ठे OCR साठी खूप जास्त आहेत (कमाल ${OCR_MAX_TOTAL_PAGES}). कृपया कमी पृष्ठे निवडा.`,
    );
  }

  const pages: PdfPage[] = [];
  let pagesDone = 0;
  for (const chunk of chunks) {
    const label =
      chunks.length === 1 && !options?.pages
        ? name
        : `${name} (पृष्ठ ${formatPageRanges(chunk.originalPages)})`;
    const chunkPages = await extractChunkPages(
      label,
      chunk.data,
      chunk.originalPages.length,
      timeoutMs,
    );
    // Back to the ORIGINAL document's numbering. A chunk's pages are numbered 1..n within
    // the chunk, so its own page list is the lookup table — this is the single point where
    // page identity is restored, and getting it wrong silently translates the wrong pages.
    for (const page of chunkPages) {
      const original = chunk.originalPages[page.page - 1];
      if (original === undefined) {
        console.warn(
          `[sarvam-doc] ${label}: OCR returned page ${page.page} but only ${chunk.originalPages.length} were sent; dropping it.`,
        );
        continue;
      }
      pages.push({ page: original, text: page.text });
    }
    pagesDone += chunk.originalPages.length;
    options?.onProgress?.(pagesDone, totalPages);
  }

  if (pages.every((page) => page.text.length === 0)) {
    throw new Error(
      `Sarvam document digitization returned no text for ${name}.`,
    );
  }
  return pages;
}

// Free transport/output harness. It proves the exact Document AI form fields and verifies
// that a ZIP of page-level HTML comes back as separately numbered pages without touching
// Sarvam or spending credits.
//   tsx src/intake/sarvam-doc.ts
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const checks: Array<[string, boolean]> = [];
  const check = (label: string, ok: boolean): void => {
    checks.push([label, ok]);
  };
  const zip = new AdmZip();
  zip.addFile('page_001.html', Buffer.from('<h1>पहिले पृष्ठ</h1><p>मजकूर</p>'));
  zip.addFile(
    'page_002.html',
    Buffer.from('<h2>दुसरे पृष्ठ</h2><table><tr><td>१</td></tr></table>'),
  );
  const output = zip.toBuffer();
  const metadataZip = new AdmZip();
  metadataZip.addFile('document.html', Buffer.from('<p>unsplit document</p>'));
  metadataZip.addFile(
    'metadata/page_001.json',
    Buffer.from(
      JSON.stringify({
        page_num: 1,
        blocks: [{ text: 'शीर्षक', tag: 'headline', reading_order: 0 }],
      }),
    ),
  );
  metadataZip.addFile(
    'metadata/page_002.json',
    Buffer.from(
      JSON.stringify({
        page_num: 2,
        blocks: [
          {
            text: '| नाव | संख्या |\n| --- | --- |\n| अ | १ |',
            tag: 'table',
            reading_order: 0,
          },
        ],
      }),
    ),
  );
  const metadataPages = pagesFromOutputZip(metadataZip.toBuffer(), 2);
  check(
    'metadata fallback rebuilds semantic HTML and tables',
    metadataPages[0]?.text === '<h1>शीर्षक</h1>' &&
      metadataPages[1]?.text.includes('<table>') === true,
  );
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.SARVAM_API_KEY;
  let formOk = false;
  let calls = 0;
  process.env.SARVAM_API_KEY = 'test-key';
  globalThis.fetch = (async (input, init) => {
    calls += 1;
    const url = String(input);
    if (url.endsWith('/digitise')) {
      const form = init?.body;
      formOk =
        form instanceof FormData &&
        form.get('output_format') === 'html' &&
        form.get('content_type') === 'printed' &&
        // A language field is what fails the live job outright; it must not come back.
        form.get('language') === null &&
        form.get('file') instanceof Blob;
      return new Response(
        JSON.stringify({ job_id: 'job-1', status: 'pending' }),
        {
          status: 201,
        },
      );
    }
    if (url.endsWith('/job-1/status')) {
      return new Response(JSON.stringify({ status: 'completed' }));
    }
    if (url.endsWith('/job-1/download-url')) {
      return new Response(
        JSON.stringify({
          method: 'GET',
          url: 'https://download.test/output.zip',
        }),
      );
    }
    if (url === 'https://download.test/output.zip') {
      return new Response(new Uint8Array(output));
    }
    return new Response('unexpected URL', { status: 500 });
  }) as typeof fetch;

  extractChunkPages('check.pdf', Buffer.from('%PDF-check'), 2, 2_000)
    .then((pages) => {
      check('uses Digitise HTML printed form', formOk);
      check('create + status + URL + download', calls === 4);
      check(
        'keeps two page-level HTML entries',
        pages.length === 2 &&
          pages[0]?.page === 1 &&
          pages[0]?.text.includes('<h1>') === true &&
          pages[1]?.page === 2 &&
          pages[1]?.text.includes('<table>') === true,
      );
    })
    .catch((error: unknown) => {
      console.error(error);
      check('transport completes', false);
    })
    .finally(() => {
      globalThis.fetch = originalFetch;
      if (originalKey === undefined) delete process.env.SARVAM_API_KEY;
      else process.env.SARVAM_API_KEY = originalKey;

      let failed = 0;
      for (const [label, ok] of checks) {
        console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
        if (!ok) failed += 1;
      }
      console.log(`\n${checks.length - failed}/${checks.length} passed.`);
      process.exitCode = failed > 0 ? 1 : 0;
    });
}
