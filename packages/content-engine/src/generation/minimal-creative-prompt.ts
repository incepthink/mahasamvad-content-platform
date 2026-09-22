// Minimal creative poster prompt for testing.
// Contains ONLY:
// 1. "Make a creative poster for social media platforms in the size {width} × {height}."
// 2. Text accuracy rules
// 3. Text priority & readability (text takes priority over artwork/icons, large readable font for mobile)
// 4. Numbers rule (Devanagari numerals ०-९ only)
// 5. Do not use (logos, watermarks, maps)
// 6. Headline & margins (font scaled/wrapped to clear top-right badge)
// 7. Area rules (bottom text cushion)
// 8. The text to put on the poster
//
// No extra creative direction essay, no color palettes, no forced layout templates.

import { pathToFileURL } from 'node:url';

export const DEFAULT_POSTER_WIDTH = 1280;
export const DEFAULT_POSTER_HEIGHT = 1504;
export const DEFAULT_BADGE_WIDTH = 180;
export const DEFAULT_BADGE_HEIGHT = 170;
export const DEFAULT_BOTTOM_MARGIN = 16;

export type MinimalCreativePromptInput = Readonly<{
  text: string;
  width?: number | undefined;
  height?: number | undefined;
  bottomMargin?: number | undefined;
  badgeWidth?: number | undefined;
  badgeHeight?: number | undefined;
}>;

export const TEXT_ACCURACY_RULE = `TEXT ACCURACY:
- Preserve every अक्षर, मात्रा, जोडाक्षर and अनुस्वार in its correct position.
- Pay special attention to conjuncts such as “क्ती” and “र्दे”. Never separate, reorder, replace or omit their characters or matras.
- Words such as “व्यक्ती”, “शक्ती”, “युक्ती” and “निर्देश” must remain exactly as supplied.
- Do not rewrite, translate, autocorrect, abbreviate or approximate any word.
- Before finishing, compare every rendered word and number with the supplied content and correct all differences.`;

export const TEXT_PRIORITY_RULE = `TEXT PRIORITY & READABILITY:
- The text is the primary purpose of the poster and must take priority over artwork, illustrations, and decorative elements.
- The poster will be read on mobile phones: ensure all body text, bullet points, and cards use large, bold, easily readable font sizes with strong contrast against their background.
- Never shrink text into tiny unreadable lines to make room for giant icons or heavy illustrations.
- Keep icons compact and secondary so the written text has plenty of room to breathe and remains effortlessly readable at a glance.`;

export const NUMBERS_RULE = `NUMBERS:
- Use only Devanagari numerals: ० १ २ ३ ४ ५ ६ ७ ८ ९.
- Never use Western numerals: 0 1 2 3 4 5 6 7 8 9.`;

export const DO_NOT_USE_RULE = `DO NOT USE:
- Do not add or paint any logo, emblem, seal, QR code, government wordmark, or watermark.
- Do not include maps (no geographic maps, territory outlines, world maps, or country/state outlines).`;

// Backwards compatibility alias
export const NO_LOGOS_RULE = DO_NOT_USE_RULE;

export function buildHeadlineMarginsRule(
  badgeWidth: number = DEFAULT_BADGE_WIDTH,
  badgeHeight: number = DEFAULT_BADGE_HEIGHT,
): string {
  return `HEADLINE & MARGINS:
- An official emblem badge (${badgeWidth} × ${badgeHeight} px) is placed in the far top-right corner afterwards. Keep top headlines sized with comfortable breathing room so no text stretches into that top-right corner. If a headline is wide, reduce its font size or wrap it across multiple lines so it remains clear of that ${badgeWidth} × ${badgeHeight} px corner area.`;
}

export const HEADLINE_MARGINS_RULE = buildHeadlineMarginsRule();

export function buildAreaRule(
  width: number,
  height: number,
  bottomMargin: number = DEFAULT_BOTTOM_MARGIN,
): string {
  const bottomY = height - bottomMargin;
  return `AREA RULES:
- Bottom margin: The footer is attached below the image and covers nothing. Extend the design to the bottom edge, but keep all text and icons above y=${bottomY} (at least ${bottomMargin} pixels above the bottom edge). Reflow or shrink content until everything fits.`;
}

export function buildMinimalCreativePrompt(
  input: MinimalCreativePromptInput,
): string {
  const width = input.width ?? DEFAULT_POSTER_WIDTH;
  const height = input.height ?? DEFAULT_POSTER_HEIGHT;
  const bottomMargin = input.bottomMargin ?? DEFAULT_BOTTOM_MARGIN;
  const badgeWidth = input.badgeWidth ?? DEFAULT_BADGE_WIDTH;
  const badgeHeight = input.badgeHeight ?? DEFAULT_BADGE_HEIGHT;
  const text = input.text.trim();

  const opening = `Make a creative poster for social media platforms in the size ${width} × ${height}.`;
  const areaRule = buildAreaRule(width, height, bottomMargin);
  const headlineMarginsRule = buildHeadlineMarginsRule(badgeWidth, badgeHeight);

  const sections = [
    opening,
    '',
    TEXT_ACCURACY_RULE,
    '',
    TEXT_PRIORITY_RULE,
    '',
    NUMBERS_RULE,
    '',
    DO_NOT_USE_RULE,
    '',
    headlineMarginsRule,
    '',
    areaRule,
  ];

  if (text) {
    sections.push('', 'TEXT TO PUT ON THE POSTER:', text);
  }

  return sections.join('\n');
}

// ---------------------------------------------------------------------------
// Direct execution harness:
//   npx tsx packages/content-engine/src/generation/minimal-creative-prompt.ts
//   npx tsx packages/content-engine/src/generation/minimal-creative-prompt.ts --render
// ---------------------------------------------------------------------------
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const sampleText = `मंत्रिमंडळ निर्णय
राज्यातील २५ लाख शेतकऱ्यांना सौर कृषी पंप वाटप
• दिवसा अखंड वीजपुरवठा उपलब्ध होणार
• सौर ऊर्जेवर चालणाऱ्या पंपांसाठी ९०% पर्यंत अनुदान
• नोंदणी व अधिक माहितीसाठी mahadiscom.in ला भेट द्या`;

  const prompt = buildMinimalCreativePrompt({
    text: sampleText,
  });

  console.log('=== ASSEMBLED MINIMAL PROMPT ===\n');
  console.log(prompt);
  console.log('\n================================');

  const shouldRender = process.argv.includes('--render');
  if (shouldRender) {
    console.log('\n[render] Rendering test poster via OpenAI Image API...');
    const { generateImage } = await import('@dgipr/poster-renderer');
    const fs = await import('node:fs/promises');
    const path = await import('node:path');

    const png = await generateImage(prompt, { size: '1280x1504' });
    const outPath = path.resolve(process.cwd(), 'minimal-test-poster.png');
    await fs.writeFile(outPath, png);
    console.log(`[render] Wrote test poster to ${outPath}`);
  }
}
