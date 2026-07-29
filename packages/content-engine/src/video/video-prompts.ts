// Prompts for the three visual stages of a video scene:
//   1. generate an approved opening frame;
//   2. optionally edit it into a required final state;
//   3. animate the shot from the opening frame, with the final frame only when
//      the planner decided that the destination matters.
//
// These prompts intentionally leave action and camera motion open. The model
// receives a small set of durable constraints, not a long list that turns every
// scene into a locked photograph.

import { pathToFileURL } from 'node:url';

const NO_TEXT_RULE =
  'No visible writing, captions, subtitles, logos or watermarks. Keep any ' +
  'signs, papers and screens blank because verified Marathi text is added later.';

const NO_TALKING_RULE =
  'Nobody speaks or addresses the camera; mouths remain naturally closed because the voiceover carries the words.';

const FEW_PEOPLE_RULE =
  'Keep active characters to the minimum needed for the scene, preferably one person and no more than two when an interaction is essential.';

const REALISM_RULE =
  'Realistic cinematic live-action with natural movement, authentic people and places, and consistent anatomy and identity.';

const SETTING_RULE =
  'Set in Maharashtra, India, with Indian people, clothing, buildings, vehicles and public spaces that feel authentic to the location.';

const WORLD_REFERENCE_RULE =
  'An attached image comes from an earlier scene in this video. Use it only to keep the same visual world, colour treatment and production style; create the new location and action described here.';

export const CLIP_NEGATIVE_PROMPT =
  'text, captions, subtitles, logos, watermark, talking, lip sync, distorted ' +
  'anatomy, extra limbs, extra fingers, identity changes, face morphing, ' +
  'flicker, jitter, camera shake, abrupt cuts, cartoon, illustration, 3D render, CGI look';

export function buildKeyframePrompt(
  style: string,
  visualBrief: string,
  shotHint?: string,
  hasWorldReference?: boolean,
): string {
  return [
    `Visual style: ${style.trim()}`,
    `Opening scene: ${visualBrief.trim()}`,
    ...(shotHint ? [`Framing: ${shotHint.trim()}`] : []),
    '',
    'Create the opening frame of an engaging Government of Maharashtra explainer-video shot. Show a natural starting moment with room for the subject and camera to move.',
    SETTING_RULE,
    REALISM_RULE,
    FEW_PEOPLE_RULE,
    ...(hasWorldReference ? [WORLD_REFERENCE_RULE] : []),
    NO_TALKING_RULE,
    NO_TEXT_RULE,
  ].join('\n');
}

export function buildEndFramePrompt(
  style: string,
  endVisualBrief: string,
  shotHint?: string,
): string {
  return [
    'Edit the source image into the final frame of the same continuous live-action shot.',
    `Required final state: ${endVisualBrief.trim()}`,
    ...(shotHint ? [`Keep the same camera direction: ${shotHint.trim()}`] : []),
    `Visual style: ${style.trim()}`,
    '',
    'Keep the same people, identities, location and overall look while allowing every natural physical change needed to reach the required final state.',
    SETTING_RULE,
    REALISM_RULE,
    FEW_PEOPLE_RULE,
    NO_TALKING_RULE,
    NO_TEXT_RULE,
  ].join('\n');
}

const STYLE_PREFIX = 'Visual style: ';
const OPEN_PREFIX = 'Opening scene: ';
const END_PREFIX = 'Required final state: ';
const AVOID_PREFIX = 'Avoid all of the following';

export function buildClipMotionPrompt(
  style: string,
  visualBrief: string,
  shotHint?: string,
  endVisualBrief?: string,
): string {
  return [
    'Create one engaging, realistic live-action shot for a Government of Maharashtra explainer video.',
    SETTING_RULE,
    `${STYLE_PREFIX}${style.trim()}`,
    `${OPEN_PREFIX}${visualBrief.trim()}`,
    ...(endVisualBrief
      ? [
          `${END_PREFIX}${endVisualBrief.trim()}`,
          'Move naturally from the opening frame to the provided final frame, making the change feel motivated and continuous.',
        ]
      : [
          'There is no prescribed final frame. Develop the action naturally and use the available time to create meaningful subject and camera movement.',
        ]),
    ...(shotHint
      ? [
          `Camera direction: ${shotHint.trim()}. Use it naturally rather than holding a rigid composition.`,
        ]
      : [
          'Choose natural camera movement that makes the action clear and engaging.',
        ]),
    'Keep all camera movement smooth and stable with no camera shake.',
    'Allow realistic body movement, object movement and subtle environmental motion. Keep identities and the location coherent throughout the single shot.',
    FEW_PEOPLE_RULE,
    NO_TALKING_RULE,
    NO_TEXT_RULE,
  ].join('\n');
}

// Kling has no separate negative-prompt field, so its adapter appends this
// explicit instruction to the positive motion prompt.
export function buildAvoidClause(negativePrompt: string): string {
  const list = negativePrompt.trim().replace(/[.\s]+$/, '');
  if (list === '') return '';
  return `${AVOID_PREFIX} in every frame: ${list}.`;
}

// Keep provider-facing prompts inside the recommended character budget without
// truncating the continuity, speech or text instructions.
export function fitClipPrompt(prompt: string, maxChars: number): string {
  if (prompt.length <= maxChars) return prompt;

  let lines = prompt.split('\n');
  const rendered = (): string => lines.join('\n').trim();

  lines = lines.filter((line) => !line.startsWith(AVOID_PREFIX));
  if (rendered().length <= maxChars) return rendered();

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
      `${maxChars} recommended budget after trimming. Sending it because the ` +
      'remaining continuity, speech and text instructions are more important.',
  );
  return rendered();
}

// Free prompt-contract harness:
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

  const style = 'Cinematic documentary realism with natural daylight.';
  const brief = 'A woman opens the front door of a city bus and steps aboard.';
  const endBrief = 'The bus door is fully closed after she boards.';
  const hint = 'medium tracking shot';

  const start = buildKeyframePrompt(style, brief, hint);
  const startWithRef = buildKeyframePrompt(style, brief, hint, true);
  const end = buildEndFramePrompt(style, endBrief, hint);
  const motion = buildClipMotionPrompt(style, brief, hint, endBrief);
  const startOnlyMotion = buildClipMotionPrompt(style, brief, hint);

  for (const [label, prompt] of [
    ['start frame', start],
    ['end frame', end],
    ['clip motion', motion],
  ] as const) {
    check(`${label}: names Maharashtra`, prompt.includes('Maharashtra, India'));
    check(`${label}: carries the style`, prompt.includes(style));
    check(`${label}: asks for live action`, /live-action/i.test(prompt));
    check(
      `${label}: minimizes active people`,
      prompt.includes('minimum needed'),
    );
    check(
      `${label}: forbids model text`,
      prompt.includes('No visible writing'),
    );
    check(`${label}: forbids talking`, prompt.includes('Nobody speaks'));
  }

  check(
    'start frame: reference is conditional',
    !start.includes('earlier scene') && startWithRef.includes('earlier scene'),
  );
  check(
    'end frame: names the required destination',
    end.includes(`${END_PREFIX}${endBrief}`),
  );
  check(
    'motion with end frame: directs the transition',
    motion.includes('provided final frame') && motion.includes(endBrief),
  );
  check(
    'motion without end frame: gives the model freedom',
    startOnlyMotion.includes('no prescribed final frame') &&
      startOnlyMotion.includes('meaningful subject and camera movement') &&
      !startOnlyMotion.includes(END_PREFIX),
  );
  check(
    'motion prompt: does not freeze the scene',
    !/Everything else stays still|locked frame|hold the close composition/.test(
      startOnlyMotion,
    ),
  );
  check(
    'motion prompt: forbids camera shake',
    startOnlyMotion.includes('no camera shake'),
  );
  check(
    'negative prompt: keeps technical failure terms',
    CLIP_NEGATIVE_PROMPT.includes('distorted anatomy') &&
      CLIP_NEGATIVE_PROMPT.includes('face morphing') &&
      CLIP_NEGATIVE_PROMPT.includes('lip sync') &&
      CLIP_NEGATIVE_PROMPT.includes('camera shake'),
  );
  check(
    'negative prompt: does not ban scene energy',
    !/wide shot|crowd|busy background|simultaneous actions/.test(
      CLIP_NEGATIVE_PROMPT,
    ),
  );

  const avoid = buildAvoidClause(CLIP_NEGATIVE_PROMPT);
  check('avoid clause: is an instruction', avoid.startsWith('Avoid all of'));
  check('avoid clause: carries the list', avoid.includes('distorted anatomy'));
  check('avoid clause: empty in, empty out', buildAvoidClause('  ') === '');

  const fatStyle = 'S'.repeat(1200);
  const fatBrief = 'B'.repeat(600);
  const fatEnd = 'E'.repeat(600);
  const fat =
    buildClipMotionPrompt(fatStyle, fatBrief, hint, fatEnd) + '\n\n' + avoid;
  const fitted = fitClipPrompt(fat, 2500);
  check('fit: worst case overflows before trimming', fat.length > 2500);
  check('fit: worst case fits after trimming', fitted.length <= 2500);
  check('fit: keeps Maharashtra', fitted.includes('Maharashtra, India'));
  check(
    'fit: keeps the final-frame transition',
    fitted.includes('provided final frame'),
  );
  check('fit: keeps the no-text rule', fitted.includes('No visible writing'));
  check('fit: keeps the no-talking rule', fitted.includes('Nobody speaks'));

  console.log(
    failures.length === 0
      ? '\nAll prompt checks passed.'
      : `\n${failures.length} check(s) FAILED.`,
  );
  process.exitCode = failures.length === 0 ? 0 : 1;
}
