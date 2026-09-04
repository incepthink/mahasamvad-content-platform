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

const NO_TALKING_RULE =
  'Nobody speaks or addresses the camera; mouths remain naturally closed because the voiceover carries the words.';

const FEW_PEOPLE_RULE =
  'Keep active characters to the minimum needed for the scene, preferably one person and no more than two when an interaction is essential.';

const REALISM_RULE =
  'Realistic cinematic live-action with natural movement, authentic people and places, and consistent anatomy and identity.';

const SETTING_RULE =
  'Set in Maharashtra, India, with Indian people, clothing, buildings, vehicles and public spaces that feel authentic to the location.';

// Which single picture, if any, is attached to a start-frame render. One at a
// time by construction — the frame seam carries one reference image, because two
// inline pictures under one instruction leave the model guessing which is which.
export type KeyframeReference = 'world' | 'supplied';

export const CLIP_NEGATIVE_PROMPT =
  'talking, lip sync, distorted anatomy, extra limbs, extra fingers, identity ' +
  'changes, face morphing, flicker, jitter, camera shake, abrupt cuts, cartoon, ' +
  'illustration, 3D render, CGI look';

export function buildKeyframePrompt(
  _style: string,
  _visualBrief: string,
  _shotHint?: string,
  _reference?: KeyframeReference,
): string {
  return 'make a storyboard for a social media Video for Maharashtra DGIPR department';
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
  ].join('\n');
}

const STYLE_PREFIX = 'Visual style: ';
const OPEN_PREFIX = 'Opening scene: ';
const END_PREFIX = 'Required final state: ';
const MOTION_PREFIX = 'Detailed performance direction: ';
const CAMERA_PREFIX = 'Camera direction: ';
const AVOID_PREFIX = 'Avoid all of the following';

const INTERPOLATION_RULE =
  'Move naturally from the opening frame to the provided final frame, making the change feel motivated and continuous.';

// fitClipPrompt trims line by line, so every model-authored field must occupy
// exactly ONE line. A style paragraph or a brief that arrives with newlines
// would otherwise put most of its characters on lines carrying no prefix, which
// the trimmer cannot see and cannot shed — the shape that sent a 3000+ char
// prompt at Kling's 3072 hard cap.
const oneLine = (value: string): string => value.trim().replace(/\s+/g, ' ');

export function buildClipMotionPrompt(
  style: string,
  visualBrief: string,
  shotHint?: string,
  endVisualBrief?: string,
  motionBrief?: string,
): string {
  const directedMotion = motionBrief ? oneLine(motionBrief) : '';
  const directedCamera = shotHint ? oneLine(shotHint) : '';
  return [
    'Create one engaging, realistic live-action shot for a Government of Maharashtra explainer video.',
    SETTING_RULE,
    `${STYLE_PREFIX}${oneLine(style)}`,
    `${OPEN_PREFIX}${oneLine(visualBrief)}`,
    ...(directedMotion
      ? [`${MOTION_PREFIX}${directedMotion}`]
      : [
          'Develop the action naturally and use the available time to create meaningful subject and camera movement.',
        ]),
    ...(endVisualBrief
      ? [`${END_PREFIX}${oneLine(endVisualBrief)}`, INTERPOLATION_RULE]
      : [
          'There is no prescribed final frame. Develop the action naturally and use the available time to create meaningful subject and camera movement.',
        ]),
    ...(directedCamera
      ? [
          `${CAMERA_PREFIX}${directedCamera}. Use it naturally rather than holding a rigid composition.`,
        ]
      : [
          'Choose natural camera movement that makes the action clear and engaging.',
        ]),
    'Keep all camera movement smooth and stable with no camera shake.',
    'Allow realistic body movement, object movement and subtle environmental motion. Keep identities and the location coherent throughout the single shot.',
    FEW_PEOPLE_RULE,
    NO_TALKING_RULE,
  ].join('\n');
}

// Kling has no separate negative-prompt field, so its adapter appends this
// explicit instruction to the positive motion prompt.
export function buildAvoidClause(negativePrompt: string): string {
  const list = negativePrompt.trim().replace(/[.\s]+$/, '');
  if (list === '') return '';
  return `${AVOID_PREFIX} in every frame: ${list}.`;
}

// The lines a trimmed prompt keeps at any cost: they carry the setting, the
// people/speech rules and the interpolation instruction, which is what the paid
// render is buying. Everything else is describable detail that may be shortened.
const PROTECTED_LINES: readonly string[] = [
  SETTING_RULE,
  FEW_PEOPLE_RULE,
  NO_TALKING_RULE,
  INTERPOLATION_RULE,
];

// Which model-authored field is shed first, and how much of it survives while a
// prompt is only over the RECOMMENDED budget.
const TRIMMABLE: readonly (readonly [string, number])[] = [
  [STYLE_PREFIX, 80],
  [END_PREFIX, 120],
  [OPEN_PREFIX, 120],
  [CAMERA_PREFIX, 120],
  [MOTION_PREFIX, 600],
];

// Keep provider-facing prompts inside the recommended character budget without
// truncating the continuity or speech instructions. `hardMaxChars` is a limit
// the provider ENFORCES (Kling rejects >3072 outright), so once it is supplied
// the result is guaranteed to fit it — overshooting there is not a trade-off
// between rules, it is a failed render.
export function fitClipPrompt(
  prompt: string,
  maxChars: number,
  hardMaxChars?: number,
): string {
  const hardMax =
    hardMaxChars === undefined ? undefined : Math.max(hardMaxChars, 0);
  if (prompt.length <= maxChars) return prompt;

  let lines = prompt.split('\n');
  const rendered = (): string => lines.join('\n').trim();

  // Shorten each trimmable field toward `budget`, no further than its floor
  // (0 = the field may disappear entirely).
  const shrinkToward = (
    budget: number,
    floorOf: (f: number) => number,
  ): void => {
    for (const [prefix, floor] of TRIMMABLE) {
      const overflow = rendered().length - budget;
      if (overflow <= 0) return;
      const index = lines.findIndex((line) => line.startsWith(prefix));
      if (index === -1) continue;
      const body = (lines[index] as string).slice(prefix.length);
      const keep = Math.max(floorOf(floor), body.length - overflow);
      if (keep >= body.length) continue;
      lines[index] = keep === 0 ? '' : prefix + body.slice(0, keep).trimEnd();
    }
    lines = lines.filter((line, index) => line !== '' || index === 0);
  };

  lines = lines.filter((line) => !line.startsWith(AVOID_PREFIX));
  if (rendered().length <= maxChars) return rendered();

  shrinkToward(maxChars, (floor) => floor);
  if (rendered().length <= maxChars) return rendered();

  const styleIndex = lines.findIndex((line) => line.startsWith(STYLE_PREFIX));
  if (styleIndex !== -1) {
    lines.splice(styleIndex, 1);
    if (rendered().length <= maxChars) return rendered();
  }

  if (hardMax === undefined || rendered().length <= hardMax) {
    console.warn(
      `[video-prompts] clip prompt is ${rendered().length} chars against a ` +
        `${maxChars} recommended budget after trimming. Sending it because the ` +
        'remaining continuity and performance instructions are more important.',
    );
    return rendered();
  }

  // Past the provider's hard cap the floors stop being protective, so drop them
  // and then shed unprotected lines from the end until it fits.
  shrinkToward(hardMax, () => 0);
  while (rendered().length > hardMax) {
    const index = lines
      .map((line, i) => [line, i] as const)
      .filter(([line]) => !PROTECTED_LINES.includes(line))
      .map(([, i]) => i)
      .pop();
    if (index === undefined) break;
    lines.splice(index, 1);
  }

  console.warn(
    `[video-prompts] clip prompt hit the provider's ${hardMax}-char hard cap ` +
      'and was cut back to the setting, people and continuity rules.',
  );
  // Backstop: even the protected rules alone must not exceed the cap.
  return rendered().slice(0, hardMax).trim();
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
  const performance =
    'She studies the phone, her concern turns to recognition, then she relaxes into a genuine smile and nods once.';

  const start = buildKeyframePrompt(style, brief, hint);
  const startWithRef = buildKeyframePrompt(style, brief, hint, 'world');
  const startWithSupplied = buildKeyframePrompt(style, brief, hint, 'supplied');
  const end = buildEndFramePrompt(style, endBrief, hint);
  const motion = buildClipMotionPrompt(
    style,
    brief,
    hint,
    endBrief,
    performance,
  );
  const startOnlyMotion = buildClipMotionPrompt(
    style,
    brief,
    hint,
    undefined,
    performance,
  );

  for (const [label, prompt] of [
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
    check(`${label}: forbids talking`, prompt.includes('Nobody speaks'));
  }

  const storyboardPrompt =
    'make a storyboard for a social media Video for Maharashtra DGIPR department';
  check('start frame: uses the exact storyboard prompt', start === storyboardPrompt);
  check(
    'start frame: reference inputs do not alter the storyboard prompt',
    startWithRef === storyboardPrompt && startWithSupplied === storyboardPrompt,
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
      startOnlyMotion.includes(performance) &&
      !startOnlyMotion.includes(END_PREFIX),
  );
  check(
    'motion prompt: carries detailed performance direction',
    motion.includes(`${MOTION_PREFIX}${performance}`),
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
  check(
    'negative prompt: allows visible writing',
    !/text|caption|subtitle|logo|watermark/.test(CLIP_NEGATIVE_PROMPT),
  );

  const avoid = buildAvoidClause(CLIP_NEGATIVE_PROMPT);
  check('avoid clause: is an instruction', avoid.startsWith('Avoid all of'));
  check('avoid clause: carries the list', avoid.includes('distorted anatomy'));
  check('avoid clause: empty in, empty out', buildAvoidClause('  ') === '');

  const fatStyle = 'S'.repeat(1200);
  const fatBrief = 'B'.repeat(600);
  const fatEnd = 'E'.repeat(600);
  const fat =
    buildClipMotionPrompt(fatStyle, fatBrief, hint, fatEnd, 'M'.repeat(2200)) +
    '\n\n' +
    avoid;
  const fitted = fitClipPrompt(fat, 2500);
  check('fit: worst case overflows before trimming', fat.length > 2500);
  check('fit: worst case fits after trimming', fitted.length <= 2500);
  check('fit: keeps Maharashtra', fitted.includes('Maharashtra, India'));
  check(
    'fit: keeps the final-frame transition',
    fitted.includes('provided final frame'),
  );
  check('fit: keeps the no-talking rule', fitted.includes('Nobody speaks'));

  // The real failure: a model-authored field arriving as several paragraphs put
  // most of its characters on lines the trimmer could not see, so the prompt
  // sailed past Kling's 3072 hard cap and the render was rejected outright.
  const multiLineStyle = `Cinematic realism.\n\n${'S'.repeat(900)}\n${'T'.repeat(900)}`;
  const multiLineMotion = `Opening beat.\n\n${'M'.repeat(1800)}\n${'N'.repeat(1800)}`;
  const paragraphed = buildClipMotionPrompt(
    multiLineStyle,
    `${'B'.repeat(700)}\n\n${'C'.repeat(700)}`,
    hint,
    `${'E'.repeat(700)}\n\n${'F'.repeat(700)}`,
    multiLineMotion,
  );
  check(
    'multi-line fields: every field stays on one line',
    !/\n\n/.test(paragraphed) &&
      paragraphed.split('\n').filter((line) => line.includes('SSS')).length ===
        1,
  );
  const cappedSoft = fitClipPrompt(paragraphed, 2500);
  const capped = fitClipPrompt(paragraphed, 2500, 3072);
  check(
    'hard cap: paragraphed worst case now fits the soft budget too',
    cappedSoft.length <= 2500,
  );
  check('hard cap: never exceeds the provider limit', capped.length <= 3072);
  check(
    'hard cap: keeps the setting rule',
    capped.includes('Maharashtra, India'),
  );
  check(
    'hard cap: keeps the no-talking rule',
    capped.includes('Nobody speaks'),
  );
  check(
    'hard cap: keeps the final-frame transition',
    capped.includes('provided final frame'),
  );

  // A prompt made only of protected rules must still be capped rather than sent.
  const absurd = fitClipPrompt(paragraphed, 200, 200);
  check(
    'hard cap: honoured even below the rules themselves',
    absurd.length <= 200,
  );

  console.log(
    failures.length === 0
      ? '\nAll prompt checks passed.'
      : `\n${failures.length} check(s) FAILED.`,
  );
  process.exitCode = failures.length === 0 ? 0 : 1;
}
