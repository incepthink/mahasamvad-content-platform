// Translate an OCR'd PDF page by page, into English or Hindi.
//
// Why pages rather than one concatenated blob: the /translate PDF path lets the user pick
// which pages to translate and shows the result page by page, so page boundaries have to
// survive the translation. Translating each page on its own keeps them intact for free —
// and gives progress the user can read ("page 7 of 20") instead of an opaque block index.
//
// The other reason this file exists is MIXED-LANGUAGE documents. A Marathi PDF routinely
// carries a few English pages (an annexure, a circular), and feeding those to the
// Marathi→X paths is wrong in two different ways:
//
//   - target English: the mr→en chat model would REWRITE already-English prose. That is a
//     silent paraphrase of an official document, so an English page is passed through
//     byte-for-byte instead. A translation of English into English is not a translation.
//   - target Hindi: the page genuinely needs translating, just from a different source —
//     the same Sarvam endpoint with source en-IN (see translateArticle's sourceLanguage).
//
// Everything else — block splitting, the LOCKED TERMS table, the degeneracy guard, the
// Hindi name enforcement — belongs to translateArticle and is reused unchanged.

import type { TranslationLanguage } from '@dgipr/schemas';
import { translateArticle, type GlossaryEntry } from './translate-article.js';
import { detectProofreadLanguage } from './proof-read.js';

// One page in, one page out. `page` is the 1-based source page number and is preserved so
// the UI can label the output; `mode` says whether the text was translated or copied
// through, which the UI marks so nobody mistakes a passthrough page for a failure.
export type DocumentPageInput = Readonly<{ page: number; text: string }>;

export type TranslatedDocumentPage = Readonly<{
  page: number;
  text: string;
  mode: 'translated' | 'passthrough';
  // Locked names this page's Hindi output could not be made to carry (see
  // translateArticle). Always empty for English and for passthrough pages.
  unpreservedNames: readonly string[];
}>;

export type TranslateDocumentOptions = Readonly<{
  // Called once before each page (0-based) and once more at completion
  // (pageIndex === pageCount), mirroring translateArticle's onProgress contract.
  onProgress?: (pageIndex: number, pageCount: number) => void;
  // Called with each page the moment it is done. A document is many minutes and many
  // billed calls, so a caller that wants to keep finished pages when a LATER page throws
  // has to be handed them as they land — the return value only exists if every page
  // succeeds, which is exactly the case where nothing needed saving.
  onPage?: (page: TranslatedDocumentPage) => void;
}>;

// Which language a page is written in. Deterministic (Devanagari-vs-Latin letter ratio),
// shared with the proofreader so one document can never be classified two ways.
export function detectPageLanguage(text: string): 'mr' | 'en' {
  return detectProofreadLanguage(text);
}

export async function translateDocumentPages(
  pages: readonly DocumentPageInput[],
  glossary: readonly GlossaryEntry[],
  language: TranslationLanguage,
  options?: TranslateDocumentOptions,
): Promise<TranslatedDocumentPage[]> {
  const onProgress = options?.onProgress ?? (() => {});
  const onPage = options?.onPage ?? (() => {});
  const translated: TranslatedDocumentPage[] = [];

  const finish = (page: TranslatedDocumentPage) => {
    translated.push(page);
    onPage(page);
  };

  for (const [index, page] of pages.entries()) {
    onProgress(index, pages.length);
    const sourceLanguage = detectPageLanguage(page.text);

    if (language === 'en' && sourceLanguage === 'en') {
      finish({
        page: page.page,
        text: page.text,
        mode: 'passthrough',
        unpreservedNames: [],
      });
      continue;
    }

    const result = await translateArticle(page.text, glossary, language, {
      sourceLanguage,
    });
    finish({
      page: page.page,
      text: result.text.trim(),
      mode: 'translated',
      unpreservedNames: result.unpreservedNames,
    });
  }

  onProgress(pages.length, pages.length);
  return translated;
}

// Flatten a translated document into one downloadable text, page markers included so a
// reader can line the output up against the source PDF.
export function joinTranslatedPages(
  pages: readonly TranslatedDocumentPage[],
  pageLabel = 'Page',
): string {
  return pages
    .map((page) => `--- ${pageLabel} ${page.page} ---\n\n${page.text}`)
    .join('\n\n');
}
