// Prompt builders for the explainer-video pipeline: the storyboard keyframe
// (gpt-image still, gate 2) and the Veo motion prompt (image-to-video).
//
// Both HARD-APPEND the no-text rule regardless of what the visual brief says:
// image/video models garble Devanagari (the reason posters typeset text in
// HTML), so the narration carries every word and the visuals must stay
// text-free. The same reasoning bans TALKING: Veo glitches badly on lip/mouth
// movement, so characters may appear but never speak — the no-talking rule is
// likewise hard-appended, not left to the visual brief. The project's one
// `style` paragraph is embedded verbatim in every prompt — that shared string
// is the v1 cross-scene consistency mechanism. The optional per-scene
// `shotHint` (planner-authored, e.g. "wide establishing shot, slow push-in")
// directs framing/camera; legacy scenes without one keep the generic lines.

const NO_TEXT_RULE =
  'Absolutely no on-screen text, letters, numerals, captions, subtitles, ' +
  'signage, banners, or logos anywhere in the image.';

const NO_TALKING_STILL_RULE =
  'If people appear, show them at medium or wide distance with neutral, ' +
  'closed mouths — never mid-speech, never addressing the camera, never a ' +
  'close-up of a face.';

const NO_TALKING_MOTION_RULE =
  'Characters, if any, never talk: no speaking, no lip or mouth movement, ' +
  'no one addressing the camera. They may walk, gesture, or work quietly. ' +
  'Keep faces at medium or wide distance — never a close-up.';

// Passed to Veo as negativePrompt (describe what to avoid, not "no ..." — the
// negative field already negates). The talking/lip-sync terms back up the
// motion prompt's no-talking rule: glitchy mouth animation was the single
// worst artifact in real renders.
export const VEO_NEGATIVE_PROMPT =
  'text, letters, numerals, captions, subtitles, words, signage, banners, ' +
  'logos, watermark, photorealistic faces, talking, speaking, lip sync, ' +
  'lip movement, mouth movement, dialogue, monologue, interview, close-up face';

// The storyboard still for one scene. The still is what the user approves and
// what Veo animates from, so it must already look like a frame OF the video:
// same style paragraph, same no-text/no-talking rules.
export function buildKeyframePrompt(
  style: string,
  visualBrief: string,
  shotHint?: string,
): string {
  return [
    `Illustration style: ${style.trim()}`,
    '',
    `Scene: ${visualBrief.trim()}`,
    ...(shotHint ? ['', `Framing: ${shotHint.trim()}`] : []),
    '',
    'This is one keyframe of an animated government explainer video. ' +
      'Clean composition with a clear focal subject and quiet edges. ' +
      'Flat 2D illustration, not a photograph. ' +
      NO_TALKING_STILL_RULE +
      ' ' +
      NO_TEXT_RULE,
  ].join('\n');
}

// The Veo image-to-video prompt for one scene. The input image IS the approved
// keyframe, so the prompt asks for gentle motion within that scene rather than
// re-describing it from scratch — re-description is what makes the model wander
// off the approved look. When the planner supplied a shot hint it REPLACES the
// generic camera line, so each scene gets directed motion instead of the same
// slow push everywhere.
export function buildVeoMotionPrompt(
  style: string,
  visualBrief: string,
  shotHint?: string,
): string {
  const cameraLine = shotHint
    ? `Camera and motion: ${shotHint.trim()}. Soft ambient movement only ` +
      '(people walking, leaves, water, subtle icon motion). No scene changes, ' +
      'no cuts, no camera shake, no new objects or characters.'
    : 'Gentle, purposeful motion only: a slow camera push or pan, soft ambient ' +
      'movement (people walking, leaves, water, subtle icon motion). No scene ' +
      'changes, no cuts, no camera shake, no new objects or characters.';
  return [
    'Animate this illustrated scene as one shot of a calm, informative ' +
      'government explainer video.',
    `Visual style (keep it exactly): ${style.trim()}`,
    `Scene content: ${visualBrief.trim()}`,
    cameraLine,
    NO_TALKING_MOTION_RULE,
    NO_TEXT_RULE,
  ].join('\n');
}
