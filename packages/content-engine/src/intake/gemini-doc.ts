// Marathi PDF reading via the Gemini API — a third document backend beside sarvam-doc.ts
// (the default) and openai-doc.ts. Which one runs is decided by ocr-provider.ts; pdf-pages.ts
// owns the policy above all three. This file is one transport, its prompt, and the arithmetic
// that keeps a request inside the model's limits.
//
// WHY THIS EXISTS, and it is one number: Gemini takes a WHOLE PDF in a single call — up to
// 1,000 pages and 50 MB per document — where openai-doc.ts makes ONE CALL PER PAGE. A
// twenty-page attachment in /chat is one request here and twenty there. It is wired to /chat
// only (see the surface plumbing in apps/api/src/routes/documents.ts): the surfaces whose
// output gets published keep whatever OCR_PROVIDER says, because their read is reviewed page
// by page and changing it is a separate, separately-verifiable decision.
//
// PAGE IDENTITY IS STILL EXACT, and this is the part that had to be designed rather than
// assumed. Page identity is the thing this codebase guards hardest — a page number that
// silently shifts translates the wrong pages, and it has happened here before. So the model is
// never asked what page it is looking at and never reports one. It is handed a chunk of N
// pages, told it has N pages, and must answer with N entries in order; entry i is filed under
// `chunk.originalPages[i]`. When the count does not match, nothing is guessed — the chunk is
// SPLIT IN HALF and both halves are re-read, down to a single page where one entry can only
// mean one thing. That is the splitPdfPagesBySize halving precedent, and it doubles as the
// recovery for a truncated answer.
//
// THE BINDING LIMIT IS OUTPUT TOKENS, NOT THE 1,000-PAGE INPUT CEILING. A page of dense
// Marathi transcribes to something like 800-1,500 tokens, so a few tens of pages already fill
// a model's whole answer budget, and an answer that runs out mid-JSON is exactly the failure
// that hides. GEMINI_OCR_MAX_PAGES is therefore the real knob and defaults far below 1,000;
// the halving above is what makes a wrong guess self-correcting rather than fatal, and a
// truncation permanently lowers the budget for the rest of the process.
//
// SIZE IS LEARNED, NOT DECLARED. Google documents 50 MB per PDF, but an inline request also
// has its own ceiling and the two are not the same number. Rather than hardcode a guess, the
// budget starts at the documented figure and a size rejection lowers it for the process and
// re-reads in halves — the veo-client "params are LEARNED" doctrine. Nothing here needs to be
// re-tuned by hand when Google changes a limit.
//
// CHUNKS ARE READ ONE AT A TIME and each is base64-encoded only while it is in flight. That is
// a memory decision, not a style one: at several hundred pages the alternative holds every
// chunk's buffer and a base64 copy of each, on a box that has already been OOM-killed once
// (see the video-stitch milestone in AGENTS.md).
//
// A PER-CHUNK FAILURE IS NOT A DOCUMENT FAILURE. A chunk that cannot be read at all records
// its pages as empty with a warning and the rest of the document is still delivered — the
// openai-doc stance, and the reason /chat's attachment does not lose a 40-page scan to one bad
// stretch. The extraction fails only when NO page produced text.

import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { GeminiRequestError, geminiFetch } from '../http/gemini-request.js';
import {
  splitPdfPages,
  splitPdfPagesBySize,
  type PdfChunk,
} from './pdf-split.js';
import { ocrSystemPrompt } from './openai-doc.js';
import { type ExtractPdfOptions, type PdfPage } from './pdf-shared.js';

// The model ids churn, so this is env-overridable — the GEMINI_IMAGE_MODEL precedent. Must be
// a model that accepts a PDF as inline data.
const DEFAULT_OCR_MODEL = 'gemini-3.7-flash';

export function geminiOcrModel(): string {
  const override = process.env.GEMINI_OCR_MODEL;
  return override && override.trim() !== ''
    ? override.trim()
    : DEFAULT_OCR_MODEL;
}

function readInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

// Google's documented per-document ceiling. Budgeted against the RAW PDF; the base64 the
// transport actually sends is ~4/3 of it. Lowered at runtime if the API says otherwise — see
// the header.
export function geminiOcrMaxRequestBytes(): number {
  return readInt('GEMINI_OCR_MAX_REQUEST_BYTES', 50 * 1024 * 1024);
}

// How many pages one call may carry. NOT the model's 1,000-page input ceiling: this is sized
// by how much TEXT one answer can hold. Raise it for born-digital documents with little text
// per page, lower it if the log starts reporting truncated answers.
export function geminiOcrMaxPages(): number {
  return readInt('GEMINI_OCR_MAX_PAGES', 30);
}

// Sent explicitly rather than left to the model's default, which on some ids is small enough
// to truncate a handful of pages of Marathi.
function maxOutputTokens(): number {
  return readInt('GEMINI_OCR_MAX_OUTPUT_TOKENS', 65_536);
}

const SYSTEM_PROMPT = ocrSystemPrompt('document');

// How many times a chunk that FAILED (as opposed to answering with the wrong number of pages)
// may be split and retried. See the error branch in extractPdfPagesViaGemini.
const ERROR_RETRY_DEPTH = 2;

// Lowered for the rest of the process when the API rejects a request as too large. Starts
// unset, meaning "use the configured budget".
let learnedMaxBytes: number | null = null;
// Same, for a model whose answer truncated: the pages-per-call budget is too optimistic for
// this document's density.
let learnedMaxPages: number | null = null;
// Model ids that reject structured output. Learned once, then every later call asks for plain
// JSON text and it is parsed tolerantly.
const modelsRejectingSchema = new Set<string>();

function currentMaxBytes(): number {
  return Math.min(geminiOcrMaxRequestBytes(), learnedMaxBytes ?? Infinity);
}

function currentMaxPages(): number {
  return Math.min(geminiOcrMaxPages(), learnedMaxPages ?? Infinity);
}

function requireApiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error(
      'Missing required environment variable GEMINI_API_KEY. ' +
        'Set it in the API process environment (deploy/.env.prod for the ' +
        'production Docker deployment; the root .env is local-only).',
    );
  }
  return key;
}

// A 400 that is really "your request is too big". Google words this several ways depending on
// which limit was hit, and a 413 comes back for the hard transport cap, so the test is
// deliberately broad — the consequence of a false positive is one extra split, and of a false
// negative a failed read.
export function mentionsRequestTooLarge(error: unknown): boolean {
  if (!(error instanceof GeminiRequestError)) return false;
  if (error.status === 413) return true;
  if (error.status !== 400) return false;
  const detail = error.detail.toLowerCase();
  return (
    detail.includes('too large') ||
    detail.includes('too long') ||
    detail.includes('exceeds the maximum') ||
    detail.includes('request payload size') ||
    detail.includes('request entity') ||
    detail.includes('page limit') ||
    detail.includes('too many pages')
  );
}

// A 400 naming the structured-output fields, which older ids do not take.
export function mentionsResponseSchema(error: unknown): boolean {
  if (!(error instanceof GeminiRequestError) || error.status !== 400) {
    return false;
  }
  const detail = error.detail.toLowerCase();
  return (
    detail.includes('responseschema') ||
    detail.includes('response_schema') ||
    detail.includes('responsemimetype') ||
    detail.includes('response_mime_type')
  );
}

type GeminiOcrResponse = {
  candidates?: Array<{
    finishReason?: string;
    content?: { parts?: Array<{ text?: string }> };
  }>;
  promptFeedback?: { blockReason?: string };
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
};

function answerTextOf(body: GeminiOcrResponse): string {
  return (body.candidates?.[0]?.content?.parts ?? [])
    .map((part) => part.text)
    .filter((value): value is string => typeof value === 'string')
    .join('');
}

function refusalTextOf(body: GeminiOcrResponse): string {
  const blocked = body.promptFeedback?.blockReason;
  const finish = body.candidates?.[0]?.finishReason;
  return [
    blocked ? `blockReason=${blocked}` : '',
    finish ? `finishReason=${finish}` : '',
  ]
    .filter((value) => value !== '')
    .join(' — ');
}

/**
 * Pulls the page list out of an answer.
 *
 * Tolerant on purpose: with structured output on, the body IS the JSON, but the fallback path
 * asks for JSON in plain text and a model will sometimes wrap it in a fence or add a line
 * before it. Returns null when nothing parseable is there, which the caller treats exactly
 * like a wrong page count — split and retry.
 */
export function parseOcrPages(raw: string): string[] | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;

  const candidates: string[] = [trimmed];
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed);
  if (fenced?.[1]) candidates.push(fenced[1].trim());
  // The first {...} or [...] in a reply that carried a sentence before it.
  const braced = /[[{][\s\S]*[\]}]/.exec(trimmed);
  if (braced?.[0]) candidates.push(braced[0]);

  for (const candidate of candidates) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      continue;
    }
    const list = Array.isArray(parsed)
      ? parsed
      : typeof parsed === 'object' && parsed !== null
        ? (parsed as { pages?: unknown }).pages
        : undefined;
    if (!Array.isArray(list)) continue;
    // Entries may be bare strings or {text}. A page with nothing on it is an empty string,
    // never a dropped entry — the count is what page identity rests on.
    return list.map((entry) => {
      if (typeof entry === 'string') return entry;
      if (typeof entry === 'object' && entry !== null) {
        const text = (entry as { text?: unknown }).text;
        if (typeof text === 'string') return text;
      }
      return '';
    });
  }
  return null;
}

// The structured-output declaration. `pages` is an array of one string per page, in order —
// the smallest shape that can carry the answer, because every extra field is a field the model
// can disagree with us about.
const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    pages: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['pages'],
} as const;

export function buildOcrRequestBody(
  pdfBase64: string,
  pageCount: number,
  withSchema: boolean,
): unknown {
  const instruction =
    pageCount === 1
      ? 'Transcribe this page as Markdown, following your instructions exactly. ' +
        'Answer with JSON: {"pages": ["<the page>"]} — exactly one entry.'
      : `This document has ${pageCount} pages. Transcribe every one of them as Markdown, ` +
        'following your instructions exactly. Answer with JSON: ' +
        `{"pages": [...]} holding exactly ${pageCount} entries, in page order, one per page. ` +
        'A blank page is an empty string, not a missing entry.';

  return {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [
      {
        role: 'user',
        parts: [
          // The document first and the short instruction after it: the large part is then a
          // stable prefix, which is what a provider's context cache can reuse.
          {
            inlineData: { mimeType: 'application/pdf', data: pdfBase64 },
          },
          { text: instruction },
        ],
      },
    ],
    generationConfig: {
      maxOutputTokens: maxOutputTokens(),
      ...(withSchema
        ? {
            responseMimeType: 'application/json',
            responseSchema: RESPONSE_SCHEMA,
          }
        : {}),
    },
  };
}

// Splits one chunk into two, keeping each half's ORIGINAL page numbers. The chunk is its own
// little PDF numbered 1..n, so the halves come back numbered against it and are mapped back
// through `chunk.originalPages` here — the one line that decides whether the right pages come
// back, kept in one place.
export async function halveChunk(chunk: PdfChunk): Promise<PdfChunk[]> {
  const count = chunk.originalPages.length;
  const parts = await splitPdfPages(chunk.data, Math.ceil(count / 2));
  return parts.map((part) => ({
    data: part.data,
    originalPages: part.originalPages.map(
      (position) => chunk.originalPages[position - 1] ?? position,
    ),
  }));
}

// One call. Returns the page texts as the model gave them — the CALLER checks the count.
async function readChunk(
  label: string,
  chunk: PdfChunk,
): Promise<{ pages: string[] | null; truncated: boolean }> {
  const apiKey = requireApiKey();
  const model = geminiOcrModel();
  const pageCount = chunk.originalPages.length;
  const pdfBase64 = chunk.data.toString('base64');

  const send = async (withSchema: boolean): Promise<GeminiOcrResponse> => {
    const response = await geminiFetch(`models/${model}:generateContent`, {
      label: 'document ocr',
      apiKey,
      lane: 'ocr',
      body: buildOcrRequestBody(pdfBase64, pageCount, withSchema),
    });
    return (await response.json()) as GeminiOcrResponse;
  };

  let withSchema = !modelsRejectingSchema.has(model);
  let body: GeminiOcrResponse;
  for (;;) {
    try {
      body = await send(withSchema);
      break;
    } catch (error) {
      if (withSchema && mentionsResponseSchema(error)) {
        modelsRejectingSchema.add(model);
        console.warn(
          `[gemini-doc] ${model} rejects structured output; asking for plain JSON instead.`,
        );
        withSchema = false;
        continue;
      }
      throw error;
    }
  }

  // Logged on every success: this is the calibration signal for GEMINI_OCR_MAX_PAGES and for
  // the per-page price in cost/pricing.ts, neither of which anything in the product can
  // discover on its own.
  const usage = body.usageMetadata;
  console.log(
    `[gemini-doc] ${label}: ${pageCount} page(s), ` +
      `in=${usage?.promptTokenCount ?? '?'} out=${usage?.candidatesTokenCount ?? '?'} tokens.`,
  );

  const finish = body.candidates?.[0]?.finishReason;
  const truncated = finish === 'MAX_TOKENS';
  if (truncated) {
    console.warn(
      `[gemini-doc] ${label}: the answer hit the output limit and was cut off.`,
    );
  }

  const text = answerTextOf(body);
  if (text.trim() === '') {
    const reason = refusalTextOf(body);
    console.warn(
      `[gemini-doc] ${label}: empty answer${reason ? ` (${reason})` : ''}.`,
    );
    return { pages: null, truncated };
  }
  return { pages: parseOcrPages(text), truncated };
}

// Reads a PDF through Gemini. Same contract as extractPdfPagesViaOcr (sarvam-doc.ts) and
// extractPdfPagesViaOpenAI: pages carry the ORIGINAL document's numbers, `options.pages`
// restricts the read to the user's selection, and a total failure throws with a message the
// DLO caller records against that one file.
export async function extractPdfPagesViaGemini(
  name: string,
  data: Buffer,
  options?: ExtractPdfOptions,
): Promise<PdfPage[]> {
  // Asked for once, here, so a deployment missing the key fails immediately and says so
  // rather than surfacing as every page failing and then "no text came back" — which is what
  // it looked like before, after the retry ladder below had halved its way down the document.
  requireApiKey();

  // options.timeoutMs is deliberately NOT applied. It is a per-Sarvam-JOB budget — a job being
  // something you poll — and a Gemini read is one long request whose clock belongs to its lane
  // (GEMINI_OCR_TIMEOUT_MS). Holding it to a caller's job budget would abort a read that is
  // simply long.

  const chunks = await splitPdfPagesBySize(
    data,
    currentMaxBytes(),
    options?.pages,
    currentMaxPages(),
  );
  const pageCount = chunks.reduce(
    (total, chunk) => total + chunk.originalPages.length,
    0,
  );
  console.log(
    `[gemini-doc] ${name}: ${pageCount} page(s) in ${chunks.length} call(s) on ${geminiOcrModel()}.`,
  );

  let pagesDone = 0;
  const failures: number[] = [];
  const pages: PdfPage[] = [];

  const deliver = (page: PdfPage): void => {
    pages.push(page);
    pagesDone += 1;
    options?.onProgress?.(pagesDone, pageCount);
    // Reported as the page lands, never allowed to sink a read that is already paid for.
    try {
      options?.onPage?.(page);
    } catch (error) {
      console.warn(`[gemini-doc] ${name}: onPage callback threw:`, error);
    }
  };

  // Reads one chunk, splitting and retrying rather than guessing whenever the answer cannot be
  // trusted to line up with the pages that were sent. At one page there is nothing left to
  // split, so whatever came back is that page's text.
  const read = async (chunk: PdfChunk, depth = 0): Promise<void> => {
    const count = chunk.originalPages.length;
    const label = `${name} (पृष्ठ ${chunk.originalPages[0]}${count > 1 ? `-${chunk.originalPages[count - 1]}` : ''})`;

    let result: { pages: string[] | null; truncated: boolean };
    try {
      result = await readChunk(label, chunk);
    } catch (error) {
      if (mentionsRequestTooLarge(error) && count > 1) {
        // Learned, so the rest of the document does not repeat the discovery.
        const lowered = Math.max(1, Math.floor(count / 2));
        learnedMaxPages = Math.min(learnedMaxPages ?? Infinity, lowered);
        learnedMaxBytes = Math.min(
          learnedMaxBytes ?? Infinity,
          Math.max(1, Math.floor(chunk.data.length / 2)),
        );
        console.warn(
          `[gemini-doc] ${label}: rejected as too large — retrying in halves ` +
            `(budget now ${lowered} page(s) / ${learnedMaxBytes} bytes).`,
        );
        for (const half of await halveChunk(chunk)) await read(half, depth + 1);
        return;
      }
      // A failure that is NOT about size gets a bounded retry, not the full descent the count
      // mismatch below gets. Halving all the way down a document the API is simply refusing
      // would turn one failed read into ~2N paid attempts; two halvings is enough to isolate
      // a bad stretch from the pages around it.
      if (count > 1 && depth < ERROR_RETRY_DEPTH) {
        console.warn(
          `[gemini-doc] ${label} failed — retrying in halves:`,
          error,
        );
        for (const half of await halveChunk(chunk)) await read(half, depth + 1);
        return;
      }
      if (count > 1) {
        for (const page of chunk.originalPages) {
          failures.push(page);
          deliver({ page, text: '' });
        }
        console.warn(
          `[gemini-doc] ${label} could not be read after ${ERROR_RETRY_DEPTH} retries:`,
          error,
        );
        return;
      }
      // One page, not the document.
      failures.push(chunk.originalPages[0] ?? 0);
      console.warn(`[gemini-doc] ${label} could not be read:`, error);
      deliver({ page: chunk.originalPages[0] ?? 0, text: '' });
      return;
    }

    if (result.truncated && count > 1) {
      learnedMaxPages = Math.min(
        learnedMaxPages ?? Infinity,
        Math.max(1, Math.floor(count / 2)),
      );
    }

    const answered = result.pages;
    if (!answered || answered.length !== count) {
      if (count > 1) {
        console.warn(
          `[gemini-doc] ${label}: expected ${count} entries, got ` +
            `${answered ? answered.length : 'none'} — re-reading in halves.`,
        );
        // Descends all the way to a single page, deliberately: one page in, one entry out is
        // the only shape whose page identity cannot be wrong, and the learned page budget
        // above means later chunks start smaller so this rarely happens twice.
        for (const half of await halveChunk(chunk)) await read(half, depth + 1);
        return;
      }
      // A single page: whatever came back is this page, joined if it arrived split. Nothing
      // can be mis-numbered here, so there is no reason to throw the text away.
      const page = chunk.originalPages[0] ?? 0;
      const text = (answered ?? []).join('\n\n').trim();
      if (text === '') failures.push(page);
      deliver({ page, text });
      return;
    }

    // The counts agree: entry i IS page originalPages[i]. The model was never asked for a page
    // number and never gave one, so there is nothing to reconcile.
    answered.forEach((text, index) => {
      deliver({
        page: chunk.originalPages[index] ?? 0,
        text: text.trim(),
      });
    });
  };

  for (const chunk of chunks) await read(chunk);

  pages.sort((a, b) => a.page - b.page);

  if (pages.every((page) => page.text.length === 0)) {
    throw new Error(`${name}: Gemini कडून या पृष्ठांचा मजकूर मिळाला नाही.`);
  }
  if (failures.length > 0) {
    console.warn(
      `[gemini-doc] ${name}: ${failures.length} page(s) came back empty (${failures
        .sort((a, b) => a - b)
        .join(', ')}); the rest were read.`,
    );
  }
  return pages;
}

// Harnesses:
//   tsx src/intake/gemini-doc.ts --check                              (free)
//   tsx --env-file=../../.env src/intake/gemini-doc.ts <file.pdf> [--pages=2,5,9]   (paid)
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const args = process.argv.slice(2);

  if (args.includes('--check')) {
    let failed = 0;
    let total = 0;
    const check = (label: string, ok: boolean): void => {
      total += 1;
      if (!ok) failed += 1;
      console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
    };

    const original = { ...process.env };

    delete process.env.GEMINI_OCR_MODEL;
    check('model defaults', geminiOcrModel() === DEFAULT_OCR_MODEL);
    process.env.GEMINI_OCR_MODEL = '  my-model  ';
    check('model override is trimmed', geminiOcrModel() === 'my-model');

    delete process.env.GEMINI_OCR_MAX_PAGES;
    check(
      'page budget is far below the 1000-page input ceiling',
      geminiOcrMaxPages() === 30,
    );
    process.env.GEMINI_OCR_MAX_PAGES = '8';
    check('page budget is overridable', geminiOcrMaxPages() === 8);
    process.env.GEMINI_OCR_MAX_PAGES = 'nonsense';
    check('a junk page budget falls back', geminiOcrMaxPages() === 30);
    delete process.env.GEMINI_OCR_MAX_REQUEST_BYTES;
    check(
      'byte budget is the documented 50 MB',
      geminiOcrMaxRequestBytes() === 50 * 1024 * 1024,
    );

    // --- the answer parser: every shape a model has an excuse for ---
    check(
      'the declared shape parses',
      JSON.stringify(parseOcrPages('{"pages":["a","b"]}')) ===
        JSON.stringify(['a', 'b']),
    );
    check(
      'a bare array parses',
      JSON.stringify(parseOcrPages('["a","b"]')) === JSON.stringify(['a', 'b']),
    );
    check(
      'entries given as objects parse',
      JSON.stringify(parseOcrPages('{"pages":[{"text":"a"},{"text":"b"}]}')) ===
        JSON.stringify(['a', 'b']),
    );
    check(
      'a fenced answer parses',
      JSON.stringify(parseOcrPages('```json\n{"pages":["a"]}\n```')) ===
        JSON.stringify(['a']),
    );
    check(
      'a sentence before the JSON is tolerated',
      JSON.stringify(parseOcrPages('Here you go:\n{"pages":["a"]}')) ===
        JSON.stringify(['a']),
    );
    check(
      'a blank page stays an entry, so the count still lines up',
      parseOcrPages('{"pages":["a","","c"]}')?.length === 3,
    );
    check(
      'truncated JSON returns null',
      parseOcrPages('{"pages":["a","b') === null,
    );
    check(
      'prose returns null',
      parseOcrPages('I could not read this.') === null,
    );
    check('an empty answer returns null', parseOcrPages('   ') === null);

    // --- the request body ---
    const body = buildOcrRequestBody('QUJD', 4, true) as {
      systemInstruction: { parts: Array<{ text: string }> };
      contents: Array<{ parts: Array<Record<string, unknown>> }>;
      generationConfig: Record<string, unknown>;
    };
    const parts = body.contents[0]?.parts ?? [];
    check('the PDF is the first part', 'inlineData' in (parts[0] ?? {}));
    check(
      'the instruction follows it',
      typeof (parts[1] as { text?: string })?.text === 'string',
    );
    check(
      'the page count is stated to the model',
      JSON.stringify(parts[1]).includes('4'),
    );
    check(
      'the shared fidelity prompt is the system instruction',
      (body.systemInstruction.parts[0]?.text ?? '').includes(
        'TABLES AS MARKDOWN TABLES',
      ),
    );
    check(
      'the document prompt demands one entry per page',
      (body.systemInstruction.parts[0]?.text ?? '').includes(
        'ONE ENTRY PER PAGE',
      ),
    );
    check(
      'and never asks for a page number back',
      !(body.systemInstruction.parts[0]?.text ?? '').includes(
        'report the page number',
      ),
    );
    check(
      'structured output is requested',
      body.generationConfig.responseMimeType === 'application/json',
    );
    const plain = buildOcrRequestBody('QUJD', 1, false) as {
      generationConfig: Record<string, unknown>;
      contents: Array<{ parts: Array<Record<string, unknown>> }>;
    };
    check(
      'the fallback sends no schema',
      plain.generationConfig.responseSchema === undefined,
    );
    check(
      'but still asks for JSON in words',
      JSON.stringify(plain.contents[0]?.parts?.[1]).includes('pages'),
    );
    check(
      'an output ceiling is always sent',
      typeof plain.generationConfig.maxOutputTokens === 'number',
    );

    // --- the learned-limit classifiers ---
    const err = (status: number, detail: string): GeminiRequestError =>
      new GeminiRequestError('x', status, 'Bad Request', detail);
    check(
      'a payload-size 400 is recognised',
      mentionsRequestTooLarge(
        err(400, 'Request payload size exceeds the limit'),
      ),
    );
    check('a 413 is recognised', mentionsRequestTooLarge(err(413, '')));
    check(
      'a page-limit 400 is recognised',
      mentionsRequestTooLarge(err(400, 'Document exceeds the page limit')),
    );
    check(
      'an unrelated 400 is not',
      !mentionsRequestTooLarge(err(400, 'Invalid argument: temperature')),
    );
    check(
      'a schema 400 is recognised',
      mentionsResponseSchema(err(400, 'Unknown name "responseSchema"')),
    );
    check(
      'a 500 is neither',
      !mentionsRequestTooLarge(err(500, 'internal')) &&
        !mentionsResponseSchema(err(500, 'internal')),
    );

    process.env = original;

    // --- page identity through a split, the thing that must never drift ---
    // Async, so it runs after the synchronous checks above and prints the summary itself.
    void (async () => {
      // A real PDF, built here, so the remap is exercised rather than described. The chunk
      // carries a SCATTERED selection, which is exactly what a start+count offset gets wrong.
      const { PDFDocument } = await import('pdf-lib');
      const built = await PDFDocument.create();
      for (let i = 0; i < 5; i += 1) built.addPage([200, 200]);
      const chunk = {
        originalPages: [3, 7, 8, 11, 12],
        data: Buffer.from(await built.save()),
      };
      const halves = await halveChunk(chunk);
      check('a chunk halves into two', halves.length === 2);
      check(
        'the first half keeps its ORIGINAL page numbers',
        JSON.stringify(halves[0]?.originalPages) === JSON.stringify([3, 7, 8]),
      );
      check(
        'and so does the second',
        JSON.stringify(halves[1]?.originalPages) === JSON.stringify([11, 12]),
      );
      check(
        'no page is lost or duplicated by the split',
        JSON.stringify([
          ...(halves[0]?.originalPages ?? []),
          ...(halves[1]?.originalPages ?? []),
        ]) === JSON.stringify(chunk.originalPages),
      );
      check(
        'each half is a real PDF of its own pages',
        (
          await PDFDocument.load(halves[0]?.data ?? Buffer.alloc(0))
        ).getPageCount() === 3,
      );

      console.log(`\n${total - failed}/${total} passed.`);
      process.exitCode = failed > 0 ? 1 : 0;
    })();
  } else {
    const file = args.find((arg) => !arg.startsWith('--'));
    const selection = args
      .find((arg) => arg.startsWith('--pages='))
      ?.slice('--pages='.length)
      .split(',')
      .map((part) => Number.parseInt(part.trim(), 10))
      .filter((page) => Number.isInteger(page));

    if (!file) {
      console.error(
        'usage: tsx --env-file=../../.env src/intake/gemini-doc.ts <file.pdf> [--pages=2,5,9]\n' +
          '       tsx src/intake/gemini-doc.ts --check',
      );
      process.exitCode = 1;
    } else {
      readFile(file)
        .then(async (data) => {
          const started = Date.now();
          const pages = await extractPdfPagesViaGemini(basename(file), data, {
            ...(selection ? { pages: selection } : {}),
            onProgress: (done, count) =>
              console.log(`  …${done}/${count} page(s)`),
          });
          console.log(
            `\n${geminiOcrModel()} — ${pages.length} page(s) in ${(
              (Date.now() - started) /
              1000
            ).toFixed(1)}s\n`,
          );
          for (const page of pages) {
            console.log(
              `----- page ${page.page} (${page.text.length} chars) -----`,
            );
            console.log(page.text);
            console.log();
          }
        })
        .catch((error: unknown) => {
          console.error(error);
          process.exitCode = 1;
        });
    }
  }
}
