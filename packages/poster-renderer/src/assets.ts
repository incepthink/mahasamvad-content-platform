// Load the brand-constant assets the HTML poster template composites: the Devanagari
// webfont and the DGIPR header/footer frame (राजमुद्रा emblem top-right + footer band,
// transparent elsewhere). All are returned as base64 data URIs so the template is a single
// self-contained HTML string (no file:// or network fetches for Playwright to resolve).
// Paths resolve relative to this module, so it works whether it runs from dist/ (built) or
// src/ (tsx dev scripts).

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ASSETS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../assets');

export type BrandAssets = Readonly<{
  // @font-face src for Noto Sans Devanagari (variable, weights 100–900).
  fontDataUri: string;
  // Full-canvas transparent DGIPR frame: राजमुद्रा emblem + "महाराष्ट्र शासन" top-right and
  // the footer band (department line + social handles) bottom, overlaid on the poster.
  frameDataUri: string;
}>;

async function dataUri(file: string, mime: string): Promise<string> {
  const buf = await readFile(resolve(ASSETS_DIR, file));
  return `data:${mime};base64,${buf.toString('base64')}`;
}

export async function loadBrandAssets(): Promise<BrandAssets> {
  const [fontDataUri, frameDataUri] = await Promise.all([
    dataUri('fonts/NotoSansDevanagari.ttf', 'font/ttf'),
    dataUri('poster-header-footer.png', 'image/png'),
  ]);
  return { fontDataUri, frameDataUri };
}

// The landscape article frame (article-header-footer.png): महासंवाद logo floats top-left, an
// opaque navy department pill + full-width white social strip at the bottom, transparent
// everywhere else. Used by the landscape article poster (article-template.ts); loadBrandAssets
// above keeps loading the portrait poster frame.
export async function loadArticleAssets(): Promise<BrandAssets> {
  const [fontDataUri, frameDataUri] = await Promise.all([
    dataUri('fonts/NotoSansDevanagari.ttf', 'font/ttf'),
    dataUri('article-header-footer.png', 'image/png'),
  ]);
  return { fontDataUri, frameDataUri };
}
