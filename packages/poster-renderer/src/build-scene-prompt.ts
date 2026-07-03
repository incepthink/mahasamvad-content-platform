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
