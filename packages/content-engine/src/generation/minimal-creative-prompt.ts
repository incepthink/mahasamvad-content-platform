// Minimal creative poster prompt for testing.
// Contains ONLY:
// 1. "Make a creative poster for social media platforms in the size {width} × {height}. It must look very professional and not be congested."
// 2. Numbers rule (Devanagari numerals ०-९ only, no English numerals)
// 3. Text accuracy rules (including preserving the loop in 'श')
// 4. Borders/dividers/icons rule (only when functional; icons small and secondary)
// 5. Do not use (logos, watermarks, maps, wave patterns at bottom)
// 6. Headline & margins (font scaled/wrapped to clear top-right badge)
// 7. Area rules (bottom text cushion, no wave patterns)
// 8. The text to put on the poster
//
// No extra creative direction essay, no color palettes, no forced layout templates.
//
// Two OPTIONAL blocks were added 2026-09-26 (see poster-design-director.ts), both after the opening
// line and before the rules above, which are unchanged: DESIGN DIRECTION (a short per-poster brief
// in words, no hex) and LIGHT BACKGROUND. With neither option set the output is byte-identical.

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
  // The design director's brief for THIS poster (poster-design-director.ts) — English style prose,
  // already sanitised. Emitted as a DESIGN DIRECTION block right after the opening line.
  designDirection?: string | undefined;
  // Emit LIGHT_GROUND_RULE. The fresh social lane always sets it, with or without a direction.
  lightGround?: boolean | undefined;
}>;

// The fresh social lane's light-ground rule (2026-09-26). Every poster sits on a light ground; the
// rule names which side of the contrast the large areas are on, so "strong contrast" cannot be
// satisfied by white type on black.
export const LIGHT_GROUND_RULE = `LIGHT BACKGROUND:
- Use a light, luminous ground — white, off-white or a pale tint — covering most of the canvas.
- Dark tones are only for text and small accents.
- No dark, black, charcoal or night-mode poster, and no large dark panel as the main surface.
- Photographs are bright and naturally lit, with no dark scrim over them.`;

function designDirectionBlock(brief: string): string {
  return `DESIGN DIRECTION:
- This is the visual direction for THIS poster. It never overrides any rule below; where they differ, the rules below win.
${brief}`;
}

export const NUMBERS_RULE = `NUMBERS:
- Use only Devanagari numerals: ० १ २ ३ ४ ५ ६ ७ ८ ९.
- Never use Western numerals: 0 1 2 3 4 5 6 7 8 9.
- Every year (e.g. २०२६ instead of 2026), date, quantity, and phone number must strictly use Devanagari numerals only. No English digits anywhere.`;

export const TEXT_ACCURACY_RULE = `TEXT ACCURACY:
- Preserve every अक्षर, मात्रा, जोडाक्षर and अनुस्वार in its correct position.
- Pay special attention to conjuncts such as “क्ती” and “र्दे”. Never separate, reorder, replace or omit their characters or matras.
- Words such as “व्यक्ती”, “शक्ती”, “युक्ती” and “निर्देश” must remain exactly as supplied.
- For letters with a loop such as “श”, the loop/circle at the top-left of the letter must be clearly formed and properly maintained (never omit, break, or flatten the circle in “श” in words such as “शेतकरी”, “शासन”, “विशेष”, “शिक्षण”).
- Do not rewrite, translate, autocorrect, abbreviate or approximate any word.
- Before finishing, compare every rendered word and number with the supplied content and correct all differences.`;

// Borders, dividers, outlined boxes and icons (2026-09-26, the department's design note). Renders
// were coming back with a coloured outline round every block, a divider between every item and an
// icon beside every heading — templated clutter. Stated positively first (what builds structure
// instead), because a bare "no borders" leaves the model nothing to do with a section boundary.
// No Devanagari examples here on purpose: Devanagari inside a rule block is text a model may print.
export const DECORATION_RULE = `BORDERS, DIVIDERS AND ICONS — ONLY WHEN THEY HELP:
- Build structure with spacing, alignment, type, colour and imagery. Do not outline every section or block and do not draw decorative divider lines; use a border or divider only where distinct sections would otherwise be hard to tell apart.
- No icons by default beside headings or points. Use one only when it says something useful the words do not — never one that repeats its heading, and none where a photograph or illustration already gives the context. Any icon stays small and secondary to the text.
- Aim for a clean, editorial government design: if removing a border, divider or icon loses no clarity, leave it out.`;

// Backwards compatibility alias: the block used to be icons-only.
export const ICONS_RULE = DECORATION_RULE;

export const DO_NOT_USE_RULE = `DO NOT USE:
- Do not add or paint any logo, emblem, seal, QR code, government wordmark, or watermark.
- Do not include maps (no geographic maps, territory outlines, world maps, or country/state outlines).
- Do not add wave patterns, wavy ribbons, curved swooshes, or decorative wave-like shapes along the bottom. Keep the lower background clean, flat, and natural.`;

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
- Bottom margin: The footer is attached below the image and covers nothing. Extend the design to the bottom edge, but keep all text and icons above y=${bottomY} (at least ${bottomMargin} pixels above the bottom edge). Do not draw wave patterns or curved decorative swooshes along the bottom. Reflow or shrink content until everything fits.`;
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

  const opening = `Make a creative poster for social media platforms in the size ${width} × ${height}. It must look very professional and not be congested.`;
  const areaRule = buildAreaRule(width, height, bottomMargin);
  const headlineMarginsRule = buildHeadlineMarginsRule(badgeWidth, badgeHeight);

  const designDirection = input.designDirection?.trim() ?? '';
  // Both optional blocks sit between the opening line and the existing rules, so a prompt with
  // neither is byte-identical to the one that shipped before them.
  const sections = [
    opening,
    ...(designDirection ? ['', designDirectionBlock(designDirection)] : []),
    ...(input.lightGround ? ['', LIGHT_GROUND_RULE] : []),
    '',
    NUMBERS_RULE,
    '',
    TEXT_ACCURACY_RULE,
    '',
    ICONS_RULE,
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
    lightGround: true,
    designDirection:
      'Let the figures carry the design: set the central amount as large confident type on a pale sky-tinted ground. Arrange the supporting points as two grouped sections with clear headings and generous spacing, and use a bright naturally lit photograph of a solar pump in a field as a wide band across the lower third.',
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
