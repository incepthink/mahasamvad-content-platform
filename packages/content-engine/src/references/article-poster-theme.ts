// Curated color palette for the article poster's curved headline panel. Every
// automatic render rotates through these so the poster stops always coming out
// orange (the old master's single hardcoded color). Only the side panel + its
// headline vary — the महासंवाद logo card, layout, and navy department footer stay
// fixed, so brand identity is preserved. The API ships the picked theme to the
// article-poster-v1-api n8n workflow, which recolours the panel accordingly; an
// empty/absent theme makes the workflow fall back to its original orange/maroon.

export type ArticlePosterTheme = Readonly<{
  // A plain English color name the image model recolours the panel to (e.g. 'deep teal').
  name: string;
  // Solid flat fill for the curved left headline panel.
  panelHex: string;
  // Headline text color, chosen for high contrast on the panel above.
  headlineHex: string;
}>;

// The first entry reproduces the current look; the rest are government-appropriate,
// saturated panels each paired with a high-contrast (dark-on-light or light-on-dark)
// headline so the Marathi headline stays crisply legible.
export const ARTICLE_POSTER_THEMES: readonly ArticlePosterTheme[] = [
  { name: 'saffron orange', panelHex: '#E8820C', headlineHex: '#7A1512' },
  { name: 'deep teal', panelHex: '#0F5E5A', headlineHex: '#FFFFFF' },
  { name: 'royal blue', panelHex: '#123A7A', headlineHex: '#FFFFFF' },
  { name: 'forest green', panelHex: '#1B5E20', headlineHex: '#FFF3E0' },
  { name: 'deep maroon', panelHex: '#7A1512', headlineHex: '#FFE0B2' },
  { name: 'royal purple', panelHex: '#4A148C', headlineHex: '#FFFFFF' },
  { name: 'terracotta brick', panelHex: '#B23A0F', headlineHex: '#FFF3E0' },
];

// Random pick, matching the reference-image rotation semantics (references/catalog.ts).
export function pickArticlePosterTheme(): ArticlePosterTheme {
  const index = Math.floor(Math.random() * ARTICLE_POSTER_THEMES.length);
  return ARTICLE_POSTER_THEMES[index] as ArticlePosterTheme;
}
