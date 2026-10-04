import assert from 'node:assert/strict';
import sharp from 'sharp';
import { SOCIAL_LOGO_STYLES, socialLogoShape } from '@dgipr/schemas';
import {
  buildCanvaSocialPosterLayers,
  overlayTwitterChrome,
  SOCIAL_ARTWORK_HEIGHT,
  SOCIAL_POSTER_HEIGHT,
} from '../src/twitter-chrome.js';

const WIDTH = 1280;

// Not a flat colour: a horizontal gradient, so a logo layer that wrongly carried artwork pixels
// from outside a circle/quarter would still restack identically and the hole check below is what
// catches it — while a hole in the WRONG place cannot hide behind uniform pixels.
const artwork = await sharp(
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${SOCIAL_ARTWORK_HEIGHT}">
      <defs><linearGradient id="g"><stop offset="0" stop-color="#356b85"/><stop offset="1" stop-color="#c2562f"/></linearGradient></defs>
      <rect width="100%" height="100%" fill="url(#g)"/>
    </svg>`,
  ),
)
  .png()
  .toBuffer();

for (const logoStyle of SOCIAL_LOGO_STYLES) {
  const finished = await overlayTwitterChrome(artwork, { logoStyle });
  const layers = await buildCanvaSocialPosterLayers(finished, { logoStyle });
  const decodedBase = await sharp(layers.base)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  assert.equal(layers.width, WIDTH);
  assert.equal(layers.height, SOCIAL_POSTER_HEIGHT);

  // The card and the footer are lifted out as whole rectangles; a circle or quarter only where
  // the badge paints, so the base keeps the artwork around the shape.
  const rectangles =
    socialLogoShape(logoStyle) === 'card'
      ? [layers.logo, layers.footer]
      : [layers.footer];
  for (const layer of rectangles) {
    for (let y = layer.top; y < layer.top + layer.height; y += 1) {
      for (let x = layer.left; x < layer.left + layer.width; x += 1) {
        assert.equal(
          decodedBase.data[(y * layers.width + x) * 4 + 3],
          0,
          `${logoStyle}: brand hole must be fully transparent`,
        );
      }
    }
  }
  if (socialLogoShape(logoStyle) !== 'card') {
    // The box's far corner from the badge's own corner lies outside both a circle and a quarter:
    // that pixel is artwork and must stay in the base.
    const { logo } = layers;
    const farX = logoStyle.endsWith('right')
      ? logo.left + 1
      : logo.left + logo.width - 2;
    const farY = logo.top + logo.height - 2;
    assert.equal(
      decodedBase.data[(farY * layers.width + farX) * 4 + 3],
      255,
      `${logoStyle}: artwork outside the shaped badge was lifted into the logo layer`,
    );
  }

  const recomposed = await sharp(layers.base)
    .composite([
      { input: layers.logo.png, left: layers.logo.left, top: layers.logo.top },
      {
        input: layers.footer.png,
        left: layers.footer.left,
        top: layers.footer.top,
      },
    ])
    .png()
    .toBuffer();
  const [expectedPixels, actualPixels] = await Promise.all([
    sharp(finished).ensureAlpha().raw().toBuffer(),
    sharp(recomposed).ensureAlpha().raw().toBuffer(),
  ]);
  assert.ok(
    expectedPixels.equals(actualPixels),
    `${logoStyle}: base + logo + footer must reproduce the finished poster pixel-for-pixel`,
  );
  console.log(`  ${logoStyle}: 3 lossless image elements`);
}

console.log('Canva social poster layers verified for every logo style.');
