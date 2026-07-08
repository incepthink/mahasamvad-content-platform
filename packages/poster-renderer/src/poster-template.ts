// Build the poster as a self-contained HTML document. Playwright screenshots this into
// the final PNG (render-html.ts). This is the half of the pipeline that replaces the
// image model's (broken) Devanagari typesetting: every word here comes from the already
// correct `copy`, rendered by Chromium's HarfBuzz shaper in an embedded Noto Sans
// Devanagari webfont, so conjuncts like क्ती / ऱ्या are always right.
//
// Layout mirrors the DGIPR farm-article references: one bold scheme headline beside/over the
// AI photo, wrapped by the poster-header-footer.png frame (राजमुद्रा emblem top-right + the
// DGIPR footer band). Three interchangeable layouts — `arch`, `split`, `bottom` — are picked
// at random per poster. The AI supplies ONLY the photo; the headline and frame are drawn here.
//
// The per-post_type body bands (stats / bullets / quote / timeline, below) are kept but no
// longer drawn on the poster image — the article poster is headline-only by design.

import type { Copy } from '@dgipr/schemas';
import type { BrandAssets } from './assets.js';

export const POSTER_WIDTH = 1080;
export const POSTER_HEIGHT = 1350;

// The three reference layouts (farm-article-ref1/2/3): `arch` = photo in a rounded arch on
// the right; `split` = rectangular photo filling the right; `bottom` = photo across the
// bottom with the headline above it. One is chosen per poster.
export type PosterVariant = 'arch' | 'split' | 'bottom';
export const POSTER_VARIANTS: readonly PosterVariant[] = ['arch', 'split', 'bottom'];

function pickVariant(): PosterVariant {
  return POSTER_VARIANTS[Math.floor(Math.random() * POSTER_VARIANTS.length)]!;
}

export type BuildPosterHtmlInput = Readonly<{
  copy: Copy;
  // Background photo for the image zone, as a data URI (or any URL Chromium can load).
  sceneDataUri: string;
  assets: BrandAssets;
  // Which reference layout to use. Omit to pick one at random.
  variant?: PosterVariant;
}>;

// --- small helpers ---------------------------------------------------------------

export function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const has = (val: unknown): val is string =>
  typeof val === 'string' && val.trim() !== '';

// Escape a bullet's text, then bold any emphasis phrases inside it.
function emphasise(text: string, emphasis: readonly string[] | undefined): string {
  let out = esc(text);
  for (const phrase of emphasis ?? []) {
    if (!has(phrase)) continue;
    const safe = esc(phrase.trim());
    out = out.replace(safe, `<b>${safe}</b>`);
  }
  return out;
}

// A compact glyph for an icon_hint. Kept intentionally simple; the government look comes
// from the coloured chip around it, not the icon itself.
const ICONS: Record<string, string> = {
  rupee: '₹',
  money: '₹',
  calendar: '📅',
  date: '📅',
  people: '👥',
  person: '👤',
  farmer: '🌾',
  crop: '🌾',
  bank: '🏛',
  building: '🏛',
  location: '📍',
  phone: '📞',
  clock: '🕐',
  time: '🕐',
  check: '✔',
  alert: '⚠',
  health: '➕',
  document: '📄',
};
const icon = (hint: string): string => ICONS[hint.trim().toLowerCase()] ?? '★';

// --- body zones (one per post_type) ---------------------------------------------

function statsBand(
  stats: ReadonlyArray<{ value: string; label: string; icon_hint: string }>,
): string {
  const cells = stats
    .filter((s) => has(s.value))
    .map(
      (s) => `
        <div class="stat">
          <div class="stat-icon">${esc(icon(s.icon_hint))}</div>
          <div class="stat-value">${esc(s.value)}</div>
          <div class="stat-label">${esc(s.label)}</div>
        </div>`,
    )
    .join('<div class="stat-div"></div>');
  return `<section class="band band-stats"><div class="stats">${cells}</div></section>`;
}

function bulletsBand(
  bullets: ReadonlyArray<{ text: string; emphasis?: readonly string[] | undefined }>,
): string {
  const rows = bullets
    .filter((b) => has(b.text))
    .map(
      (b) => `
        <li class="bullet">
          <span class="bullet-mark"></span>
          <span class="bullet-text">${emphasise(b.text, b.emphasis)}</span>
        </li>`,
    )
    .join('');
  return `<section class="band band-bullets"><ul class="bullets">${rows}</ul></section>`;
}

function quoteBand(copy: Extract<Copy, { post_type: 'quote' }>): string {
  const at = copy.attribution ?? {};
  const attrib = [at.name, at.title].filter(has).join(' • ');
  const points = (copy.points ?? [])
    .filter((p) => has(p.text))
    .map(
      (p) =>
        `<div class="point"><span class="point-icon">${esc(icon(p.icon_hint))}</span><span>${esc(p.text)}</span></div>`,
    )
    .join('');
  return `
    <section class="band band-quote">
      <div class="quote-mark">“</div>
      <blockquote class="quote-text">${esc(copy.quote_text)}</blockquote>
      ${attrib ? `<div class="quote-attrib">— ${esc(attrib)}</div>` : ''}
      ${points ? `<div class="points">${points}</div>` : ''}
    </section>`;
}

function timelineBand(
  milestones: ReadonlyArray<{ date: string; text: string }>,
): string {
  const rows = milestones
    .filter((m) => has(m.text))
    .map(
      (m) => `
        <div class="milestone">
          <div class="milestone-date">${esc(m.date)}</div>
          <div class="milestone-text">${esc(m.text)}</div>
        </div>`,
    )
    .join('');
  return `<section class="band band-timeline"><div class="timeline">${rows}</div></section>`;
}

// The call-to-action / audience strip shared by campaign-like posters.
function ctaStrip(cta: string | undefined, audience: string | undefined): string {
  const parts: string[] = [];
  if (has(audience)) parts.push(`<div class="cta-audience">${esc(audience)}</div>`);
  if (has(cta)) parts.push(`<div class="cta-text">${esc(cta)}</div>`);
  if (parts.length === 0) return '';
  return `<section class="band band-cta">${parts.join('')}</section>`;
}

function bodyFor(copy: Copy): string {
  switch (copy.post_type) {
    case 'campaign':
      return (
        statsBand(copy.stats ?? []) + ctaStrip(copy.cta, copy.audience)
      );
    case 'alert':
    case 'info_bullets':
      return bulletsBand(copy.bullets);
    case 'quote':
      return quoteBand(copy);
    case 'timeline':
      return timelineBand(copy.milestones);
  }
}

// The green schedule ribbon (campaign date/time), rendered under the headline.
function scheduleRibbon(copy: Copy): string {
  if (copy.post_type !== 'campaign') return '';
  const sch = copy.schedule ?? {};
  const when = [sch.date, sch.time].filter(has).join('  •  ');
  return has(when)
    ? `<section class="band band-date">${esc(when)}</section>`
    : '';
}

// Headline / subhead vary in field name per type; pull the best-fit strings.
export function headStrings(copy: Copy): { kicker?: string; headline: string; subhead?: string } {
  if (copy.post_type === 'quote') {
    return {
      ...(has(copy.topic_label) ? { kicker: copy.topic_label } : {}),
      headline: has(copy.headline) ? copy.headline : copy.quote_text,
    };
  }
  const kicker =
    copy.post_type === 'timeline' ? copy.side_label : copy.kicker;
  return {
    ...(has(kicker) ? { kicker } : {}),
    headline: copy.headline,
    ...(copy.post_type !== 'timeline' && has(copy.subhead)
      ? { subhead: copy.subhead }
      : copy.post_type === 'timeline' && has(copy.intro)
        ? { subhead: copy.intro }
        : {}),
  };
}

// --- document ---------------------------------------------------------------------

export function buildPosterHtml(input: BuildPosterHtmlInput): string {
  const { copy, sceneDataUri, assets } = input;
  const variant = input.variant ?? pickVariant();
  // The article poster shows only the scheme headline; headStrings resolves the best
  // heading for every post_type (quote falls back to its quote_text).
  const { headline } = headStrings(copy);

  return `<!doctype html>
<html lang="mr">
<head>
<meta charset="utf-8" />
<style>
  @font-face {
    font-family: 'Noto Sans Devanagari';
    src: url('${assets.fontDataUri}') format('truetype');
    font-weight: 100 900;
    font-style: normal;
    font-display: block;
  }
  :root {
    --saffron1: #ff8a00;
    --saffron2: #ef5314;
    --maroon: #7a1512;
    --navy: #0b3d91;
    --navy2: #0a2f6e;
    --green: #187a37;
    --gold: #f6b900;
    --cream: #fff7ea;
    --ink: #1b2437;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${POSTER_WIDTH}px; height: ${POSTER_HEIGHT}px; }
  body {
    font-family: 'Noto Sans Devanagari', sans-serif;
    color: var(--ink);
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
  }
  .stage {
    position: relative;
    width: ${POSTER_WIDTH}px;
    height: ${POSTER_HEIGHT}px;
    overflow: hidden;
    background: #fff;
  }

  /* Layers (bottom to top): background · photo · headline · white footer plate · frame */
  .bg { position: absolute; inset: 0; z-index: 0; }
  .photo { position: absolute; z-index: 1; overflow: hidden; }
  .photo img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .headline-wrap { position: absolute; z-index: 2; display: flex; }
  .headline {
    font-weight: 900;
    line-height: 1.12;
    letter-spacing: -.5px;
    text-wrap: balance;
  }
  /* Keeps the frame's social-handle row on a clean light strip (like the references). */
  .footer-plate { position: absolute; left: 0; right: 0; bottom: 0; height: 176px; background: #fff; z-index: 5; }
  .frame { position: absolute; inset: 0; width: 100%; height: 100%; z-index: 10; display: block; pointer-events: none; }

  /* --- arch (ref1): headline left, photo in a rounded arch on the right --- */
  [data-variant="arch"] .bg {
    background: linear-gradient(155deg, #ffe1b0 0%, #ffb457 42%, #f4851d 100%);
  }
  [data-variant="arch"] .headline-wrap {
    left: 60px; top: 150px; width: 500px; height: 1000px; align-items: center;
  }
  [data-variant="arch"] .headline { font-size: 58px; color: var(--maroon); }
  [data-variant="arch"] .photo {
    right: 56px; top: 208px; width: 400px; height: 812px;
    border-radius: 200px 200px 30px 30px;
    border: 8px solid #fff;
    box-shadow: 0 18px 40px rgba(122,21,18,.28);
  }

  /* --- split (ref2): headline left on saffron, rectangular photo right --- */
  [data-variant="split"] .bg {
    background: radial-gradient(120% 100% at 0% 0%, #ff9a34 0%, #f4791a 60%, #e56a12 100%);
  }
  [data-variant="split"] .headline-wrap {
    left: 60px; top: 150px; width: 470px; height: 1000px; align-items: center;
  }
  [data-variant="split"] .headline { font-size: 56px; color: #fff; text-shadow: 0 2px 10px rgba(0,0,0,.14); }
  [data-variant="split"] .photo {
    right: 0; top: 150px; width: 500px; height: 1000px;
    border-left: 8px solid #fff;
  }

  /* --- bottom (ref3): headline over sky at top, photo across the bottom --- */
  [data-variant="bottom"] .bg {
    background: linear-gradient(180deg, #cfe9ff 0%, #eaf6ff 55%, #ffffff 100%);
  }
  [data-variant="bottom"] .headline-wrap {
    left: 64px; top: 172px; width: 780px; height: 360px; align-items: flex-start;
  }
  [data-variant="bottom"] .headline { font-size: 58px; color: var(--navy2); }
  [data-variant="bottom"] .photo {
    left: 0; right: 0; top: 556px; height: 610px; width: 100%;
    border-top: 8px solid #fff;
  }
</style>
</head>
<body>
  <div class="stage" data-variant="${variant}">
    <div class="bg"></div>
    <div class="photo"><img src="${sceneDataUri}" alt="" /></div>
    <div class="headline-wrap"><h1 class="headline">${esc(headline)}</h1></div>
    <div class="footer-plate"></div>
    <img class="frame" src="${assets.frameDataUri}" alt="" />
  </div>
</body>
</html>`;
}
