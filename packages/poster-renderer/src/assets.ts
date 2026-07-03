// Load the brand-constant assets the HTML poster template composites: the Devanagari
// webfont, the राजमुद्रा emblem and the DGIPR footer band. All are returned as base64
// data URIs so the template is a single self-contained HTML string (no file:// or
// network fetches for Playwright to resolve). Paths resolve relative to this module, so
// it works whether it runs from dist/ (built) or src/ (tsx dev scripts).

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ASSETS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../assets');

export type BrandAssets = Readonly<{
  // @font-face src for Noto Sans Devanagari (variable, weights 100–900).
  fontDataUri: string;
  // Cropped emblem + "महाराष्ट्र शासन" caption (goes in the header chip).
  emblemDataUri: string;
  // Full-width DGIPR footer band (teal line + social-handle strip).
  footerDataUri: string;
}>;

async function dataUri(file: string, mime: string): Promise<string> {
  const buf = await readFile(resolve(ASSETS_DIR, file));
  return `data:${mime};base64,${buf.toString('base64')}`;
}

export async function loadBrandAssets(): Promise<BrandAssets> {
  const [fontDataUri, emblemDataUri, footerDataUri] = await Promise.all([
    dataUri('fonts/NotoSansDevanagari.ttf', 'font/ttf'),
    dataUri('emblem.png', 'image/png'),
    dataUri('footer-band.png', 'image/png'),
  ]);
  return { fontDataUri, emblemDataUri, footerDataUri };
}
