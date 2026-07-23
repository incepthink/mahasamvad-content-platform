// The CMO (मंत्रिमंडळ निर्णय) poster's photo zone, in one place.
//
// The official CMO design puts TWO OVERLAPPING CIRCLES in the upper right, each
// holding a different photograph. The image model could never render that reliably —
// it painted one photo plus a flat blue crescent where the second circle belongs — so
// we DROPPED the second circle: a CMO poster now shows ONE photograph in the big circle
// (CMO_BIG), and that photo is generated + composited entirely in code (overlayCmoChrome),
// NOT painted by the master-edit model. The model is told to leave the circle zone quiet.
//
// cmo-header.png carries the two-lobe cut-out shape as a hole in its opaque blue leader
// band (it is a fixed brand asset — its shape is not ours to change). So CMO_SMALL is
// STILL defined here, but purely as a FILLED lobe: scripts/build-cmo-photo-frame.ts paints
// it over (band-colour above the band, page white below) so no hole opens under the header.
// It is never a photo window anymore.
//
// So the geometry is pinned here, and scripts/build-cmo-photo-frame.ts bakes it into ONE
// overlay asset (cmo-photo-frame.png) that covers everything OUTSIDE the big circle. The
// shape of the photo zone is then deterministic no matter what the model paints; code
// supplies the pixels seen through the single big hole.
//
// The numbers are not invented — they were recovered from cmo-header.png's own alpha
// channel by least-squares circle fits on the two lobes of the cut-out, and both lobes
// turned out to be circles to within ~1.5 px:
//
//   big    centre (796.0, 259.9) r 226.4   max fit error 1.42 px
//   small  centre (612.3, 213.0) r 117.9   max fit error 1.52 px
//
// on the 1080x1350 canvas the header is authored at. Centre distance is 189.6 px, so
// the two overlap by 154.7 px, and the big circle's centre sits on the band line
// (259.9 vs the band's last opaque row, 259) — half of it carved from the band, half
// hanging over the white poster body.
//
// EVERY value below is a fraction of the poster WIDTH, including the vertical ones.
// That is the convention loadScaled() establishes for all the chrome overlays: assets
// are scaled by width with their aspect ratio preserved, so one scale factor drives
// both axes and a differently sized render still lines up.
//
// Keep these in sync with the percentages the n8n workflow's CMO prompt branches quote
// to the image model (Build Image Prompt / Build Feedback Prompt in
// n8n/workflow-exports/social-post-v2-api.json). Tune any of it for free — no model
// call — with `pnpm --filter @dgipr/poster-renderer poster:preview:chrome:cmo`.

export type CmoCircle = Readonly<{ cx: number; cy: number; r: number }>;

// The canvas cmo-header.png (and therefore every generated frame asset) is authored at.
export const CMO_ASSET_WIDTH = 1080;
export const CMO_ASSET_HEIGHT = 1350;

// Last opaque row of the leader band, y = 259 on the authoring canvas. Above it the
// frame fills with band blue, below it with page white.
export const CMO_BAND_BOTTOM = 259 / CMO_ASSET_WIDTH;

// The main photograph — the large circle on the right.
export const CMO_BIG: CmoCircle = {
  cx: 796.0 / CMO_ASSET_WIDTH,
  cy: 259.9 / CMO_ASSET_WIDTH,
  r: 226.4 / CMO_ASSET_WIDTH,
};

// The smaller lobe overlapping the big circle on the left. No longer a photo window —
// it is only kept so the frame paints over it (see the header note above), closing the
// header's two-lobe cut-out into a single clean circle.
export const CMO_SMALL: CmoCircle = {
  cx: 612.3 / CMO_ASSET_WIDTH,
  cy: 213.0 / CMO_ASSET_WIDTH,
  r: 117.9 / CMO_ASSET_WIDTH,
};

// How far below the band line the frame keeps painting over the model's output. It has
// to reach past the bottom of the big circle, or a photo that bleeds low leaves a stray
// blob under the circle; it must not reach so far left that it clips the headline and
// kicker, which sit left of the circles. Right edge = the canvas edge, bottom = the big
// circle's bottom plus a pad, left edge = the small circle's left edge with only a
// hairline overshoot: in a real render the kicker chip's right edge lands around .44 of
// the width, so ~.006 is bought comfortably and anything reaching closer than that to the
// photo zone is already a layout error.
export const CMO_BELOW_BAND_FILL = {
  left: CMO_SMALL.cx - CMO_SMALL.r - 0.006,
  right: 1,
  bottom: CMO_BIG.cy + CMO_BIG.r + 0.02,
} as const;

// The translucent light-blue frame ring, carried over unchanged from the previous
// omega-ring generator so the poster's look does not shift: half-thickness in fractions
// of the width (11 px on the authoring canvas), the official soft blue, and an alpha
// that lets the photograph read through the band.
export const CMO_RING = {
  halfThickness: 11 / CMO_ASSET_WIDTH,
  color: { r: 150, g: 190, b: 235 },
  alpha: 150,
} as const;
