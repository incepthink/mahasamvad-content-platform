// Free harness for the ratio-locked crop rectangle.
//
//   npx tsx --tsconfig apps/web/tsconfig.check.json apps/web/components/motionCropRatio.check.ts
//
// Run it from `packages/content-engine`, which has tsx (the fileName.check.ts precedent).
//
// WHAT IT PROVES, and why arithmetic on paper does not. The officer's whole reason for pressing
// the 4:5 pill is that the finished MP4 is exactly 4:5 — the reported defect was a sliver of
// white left over in Canva. Between the pill and that file sit two conversions: a pixel ratio
// becomes a share of the frame here, and the API turns that share back into pixels and rounds
// each side to an even number (cropVideoToRect). So this measures the OUTPUT ratio, in pixels,
// after that rounding, rather than checking that a fraction came back unchanged.

import { centredRectForAspect } from './MotionCropBox';

let failures = 0;
function check(label: string, ok: boolean, detail = '') {
  if (!ok) {
    failures += 1;
    console.error(`FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    console.log(`ok    ${label}`);
  }
}

// The frames a Dynamic Poster clip actually comes back in: the DGIPR social poster's own 4:5,
// a reel, a landscape post, and the odd shape a clip trimmed once already carries.
const FRAMES = [
  { name: '1280x1600 (poster 4:5)', w: 1280, h: 1600 },
  { name: '720x1280 (9:16)', w: 720, h: 1280 },
  { name: '1280x720 (16:9)', w: 1280, h: 720 },
  { name: '1080x1080 (square)', w: 1080, h: 1080 },
  { name: '484x346 (already trimmed)', w: 484, h: 346 },
];

const RATIOS = [
  { label: '4:5', value: 4 / 5 },
  { label: '9:16', value: 9 / 16 },
];

// What the API does with the rectangle, mirrored from cropVideoToRect line for line — sizes
// evened FIRST, then offsets pulled back inside the frame, and every one of them floored to an
// even pixel rather than rounded (yuv420p subsamples chroma and rejects odd dimensions). The
// distinction matters here: flooring is what can move the output off the asked-for ratio, so a
// harness that rounded would be measuring a crop the API never performs.
const evenDown = (n: number) => {
  const floored = Math.max(0, Math.floor(n));
  return floored - (floored % 2);
};
const evenSize = (n: number) => Math.max(2, evenDown(n));

function toPixels(
  rect: { x: number; y: number; width: number; height: number },
  frameW: number,
  frameH: number,
) {
  const width = Math.min(evenSize(rect.width * frameW), evenSize(frameW));
  const height = Math.min(evenSize(rect.height * frameH), evenSize(frameH));
  const x = Math.min(evenDown(rect.x * frameW), evenSize(frameW) - width);
  const y = Math.min(evenDown(rect.y * frameH), evenSize(frameH) - height);
  return { x, y, width, height };
}

for (const frame of FRAMES) {
  for (const ratio of RATIOS) {
    const fractionAspect = ratio.value / (frame.w / frame.h);
    const rect = centredRectForAspect(fractionAspect);

    check(
      `${frame.name} @ ${ratio.label}: inside the frame`,
      rect.x >= -1e-9 &&
        rect.y >= -1e-9 &&
        rect.x + rect.width <= 1 + 1e-9 &&
        rect.y + rect.height <= 1 + 1e-9,
      JSON.stringify(rect),
    );

    // It must be the LARGEST such rectangle, or the pill is quietly throwing away poster.
    check(
      `${frame.name} @ ${ratio.label}: touches an edge (largest that fits)`,
      Math.abs(rect.width - 1) < 1e-9 || Math.abs(rect.height - 1) < 1e-9,
      `${rect.width} x ${rect.height}`,
    );

    // Centred, so the poster's middle is what survives before the officer moves it.
    check(
      `${frame.name} @ ${ratio.label}: centred`,
      Math.abs(rect.x + rect.width / 2 - 0.5) < 1e-9 &&
        Math.abs(rect.y + rect.height / 2 - 0.5) < 1e-9,
    );

    const px = toPixels(rect, frame.w, frame.h);
    const got = px.width / px.height;
    // Half a percent: the even-pixel rounding is the only thing that can move it, and on the
    // smallest realistic frame here that is worth well under 1%.
    check(
      `${frame.name} @ ${ratio.label}: output is ${ratio.label} in pixels`,
      Math.abs(got - ratio.value) / ratio.value < 0.005,
      `${px.width}x${px.height} = ${got.toFixed(4)}, wanted ${ratio.value.toFixed(4)}`,
    );
  }
}

// A clip already at the asked-for shape yields the whole frame, which is what makes the pill
// disable itself instead of arming a crop the API refuses.
const same = centredRectForAspect(0.8 / (1280 / 1600));
check(
  '1280x1600 @ 4:5 is the whole clip (pill disables)',
  same.width >= 0.995 && same.height >= 0.995,
  `${same.width} x ${same.height}`,
);

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} FAILED.`);
process.exit(failures === 0 ? 0 : 1);
