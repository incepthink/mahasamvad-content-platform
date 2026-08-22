// Marathi PDF reading via the OpenAI API — the DEFAULT document backend, and the twin of
// sarvam-doc.ts. Which one runs is decided by ocr-provider.ts; pdf-pages.ts owns the policy
// above both. This file is one transport and its prompt, nothing else.
//
// WHY THIS EXISTS. The officers were already uploading these PDFs to ChatGPT by hand and
// pasting the result in, because it reads their documents better than what the platform
// returned — specifically it keeps TABLES, which government material is full of and which
// this whole product then has to reason over. Reproducing that read inside the pipeline is
// the entire goal; the officer should not have to leave the product to get the good answer.
//
// ONE CALL PER PAGE, EACH CARRYING ITS CHUNK AS CONTEXT. Page identity is the thing this
// codebase guards hardest — a page number that silently shifts translates the wrong pages,
// and it has happened here before — so every call still ANSWERS with exactly one page, and
// that answer is filed under the page number it was asked for. There is no model-reported
// page number to disagree with us, no `---` rule to split on, no metadata to reconcile.
//
// What changed (and why): each call used to be handed its page ALONE, and that lost the
// document. A real 2-page press note came back with a fabricated signatory —
// `(एस.बी.चव्हाण)` — where page 2's name is obscured by the scanned signature over it. Page 1
// carries the SAME signature block, printed cleanly. Read together the name is unambiguous;
// read in isolation the model filled the gap with a plausible one, confidently and
// invisibly. So a call now receives the surrounding pages too, purely as context, with the
// prompt stating that they are not to be transcribed or drawn on for facts.
//
// CHUNKED BY BYTES, NOT BY PAGES (splitPdfPagesBySize). Context has to be bounded by
// something, and the binding limit is the REQUEST SIZE — see OCR_MAX_REQUEST_BYTES. A page
// count would be the wrong bound: 400 pages of born-digital text can be a few MB, while 12
// pages of 600dpi scan can be 300. Most uploads are a few pages and become a single chunk,
// which is exactly the whole-document read; a 400-page scan becomes several, and each page
// still gets its neighbourhood rather than nothing.
//
// Chunks are read ONE AT A TIME and their bytes are encoded once and shared by that chunk's
// page calls. Both of those are memory decisions, not style: at 400 pages the alternative
// holds every chunk's buffer AND a base64 copy per in-flight call, on a box that has
// already been OOM-killed once (see the video-stitch milestone in AGENTS.md).
//
// Within a chunk the calls run concurrently in their own lane (`lane: 'ocr'` →
// OCR_MAX_CONCURRENCY) rather than behind the pipeline's serializing
// OPENAI_MAX_CONCURRENCY=1 gate. Retries and the server's own rate-limit waits still come
// from openai-request.ts; the lane changes how many are in flight, nothing else.
//
// WHAT THE MODEL ACTUALLY SEES. A PDF handed to OpenAI as a file input arrives as each
// page's RENDERED IMAGE alongside its extracted text. That matters more than it sounds: the
// documents that prompted this change are typeset in a legacy Marathi font whose embedded
// text layer decodes to convincing junk — नोंदणी comes out as `नोंिणी`, निर्णय as `ननणणय` — and a
// model reading only that text would faithfully reproduce the corruption (ChatGPT itself
// does, on this document). So the prompt says outright: where the two disagree, the picture
// wins. That is the one instruction here doing real work, and it is the first thing to check
// if garbled Devanagari ever comes back.
//
// A PER-PAGE FAILURE IS NOT A DOCUMENT FAILURE. sarvam-doc.ts fails the whole extraction on
// any chunk error, and had to: a Sarvam chunk is ten pages, so a partial result would be a
// document with ten pages silently missing. Here a failure costs exactly one page, so it is
// recorded as that page's empty text with a warning and the other nineteen are still
// delivered — the officer sees which page came back blank and can re-read it. The extraction
// fails only when NO page produced text, which is the "this did not work at all" case.

import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { openAiFetch } from '../http/openai-request.js';
import { recordChatUsage, type ChatUsage } from '../cost/cost-meter.js';
import { splitPdfPagesBySize } from './pdf-split.js';
import { type ExtractPdfOptions, type PdfPage } from './pdf-shared.js';

const CHAT_URL = 'https://api.openai.com/v1/chat/completions';

// Must be a model that accepts file input. Defaults to the vision tier, which is what every
// other pixel-reading call in this repo runs on.
export const OCR_MODEL = process.env.OPENAI_OCR_MODEL ?? 'gpt-5.6-terra';

// NO OUTPUT CEILING, deliberately. `max_completion_tokens` is not sent, so the model may
// emit up to its own maximum. There used to be an 8,000-token cap here sized for "one page
// of dense Marathi plus its tables", and it was the wrong shape of guard twice over: on
// gpt-5 that budget is SHARED with reasoning tokens, so raising reasoning_effort quietly ate
// the transcription's room, and an exhausted budget does not error — it truncates, which is
// the failure that hides. Billing is on tokens actually emitted, so an unused ceiling was
// never saving anything. `finish_reason: 'length'` is still checked below and now means
// something real: the model hit its OWN cap.

// How hard the model thinks before answering. UNSET by default, which sends no field.
//
// Wired here so the PDF path can be tuned without a code change — it previously read this
// variable only on the image path, so a deployment could set it and see no effect on PDFs at
// all. Worth knowing before reaching for it: 'high' was measured on the image path and did
// NOT fix Devanagari digits (see image-ocr.ts), which fits — transcription is perception,
// not deliberation. Reasoning effort cannot make obscured pixels clearer.
const OCR_REASONING_EFFORT = process.env.OPENAI_OCR_REASONING_EFFORT?.trim();

// The biggest request we will build, which is what bounds a context chunk.
//
// Budgeted against the RAW PDF, so the base64 the transport actually sends is ~4/3 of it —
// that inflation is why this is not simply the API's request cap. The remaining margin
// covers the JSON envelope and the prompt, both small beside a scan.
const OCR_MAX_REQUEST_BYTES = Number.parseInt(
  process.env.OPENAI_OCR_MAX_REQUEST_BYTES ?? `${50 * 1024 * 1024}`,
  10,
);
const CHUNK_MAX_BYTES =
  Math.floor((OCR_MAX_REQUEST_BYTES * 3) / 4) - 256 * 1024;

const PAGE_TIMEOUT_MS = Number.parseInt(
  process.env.OPENAI_OCR_TIMEOUT_MS ?? `${5 * 60_000}`,
  10,
);

// The read the officers were doing by hand. Written as instructions about FIDELITY first and
// formatting second, because everything downstream — the glossary name lock, the designation
// pass, the never-invent rule the article prompt rests on — treats this text as the source
// document itself and cannot tell a helpful paraphrase from what was printed.
// `subject` is what the model is looking at, and there are three because three backends read
// the same material in three shapes:
//   'page'      one rendered PDF page, with its neighbours attached as context (this file).
//   'image'     a PHOTOGRAPH of a page (intake/image-ocr.ts), so an officer's phone snap of a
//               GR is held to exactly the same fidelity rules as the same GR uploaded as a PDF.
//   'document'  the WHOLE document in one call, answering with one entry per page
//               (intake/gemini-doc.ts, whose model takes up to 1,000 pages at once).
// Only the opening lines and ONE fidelity bullet differ — everything about names, numerals,
// tables and format is common, which is the reason this is a parameter rather than three
// prompts free to drift apart.
//
// THE PROMPT DOES NOT ASK FOR MARATHI, AND MUST NOT. It used to open "…into Marathi text" and
// close with "Transcribe this page as Marathi Markdown", which left an English or bilingual
// document — an English annexure, a central-government letter, a GR with an English schedule —
// only two ways to answer: translate it (silently replacing the source of truth this whole
// product rests on) or return nothing. Returning nothing is what happened: every page came back
// empty, extractPdfPagesViaOpenAI threw, that failed the file, and the intake died on
// "कोणत्याही फाईलमधून मजकूर मिळाला नाही". The rule is TRANSCRIBE WHAT IS PRINTED, in the
// language and script it is printed in — which is the same instruction Marathi always needed,
// just stated without naming one language. Every Marathi-specific guarantee below (the legacy
// non-Unicode font rule, the Devanagari numeral rules, [अस्पष्ट]) is untouched.
export function ocrSystemPrompt(
  subject: 'page' | 'image' | 'document' = 'page',
): string {
  return [
    'You transcribe pages of official Government of Maharashtra documents.',
    ...(subject === 'image'
      ? [
          'You are given ONE image — a photograph, scan or screenshot of an official document,',
          'notice, letter, table or page. Return what it shows and nothing else.',
        ]
      : subject === 'document'
        ? [
            'You are given a complete document and asked to transcribe ALL of it, one entry per',
            'page, in the order the pages appear.',
            '',
            'ONE ENTRY PER PAGE, ALWAYS. You are told how many pages the document has and your',
            'answer must have exactly that many entries. A page that is blank returns an EMPTY',
            'entry — never skip it, never merge two pages into one entry, and never split one',
            "page's content across two.",
            '',
            'THE OTHER PAGES ARE CONTEXT FOR READING, NOT CONTENT TO MOVE. They are the same',
            'document, so where one page is smudged, faint, creased or obscured — by a signature',
            'written over it, a scanner streak, a fold — another page very often prints the same',
            'name, designation, office, scheme name or term clearly. Use them for that, and only',
            'that. Each entry contains ONLY what is printed on its own page: never carry a fact',
            'from page 4 onto page 2 because it would fit there.',
          ]
        : [
            'You are given a document and asked for ONE page of it. Return that page and',
            'nothing else.',
            '',
            'THE OTHER PAGES ARE CONTEXT, NOT PART OF YOUR ANSWER. They are the same document,',
            'so where the page you were asked for is smudged, faint, creased or obscured — by a',
            'signature written over it, a scanner streak, a fold — the other pages very often',
            'print the same name, designation, office, scheme name or term clearly. Use them for',
            'that, and only that. Never transcribe them, never continue into them, and never',
            'carry a fact from them onto this page: if something is on page 4 and not on the page',
            'you were asked for, it does not belong in your answer.',
          ]),
    '',
    'FIDELITY — this is not a summary, not a rewrite and NEVER a translation:',
    `- Transcribe what is on the ${subject === 'image' ? 'image' : 'page'}. Never add, infer, complete or explain anything.`,
    '- Reproduce every word in the LANGUAGE AND SCRIPT it is printed in. Marathi stays Marathi in',
    '  Devanagari; English stays English in Latin; a page carrying both keeps both, line for line,',
    '  in the order they appear. Most of these documents are Marathi, but many are English or',
    '  bilingual and those are equally valid — never translate, transliterate or "correct" a page',
    '  into another language, and never skip or blank a page because it is not in Marathi.',
    '- Names, designations, scheme names, dates, amounts, percentages and every numeral must',
    '  appear exactly as printed, in the script they are printed in. Do not convert Devanagari',
    '  numerals to Latin or the reverse, and never restate a figure in your own words.',
    ...(subject === 'image'
      ? [
          // A photograph is taken by hand: it can be angled, shadowed, cropped or blurred, and
          // the failure that matters is a plausible GUESS at a name or a figure, not a gap.
          '- The photograph may be angled, shadowed, creased or out of focus. Read only what is',
          '  actually legible, and never reconstruct a word, a name or a number from a partial',
          '  or blurred impression of it.',
          // The measured failure mode, and the one with consequences: on a real test page the
          // prose came back perfect while ५०→७०, ६५.५→६६.५ and ११→३१ went through unremarked.
          // A wrong amount or date in a government article is worse than a missing one, so the
          // instruction is to slow down per digit and to admit a doubtful one.
          '- DIGITS DESERVE A SECOND LOOK. Devanagari numerals are easily confused with one',
          '  another — ५/६, ९/०, १/३, ७/९ — and a wrong amount, date or count is far worse than',
          '  an admitted gap. Read every numeral digit by digit rather than recognising the',
          '  number at a glance, and where a single digit is not clearly legible write [अस्पष्ट]',
          '  in place of that figure instead of the closest-looking one.',
          '- Describe nothing. Do not caption the photograph, do not say what it depicts and do',
          '  not comment on its quality. If it carries no readable text at all, return an empty',
          '  answer.',
        ]
      : [
          '- The page may embed corrupted text (a legacy non-Unicode Marathi font). Read the page as',
          '  it LOOKS. Where the rendered page and any embedded text disagree, the rendered page is',
          '  correct — on a Marathi page that means correctly spelled Marathi, e.g. नोंदणी and निर्णय,',
          '  never नोंिणी or ननणणय.',
          // The measured failure this whole context mechanism was built for: a signature block
          // whose printed name was covered by the signature came back as a DIFFERENT, entirely
          // plausible name that appears nowhere in the document. A confident wrong name is far
          // worse than an admitted gap, and this bullet is the instructed half of that guard.
          '- NEVER RECONSTRUCT A NAME OR A NUMBER you cannot actually read. Names, designations and',
          '  figures are routinely obscured on these documents — a signature written across the',
          '  name below it, a stamp, a fold. Where that happens, look for the same name elsewhere',
          '  in the document and use what is printed there; if it appears nowhere legibly, write',
          '  [अस्पष्ट]. Do not supply a name that merely fits the office, the department or the',
          '  shape of the writing — a plausible invented signatory is the worst answer you can give.',
        ]),
    `- If part of the ${subject === 'image' ? 'image' : 'page'} is genuinely illegible, write [अस्पष्ट] there. Do not guess.`,
    '',
    'FORMAT — plain Markdown:',
    '- Headings as Markdown headings, lists as Markdown lists.',
    '- TABLES AS MARKDOWN TABLES, with every row and column kept. A table is the reason this',
    '  step exists: never flatten one into a paragraph or a run of loose numbers.',
    '- Join lines that the page merely wrapped, so sentences and names are not split.',
    '- Omit running headers, running footers, the page number and scan artefacts.',
    '- No preamble, no commentary, no code fences around the whole answer.',
    '- An entirely blank page returns an empty answer.',
  ].join('\n');
}

const SYSTEM_PROMPT = ocrSystemPrompt('page');

type ChatResponse = {
  choices: Array<{
    message: { content: string | null };
    finish_reason?: string;
  }>;
  usage?: ChatUsage;
};

// Strip a fence the model wrapped the whole page in despite being told not to. Only when it
// encloses the ENTIRE answer — a fenced block inside the page is the page's own content.
// Exported for image-ocr.ts, which reads the same kind of answer from the same model.
export function unwrapWholeAnswerFence(text: string): string {
  const match = text.trim().match(/^```[a-zA-Z]*\n([\s\S]*)\n```$/);
  return match?.[1] ?? text;
}

// Reads ONE page out of a chunk that is sent whole as context.
//
// `position` is 1-based WITHIN THE CHUNK, which is what the model sees — the chunk is its
// own little document, renumbered from 1. Mapping that back to the real page number is the
// caller's job (chunk.originalPages[position - 1]) and is deliberately never asked of the
// model: a model-reported page number is a number that can disagree with us.
//
// `fileData` is the chunk's base64 data URI, built once per chunk and shared by all of its
// page calls — at 400 pages, encoding it per call is how this runs the box out of memory.
async function readPageOfChunk(
  label: string,
  fileData: string,
  position: number,
  chunkPageCount: number,
  timeoutMs: number,
): Promise<string> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    throw new Error(
      'Missing required environment variable OPENAI_API_KEY. ' +
        'Copy .env.example to .env and fill it in.',
    );
  }

  const response = await openAiFetch(CHAT_URL, {
    label: 'pdf page',
    apiKey: key,
    lane: 'ocr',
    timeoutMs,
    body: {
      model: OCR_MODEL,
      // No max_completion_tokens — see the constant block above.
      ...(OCR_REASONING_EFFORT
        ? { reasoning_effort: OCR_REASONING_EFFORT }
        : {}),
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            {
              // The file part comes FIRST and is byte-identical across every call for this
              // chunk, so the shared prefix is cache-eligible; only the short instruction
              // below differs per page. Keep that order if you touch this.
              type: 'file',
              file: {
                // A Devanagari display name is legal here, but a plain ASCII one keeps the
                // request body predictable and the name is never shown to anyone.
                filename: 'document.pdf',
                file_data: fileData,
              },
            },
            {
              type: 'text',
              // Says Markdown, never a language: the system prompt's rule is that the page's own
              // language and script come back unchanged, and naming one here would override it.
              text:
                chunkPageCount === 1
                  ? 'Transcribe this page as Markdown, following your instructions exactly.'
                  : `This document has ${chunkPageCount} pages. Transcribe page ${position} as Markdown, ` +
                    `following your instructions exactly. Return only page ${position}; the other ` +
                    `pages are context.`,
            },
          ],
        },
      ],
    },
  });

  const body = (await response.json()) as ChatResponse;
  recordChatUsage(OCR_MODEL, body.usage);

  const finish = body.choices[0]?.finish_reason;
  if (finish === 'length') {
    // No ceiling is sent any more, so this now means the MODEL's own cap was reached —
    // a real signal rather than our budget having been set too small.
    console.warn(
      `[openai-doc] ${label}: hit the model's output limit (finish_reason: length) — its tail may be missing.`,
    );
  }
  return unwrapWholeAnswerFence(body.choices[0]?.message.content ?? '').trim();
}

// Reads a PDF page by page through OpenAI. Same contract as extractPdfPagesViaOcr in
// sarvam-doc.ts: pages carry the ORIGINAL document's numbers, `options.pages` restricts the
// read to the user's selection (a page nobody selected is a page nobody pays for), and a
// total failure throws with a message the DLO caller records against that one file.
export async function extractPdfPagesViaOpenAI(
  name: string,
  data: Buffer,
  options?: ExtractPdfOptions,
): Promise<PdfPage[]> {
  const timeoutMs = options?.timeoutMs ?? PAGE_TIMEOUT_MS;
  // Chunks are as large as the request cap allows, because a chunk IS the context every one
  // of its pages is read against. There is no page-count ceiling: a 400-page document is 400
  // reads and that is the officer's decision to make, not this function's.
  const chunks = await splitPdfPagesBySize(
    data,
    CHUNK_MAX_BYTES,
    options?.pages,
  );
  const pageCount = chunks.reduce(
    (total, chunk) => total + chunk.originalPages.length,
    0,
  );
  console.log(
    `[openai-doc] ${name}: ${pageCount} page(s) in ${chunks.length} context chunk(s) on ${OCR_MODEL}.`,
  );

  let pagesDone = 0;
  const failures: number[] = [];
  const pages: PdfPage[] = [];

  // ONE CHUNK AT A TIME, all of its pages at once. Sequential across chunks is a memory
  // bound, not a throughput choice: only the chunk being read is encoded and held, so peak
  // memory is one chunk regardless of whether the document is 2 pages or 400. Within a chunk
  // every page is dispatched together and the 'ocr' lane bounds how many are really in
  // flight.
  for (const chunk of chunks) {
    const fileData = `data:application/pdf;base64,${chunk.data.toString('base64')}`;
    const chunkPageCount = chunk.originalPages.length;

    const read = await Promise.all(
      chunk.originalPages.map(async (pageNumber, index): Promise<PdfPage> => {
        const label = `${name} (पृष्ठ ${pageNumber})`;
        // `index + 1` is this page's POSITION IN THE CHUNK, which is the only page number the
        // model is ever shown; `pageNumber` is its real one and is what the answer is filed
        // under. Keeping those two apart is what makes page identity exact by construction.
        let page: PdfPage;
        try {
          const text = await readPageOfChunk(
            label,
            fileData,
            index + 1,
            chunkPageCount,
            timeoutMs,
          );
          page = { page: pageNumber, text };
        } catch (error) {
          // One page, not the document. See the header.
          failures.push(pageNumber);
          console.warn(`[openai-doc] ${label} could not be read:`, error);
          page = { page: pageNumber, text: '' };
        }
        pagesDone += 1;
        options?.onProgress?.(pagesDone, pageCount);
        // Reported HERE, as this page lands, not after the chunk resolves — a chunk can hold
        // fifty pages, and waiting for all of them is exactly the spinner this callback
        // exists to remove. Advisory only, and never allowed to cost a page that has already
        // been read and paid for: a caller persisting these for a live UI must not be able to
        // sink the read.
        try {
          options?.onPage?.(page);
        } catch (error) {
          console.warn(`[openai-doc] ${name}: onPage callback threw:`, error);
        }
        return page;
      }),
    );

    pages.push(...read);
  }

  pages.sort((a, b) => a.page - b.page);

  if (pages.every((page) => page.text.length === 0)) {
    throw new Error(`${name}: OpenAI कडून या पृष्ठांचा मजकूर मिळाला नाही.`);
  }
  if (failures.length > 0) {
    console.warn(
      `[openai-doc] ${name}: ${failures.length} page(s) came back empty (${failures
        .sort((a, b) => a - b)
        .join(', ')}); the rest were read.`,
    );
  }
  return pages;
}

// Run against a real PDF to see what the model gives back per page. Costs money — one call
// per selected page — so prefer --pages while iterating on the prompt:
//
//   tsx --env-file=../../.env src/intake/openai-doc.ts <file.pdf> [--pages=2,5,9]
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const args = process.argv.slice(2);
  const file = args.find((arg) => !arg.startsWith('--'));
  const selection = args
    .find((arg) => arg.startsWith('--pages='))
    ?.slice('--pages='.length)
    .split(',')
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((page) => Number.isInteger(page));

  if (!file) {
    console.error(
      'usage: tsx --env-file=../../.env src/intake/openai-doc.ts <file.pdf> [--pages=2,5,9]',
    );
    process.exitCode = 1;
  } else {
    readFile(file)
      .then(async (data) => {
        const started = Date.now();
        const pages = await extractPdfPagesViaOpenAI(basename(file), data, {
          ...(selection ? { pages: selection } : {}),
          onProgress: (done, total) =>
            console.log(`  …${done}/${total} page(s)`),
        });
        console.log(
          `\n${OCR_MODEL} — ${pages.length} page(s) in ${((Date.now() - started) / 1000).toFixed(1)}s\n`,
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
