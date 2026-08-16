import sharp from 'sharp';
// Card rect measured in the clip (1280x720), padded by 2px for antialiasing.
const CARD = { x: 1076, y: 8, w: 196, h: 189 };
const FEATHER = 28;
// Patch region: the card plus feather, clamped to the frame. Top and right sit
// at/near the frame edge, so the ramp only ever matters on the left and bottom.
const px0 = Math.max(0, CARD.x - FEATHER);
const py0 = Math.max(0, CARD.y - FEATHER);
const px1 = Math.min(1280, CARD.x + CARD.w + FEATHER);
const py1 = Math.min(720, CARD.y + CARD.h + FEATHER);
const w = px1 - px0;
const h = py1 - py0;
const mask = Buffer.alloc(w * h);
for (let y = 0; y < h; y++) {
  for (let x = 0; x < w; x++) {
    const gx = px0 + x;
    const gy = py0 + y;
    // Distance INSIDE the card = fully opaque; outside it ramps to 0 at the
    // patch edge, so the join lands on real footage instead of a hard line.
    const dxLeft = CARD.x - gx;
    const dxRight = gx - (CARD.x + CARD.w);
    const dyTop = CARD.y - gy;
    const dyBottom = gy - (CARD.y + CARD.h);
    const out = Math.max(0, dxLeft, dxRight, dyTop, dyBottom);
    const a = out === 0 ? 255 : Math.round(255 * Math.max(0, 1 - out / FEATHER));
    mask[y * w + x] = a;
  }
}
const out = process.env.LOCALAPPDATA + '/Temp/claude/vid/mask.png';
await sharp(mask, { raw: { width: w, height: h, channels: 1 } }).png().toFile(out);
console.log(JSON.stringify({ patch: { x: px0, y: py0, w, h }, mirrorSrcX: px0 - w, out }));
