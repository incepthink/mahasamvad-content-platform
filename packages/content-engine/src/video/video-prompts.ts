// Prompt builders for the explainer-video pipeline, STYLIZED-3D flow: an
// animated-film START frame (a fresh generation), an END frame of the SAME
// shot (an EDIT of the start frame), and the motion prompt that interpolates
// between the two. Which image model renders the frames is frame-provider.ts's
// business, and which model animates them is clip-provider.ts's — neither is
// this file's.
//
// The motion prompt therefore serves BOTH clip providers, which is why nothing
// here is named after one of them. Two provider differences land here rather
// than in an adapter, because they are about prompt TEXT: Kling has no
// negative-prompt field (buildAvoidClause restates the list as an instruction
// the prompt itself can carry) and caps prompt length (fitClipPrompt trims to a
// budget in an order that protects the three hard rules below).
//
// Three rules are HARD-APPENDED here regardless of what the visual brief says,
// because the brief is written by a model and these are not negotiable: the
// SETTING (Maharashtra, India — the fix for a pipeline that never named a
// country and got a blonde Western woman back), the no-text rule, and the
// no-talking rule.
//
// No text, because image/video models garble Devanagari (the reason posters
// typeset text in HTML), so the narration carries every word and the visuals
// must stay text-free. On-screen Marathi key points DO exist now, but they are
// typeset by Chromium and burned onto the finished MP4 after Veo
// (poster-renderer/src/video/caption-overlay.ts) — no model ever sees them, so
// nothing here relaxes.
//
// The same quality reasoning bans TALKING: video models glitch badly on
// lip-sync, so characters may appear — close and expressive is fine, that is
// the whole appeal of the animated-film style — but never mid-speech; the
// voiceover carries the words.
//
// Cross-scene consistency has two mechanisms. The project's one `style`
// paragraph is embedded verbatim in every prompt, and from scenes 2..N an
// earlier scene's approved frame rides along as a world reference
// (WORLD_REFERENCE_RULE) — style alone let a four-scene video read as four
// unrelated productions. The optional per-scene `shotHint` (planner-authored,
// e.g. "wide establishing shot, slow push-in") directs framing/camera; legacy
// scenes without one keep the generic lines.

import { pathToFileURL } from 'node:url';

// Stated as a POSITIVE instruction, not just a prohibition, because a bare "no
// text" contradicts the scene itself: an office counter has forms on it and a
// hospital corridor has a door plate, so a model told only "no text" paints
// them anyway and fills them with gibberish Devanagari. Real renders came back
// with a wall sign reading "मरी रूटूम" — not a word. Telling it the paper and
// the boards are BLANK is something it can actually execute.
//
// Emitted as its own final block rather than tacked onto the end of a
// paragraph: it is the most-violated rule in the set and last position is the
// one the image models weight most.
const NO_TEXT_RULE =
  'NO WRITING ANYWHERE IN THE FRAME. No text, letters, numerals, words, ' +
  'captions or subtitles; no signboards, name boards, door plates, notices, ' +
  'banners, hoardings, posters, logos or watermarks. Where the scene would ' +
  'normally carry writing, show it BLANK: signboards and door plates are ' +
  'plain painted panels, forms, receipts, files, folders and papers are ' +
  'unprinted blank sheets, screens and displays are switched off. Devanagari ' +
  'and Latin script both come out as nonsense here, so anything written is a ' +
  'defect — the voiceover carries every word.';

// Characters may be close and expressive (that is the style's appeal), but
// never mid-speech: a frame that looks like someone talking invites the clip
// model to animate the mouth, and lip glitches were the single worst artifact
// in real renders.
const NO_TALKING_STILL_RULE =
  'People may appear naturally, but never mid-speech: mouths closed or ' +
  'neutral, nobody addressing the camera as if speaking.';

const NO_TALKING_MOTION_RULE =
  'No one talks: no speaking, no lip or mouth movement, no dialogue, no one ' +
  'addressing the camera. People may walk, gesture, work, look around, and ' +
  'show natural expression.';

// The look contract shared by both frame prompts — one string so the start
// and end frame cannot drift onto different styles. Stylized 3D replaced the
// photoreal live-action rule 2026-07-26: real renders never quite landed
// "real", and a polished animated-film look is both more forgiving of model
// artifacts and warmer to watch. Bounded on BOTH sides — never live-action,
// never flat 2D — because a bare "3D animation" drifts to whichever end the
// brief suggests.
const ANIMATION_STYLE_RULE =
  'Stylized 3D animated film look, in the manner of a contemporary Pixar or ' +
  'DreamWorks feature: expressive stylized characters with appealing ' +
  'proportions, richly detailed believable environments, soft cinematic ' +
  'lighting, warm filmic colour grading, polished high-end 3D rendering. ' +
  'Clearly an animated film — never live-action footage, never a photograph ' +
  'or photorealistic humans, and never flat 2D vector art, paper-cutout ' +
  'illustration or anime.';

// WHERE we are, stated in code rather than left to the script writer. Nothing
// in this pipeline used to name a country: the style paragraph is authored by
// an LLM that was asked only for lens/framing/palette, the visual briefs are
// English sentences about "a hospital entrance", and the frame prompt said
// "a government explainer video" — so the image model filled the gap from its
// own prior and a real render came back with a blonde Western woman in a
// Maharashtra government video. Hard-appended to all three prompts for the
// same reason NO_TEXT_RULE is: an instructed rule can be lost by whichever
// model is authoring the brief, a code-appended one cannot. Wording follows
// the poster path's buildScenePrompt, which has always named the setting.
const SETTING_RULE =
  'Setting: Maharashtra, India — a Government of Maharashtra public ' +
  'information film. Every character is Indian: Indian faces, skin tones and ' +
  'hair, and clothing as actually worn in Maharashtra (saree, salwar kameez, ' +
  'kurta, shirt and trousers, work and service uniforms). Streets, vehicles, ' +
  'shopfronts, homes, hospitals and government offices as they really look in ' +
  'Maharashtra, with authentic skin, fabric and material textures. Never ' +
  'Western or East Asian people; never a European, American or East Asian ' +
  'location.';

// Emitted only when a reference frame from an EARLIER scene is attached. It has
// to say plainly that the reference is not this scene, or the model reproduces
// its location and action instead of borrowing its world.
const WORLD_REFERENCE_RULE =
  'One attached image is a frame from an EARLIER SCENE of this same ' +
  'video. Keep its world: the same country and region, the same kind of ' +
  'people and clothing, the same colour treatment and animation style. It is ' +
  'NOT this scene — do not copy its location, its framing or its action ' +
  'unless the scene description above asks for the same place.';

// The frame has to EARN its place: the visuals used to be mood B-roll while
// every fact rode on the voiceover, which is what made the videos feel
// decorative. Stated here as well as in the brief spec because the brief is
// LLM-authored and this is not.
const INFORMATIVE_RULE =
  'Show the specific place, people, objects and action this scene is about, ' +
  'close enough to read them — a viewer watching with the sound off should be ' +
  'able to tell what is happening. Not a generic stock mood shot.';

// The "avoid" list, written as bare terms rather than "no ..." because Veo's
// negativePrompt field already negates. Kling has no such field and takes the
// same list through buildAvoidClause instead, which is why this is named for
// the clip step rather than for either provider.
//
// The talking/lip-sync terms back up the motion prompt's no-talking rule. The
// style terms bound the stylized-3D look from BOTH ends: live-action/photoreal
// terms keep the footage animated, flat-2D/anime terms keep it from collapsing
// into cheap illustration. `3D render` and `CGI look` came OUT when the look
// went 3D — they ARE the look now — and `cartoon`/`illustration` came out
// because they sit close enough to the Pixar family to fight it. The setting
// terms are deliberately about PLACE, not people: the people are specified
// positively by SETTING_RULE, which is the safer half of that instruction to
// give a model.
export const CLIP_NEGATIVE_PROMPT =
  'text, letters, numerals, captions, subtitles, words, signage, banners, ' +
  'logos, watermark, talking, speaking, lip sync, lip movement, mouth ' +
  'movement, dialogue, monologue, interview, live-action, photorealistic, ' +
  'photograph, real footage, flat 2D vector art, anime, Western setting, ' +
  'European or American architecture';

// The START frame for one scene. It is what the user approves, what the end
// frame is edited from, and what the clip model animates from — so it must
// already look like a frame OF the video: same style paragraph, same rules.
export function buildKeyframePrompt(
  style: string,
  visualBrief: string,
  shotHint?: string,
  // True when the caller is attaching an earlier scene's frame as a world
  // reference (scenes 2..N). Only ever set on a fresh generation — see
  // frame-provider.ts for why an edit never carries one.
  hasWorldReference?: boolean,
): string {
  return [
    `Cinematic style: ${style.trim()}`,
    '',
    `Scene: ${visualBrief.trim()}`,
    ...(shotHint ? ['', `Framing: ${shotHint.trim()}`] : []),
    '',
    SETTING_RULE,
    ...(hasWorldReference ? ['', WORLD_REFERENCE_RULE] : []),
    '',
    'This is the opening frame of one continuous animated shot in a ' +
      'Government of Maharashtra explainer video. ' +
      ANIMATION_STYLE_RULE +
      ' Clean composition with a clear focal subject. ' +
      INFORMATIVE_RULE +
      ' ' +
      NO_TALKING_STILL_RULE,
    '',
    NO_TEXT_RULE,
  ].join('\n');
}

// The END frame, as an images/EDITS instruction over the start frame. Editing
// (rather than generating fresh) is what keeps the pair inside ONE shot —
// same location, characters, light and lens — so the interpolation reads as
// motion within the scene instead of a crossfade between two places.
export function buildEndFramePrompt(
  style: string,
  endVisualBrief: string,
  shotHint?: string,
): string {
  return [
    'Edit this image into the FINAL frame of the same continuous ' +
      'animated shot. Keep the same location, the same characters, the same ' +
      'lighting, colour palette and camera framing — this is the same scene ' +
      'a few seconds later, not a new one.',
    '',
    `By the end of the shot: ${endVisualBrief.trim()}`,
    ...(shotHint
      ? ['', `The camera move across the shot: ${shotHint.trim()}`]
      : []),
    '',
    `Cinematic style (unchanged): ${style.trim()}`,
    '',
    // Repeated on the edit as well: an edit prompt that stops naming the
    // setting lets the model "correct" the people or the place while it moves
    // the action on, which would break the pair the interpolation depends on.
    SETTING_RULE,
    '',
    ANIMATION_STYLE_RULE + ' ' + NO_TALKING_STILL_RULE,
    '',
    // Also on the edit: the source frame may itself contain writing the
    // generator slipped in, and an edit prompt that says nothing about text
    // will faithfully preserve it.
    NO_TEXT_RULE + ' Remove any writing already visible in the image.',
  ].join('\n');
}

// Line prefixes fitClipPrompt trims against. They live beside the builder that
// emits them so the two cannot drift; the harness asserts the trimmer actually
// finds them.
const STYLE_PREFIX = 'Visual style (keep it exactly): ';
const OPEN_PREFIX = 'The shot opens on: ';
const END_PREFIX = 'It ends on the provided final frame: ';
const AVOID_PREFIX = 'Avoid all of the following';

// The motion prompt for one scene, provider-neutral. With interpolation the
// model receives BOTH approved frames, so the prompt directs the journey
// between them rather than re-describing the scene — re-description is what
// makes the model wander off the approved look. When the planner supplied a
// shot hint it REPLACES the generic camera line, so each scene gets directed
// motion. The same prompt serves a legacy first-frame-only render.
//
// Every trimmable field is its OWN line, and the instruction that makes
// interpolation work ("move naturally … to that final frame") is a separate
// line from the brief it follows — otherwise fitClipPrompt, shortening the
// brief, would cut the instruction off its tail.
export function buildClipMotionPrompt(
  style: string,
  visualBrief: string,
  shotHint?: string,
  endVisualBrief?: string,
): string {
  const cameraLine = shotHint
    ? `Camera: ${shotHint.trim()}. Smooth, continuous, purposeful motion — ` +
      'no cuts, no scene changes, no camera shake.'
    : 'Camera: one smooth, continuous move (a slow push, pan or track). ' +
      'No cuts, no scene changes, no camera shake.';
  return [
    'One continuous shot of a calm, informative Government of Maharashtra ' +
      'explainer video, in stylized 3D animation (a contemporary ' +
      'Pixar/DreamWorks-style animated film — never live-action).',
    SETTING_RULE,
    `${STYLE_PREFIX}${style.trim()}`,
    `${OPEN_PREFIX}${visualBrief.trim()}`,
    ...(endVisualBrief
      ? [
          `${END_PREFIX}${endVisualBrief.trim()}`,
          'Move naturally and continuously from the first frame to that ' +
            'final frame within this single shot.',
        ]
      : []),
    cameraLine,
    NO_TALKING_MOTION_RULE,
    NO_TEXT_RULE,
  ].join('\n');
}

// Restate the negative list as something a prompt can carry. Kling's
// image-to-video API has NO negative_prompt field — its docs say the prompt
// itself holds both positive and negative description — and pasting a bare
// comma list of nouns into an otherwise positive prompt reads as a shopping
// list of things to INCLUDE. So it becomes an explicit instruction.
export function buildAvoidClause(negativePrompt: string): string {
  const list = negativePrompt.trim().replace(/[.\s]+$/, '');
  if (list === '') return '';
  return `${AVOID_PREFIX} in every frame: ${list}.`;
}

// Trim an assembled clip prompt toward a provider's character budget.
//
// The DROP ORDER is the whole point and is asserted by the harness, not
// trusted. SETTING_RULE, NO_TALKING_MOTION_RULE and NO_TEXT_RULE are NEVER
// touched — they are the three rules the pipeline learned the hard way (a
// blonde Western woman, glitching lips, a wall sign reading "मरी रूटूम"), and
// they sit at the END of the prompt, which is exactly where a naive tail
// truncation would eat them. Hence no blind `.slice()` anywhere here.
//
// What goes, cheapest first:
//   1. the Avoid clause — a BACKUP for rules the protected blocks already state
//      positively, so losing it costs the least
//   2. the style paragraph, truncated toward a floor — least load-bearing of
//      the descriptive fields on this call, because the style is already baked
//      into the two approved frames the model is interpolating between
//   3. the end brief, then the opening brief, truncated toward a floor
//   4. the style paragraph dropped outright
//
// If even that will not fit, it WARNS and returns the best it has rather than
// mutilating a rule: the budget passed in is Kling's *recommended* 2500, while
// its hard cap is 3072, so a small overshoot is survivable and a missing
// no-text rule is not.
export function fitClipPrompt(prompt: string, maxChars: number): string {
  if (prompt.length <= maxChars) return prompt;

  let lines = prompt.split('\n');
  const rendered = (): string => lines.join('\n').trim();

  lines = lines.filter((line) => !line.startsWith(AVOID_PREFIX));
  if (rendered().length <= maxChars) return rendered();

  // Floors below which a field stops carrying meaning at all.
  for (const [prefix, floor] of [
    [STYLE_PREFIX, 80],
    [END_PREFIX, 120],
    [OPEN_PREFIX, 120],
  ] as const) {
    const index = lines.findIndex((line) => line.startsWith(prefix));
    if (index === -1) continue;
    const body = (lines[index] as string).slice(prefix.length);
    const overflow = rendered().length - maxChars;
    if (overflow <= 0) break;
    const keep = Math.max(floor, body.length - overflow);
    if (keep >= body.length) continue;
    lines[index] = prefix + body.slice(0, keep).trimEnd();
    if (rendered().length <= maxChars) return rendered();
  }

  const styleIndex = lines.findIndex((line) => line.startsWith(STYLE_PREFIX));
  if (styleIndex !== -1) {
    lines.splice(styleIndex, 1);
    if (rendered().length <= maxChars) return rendered();
  }

  console.warn(
    `[video-prompts] clip prompt is ${rendered().length} chars against a ` +
      `${maxChars} budget even after trimming. Sending it anyway — the three ` +
      'hard rules matter more than the budget. If this repeats, the visual ' +
      'briefs are running long and the script generator is where to fix it.',
  );
  return rendered();
}

// Free self-check of the rules that must reach the model on EVERY prompt. They
// are load-bearing and invisible — a frame prompt that quietly lost its setting
// rule looks exactly like one that has it until a render comes back with the
// wrong country — so they are asserted rather than trusted.
//
//   tsx src/video/video-prompts.ts
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const failures: string[] = [];
  const check = (label: string, ok: boolean): void => {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
    if (!ok) failures.push(label);
  };

  const style =
    'Stylized 3D animated film, Maharashtra, soft daylight, warm palette.';
  const brief = 'A technician guides a trolley into an MRI scanner.';
  const endBrief = 'The trolley is fully inside; the technician steps back.';
  const hint = 'medium shot, slow push-in';

  const start = buildKeyframePrompt(style, brief, hint);
  const startWithRef = buildKeyframePrompt(style, brief, hint, true);
  const end = buildEndFramePrompt(style, endBrief, hint);
  const motion = buildClipMotionPrompt(style, brief, hint, endBrief);

  for (const [label, prompt] of [
    ['start frame', start],
    ['end frame', end],
    ['clip motion', motion],
  ] as const) {
    check(`${label}: names Maharashtra`, prompt.includes('Maharashtra, India'));
    check(`${label}: rules out Western people`, /Never Western/.test(prompt));
    check(`${label}: forbids all writing`, /NO WRITING ANYWHERE/.test(prompt));
    // The positive half is what the model can actually execute — a bare
    // prohibition against text in a scene that contains forms is a
    // contradiction, and the model resolves it by inventing gibberish.
    check(`${label}: says what to show instead`, /BLANK/.test(prompt));
    check(`${label}: forbids talking`, /never mid-speech|No one talks/.test(prompt));
    check(`${label}: carries the style paragraph`, prompt.includes(style));
    // The 3D inversion (2026-07-26): every prompt must DEMAND the animated-film
    // look and explicitly rule live-action out — a prompt that merely stopped
    // saying "photoreal" would let the model default back to it.
    check(
      `${label}: demands the animated-film look`,
      /stylized 3D|animated film|animated shot/i.test(prompt),
    );
    check(
      `${label}: rules out live-action`,
      /never live-action/i.test(prompt),
    );
  }

  // The reference clause is the one rule that must NOT always be there: it
  // describes an attached image, so emitting it without one would have the
  // model looking for a photograph that was never sent.
  check(
    'start frame: no reference clause without a reference',
    !start.includes('EARLIER SCENE'),
  );
  check(
    'start frame: reference clause when one is attached',
    startWithRef.includes('EARLIER SCENE'),
  );
  check(
    'end frame: never claims an earlier-scene reference',
    !end.includes('EARLIER SCENE'),
  );
  check(
    'start frame: demands the scene be legible with the sound off',
    start.includes('sound off'),
  );
  check(
    'negative prompt: bars a Western setting',
    CLIP_NEGATIVE_PROMPT.includes('Western setting'),
  );
  // Removed deliberately in the realistic era and still out — expressive
  // character faces are the appeal of the animated-film style.
  check(
    'negative prompt: still allows faces and close-ups',
    !/close-up face|photorealistic faces/.test(CLIP_NEGATIVE_PROMPT),
  );
  // The 3D inversion of the negative list: photoreal terms went IN, the terms
  // that ARE the new look (3D render, CGI) came OUT, and the flat-2D/anime
  // terms stayed so the style cannot collapse into cheap illustration.
  check(
    'negative prompt: bans live-action and photorealism',
    CLIP_NEGATIVE_PROMPT.includes('live-action') &&
      CLIP_NEGATIVE_PROMPT.includes('photorealistic'),
  );
  check(
    'negative prompt: no longer bans the 3D look',
    !/3D render|CGI look|cartoon|illustration/.test(CLIP_NEGATIVE_PROMPT),
  );
  check(
    'negative prompt: still bans flat 2D and anime',
    CLIP_NEGATIVE_PROMPT.includes('flat 2D') &&
      CLIP_NEGATIVE_PROMPT.includes('anime'),
  );

  // The avoid clause is how a provider with no negative_prompt field (Kling)
  // still gets the list. It must read as an instruction, not as a noun list.
  const avoid = buildAvoidClause(CLIP_NEGATIVE_PROMPT);
  check('avoid clause: is an instruction', avoid.startsWith('Avoid all of'));
  check('avoid clause: carries the list', avoid.includes('Western setting'));
  check('avoid clause: ends as a sentence', avoid.endsWith('.'));
  check('avoid clause: empty in, empty out', buildAvoidClause('  ') === '');

  // The prompt budget. The worst case is real and reachable: style is capped at
  // VIDEO_STYLE_MAX_CHARS (1200) and each brief at 600, which assembles to well
  // over Kling's recommended 2500 before anything is trimmed.
  const fatStyle = 'S'.repeat(1200);
  const fatBrief = 'B'.repeat(600);
  const fatEnd = 'E'.repeat(600);
  const fat =
    buildClipMotionPrompt(fatStyle, fatBrief, hint, fatEnd) + '\n\n' + avoid;
  const fitted = fitClipPrompt(fat, 2500);
  check('fit: worst case actually overflows', fat.length > 2500);
  check('fit: worst case is brought under budget', fitted.length <= 2500);
  check('fit: drops the avoid clause first', !fitted.includes('Avoid all of'));
  // The three rules the trimmer must never reach, re-checked on the TRIMMED
  // prompt — a tail truncation would have taken all three, since they sit last.
  check('fit: keeps the setting rule', fitted.includes('Maharashtra, India'));
  check('fit: keeps the no-writing rule', fitted.includes('NO WRITING ANYWHERE'));
  check('fit: keeps the no-talking rule', fitted.includes('No one talks'));
  check(
    'fit: keeps the interpolation instruction',
    fitted.includes('Move naturally and continuously'),
  );
  // A typical prompt must pass through untouched, or every ordinary render
  // would silently lose its style paragraph.
  const typical = buildClipMotionPrompt(style, brief, hint, endBrief) + '\n\n' + avoid;
  check('fit: typical prompt is unchanged', fitClipPrompt(typical, 2500) === typical);

  console.log(
    failures.length === 0
      ? '\nAll prompt checks passed.'
      : `\n${failures.length} check(s) FAILED.`,
  );
  process.exitCode = failures.length === 0 ? 0 : 1;
}
