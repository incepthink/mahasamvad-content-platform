// The DGIPR social poster's brand chrome, served as two transparent PNGs so a browser can lay
// it over something that does not carry it yet.
//
// WHY THIS EXISTS. overlayTwitterChrome composites this artwork onto every finished
// twitter/facebook poster, but a Dynamic Poster clip is deliberately unbranded (the lane's
// source is a poster that already carries the department's branding, and stamping a second
// lockup onto it would be a defect). Once an officer TRIMS one down to a single panel, though,
// whatever branding the source had is outside the rectangle — so the crop tool previews where
// the chrome would sit, and that preview needs the real graphics.
//
// Served from the API rather than copied into apps/web/public, exactly as /video/lockup.png is,
// so renderGovernmentLockup and footer-new-poster.png stay the ONE source of the artwork. A
// copy under public/ is a copy that silently keeps the old emblem the day the asset changes.
//
// Rendered once per process — neither graphic varies — and only the bytes are sent: each keeps
// its own aspect ratio, so the browser places it by width and lets the height follow. That is
// what keeps the badge's 154:160 and the band's 239:3376 from having to be written down on the
// web side as well.

import type { FastifyInstance } from 'fastify';
import {
  renderGovernmentLockup,
  renderSocialFooterBand,
} from '@dgipr/poster-renderer';

// Both are rendered wide enough that a browser only ever scales them DOWN. The poster column
// caps at ~560 CSS px, so the badge (12.5% of the frame) is ~70 CSS px and ~140 physical on a
// 2x screen; the band runs the full width.
const LOGO_RENDER_WIDTH = 320;
const FOOTER_RENDER_WIDTH = 1280;

let logoPng: Promise<Buffer> | null = null;
let footerPng: Promise<Buffer> | null = null;

// Memoize the RESULT but never a failure: a rejected promise left in the slot would turn one
// bad render into a permanently broken route for the life of the process.
function once(
  slot: () => Promise<Buffer> | null,
  set: (value: Promise<Buffer> | null) => void,
  render: () => Promise<Buffer>,
): Promise<Buffer> {
  const existing = slot();
  if (existing) return existing;
  const started = render().catch((error: unknown) => {
    set(null);
    throw error;
  });
  set(started);
  return started;
}

export function registerChromeRoutes(app: FastifyInstance): void {
  // The white emblem + "महाराष्ट्र शासन" badge that sits in the poster's top-right corner.
  // The `card` background (the default) is the poster variant — /video asks for `transparent`,
  // which drops the white card because a white square over live-action footage reads as a
  // sticker. Here the preview is over a poster, so the card is what the officer will get.
  app.get('/chrome/social-logo.png', async (_request, reply) => {
    const png = await once(
      () => logoPng,
      (value) => {
        logoPng = value;
      },
      () =>
        renderGovernmentLockup(LOGO_RENDER_WIDTH).then((raster) => raster.data),
    );
    return reply
      .header('content-type', 'image/png')
      .header('cache-control', 'public, max-age=86400')
      .send(png);
  });

  // The full-width department band that runs along the poster's bottom edge.
  app.get('/chrome/social-footer.png', async (_request, reply) => {
    const png = await once(
      () => footerPng,
      (value) => {
        footerPng = value;
      },
      () => renderSocialFooterBand(FOOTER_RENDER_WIDTH),
    );
    return reply
      .header('content-type', 'image/png')
      .header('cache-control', 'public, max-age=86400')
      .send(png);
  });
}
