// Offline preview of the printable article PDF — no API, no OpenAI, no Supabase, no n8n.
// This is the free loop for tuning src/article-pdf-template.ts (letterhead, margins,
// typography, justification, page breaks).
//
//   pnpm --filter @dgipr/poster-renderer pdf:preview
//   pnpm --filter @dgipr/poster-renderer pdf:preview article.txt --heading="…"
//   pnpm --filter @dgipr/poster-renderer pdf:preview --lang=en
//   pnpm --filter @dgipr/poster-renderer pdf:preview --html      # raw HTML, for Ctrl+P
//
// With no file argument a built-in sample is used, so the harness works on a fresh clone
// with zero setup. The Marathi sample is deliberately loaded with the hard cases — क्ती,
// ऱ्या, ट्र, द्ध, ज्ञ, श्री, हृ, Devanagari numerals, a very long scheme name to stress
// justification, and a one-line paragraph to check widow/orphan behaviour.
//
// --html writes the HTML instead of the PDF: open it in Chrome, Ctrl+P, and tweak CSS in
// DevTools with print-media emulation on — the fastest loop of all. It matches page.pdf()
// because the template's @page block interpolates the same A4_MARGIN.
//
// --png writes page 1 as an image, for a quick look (or a docs screenshot) on a machine with
// no PDF rasteriser installed. The page padding is derived from the SAME A4_MARGIN the real
// PDF is printed with, so the two cannot drift.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadArticlePdfAssets } from '../src/assets.js';
import {
  buildArticlePdfHtml,
  A4_MARGIN,
  type ArticlePdfLanguage,
} from '../src/article-pdf-template.js';
import { renderHtmlToPdf, renderHtmlToPng } from '../src/render-html.js';

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT_DIR = resolve(here, '../../content-engine/data/output');

// A4 at CSS's 96 dpi. Chromium resolves the mm padding below against the same scale, so the
// screenshot is a true-to-size page 1.
const A4_PX = { width: 794, height: 1123 } as const;

const SAMPLE_MR = `मुंबई, दि. २५ : राज्यातील शेतकऱ्यांना दिलासा देणाऱ्या पुण्यश्लोक अहिल्यादेवी होळकर शेतकरी कर्जमुक्ती योजना २०२६ अंतर्गत आतापर्यंत ५०० कोटी रुपयांचे वाटप पूर्ण झाले असल्याची माहिती मुख्यमंत्र्यांनी विधानसभेत दिली.

या योजनेच्या अंमलबजावणीसाठी जिल्हास्तरीय समित्या स्थापन करण्यात आल्या असून, प्रत्येक जिल्ह्यात विशेष कक्ष कार्यरत आहे. लाभार्थ्यांची निवड पारदर्शक पद्धतीने केली जात असून, ऑनलाईन अर्ज प्रक्रिया ३१ ऑगस्ट २०२६ पर्यंत सुरू राहणार आहे.

विद्यार्थ्यांच्या शैक्षणिक गरजा लक्षात घेऊन स्वतंत्र निधीची तरतूद करण्यात आली आहे. श्री. संजय पाटील यांच्या अध्यक्षतेखालील समितीने सादर केलेल्या अहवालातील शिफारशी स्वीकारण्यात आल्या असून, त्यानुसार निर्णय घेण्यात आला.

महाराष्ट्र राज्य सहकारी बँकेमार्फत २ कोटी रुपयांचा निधी वितरित करण्यात येणार आहे. या संदर्भातील शासन निर्णय लवकरच निर्गमित करण्यात येईल.

ज्ञानज्योती सावित्रीबाई फुले आधार योजनेच्या धर्तीवर ही योजना राबविण्यात येत आहे. हृदयरोग तसेच इतर गंभीर आजारांवरील उपचारांसाठीही स्वतंत्र तरतूद करण्यात आली आहे.

अधिक माहितीसाठी नागरिकांनी संबंधित तहसील कार्यालयाशी संपर्क साधावा, असे आवाहन करण्यात आले आहे.`;

const SAMPLE_EN = `Mumbai, 25: The state government has completed the disbursement of Rs 500 crore under the Punyashlok Ahilyadevi Holkar Farmer Loan Waiver Scheme 2026, the Chief Minister informed the Legislative Assembly.

District-level committees have been constituted to implement the scheme, with a dedicated cell functioning in every district. Beneficiary selection is being carried out transparently, and the online application process will remain open until 31 August 2026.

Citizens seeking further information have been urged to contact their respective tehsil offices.`;

type Args = {
  file?: string;
  heading?: string;
  language: ArticlePdfLanguage;
  date: string;
  html: boolean;
  png: boolean;
};

function parseArgs(argv: string[]): Args {
  let file: string | undefined;
  let heading: string | undefined;
  let language: ArticlePdfLanguage = 'mr';
  // Fixed default so repeated previews are byte-comparable while tuning CSS.
  let date = '2026-07-25T09:30:00.000Z';
  let html = false;
  let png = false;

  for (const arg of argv) {
    if (arg === '--html') html = true;
    else if (arg === '--png') png = true;
    else if (arg.startsWith('--heading=')) heading = arg.slice('--heading='.length);
    else if (arg.startsWith('--lang=')) {
      const value = arg.slice('--lang='.length);
      if (value !== 'mr' && value !== 'en' && value !== 'hi') {
        throw new Error(`--lang must be mr|en|hi (got "${value}")`);
      }
      language = value;
    } else if (arg.startsWith('--date=')) date = arg.slice('--date='.length);
    else if (!arg.startsWith('--')) file = arg;
  }

  return { file, heading, language, date, html, png };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  let article: string;
  let outBase: string;
  if (args.file) {
    const full = resolve(args.file);
    article = await readFile(full, 'utf8');
    outBase = full.replace(/\.[^.]+$/, '') + '.pdf-preview';
  } else {
    article = args.language === 'en' ? SAMPLE_EN : SAMPLE_MR;
    await mkdir(DEFAULT_OUT_DIR, { recursive: true });
    outBase = join(DEFAULT_OUT_DIR, `article-pdf-preview-${args.language}`);
  }

  const assets = await loadArticlePdfAssets();
  const doc = buildArticlePdfHtml({
    article,
    heading: args.heading ?? null,
    createdAt: args.date,
    language: args.language,
    assets,
  });

  if (args.html) {
    const outPath = `${outBase}.html`;
    await writeFile(outPath, doc, 'utf8');
    console.log(`Wrote ${outPath}`);
    console.log('Open it in Chrome and press Ctrl+P to preview the print layout.');
    return;
  }

  if (args.png) {
    // @page margins are inert in a screenshot, so re-apply the SAME constant as body
    // padding. Both are mm against CSS's 96 dpi, so page 1 comes out true to size.
    const shot = doc.replace(
      '</style>',
      `  body { padding: ${A4_MARGIN.top} ${A4_MARGIN.right} ${A4_MARGIN.bottom} ${A4_MARGIN.left}; background: #fff; }
</style>`,
    );
    const png = await renderHtmlToPng(shot, {
      width: A4_PX.width,
      height: A4_PX.height,
      deviceScaleFactor: 2,
    });
    const outPath = `${outBase}.png`;
    await writeFile(outPath, png);
    console.log(`Wrote ${outPath} (page 1 only)`);
    return;
  }

  const pdf = await renderHtmlToPdf(doc, { format: 'A4', margin: A4_MARGIN });
  const outPath = `${outBase}.pdf`;
  await writeFile(outPath, pdf);
  console.log(`Wrote ${outPath} (${(pdf.length / 1024).toFixed(0)} KB)`);
  // A rasterised A4 page would be several MB; this is the cheap proof the text stayed vector.
  console.log(
    'Check: conjuncts (क्ती ऱ्या ट्र द्ध ज्ञ श्री हृ), Devanagari digits in the date line,',
  );
  console.log(
    '       letterhead on page 1 only, no page numbers, text selectable at 800% zoom.',
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
