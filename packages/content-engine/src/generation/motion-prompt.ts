// Step 1 of the Dynamic Poster lane: read the officer's still poster and WRITE THE PROMPT that
// gemini-omni will render the clip from.
//
// The lane is two calls. This one is the cheap, decisive one — the video model never sees the
// department's intent, only the sentences produced here — so it runs on gpt-5.6-sol at high
// reasoning effort, the tier this repo reserves for judgement nothing downstream can correct
// (the ARTICLE_MODEL / POINTERS_MODEL precedent).
//
// THE BRIEF IS THE OFFICER'S, IN THEIR OWN WORDS, AND IS DELIBERATELY THE WHOLE INSTRUCTION.
// It briefly grew a page of platform rules on top — a text lock, a framing lock, a loop rule,
// guidance on how to choose the motion — and that was removed on the officer's own report that
// the prompt had become too big. Their sentences already say what a Dynamic Poster is (text
// unchanged, whole poster on screen, nothing cut off, loopable), and the model being asked is
// the judgement tier precisely so it can decide the rest. **Do not re-add rule blocks here
// without the officer asking for them.** Two things only are layered on:
//
//  1. THE OUTPUT SHAPE IS AN ASPECT RATIO, replacing the brief's original "find out what is the
//     resolution of my uploaded image". These models are unreliable at reading their own
//     input's pixel dimensions, and a video model does not return an arbitrary pixel size
//     either — so the loudest requirement in the prompt was the one thing the render could
//     never honour.
//
//     IT IS A LABEL, NOT THE ENUM, and that matters: the create form's default is the POSTER'S
//     OWN ratio, so what arrives here is '4:5' as readily as '9:16'. It also arrives as a fact
//     rather than a request — the caller has already padded the poster into exactly that frame
//     (fitImageToAspect), so the image below this text IS that shape. That is what makes the
//     brief's two demands — this ratio, and nothing cut off — possible at the same time. They
//     were not: a 4:5 poster asked for a 9:16 clip came back with ~15% missing off each side,
//     because only 70% of its width fits, and the render obeyed "full-screen" over "nothing cut
//     off". Do not re-word this back into asking the model to fit the poster itself.
//
//  2. THE OFFICER'S DIRECTION, when they typed one. It arrives as free text beside the upload
//     and is the only thing on this lane that says what should MOVE, so it is stated as a
//     requirement rather than as context.
//
// Structured output (`json_object`), not free text, because a model asked for "the prompt"
// answers with a preamble about half the time and that preamble would be sent to the video
// model as part of the prompt.

import { pathToFileURL } from 'node:url';
import { chatCompleteVision } from './openai-chat.js';
import type { ReasoningEffort } from './openai-chat.js';

// Pinned one step up, like every other call whose output nothing re-checks. Env-overridable so
// the tier can be traded for latency in one line, the OPENAI_COPY_MODEL precedent.
export const MOTION_PROMPT_MODEL =
  process.env.OPENAI_MOTION_PROMPT_MODEL?.trim() || 'gpt-5.6-sol';

// High rather than the 'medium' default: this call is looking at a poster and deciding which
// of its elements may move and which are typography that must not, and there is no later pass
// to correct it. That judgement is now the ONLY thing standing between the brief and the
// render, since the rule blocks that used to spell it out are gone.
export const MOTION_PROMPT_REASONING_EFFORT: ReasoningEffort =
  (process.env.OPENAI_MOTION_PROMPT_REASONING_EFFORT?.trim() as
    ReasoningEffort | undefined) || 'high';

// The generated prompt is one paragraph or a few; a budget an order of magnitude above that
// costs nothing (billing is on tokens EMITTED) and leaves the reasoning stage room.
const MOTION_PROMPT_MAX_TOKENS = 4_000;

export type MotionPromptInput = Readonly<{
  // The poster, upright PNG bytes (normalizeSourceImage).
  imagePng: Buffer;
  // The shape of the CLIP as a ratio label — '4:5', '9:16', '16:9'. Resolved by the caller
  // (aspectRatioLabel), which has also already framed `imagePng` to it. See the header.
  aspect: string;
  // The officer's motion direction, verbatim. Empty/absent is the common case and is a
  // complete request: the poster alone is enough to motionise.
  direction?: string | undefined;
}>;

// The officer's brief, verbatim except for the aspect-ratio sentence, which replaced their
// "find out what is the resolution of my uploaded image" line. `{{ASPECT}}` is the ratio they
// picked on the create form.
export const MOTION_BRIEF = [
  'I want to turn the uploaded poster into a motionized, loopable GIF for the Maharashtra DGIPR social media platforms.',
  'I want the text to remain unchanged.',
  'The output video must be in {{ASPECT}} aspect ratio — mention in the Gemini prompt that this exact aspect ratio must be maintained in the Output Video.',
  'The uploaded image is already exactly {{ASPECT}}, so say in the prompt that the frame is to be used as it is: no zooming, re-framing, cropping or panning.',
  'Nothing from the uploaded image must be left out in the output video.',
  'The video must have all the elements of the Poster with the full poster visible full-screen and nothing cut off.',
  'I want you to make a gemini-omni-1.1-flash prompt for this image.',
].join(' ');

function directionBlock(direction: string | undefined): string[] {
  const trimmed = (direction ?? '').trim();
  if (trimmed === '') return [];
  return [
    '',
    'The officer has asked for this specifically. It is the one instruction on this run about',
    'what should move, and the prompt you write must carry it out in its own words.',
    '',
    'OFFICER REQUEST:',
    trimmed,
  ];
}

// The complete instruction sent with the poster. Pure and exported so the harness can assert on
// it without spending anything.
export function buildMotionPromptRequest(
  input: Readonly<{
    aspect: string;
    direction?: string | undefined;
  }>,
): string {
  return [
    MOTION_BRIEF.replaceAll('{{ASPECT}}', input.aspect),
    ...directionBlock(input.direction),
    '',
    'Answer with JSON only: {"prompt": "<the complete prompt for gemini-omni-1.1-flash>"}.',
    'The value is sent to the video model verbatim, so it must contain nothing but the prompt —',
    'no preamble, no explanation, no markdown, no surrounding quotes.',
  ].join('\n');
}

// Pulls the prompt out of the model's answer. Tolerant on purpose: the value is what a paid
// render is about to be spent on, and failing the run because a model wrapped its JSON in a
// code fence would be the wrong trade.
export function parseMotionPrompt(raw: string): string {
  const unfenced = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  try {
    const parsed: unknown = JSON.parse(unfenced);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'prompt' in parsed &&
      typeof (parsed as { prompt: unknown }).prompt === 'string'
    ) {
      const prompt = (parsed as { prompt: string }).prompt.trim();
      if (prompt !== '') return prompt;
    }
  } catch {
    // Not JSON. A model that answered with the prompt itself has still answered usefully.
  }
  if (unfenced !== '') return unfenced;
  throw new Error('The motion-prompt model returned nothing usable.');
}

// One vision call. Returns the prompt to hand to gemini-omni.
export async function generateMotionPrompt(
  input: MotionPromptInput,
): Promise<string> {
  const request = buildMotionPromptRequest({
    aspect: input.aspect,
    ...(input.direction !== undefined ? { direction: input.direction } : {}),
  });
  const answer = await chatCompleteVision(
    request,
    `data:image/png;base64,${input.imagePng.toString('base64')}`,
    {
      model: MOTION_PROMPT_MODEL,
      reasoningEffort: MOTION_PROMPT_REASONING_EFFORT,
      responseFormat: 'json_object',
      maxTokens: MOTION_PROMPT_MAX_TOKENS,
    },
  );
  return parseMotionPrompt(answer);
}

// ---------------------------------------------------------------------------
// Free harness: npx tsx src/generation/motion-prompt.ts
// ---------------------------------------------------------------------------

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const failures: string[] = [];
  const check = (ok: boolean, message: string) => {
    if (!ok) failures.push(message);
  };

  const plain = buildMotionPromptRequest({ aspect: '9:16' });
  const landscape = buildMotionPromptRequest({ aspect: '16:9' });
  // The default: the poster's own ratio, which is NOT one of the two fixed frames.
  const source = buildMotionPromptRequest({ aspect: '4:5' });

  // The officer's chosen ratio, in their own sentence. If this goes, the output shape stops
  // being asked for at all.
  check(
    plain.includes('must be in 9:16 aspect ratio'),
    'the brief lost the aspect ratio',
  );
  check(
    landscape.includes('must be in 16:9 aspect ratio'),
    'the landscape ratio is not carried through',
  );
  check(
    !landscape.includes('9:16'),
    'the portrait ratio leaked into a landscape request',
  );
  // An arbitrary poster ratio has to travel as readily as the two fixed frames, in BOTH the
  // places the brief names it — a half-substituted brief would leave a literal {{ASPECT}} in
  // front of a paid render.
  check(
    source.includes('must be in 4:5 aspect ratio') &&
      source.includes('already exactly 4:5'),
    'a measured poster ratio is not carried through',
  );
  check(!/\{\{ASPECT\}\}/.test(source), 'an ASPECT placeholder survived');
  check(!/\{\{ASPECT\}\}/.test(plain), 'an ASPECT placeholder survived');
  // THE FIX for the lane's first reported defect: the frame is stated as settled, so the model
  // is never left choosing between honouring the ratio and showing the whole poster.
  check(
    /no zooming, re-framing, cropping or panning/.test(plain),
    'the brief no longer rules out re-framing — the crop bug can come back',
  );
  // NO PIXEL SIZE, anywhere. This is what the ratio replaced: the brief used to ask the model
  // to work out the poster's resolution and demand it back, which a video model cannot deliver.
  check(
    !/\d{3,4}\s*x\s*\d{3,4}/.test(plain),
    'a pixel resolution is back in the request',
  );
  check(
    !/resolution/i.test(plain),
    'the model is being asked about resolution again',
  );

  // The four sentences of the officer's brief that carry the product decision.
  check(
    plain.includes('I want the text to remain unchanged.'),
    'the text sentence was rewritten',
  );
  check(
    plain.includes(
      'Nothing from the uploaded image must be left out in the output video.',
    ),
    'the brief lost the completeness sentence',
  );
  check(
    plain.includes('the full poster visible full-screen and nothing cut off'),
    'the brief was rewritten',
  );
  check(
    plain.includes('motionized, loopable GIF'),
    'the brief lost the loop wording',
  );

  // KEEP IT SMALL. The officer's complaint was the size of this request; the rule blocks it
  // used to carry are gone and must not creep back without them asking.
  // Raised from 900 by exactly one sentence: the "already exactly {{ASPECT}}" line, which is
  // what closes the crop. Still a cap, and still there so "just one more rule" has to be a
  // deliberate decision.
  check(
    plain.length < 1_050,
    `the request has grown back (${plain.length} chars) — see the header`,
  );
  check(
    !/TEXT LOCK|FRAMING LOCK|COMPLETENESS RULE|HOW TO CHOOSE THE MOTION/.test(
      plain,
    ),
    'the retired rule blocks are back in the request',
  );

  // No direction supplied is the common case and must add nothing at all.
  check(
    !/OFFICER REQUEST/.test(plain),
    'an officer-request block appeared with no direction supplied',
  );
  check(
    buildMotionPromptRequest({ aspect: '9:16', direction: '   ' }) ===
      buildMotionPromptRequest({ aspect: '9:16' }),
    'a whitespace-only direction changed the request',
  );

  // Supplied, it is carried verbatim and stated as a requirement.
  const directed = buildMotionPromptRequest({
    aspect: '16:9',
    direction: 'झेंडा हलवा, मुख्यमंत्र्यांचा फोटो स्थिर ठेवा',
  });
  check(
    directed.includes('झेंडा हलवा, मुख्यमंत्र्यांचा फोटो स्थिर ठेवा'),
    'the officer direction did not survive verbatim',
  );
  check(
    /must carry it out in its own words/.test(directed),
    'the officer direction was not stated as a requirement',
  );

  // The answer parser, against the shapes a model actually returns.
  check(
    parseMotionPrompt('{"prompt":"Animate the flag."}') === 'Animate the flag.',
    'plain JSON not parsed',
  );
  check(
    parseMotionPrompt('```json\n{"prompt":"Animate the flag."}\n```') ===
      'Animate the flag.',
    'fenced JSON not parsed',
  );
  check(
    parseMotionPrompt('  Animate the flag.  ') === 'Animate the flag.',
    'a bare prompt was not accepted',
  );
  let threw = false;
  try {
    parseMotionPrompt('   ');
  } catch {
    threw = true;
  }
  check(threw, 'an empty answer was accepted');
  check(
    parseMotionPrompt('{"prompt":"   "}').length > 0,
    'an empty prompt field fell through to nothing usable',
  );

  if (failures.length > 0) {
    console.error(`\n${failures.length} FAILURE(S):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exitCode = 1;
  } else {
    console.log(
      `All motion-prompt assertions passed (${MOTION_PROMPT_MODEL}, effort ${MOTION_PROMPT_REASONING_EFFORT}, request ${plain.length} chars).\n\n--- request, no direction ---\n${plain}\n\n--- request, with a direction ---\n${directed}`,
    );
  }
}
