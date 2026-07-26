// The explainer video's on-screen Marathi key point: one short line per scene
// (the amount, the deadline, the count, the scheme name) burned into the
// finished MP4.
//
// WHY THIS EXISTS AT ALL. Every visual prompt in the video pipeline hard-forbids
// on-screen text, because image and video models garble Devanagari — so until
// now 100% of a video's information rode on the voiceover and the footage was
// mood B-roll. This is the poster path's answer applied to video: the model
// paints text-free, and CHROMIUM typesets the Marathi. Its HarfBuzz shaper is
// what makes the conjuncts correct (renderHtmlToPng's contract), and the
// overlay is composited AFTER Veo, so no model ever sees it. Nothing in
// video-prompts.ts relaxes.
//
// The PNG is rendered at the video's own pixel size and laid on at 0,0, so the
// template can position with plain CSS and the ffmpeg side needs no geometry.
// Everything outside the panel is transparent (renderHtmlToPng's `transparent`
// option): this is a mostly-empty image, not a frame.

import { loadCaptionAssets } from '../assets.js';
import { renderHtmlToPng } from '../render-html.js';

// The REFERENCE frame size the overlay is typeset at, per aspect — 1080p,
// which is the largest the pipeline's providers return.
//
// It is a reference, not a promise about the footage: the clip provider decides
// the real size (Veo 1080p, Kling at 720p returns 1280x720), so
// assembleSilentVideo scales each overlay to the footage with scale2ref before
// compositing. Typesetting high and scaling DOWN is the right direction — the
// alternative, rendering small and scaling up, softens Devanagari conjuncts.
// Every measurement below is a proportion of these numbers, so nothing here
// changes when the footage size does.
export const CAPTION_FRAME_SIZE = {
  '16:9': { width: 1920, height: 1080 },
  '9:16': { width: 1080, height: 1920 },
} as const;

export type CaptionAspect = keyof typeof CAPTION_FRAME_SIZE;

// Proportions rather than pixels, so the vertical layout is not a second set of
// numbers to keep in sync. 5% side margin is the conventional title-safe area;
// the panel sits in the lower third, clear of both the action and the bottom
// edge where a player's controls appear.
const SIDE_MARGIN = 0.05;
const BOTTOM_MARGIN = 0.08;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildCaptionHtml(
  keyPoint: string,
  aspect: CaptionAspect,
  fontDataUri: string,
): string {
  const { width, height } = CAPTION_FRAME_SIZE[aspect];
  // Vertical is the narrower canvas, so its text has to be proportionally
  // larger to stay readable on a phone held upright.
  const fontSize = Math.round(width * (aspect === '9:16' ? 0.052 : 0.038));

  return `<!doctype html>
<html lang="mr">
<head>
<meta charset="utf-8" />
<style>
  @font-face {
    font-family: 'Noto Sans Devanagari';
    src: url('${fontDataUri}') format('truetype');
    font-weight: 100 900;
  }
  /* No background anywhere: the screenshot is taken with omitBackground, and a
     painted body would come back as an opaque rectangle over the footage. */
  html, body {
    margin: 0;
    padding: 0;
    width: ${width}px;
    height: ${height}px;
    background: transparent;
  }
  .stage {
    box-sizing: border-box;
    width: ${width}px;
    height: ${height}px;
    display: flex;
    align-items: flex-end;
    padding: 0 ${Math.round(width * SIDE_MARGIN)}px
             ${Math.round(height * BOTTOM_MARGIN)}px;
  }
  /* A panel, not bare text: the footage underneath is uncontrolled — a white
     wall in one scene, a dark corridor in the next — and only an opaque backing
     keeps one styling legible over both. Slightly translucent so it reads as an
     overlay rather than a slate, with a saffron rule tying it to the brand. */
  .key-point {
    max-width: 78%;
    background: rgba(17, 24, 39, 0.82);
    border-left: ${Math.round(width * 0.006)}px solid #f59e0b;
    border-radius: ${Math.round(width * 0.005)}px;
    padding: ${Math.round(fontSize * 0.55)}px ${Math.round(fontSize * 0.85)}px;
    font-family: 'Noto Sans Devanagari', sans-serif;
    font-weight: 600;
    font-size: ${fontSize}px;
    /* Devanagari matras sit above the line; a tight leading clips them. */
    line-height: 1.45;
    color: #ffffff;
    text-shadow: 0 ${Math.round(fontSize * 0.04)}px ${Math.round(fontSize * 0.12)}px rgba(0, 0, 0, 0.55);
  }
</style>
</head>
<body>
  <div class="stage"><div class="key-point">${escapeHtml(keyPoint)}</div></div>
</body>
</html>`;
}

// Render one scene's key point as a transparent PNG the size of the video
// frame. Returns null for an empty key point — a scene with nothing hard to
// show gets no overlay, which is also how an officer turns the feature off.
export async function renderCaptionOverlay(
  keyPoint: string,
  aspect: CaptionAspect,
): Promise<Buffer | null> {
  const text = keyPoint.trim();
  if (text === '') return null;

  const { fontDataUri } = await loadCaptionAssets();
  const { width, height } = CAPTION_FRAME_SIZE[aspect];
  return renderHtmlToPng(buildCaptionHtml(text, aspect, fontDataUri), {
    width,
    height,
    // 1, not the poster default of 2: the PNG is already at the video's exact
    // pixel size, and supersampling would produce an overlay twice the size of
    // the footage it is composited onto.
    deviceScaleFactor: 1,
    transparent: true,
  });
}
