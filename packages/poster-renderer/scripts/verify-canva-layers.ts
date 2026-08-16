import assert from 'node:assert/strict';
import sharp from 'sharp';
import {
  buildCanvaSocialPosterLayers,
  overlayTwitterChrome,
  SOCIAL_ARTWORK_HEIGHT,
  SOCIAL_POSTER_HEIGHT,
} from '../src/twitter-chrome.js';

const WIDTH = 1280;

const artwork = await sharp({
  create: {
    width: WIDTH,
    height: SOCIAL_ARTWORK_HEIGHT,
    channels: 3,
    background: '#356b85',
  },
})
  .png()
  .toBuffer();
const finished = await overlayTwitterChrome(artwork);
const layers = await buildCanvaSocialPosterLayers(finished);
const decodedBase = await sharp(layers.base)
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });

assert.equal(layers.width, WIDTH);
assert.equal(layers.height, SOCIAL_POSTER_HEIGHT);

for (const layer of [layers.logo, layers.footer]) {
  for (let y = layer.top; y < layer.top + layer.height; y += 1) {
    for (let x = layer.left; x < layer.left + layer.width; x += 1) {
      assert.equal(
        decodedBase.data[(y * layers.width + x) * 4 + 3],
        0,
        'brand hole must be fully transparent',
      );
    }
  }
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
  'base + logo + footer must reproduce the finished poster pixel-for-pixel',
);

console.log('Canva social poster layers verified: 3 lossless image elements.');
