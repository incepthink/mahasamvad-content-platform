// Turn a free-text instruction about an uploaded PDF ("फक्त पृष्ठ १ ते ९ भाषांतरित करा",
// "skip the annexure", "only the farmer-scheme article") into a PAGE SELECTION.
//
// The deliberate limit: this resolves WHICH PAGES get translated and nothing else. It never
// becomes prompt text for the translator. That keeps the two target languages honest — the
// Hindi path goes through Sarvam's translate endpoint, which takes no prompt at all, so any
// instruction that shaped wording could only ever apply to English — and it keeps the
// faithfulness contract intact: a page is translated in full or not at all, never
// "summarized" or "made formal" by a side-channel.
//
// Two passes, cheapest first:
//   1. A deterministic parse of page numbers (Latin AND Devanagari digits). This is the
//      instruction users actually type, and it costs nothing and cannot hallucinate.
//   2. Only if that yields nothing: one gpt-4o-mini call with a short preview of each page,
//      so content-based asks ("only the article about crop loans") can resolve too.
//
// Whatever comes back is clamped to real page numbers in code, so a model that invents
// "page 47" of a 20-page document simply loses that entry. An empty result is returned as
// an empty selection — the caller shows an error and leaves the user's checkboxes alone.

import { pathToFileURL } from 'node:url';
import { chatComplete } from './openai-chat.js';

// What the caller knows about each page. `preview` is a short leading excerpt — enough for
// the model to recognize a topic, small enough that a 20-page document stays one cheap call.
export type DocumentPageSummary = Readonly<{
  page: number;
  chars: number;
  language: 'mr' | 'en';
  preview: string;
}>;

export type InterpretedDocumentInstruction = Readonly<{
  // 1-based page numbers to translate, ascending and deduped. Empty = not understood.
  pages: number[];
  // 'rule' = resolved by the numeric parser, 'model' = by the LLM pass.
  source: 'rule' | 'model';
  // The model's own one-line reading of the instruction (empty on the rule path).
  explanation: string;
}>;

const MODEL = 'gpt-4o-mini';
const PREVIEW_CHARS = 150;
export const INSTRUCTION_MAX_CHARS = 500;

// Page words in both scripts. The numeric parser only trusts bare numbers when one of these
// is present — otherwise "the 2024 scheme article" would read as a page number.
const PAGE_WORDS = /(page|pages|pg|पृष्ठ|पृष्ठे|पृष्ठां|पान|पाने|पानां|पृष्ट)/i;
const ALL_WORDS = /(all|every|entire|whole|complete|सर्व|संपूर्ण|पूर्ण|सगळ)/i;
const SKIP_WORDS = /(skip|except|exclude|omit|without|वगळ|सोडून|शिवाय|नको)/i;
const FIRST_WORDS = /(first|पहिल)/i;
const LAST_WORDS = /(last|शेवट|अखेर)/i;

// Devanagari digits (१२३) are what these users type; the parser works in Latin digits.
function toLatinDigits(text: string): string {
  return text.replace(/[०-९]/g, (digit) =>
    String(digit.charCodeAt(0) - 0x0966),
  );
}

function clampPages(pages: readonly number[], pageCount: number): number[] {
  const seen = new Set<number>();
  for (const page of pages) {
    if (Number.isInteger(page) && page >= 1 && page <= pageCount) {
      seen.add(page);
    }
  }
  return [...seen].sort((a, b) => a - b);
}

function range(from: number, to: number): number[] {
  const [start, end] = from <= to ? [from, to] : [to, from];
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

// The deterministic pass. Returns null when the instruction is not a page-number ask at all,
// so the caller knows to fall through to the model (an empty array would be indistinguishable
// from "understood, but nothing matched").
export function parsePageInstruction(
  instruction: string,
  pageCount: number,
): number[] | null {
  const text = toLatinDigits(instruction).trim();
  if (text.length === 0) return null;

  const allPages = range(1, pageCount);
  const numbers = [...text.matchAll(/\d+/g)].map((match) =>
    Number.parseInt(match[0], 10),
  );

  // "सर्व पृष्ठे" / "translate everything" — only when no numbers muddy the ask.
  if (ALL_WORDS.test(text) && numbers.length === 0) return allPages;

  if (numbers.length === 0) return null;

  // Bare numbers are only page numbers when the instruction says so.
  if (!PAGE_WORDS.test(text)) return null;

  // Which pages the instruction NAMES. Whether they are the ones to keep or the ones to
  // drop is decided once, at the end — "शेवटची २ पाने वगळा" names the last two and means
  // the other eighteen.
  const named: number[] = [];

  // "first 3 pages" / "शेवटची २ पाने" — a count, not a page number.
  const isCount =
    numbers.length === 1 && (FIRST_WORDS.test(text) || LAST_WORDS.test(text));
  if (isCount) {
    const count = Math.min(numbers[0]!, pageCount);
    named.push(
      ...(FIRST_WORDS.test(text)
        ? range(1, count)
        : range(pageCount - count + 1, pageCount)),
    );
  } else {
    // Ranges first (1-9, १ ते ९, 3 to 7), then any leftover single numbers.
    const consumed = new Set<number>();
    for (const match of text.matchAll(
      /(\d+)\s*(?:-|–|—|to|ते|पर्यंत|through)\s*(\d+)/gi,
    )) {
      const from = Number.parseInt(match[1]!, 10);
      const to = Number.parseInt(match[2]!, 10);
      named.push(...range(from, to));
      consumed.add(from);
      consumed.add(to);
    }
    for (const number of numbers) {
      if (!consumed.has(number)) named.push(number);
    }
  }

  const clamped = clampPages(named, pageCount);
  if (clamped.length === 0) return null;

  // "वगळा" inverts the selection: everything EXCEPT what was named.
  if (SKIP_WORDS.test(text)) {
    const excluded = new Set(clamped);
    const kept = allPages.filter((page) => !excluded.has(page));
    // Excluding everything is never what the user meant; let the model try instead.
    return kept.length > 0 ? kept : null;
  }
  return clamped;
}

function buildPrompt(
  instruction: string,
  pages: readonly DocumentPageSummary[],
): string {
  const lines = pages.map(
    (page) =>
      `Page ${page.page} (${page.language === 'en' ? 'English' : 'Marathi'}, ${page.chars} chars): ${page.preview
        .replace(/\s+/g, ' ')
        .slice(0, PREVIEW_CHARS)}`,
  );
  return [
    'You are helping a Government of Maharashtra officer choose WHICH PAGES of an uploaded',
    'PDF to translate. You do not translate anything and you do not change any wording —',
    'your only job is to turn the instruction into a list of page numbers.',
    '',
    `The document has ${pages.length} page(s). Here is the start of each page:`,
    ...lines,
    '',
    `INSTRUCTION (may be Marathi or English): «${instruction}»`,
    '',
    'RULES:',
    `- Answer with 1-based page numbers between 1 and ${pages.length} only.`,
    '- Select whole pages. A page is either translated in full or not at all.',
    '- If the instruction names a topic, include every page that continues that topic.',
    '- If the instruction asks to skip something, return all the OTHER pages.',
    '- If you genuinely cannot tell which pages are meant, return an empty list.',
    '',
    'Respond with STRICT JSON only: {"pages": [1, 2], "explanation": "one short sentence"}',
  ].join('\n');
}

export async function interpretDocumentInstruction(
  input: Readonly<{
    instruction: string;
    pages: readonly DocumentPageSummary[];
  }>,
): Promise<InterpretedDocumentInstruction> {
  const instruction = input.instruction.trim().slice(0, INSTRUCTION_MAX_CHARS);
  const pageCount = input.pages.length;
  if (instruction.length === 0 || pageCount === 0) {
    return { pages: [], source: 'rule', explanation: '' };
  }

  const ruled = parsePageInstruction(instruction, pageCount);
  if (ruled && ruled.length > 0) {
    return { pages: ruled, source: 'rule', explanation: '' };
  }

  const raw = await chatComplete(
    [{ role: 'user', content: buildPrompt(instruction, input.pages) }],
    {
      responseFormat: 'json_object',
      temperature: 0,
      model: MODEL,
      maxTokens: 500,
    },
  );

  let parsed: { pages?: unknown; explanation?: unknown };
  try {
    parsed = JSON.parse(raw) as { pages?: unknown; explanation?: unknown };
  } catch {
    console.warn(
      `[interpret-document-instruction] non-JSON reply: ${raw.slice(0, 200)}`,
    );
    return { pages: [], source: 'model', explanation: '' };
  }

  const pages = Array.isArray(parsed.pages)
    ? clampPages(
        parsed.pages.map((page) => Number(page)).filter(Number.isFinite),
        pageCount,
      )
    : [];
  return {
    pages,
    source: 'model',
    explanation:
      typeof parsed.explanation === 'string'
        ? parsed.explanation.trim().slice(0, 300)
        : '',
  };
}

// Eyeball the interpreter without a real PDF (the model pass needs OPENAI_API_KEY; the
// numeric ones answer offline):
//
//   tsx --env-file=../../.env src/generation/interpret-document-instruction.ts "फक्त पृष्ठ १ ते ९"
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const instruction = process.argv[2] ?? 'फक्त पृष्ठ १ ते ९ भाषांतरित करा';
  const SAMPLE_PAGES: DocumentPageSummary[] = Array.from(
    { length: 20 },
    (_, i) => ({
      page: i + 1,
      chars: 1800,
      language: i >= 17 ? ('en' as const) : ('mr' as const),
      preview:
        i >= 17
          ? 'Annexure: statement of expenditure for the financial year.'
          : i % 3 === 0
            ? 'शेतकऱ्यांना पीक कर्ज माफीचा लाभ; जिल्हाधिकारी यांनी माहिती दिली.'
            : 'मुख्यमंत्री यांच्या हस्ते नव्या योजनेचे उद्घाटन झाले.',
    }),
  );

  interpretDocumentInstruction({ instruction, pages: SAMPLE_PAGES })
    .then((result) => {
      console.log(`instruction: «${instruction}»`);
      console.log(`source: ${result.source}`);
      console.log(`pages: ${result.pages.join(', ') || '(none)'}`);
      if (result.explanation) console.log(`explanation: ${result.explanation}`);
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
