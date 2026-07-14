// Compress the captured PNGs before commit: cap width at 1600px (captures are
// taken at deviceScaleFactor 2, i.e. up to 2880px wide), strip metadata, and
// palette-quantize — UI screenshots compress extremely well this way. A file is
// only replaced when the optimized version is actually smaller.

import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { OUT_DIR } from './config.js';

export async function optimize(): Promise<void> {
  if (!fs.existsSync(OUT_DIR)) {
    console.log('No assets directory yet — nothing to optimize.');
    return;
  }
  const files = fs.readdirSync(OUT_DIR).filter((f) => f.endsWith('.png'));
  let before = 0;
  let after = 0;
  for (const file of files) {
    const filePath = path.join(OUT_DIR, file);
    const original = fs.statSync(filePath).size;
    before += original;
    const optimized = await sharp(filePath)
      .resize({ width: 1600, withoutEnlargement: true })
      .png({ compressionLevel: 9, palette: true, quality: 90 })
      .toBuffer();
    const kept = optimized.length < original ? optimized.length : original;
    if (optimized.length < original) fs.writeFileSync(filePath, optimized);
    after += kept;
    console.log(
      `  ${file}: ${(original / 1024).toFixed(0)} kB -> ${(kept / 1024).toFixed(0)} kB`,
    );
  }
  console.log(
    `total (${files.length} files): ${(before / 1048576).toFixed(1)} MB -> ${(after / 1048576).toFixed(1)} MB`,
  );
}
