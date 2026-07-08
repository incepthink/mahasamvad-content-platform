// Build the GPT-image prompt for the poster's BACKGROUND SCENE only.
//
// The old build-prompt.ts asked the model to typeset the entire poster — headline,
// stats, header, footer — which mangled the Devanagari conjuncts. We now let the model
// paint only a text-free photograph for the central image zone; every word is rendered
// later in HTML from the already-correct `copy` (see poster-template.ts). So this prompt
// forbids ALL lettering, logos and borders and asks for a clean documentary photo whose
// subject comes from `copy.scene_brief`.

import type { Copy } from '@dgipr/schemas';

// A hard, repeated "no text" instruction — image models happily add captions and signage
// unless told several times, and any stray glyph would clash with the typeset overlay.
const NO_TEXT =
  'ABSOLUTELY NO text, no letters, no words, no numbers, no captions, no signage, ' +
  'no logos, no emblems, no watermarks, no borders and no UI of any kind anywhere in the image.';

export function buildScenePrompt(copy: Copy): string {
  const subject = copy.scene_brief.trim();
  return [
    'A single photorealistic, documentary-style photograph for the background image zone of a',
    'Government of Maharashtra public-information poster.',
    'Subject: ' + subject,
    'Style: real, natural daylight; authentic skin, fabric and material textures; realistic depth',
    'of field; candid, dignified and hopeful mood. Rich, saturated colours that suit an official',
    'government campaign. Do NOT use illustration, cartoon, flat vector art, 3D render or collage.',
    'Composition: keep the subject roughly centred with clean, uncluttered margins so it crops well',
    'into a wide landscape band.',
    NO_TEXT,
  ].join('\n');
}

// Scene prompt for the LANDSCAPE article image (article-template.ts). Same documentary photo,
// but composed for a full-bleed landscape frame with a text panel on the LEFT: the subject sits
// to the RIGHT and the left side is kept calm and open (sky, field, soft blur) so the maroon
// headline stays legible over it.
export function buildArticleScenePrompt(copy: Copy): string {
  const subject = copy.scene_brief.trim();
  return [
    'A single photorealistic, documentary-style photograph for the full-bleed background of a',
    'wide LANDSCAPE (16:9) Government of Maharashtra public-information banner.',
    'Subject: ' + subject,
    'Style: real, natural daylight; authentic skin, fabric and material textures; realistic depth',
    'of field; candid, dignified and hopeful mood. Rich, saturated colours that suit an official',
    'government campaign. Do NOT use illustration, cartoon, flat vector art, 3D render or collage.',
    'Composition: place the main subject in the RIGHT half / right third of the frame, facing or',
    'looking toward the left. Keep the LEFT third calm, simple and uncluttered — open sky, field',
    'or gently blurred background with no busy detail — so a headline can be overlaid there. The',
    'image must read well when it fills the whole landscape banner edge to edge.',
    NO_TEXT,
  ].join('\n');
}
