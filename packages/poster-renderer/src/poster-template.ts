// Build the poster as a self-contained HTML document. Playwright screenshots this into
// the final PNG (render-html.ts). This is the half of the pipeline that replaces the
// image model's (broken) Devanagari typesetting: every word here comes from the already
// correct `copy`, rendered by Chromium's HarfBuzz shaper in an embedded Noto Sans
// Devanagari webfont, so conjuncts like क्ती / ऱ्या are always right.
//
// Layout mirrors the DGIPR reference masters: a saffron header (with the राजमुद्रा emblem
// chip), a bold headline block, the AI photo in a central zone, a type-specific body band
// (stats / bullets / quote / timeline), an optional call-to-action strip, and the cropped
// DGIPR footer band. The AI supplies ONLY the photo; every band is drawn here in code.

import type { Copy } from '@dgipr/schemas';
import type { BrandAssets } from './assets.js';

export const POSTER_WIDTH = 1080;
export const POSTER_HEIGHT = 1350;

export type BuildPosterHtmlInput = Readonly<{
  copy: Copy;
  // Background photo for the image zone, as a data URI (or any URL Chromium can load).
  sceneDataUri: string;
  assets: BrandAssets;
}>;

// --- small helpers ---------------------------------------------------------------

function esc(value: string): string {
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
function headStrings(copy: Copy): { kicker?: string; headline: string; subhead?: string } {
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
  const { kicker, headline, subhead } = headStrings(copy);

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
    width: ${POSTER_WIDTH}px;
    height: ${POSTER_HEIGHT}px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--cream);
  }

  /* Header */
  .topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 34px;
    background: linear-gradient(135deg, var(--saffron1), var(--saffron2));
    color: #fff;
  }
  .brandmark { font-weight: 800; font-size: 34px; letter-spacing: .5px; }
  .brandmark small { display: block; font-weight: 600; font-size: 18px; opacity: .92; }
  .emblem-chip {
    background: #fff;
    border-radius: 12px;
    padding: 6px 10px;
    box-shadow: 0 3px 10px rgba(0,0,0,.18);
    display: flex;
  }
  .emblem-chip img { height: 74px; display: block; }

  /* Headline */
  .headline-block { padding: 26px 44px 20px; text-align: center; }
  .kicker {
    display: inline-block;
    background: var(--green);
    color: #fff;
    font-weight: 700;
    font-size: 22px;
    padding: 6px 20px;
    border-radius: 999px;
    margin-bottom: 14px;
  }
  .headline {
    font-weight: 900;
    font-size: 66px;
    line-height: 1.08;
    color: var(--maroon);
    letter-spacing: -.5px;
  }
  .subhead {
    margin-top: 14px;
    font-weight: 700;
    font-size: 30px;
    color: var(--navy);
    line-height: 1.25;
  }

  /* Bands */
  .band { padding: 18px 44px; }
  .band-date {
    background: var(--green);
    color: #fff;
    font-weight: 800;
    font-size: 30px;
    text-align: center;
    padding: 14px;
  }

  /* Photo zone */
  .photo {
    position: relative;
    flex: 1 1 auto;
    min-height: 300px;
    border-top: 6px solid var(--gold);
    border-bottom: 6px solid var(--gold);
    overflow: hidden;
  }
  .photo img { width: 100%; height: 100%; object-fit: cover; display: block; }

  /* Stats */
  .band-stats { background: linear-gradient(180deg, var(--navy), var(--navy2)); padding: 26px 30px; }
  .stats { display: flex; align-items: stretch; justify-content: space-around; }
  .stat { flex: 1; text-align: center; padding: 0 12px; color: #fff; }
  .stat-icon {
    width: 62px; height: 62px; margin: 0 auto 8px;
    border-radius: 50%;
    background: var(--gold); color: var(--navy2);
    font-size: 34px; font-weight: 900;
    display: flex; align-items: center; justify-content: center;
  }
  .stat-value { font-size: 42px; font-weight: 900; line-height: 1.1; }
  .stat-label { font-size: 22px; font-weight: 500; margin-top: 4px; opacity: .95; }
  .stat-div { width: 2px; background: rgba(255,255,255,.28); margin: 6px 0; }

  /* Bullets */
  .band-bullets { background: var(--cream); }
  .bullets { list-style: none; display: flex; flex-direction: column; gap: 18px; }
  .bullet { display: flex; gap: 18px; align-items: flex-start; }
  .bullet-mark {
    flex: none; width: 20px; height: 20px; margin-top: 8px;
    border-radius: 50%; background: var(--saffron2);
    box-shadow: 0 0 0 5px rgba(239,83,20,.18);
  }
  .bullet-text { font-size: 30px; font-weight: 600; line-height: 1.32; color: var(--ink); }
  .bullet-text b { color: var(--saffron2); }

  /* Quote */
  .band-quote { background: var(--cream); position: relative; text-align: center; padding: 30px 54px; }
  .quote-mark { font-size: 120px; line-height: .6; color: var(--gold); font-weight: 900; }
  .quote-text { font-size: 40px; font-weight: 700; line-height: 1.3; color: var(--maroon); }
  .quote-attrib { margin-top: 16px; font-size: 26px; font-weight: 700; color: var(--navy); }
  .points { display: flex; justify-content: center; gap: 28px; margin-top: 18px; flex-wrap: wrap; }
  .point { display: flex; align-items: center; gap: 8px; font-size: 24px; font-weight: 600; }
  .point-icon { color: var(--saffron2); }

  /* Timeline */
  .band-timeline { background: var(--cream); }
  .timeline { display: flex; flex-direction: column; gap: 18px; border-left: 4px solid var(--saffron2); padding-left: 26px; margin-left: 8px; }
  .milestone { position: relative; }
  .milestone::before {
    content: ''; position: absolute; left: -34px; top: 6px;
    width: 16px; height: 16px; border-radius: 50%; background: var(--saffron2);
    box-shadow: 0 0 0 4px var(--cream), 0 0 0 6px var(--saffron2);
  }
  .milestone-date { font-size: 24px; font-weight: 800; color: var(--navy); }
  .milestone-text { font-size: 28px; font-weight: 500; line-height: 1.3; color: var(--ink); }

  /* CTA */
  .band-cta {
    background: linear-gradient(135deg, var(--saffron1), var(--saffron2));
    color: #fff; text-align: center; padding: 18px 44px;
  }
  .cta-audience { font-size: 24px; font-weight: 600; opacity: .95; margin-bottom: 6px; }
  .cta-text { font-size: 30px; font-weight: 800; line-height: 1.25; }

  /* Footer */
  .footer { width: 100%; display: block; }
  .footer img { width: 100%; display: block; }
</style>
</head>
<body>
  <div class="stage">
    <header class="topbar">
      <div class="brandmark">महासंवाद<small>DGIPR • महाराष्ट्र शासन</small></div>
      <div class="emblem-chip"><img src="${assets.emblemDataUri}" alt="" /></div>
    </header>

    <div class="headline-block">
      ${kicker ? `<div class="kicker">${esc(kicker)}</div>` : ''}
      <h1 class="headline">${esc(headline)}</h1>
      ${subhead ? `<div class="subhead">${esc(subhead)}</div>` : ''}
    </div>

    ${scheduleRibbon(copy)}

    <div class="photo"><img src="${sceneDataUri}" alt="" /></div>

    ${bodyFor(copy)}

    <footer class="footer"><img src="${assets.footerDataUri}" alt="" /></footer>
  </div>
</body>
</html>`;
}
