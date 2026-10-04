// Offline preview of the social-poster chrome overlay (poster-logo-new.png top-right +
// footer-new-poster.png full-width bottom) WITHOUT any model call — for tuning the
// scale/margin constants in src/twitter-chrome.ts for free.
//
//   pnpm --filter @dgipr/poster-renderer poster:preview:chrome:twitter [poster.png]
//
// With a PNG argument (e.g. a real n8n render) the chrome is stamped onto it and
// written as <input>.chrome-preview.png next to it. Without one, a flat 1280x1504
// stand-in ARTWORK canvas (colour bands + reserved-zone guides) is used and the result
// goes to content-engine/data/output/twitter-chrome-preview.png (gitignored).
//
// On the stand-in it is also a REGRESSION TEST for the thing an eyeball is bad at: the
// finished poster must be exactly 1280x1600 (4:5), or officers get a gap down each side of
// their 1080x1350 Canva frame — the defect this sizing exists to fix — and re-stamping must
// not grow it, or every feedback round adds another strip.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import {
  SOCIAL_LOGO_FOOTPRINT,
  SOCIAL_LOGO_RESERVE,
  SOCIAL_LOGO_STYLES,
  pickSocialLogoStyle,
  socialLogoShape,
  socialLogoSide,
  type SocialLogoStyle,
} from '@dgipr/schemas';
import {
  detectSocialLogoStyle,
  overlayTwitterChrome,
  placeSocialLogo,
  SOCIAL_ARTWORK_HEIGHT,
  SOCIAL_POSTER_HEIGHT,
} from '../src/twitter-chrome.js';

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT_DIR = resolve(here, '../../content-engine/data/output');
const WIDTH = 1280;

// Flat portrait stand-in for a social render — the ARTWORK the image model is asked for, not
// the finished poster: header band + content card, with faint outlines marking the top-right
// badge reserve (180x170) and the bottom text cushion (16px, at y=1488).
async function placeholderPoster(): Promise<Buffer> {
  const h = SOCIAL_ARTWORK_HEIGHT;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${h}">
    <rect width="${WIDTH}" height="${h}" fill="#eef4fb"/>
    <rect x="0" y="0" width="${WIDTH}" height="320" fill="#1c3f94"/>
    <text x="520" y="180" font-family="sans-serif" font-size="52" fill="#ffffff"
      text-anchor="middle">HEADLINE ZONE</text>
    <rect x="120" y="420" width="1040" height="900" rx="24" fill="#ffffff"
      stroke="#c4d3e8" stroke-width="3"/>
    <rect x="1100" y="0" width="180" height="170" fill="none"
      stroke="#ff0000" stroke-opacity="0.4" stroke-width="3" stroke-dasharray="12 8"/>
    <rect x="0" y="${h - 16}" width="${WIDTH}" height="16" fill="none"
      stroke="#ff0000" stroke-opacity="0.4" stroke-width="3" stroke-dasharray="12 8"/>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function size(png: Buffer): Promise<string> {
  const meta = await sharp(png).metadata();
  return `${meta.width}x${meta.height}`;
}

async function main(): Promise<void> {
  const inputPath = process.argv[2];
  let poster: Buffer;
  let outPath: string;
  let checkGeometry = false;
  if (inputPath) {
    const full = resolve(inputPath);
    poster = await readFile(full);
    outPath = full.replace(/\.png$/i, '') + '.chrome-preview.png';
  } else {
    poster = await placeholderPoster();
    await mkdir(DEFAULT_OUT_DIR, { recursive: true });
    outPath = join(DEFAULT_OUT_DIR, 'twitter-chrome-preview.png');
    checkGeometry = true;
  }

  const png = await overlayTwitterChrome(poster);
  await writeFile(outPath, png);
  console.log(`Wrote ${outPath} (${await size(poster)} -> ${await size(png)})`);

  if (!checkGeometry) return;
  const failures: string[] = [];
  const finished = `${WIDTH}x${SOCIAL_POSTER_HEIGHT}`;
  if ((await size(png)) !== finished)
    failures.push(
      `finished poster is ${await size(png)}, not ${finished} — a non-4:5 poster leaves a gap in a 1080x1350 frame`,
    );
  // Idempotence: a feedback round re-stamps a finished poster, and this must not append a
  // second strip. Told apart by aspect, so it is worth proving rather than assuming.
  const restamped = await overlayTwitterChrome(png);
  if ((await size(restamped)) !== finished)
    failures.push(
      `re-stamping grew the poster to ${await size(restamped)} — feedback rounds would stack strips`,
    );
  await checkLogoStyles(poster, png, failures);
  if (failures.length > 0) {
    console.error(`\n${failures.length} failure(s):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exitCode = 1;
  } else {
    console.log(
      `OK: artwork ${WIDTH}x${SOCIAL_ARTWORK_HEIGHT} -> finished ${finished} (4:5), and re-stamping is a no-op.`,
    );
  }
}

// THE LOGO ROTATION (2026-10-03). Every style is stamped onto the stand-in and written out, plus
// a contact sheet of all six, and the properties an eyeball is bad at are asserted:
//   - the default stamp is still byte-identical to an explicit card-right (no silent change for
//     a caller that passes no style);
//   - each badge reaches exactly SOCIAL_LOGO_FOOTPRINT from its own corner and stays inside the
//     prompt's SOCIAL_LOGO_RESERVE — or the prompt reserves the wrong size;
//   - nothing the badge paints falls outside its shape (a wordmark spilling past a circle's edge
//     would show as a stray piece of text on the artwork);
//   - the rotation reaches all six styles over ordinary uuids, and is stable per id.
async function checkLogoStyles(
  artwork: Buffer,
  defaultStamp: Buffer,
  failures: string[],
): Promise<void> {
  const explicit = await overlayTwitterChrome(artwork, {
    logoStyle: 'card-right',
  });
  if (!explicit.equals(defaultStamp))
    failures.push(
      'the default stamp is no longer identical to an explicit card-right',
    );

  if ((await detectSocialLogoStyle(artwork)) !== null)
    failures.push('unstamped artwork was detected as carrying a badge');
  const tiles: Buffer[] = [];
  for (const style of SOCIAL_LOGO_STYLES) {
    const stamped = await overlayTwitterChrome(artwork, { logoStyle: style });
    const out = join(DEFAULT_OUT_DIR, `twitter-chrome-${style}.png`);
    await writeFile(out, stamped);
    tiles.push(stamped);
    const detected = await detectSocialLogoStyle(stamped);
    if (detected !== style)
      failures.push(
        `${style}: detected as ${detected ?? 'nothing'} on its own stamped poster`,
      );

    const placed = await placeSocialLogo(style, WIDTH);
    const side = socialLogoSide(style);
    const shape = socialLogoShape(style);
    const reachX =
      side === 'right' ? WIDTH - placed.left : placed.left + placed.width;
    const reachY = placed.top + placed.height;
    const foot = SOCIAL_LOGO_FOOTPRINT[shape];
    const reserve = SOCIAL_LOGO_RESERVE[shape];
    if (Math.abs(reachX - foot.width) > 1 || Math.abs(reachY - foot.height) > 1)
      failures.push(
        `${style}: badge reaches ${reachX}x${reachY} from its corner, schemas says ${foot.width}x${foot.height}`,
      );
    if (reachX > reserve.width || reachY > reserve.height)
      failures.push(
        `${style}: badge (${reachX}x${reachY}) overflows the prompt reserve`,
      );

    if (shape !== 'card') {
      const alpha = await sharp(placed.data)
        .ensureAlpha()
        .extractChannel(3)
        .raw()
        .toBuffer();
      const [cx, cy, r] =
        shape === 'circle'
          ? [placed.width / 2, placed.height / 2, placed.width / 2]
          : [side === 'right' ? placed.width : 0, 0, placed.width];
      let outside = 0;
      for (let y = 0; y < placed.height; y += 1) {
        for (let x = 0; x < placed.width; x += 1) {
          if (alpha[y * placed.width + x]! === 0) continue;
          // 1.5px of tolerance for the antialiased edge.
          if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) > r + 1.5) outside += 1;
        }
      }
      if (outside > 0)
        failures.push(
          `${style}: ${outside} badge pixels fall outside its ${shape}`,
        );
    }
    console.log(
      `  ${style.padEnd(14)} ${placed.width}x${placed.height} at (${placed.left}, ${placed.top}) -> ${out}`,
    );
  }

  // Contact sheet: the top 420px of each stamped poster, 2 per row at half size.
  const crop = 420;
  const cellW = WIDTH / 2;
  const cellH = crop / 2;
  const cells = await Promise.all(
    tiles.map((t) =>
      sharp(t)
        .extract({ left: 0, top: 0, width: WIDTH, height: crop })
        .resize(cellW, cellH)
        .png()
        .toBuffer(),
    ),
  );
  const sheet = await sharp({
    create: {
      width: cellW * 2 + 10,
      height: cellH * 3 + 20,
      channels: 3,
      background: '#888888',
    },
  })
    .composite(
      cells.map((input, i) => ({
        input,
        left: (i % 2) * (cellW + 10),
        top: Math.floor(i / 2) * (cellH + 10),
      })),
    )
    .png()
    .toBuffer();
  const sheetPath = join(DEFAULT_OUT_DIR, 'twitter-chrome-styles.png');
  await writeFile(sheetPath, sheet);
  console.log(`Wrote ${sheetPath}`);

  const seen = new Map<SocialLogoStyle, number>();
  for (let i = 0; i < 600; i += 1) {
    const id = crypto.randomUUID();
    const style = pickSocialLogoStyle(id);
    seen.set(style, (seen.get(style) ?? 0) + 1);
    if (pickSocialLogoStyle(id) !== style)
      failures.push('rotation is not deterministic for one id');
  }
  for (const style of SOCIAL_LOGO_STYLES) {
    const n = seen.get(style) ?? 0;
    if (n < 50) failures.push(`rotation reaches ${style} only ${n}/600 times`);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
