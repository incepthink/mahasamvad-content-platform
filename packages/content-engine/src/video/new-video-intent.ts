// Whether one /new-video-workflow follow-up EDITS the video on screen or starts a NEW CLIP.
//
// THE BUG THIS EXISTS FOR. Every turn after the first used to be sent as an edit: the job took
// the conversation's chain point, passed it as `previous_interaction_id`, and the scaffold
// appended "this instruction is an edit of the existing video … keep everything else the
// same, including the voice". An officer building an explainer scene by scene then typed
// "Scene 2: a completely different place, three new keyframes, new Marathi narration" — which
// reached Gemini as an edit of Scene 1 that re-specified the whole video, attached new
// references mid-chain (a documented failure) and asked for a different voice (voice editing
// is not supported at all). Gemini accepted it, issued an interaction id, and eleven minutes
// later that id answered a bare `400 invalid_request`. The render was lost and the officer
// was told nothing useful.
//
// So the turn's INTENT is decided before anything is sent:
//
//   edit — change something about the video that already exists. Continues the chain.
//   new  — a different scene / shot / clip. Sent as a fresh first turn: no
//          previous_interaction_id, a declared task, the cast's portraits re-attached.
//
// HOW IT IS DECIDED, in order:
//   1. The officer's explicit choice on the composer, when they made one.
//   2. A fork is always an edit — the officer picked a video to continue from.
//   3. One small model call that reads the new instruction beside the one that produced the
//      video on screen. This is a JUDGEMENT about a sentence ("make the sky orange" vs
//      "Scene 2: a farmer in a field"), which no pattern match over Marathi can make.
//   4. If that call fails, a deterministic fallback: new reference pictures attached to a
//      follow-up mean a new clip (stacking references into an edit is the documented failure),
//      otherwise an edit — which is exactly the behaviour before this file existed.
//
// Best-effort, never a gate: the worst outcome of a classifier failure is the old behaviour.

import { pathToFileURL } from 'node:url';

import { chatComplete, CHAT_MODEL } from '../generation/openai-chat.js';
import type { ReasoningEffort } from '../generation/openai-chat.js';

export const NEW_VIDEO_TURN_INTENTS = ['edit', 'new'] as const;
export type NewVideoTurnIntent = (typeof NEW_VIDEO_TURN_INTENTS)[number];

// A routing decision, not authoring — the authoring pass (new-video-prompt.ts) is the one that
// needs the top tier. Terra at low effort answers in a couple of seconds, which matters because
// this runs on every follow-up before the render starts.
export const NEW_VIDEO_INTENT_MODEL =
  process.env.OPENAI_NEW_VIDEO_INTENT_MODEL?.trim() || CHAT_MODEL;
export const NEW_VIDEO_INTENT_REASONING_EFFORT: ReasoningEffort =
  (process.env.OPENAI_NEW_VIDEO_INTENT_REASONING_EFFORT?.trim() as
    ReasoningEffort | undefined) || 'low';

// Both prompts are bounded before they are sent: the verdict depends on what kind of request
// each one is, and a 20,000-character prompt is not more informative about that than its head.
const PROMPT_EXCERPT_CHARS = 4_000;

export type NewVideoIntentInput = Readonly<{
  // The instruction the officer just typed.
  prompt: string;
  // The instruction that produced the video currently on screen, or null when that is unknown
  // (the turn row could not be found). The call still runs on the new prompt alone.
  previousPrompt: string | null;
  // How many reference pictures THIS turn attaches (not counting cast portraits).
  imageCount: number;
}>;

export type NewVideoIntentDecision = Readonly<{
  intent: NewVideoTurnIntent;
  // Where the verdict came from — for the job's log line, which is how a wrong call is found.
  source: 'officer' | 'fork' | 'model' | 'fallback' | 'first-turn';
  reason: string;
}>;

/** The deterministic fallback. Pure. */
export function fallbackNewVideoIntent(imageCount: number): NewVideoTurnIntent {
  return imageCount > 0 ? 'new' : 'edit';
}

function excerpt(text: string): string {
  const trimmed = text.trim();
  return trimmed.length <= PROMPT_EXCERPT_CHARS
    ? trimmed
    : `${trimmed.slice(0, PROMPT_EXCERPT_CHARS)}…`;
}

/** The request sent to the classifier. Pure and exported so it can be asserted for free. */
export function buildNewVideoIntentRequest(input: NewVideoIntentInput): string {
  return [
    'You route requests in a conversational AI video tool used by a government media office.',
    'A video already exists in this conversation. The officer has now typed a new instruction.',
    'Decide whether it is an EDIT of that existing video or a request for a NEW CLIP.',
    '',
    'EDIT — the instruction changes something about the video that already exists, and',
    'everything else should stay the same. Examples: change the background or the colours,',
    'make it slower, remove or add some on-screen text, change what a character is holding,',
    'fix a mistake, make the camera closer, change one line the character says.',
    '',
    'NEW — the instruction describes a different video: another scene or shot, a different',
    'place or set of people, a full storyboard or set of keyframes, a fresh script or',
    'narration, "scene 2", "next clip", "now make a video about…". A long instruction that',
    're-describes a whole scene from scratch is NEW even if it shares a character or style',
    'with the earlier video. New reference pictures attached for a different scene point to NEW.',
    '',
    'If genuinely unsure, prefer EDIT for a short instruction and NEW for one that describes a',
    'whole scene.',
    '',
    'The instructions may be in Marathi, Hindi or English.',
    '',
    'INSTRUCTION THAT PRODUCED THE EXISTING VIDEO:',
    input.previousPrompt !== null && input.previousPrompt.trim() !== ''
      ? excerpt(input.previousPrompt)
      : '(not available)',
    '',
    `NEW INSTRUCTION (with ${Math.max(0, input.imageCount)} new reference picture(s) attached):`,
    excerpt(input.prompt),
    '',
    'Answer with JSON only: {"intent": "edit" | "new", "reason": "<one short sentence>"}.',
  ].join('\n');
}

/** Pulls the verdict out of the model's answer, or throws. */
export function parseNewVideoIntent(
  raw: string,
): Readonly<{ intent: NewVideoTurnIntent; reason: string }> {
  const unfenced = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  const parsed: unknown = JSON.parse(unfenced);
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('The intent classifier returned no object.');
  }
  const intent = String((parsed as { intent?: unknown }).intent ?? '')
    .trim()
    .toLowerCase();
  if (intent !== 'edit' && intent !== 'new') {
    throw new Error(
      `The intent classifier returned an unknown intent: ${intent}`,
    );
  }
  const reason = (parsed as { reason?: unknown }).reason;
  return {
    intent,
    reason: typeof reason === 'string' ? reason.trim() : '',
  };
}

/**
 * Decides one follow-up turn's intent. Never throws: a classifier failure returns the
 * deterministic fallback, which is the pre-existing behaviour whenever no picture is attached.
 */
export async function classifyNewVideoIntent(
  input: NewVideoIntentInput,
): Promise<NewVideoIntentDecision> {
  try {
    const answer = await chatComplete(
      [{ role: 'user', content: buildNewVideoIntentRequest(input) }],
      {
        model: NEW_VIDEO_INTENT_MODEL,
        reasoningEffort: NEW_VIDEO_INTENT_REASONING_EFFORT,
        responseFormat: 'json_object',
        maxTokens: 300,
      },
    );
    const verdict = parseNewVideoIntent(answer);
    return { ...verdict, source: 'model' };
  } catch (error) {
    return {
      intent: fallbackNewVideoIntent(input.imageCount),
      source: 'fallback',
      reason: `classifier failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Free harness: npx tsx src/video/new-video-intent.ts
// Live (cents):  npx tsx --env-file=../../.env src/video/new-video-intent.ts --live
// ---------------------------------------------------------------------------

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  let failed = 0;
  const check = (label: string, ok: boolean): void => {
    if (ok) console.log(`  ok  ${label}`);
    else {
      failed += 1;
      console.error(`FAIL  ${label}`);
    }
  };

  check(
    'fallback: a picture on a follow-up is a new clip',
    fallbackNewVideoIntent(3) === 'new',
  );
  check(
    'fallback: no picture keeps the old edit behaviour',
    fallbackNewVideoIntent(0) === 'edit',
  );

  const MARATHI = 'पार्श्वभूमी केशरी करा';
  const request = buildNewVideoIntentRequest({
    prompt: MARATHI,
    previousPrompt: 'A farmer in a field',
    imageCount: 0,
  });
  check('the new instruction is carried verbatim', request.includes(MARATHI));
  check(
    'the earlier instruction is carried',
    request.includes('A farmer in a field'),
  );
  check(
    'a missing earlier instruction is said, not left blank',
    buildNewVideoIntentRequest({
      prompt: 'x',
      previousPrompt: null,
      imageCount: 0,
    }).includes('(not available)'),
  );
  check(
    'the picture count is stated',
    request.includes('with 0 new reference picture(s)'),
  );
  check(
    'a huge prompt is bounded',
    buildNewVideoIntentRequest({
      prompt: 'a'.repeat(20_000),
      previousPrompt: null,
      imageCount: 0,
    }).length < 6_000,
  );

  check(
    'plain JSON parses',
    parseNewVideoIntent('{"intent":"new","reason":"scene 2"}').intent === 'new',
  );
  check(
    'fenced + upper-case parses',
    parseNewVideoIntent('```json\n{"intent":"EDIT"}\n```').intent === 'edit',
  );
  let threw = false;
  try {
    parseNewVideoIntent('{"intent":"extend"}');
  } catch {
    threw = true;
  }
  check('an unknown intent throws so the caller falls back', threw);

  if (process.argv.includes('--live')) {
    const cases: Array<[string, NewVideoIntentInput, NewVideoTurnIntent]> = [
      [
        'short Marathi change',
        {
          prompt: MARATHI,
          previousPrompt: 'एका शेतकऱ्याचा व्हिडिओ',
          imageCount: 0,
        },
        'edit',
      ],
      [
        'scene 2 with keyframes',
        {
          prompt:
            'Scene 2: मुंबईतील सरकारी रुग्णालय. Use the three attached images as ordered keyframes. नवीन मराठी निवेदन: "योजनेचा लाभ घ्या."',
          previousPrompt:
            'Scene 1: a farmer in Vidarbha receiving a loan waiver letter.',
          imageCount: 3,
        },
        'new',
      ],
    ];
    for (const [label, input, expected] of cases) {
      const decision = await classifyNewVideoIntent(input);
      check(
        `live: ${label} -> ${decision.intent} (${decision.source}: ${decision.reason})`,
        decision.source === 'model' && decision.intent === expected,
      );
    }
  }

  console.log(
    failed === 0
      ? '\nAll intent checks passed.'
      : `\n${failed} check(s) FAILED.`,
  );
  if (failed > 0) process.exit(1);
}
