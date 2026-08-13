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
// ONE CALL PER PAGE, RUN IN PARALLEL. Page identity is the thing this codebase guards
// hardest — a page number that silently shifts translates the wrong pages, and it has
// happened here before — so each call is handed exactly ONE page and its answer is filed
// under the page number that page came from. There is no model-reported page number to
// disagree with us, no `---` rule to split on, no metadata to reconcile: the arithmetic that
// sarvam-doc.ts needs an entire header comment to justify does not exist here.
//
// The cost of that choice is latency, which is why the calls run concurrently in their own
// lane (`lane: 'ocr'` → OCR_MAX_CONCURRENCY, default 4) rather than behind the pipeline's
// serializing OPENAI_MAX_CONCURRENCY=1 gate. Retries and the server's own rate-limit waits
// still come from openai-request.ts; the lane changes how many are in flight, nothing else.
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
import { OCR_MAX_TOTAL_PAGES, splitPdfPages } from './pdf-split.js';
import { type ExtractPdfOptions, type PdfPage } from './pdf-shared.js';

const CHAT_URL = 'https://api.openai.com/v1/chat/completions';

// Must be a model that accepts file input. Defaults to the vision tier, which is what every
// other pixel-reading call in this repo runs on.
export const OCR_MODEL = process.env.OPENAI_OCR_MODEL ?? 'gpt-5.6-terra';

// Room for ONE page of dense Marathi plus its tables. Devanagari runs ~1 token per 1.2-1.8
// characters, so a full A4 page of text is ~2-3k tokens and a table-heavy one more; billing
// is on tokens emitted, so an unused ceiling costs nothing while an exhausted one comes back
// as truncated output (which, in this repo's history, is the failure that hides).
const PAGE_MAX_TOKENS = 8_000;

const PAGE_TIMEOUT_MS = Number.parseInt(
  process.env.OPENAI_OCR_TIMEOUT_MS ?? `${5 * 60_000}`,
  10,
);

// The read the officers were doing by hand. Written as instructions about FIDELITY first and
// formatting second, because everything downstream — the glossary name lock, the designation
// pass, the never-invent rule the article prompt rests on — treats this text as the source
// document itself and cannot tell a helpful paraphrase from what was printed.
// `subject` is what the model is looking at: a rendered PDF page, or a PHOTOGRAPH of one
// (intake/image-ocr.ts, which shares this prompt so an officer's phone snap of a GR is held to
// exactly the same fidelity rules as the same GR uploaded as a PDF). Only the opening two
// lines and ONE fidelity bullet differ — everything about names, numerals, tables and format
// is common, which is the reason this is a parameter rather than a second prompt free to drift.
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
export function ocrSystemPrompt(subject: 'page' | 'image' = 'page'): string {
  return [
    'You transcribe pages of official Government of Maharashtra documents.',
    ...(subject === 'image'
      ? [
          'You are given ONE image — a photograph, scan or screenshot of an official document,',
          'notice, letter, table or page. Return what it shows and nothing else.',
        ]
      : ['You are given ONE page. Return that page and nothing else.']),
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

// Read one page. `data` is a single-page PDF; `pageNumber` is only used for labelling.
async function readOnePage(
  label: string,
  data: Buffer,
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
      max_completion_tokens: PAGE_MAX_TOKENS,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            {
              type: 'file',
              file: {
                // A Devanagari display name is legal here, but a plain ASCII one keeps the
                // request body predictable and the name is never shown to anyone.
                filename: 'page.pdf',
                file_data: `data:application/pdf;base64,${data.toString('base64')}`,
              },
            },
            {
              type: 'text',
              // Says Markdown, never a language: the system prompt's rule is that the page's own
              // language and script come back unchanged, and naming one here would override it.
              text: 'Transcribe this page as Markdown, following your instructions exactly.',
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
    console.warn(
      `[openai-doc] ${label}: the page did not fit in ${PAGE_MAX_TOKENS} tokens (finish_reason: length) — its tail may be missing.`,
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
  // One page per chunk: that is what makes page identity exact rather than reconstructed.
  const chunks = await splitPdfPages(data, 1, options?.pages);

  if (chunks.length > OCR_MAX_TOTAL_PAGES) {
    throw new Error(
      `${name}: ${chunks.length} पृष्ठे वाचण्यासाठी खूप जास्त आहेत (कमाल ${OCR_MAX_TOTAL_PAGES}). कृपया कमी पृष्ठे निवडा.`,
    );
  }

  let pagesDone = 0;
  const failures: number[] = [];

  // Every page is dispatched at once; the 'ocr' lane in openai-request.ts is what actually
  // bounds how many are in flight. Progress is reported as pages LAND, so it does not
  // pretend to be ordered.
  const pages = await Promise.all(
    chunks.map(async (chunk): Promise<PdfPage> => {
      const pageNumber = chunk.originalPages[0] ?? 1;
      const label = `${name} (पृष्ठ ${pageNumber})`;
      try {
        const text = await readOnePage(label, chunk.data, timeoutMs);
        return { page: pageNumber, text };
      } catch (error) {
        // One page, not the document. See the header.
        failures.push(pageNumber);
        console.warn(`[openai-doc] ${label} could not be read:`, error);
        return { page: pageNumber, text: '' };
      } finally {
        pagesDone += 1;
        options?.onProgress?.(pagesDone, chunks.length);
      }
    }),
  );

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
