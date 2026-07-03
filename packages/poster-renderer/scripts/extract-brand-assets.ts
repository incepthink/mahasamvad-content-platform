// One-time dev script: crop the brand-constant emblem and footer band out of the
// master-campaign.png reference into packages/poster-renderer/assets, so the HTML
// poster template can composite authentic DGIPR chrome instead of letting the image
// model (mis)draw it. Re-run only if the master or crop regions change.
//
//   pnpm --filter @dgipr/poster-renderer assets:extract
//
// Coordinates are pixels in the 682x852 master (verified visually). Both crops are
// upscaled 2x with lanczos so they stay crisp when the template scales them onto the
// 1080-wide poster.

import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const MASTER = resolve(
  here,
  '../../content-engine/data/reference/master-campaign.png',
);
const ASSETS = resolve(here, '../assets');

// Top-right राजमुद्रा emblem + "महाराष्ट्र शासन" caption (on the cream header).
const EMBLEM = { left: 576, top: 4, width: 100, height: 92 } as const;
// Full-width footer: teal "माहिती व जनसंपर्क..." bar over the social-handle strip.
const FOOTER = { left: 0, top: 783, width: 682, height: 69 } as const;

async function crop(
  region: { left: number; top: number; width: number; height: number },
  out: string,
): Promise<void> {
  await sharp(MASTER)
    .extract(region)
    .resize({ width: region.width * 2, kernel: 'lanczos3' })
    .png()
    .toFile(out);
}

async function main(): Promise<void> {
  await mkdir(ASSETS, { recursive: true });
  const emblemOut = join(ASSETS, 'emblem.png');
  const footerOut = join(ASSETS, 'footer-band.png');
  await crop(EMBLEM, emblemOut);
  await crop(FOOTER, footerOut);
  console.log('Wrote:');
  console.log('  ' + emblemOut);
  console.log('  ' + footerOut);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
