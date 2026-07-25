// Render a generated article as a printable A4 PDF: load the brand assets, build the
// self-contained HTML document, print it with Chromium. The twin of
// generate-article-poster.ts, and the only entry point apps/api needs.
//
// Nothing is stored — the PDF is produced on demand and streamed. A stored copy would go
// stale the moment the article is revised (and the public bucket is CDN-cached besides).

import { loadArticlePdfAssets } from './assets.js';
import {
  buildArticlePdfHtml,
  A4_MARGIN,
  type ArticlePdfLanguage,
} from './article-pdf-template.js';
import { renderHtmlToPdf } from './render-html.js';

export type GenerateArticlePdfInput = Readonly<{
  article: string;
  // generations.heading — the officer's optional editorial angle. Often null; the document
  // then simply has no title.
  heading?: string | null;
  createdAt: string;
  language?: ArticlePdfLanguage;
}>;

export async function generateArticlePdf(
  input: GenerateArticlePdfInput,
): Promise<Buffer> {
  const assets = await loadArticlePdfAssets();
  const html = buildArticlePdfHtml({
    article: input.article,
    heading: input.heading ?? null,
    createdAt: input.createdAt,
    language: input.language ?? 'mr',
    assets,
  });
  return renderHtmlToPdf(html, { format: 'A4', margin: A4_MARGIN });
}
