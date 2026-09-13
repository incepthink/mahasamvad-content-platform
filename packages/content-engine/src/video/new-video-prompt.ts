// Step 5: turn the officer's intent into a well-formed Omni instruction, with one LLM call.
//
// THIS IS THE FIRST THING ON THIS LANE THAT READS THE OFFICER'S PROMPT, and that is the point
// of it. Steps 1-3 put blocks AROUND the prompt from a count, a boolean and registry rows
// (video/new-video-scaffold.ts is pure and cannot see the prompt at all), which is what made
// them free to verify and impossible to get wrong on Marathi. But two of the documented
// remedies are not expressible that way, because they are about the SENTENCE:
//
//   DIALOGUE MUST NOT BE QUOTED. Omni renders burned-in subtitles when a spoken line sits
//   inside quotation marks; the documented form is `Name says: line` with none. That is the
//   "asking to add or remove text does not work" complaint, and it is the opposite of Veo 3's
//   guidance, so anyone writing prompts from Veo-era instinct gets it wrong.
//
//   A BLIND QUOTE-STRIPPER WOULD BE ACTIVELY WRONG ON THIS PRODUCT'S INPUT. Marathi
//   press-note prose marks SCHEME NAMES with single quotes -- 'भारत टॅक्सी', which
//   generation/resolve-poster-subject.ts strips deliberately and which must otherwise survive
//   character for character. A regex aimed at dialogue mangles exactly the one string that
//   may not move. A model with the whole sentence in front of it can tell a scheme name from
//   a line somebody speaks; a pattern match cannot. That is why Step 1 refused the regex and
//   named this pass as where the remedy belongs.
//
// This is the Dynamic Poster lane's shape (generation/motion-prompt.ts): one judgement-tier
// call writes the prompt the video model will actually be given, structured output so no
// preamble leaks into it, and the result is not re-checked by anything.
//
// WHAT IT DOES **NOT** WRITE, and this is the division that keeps the step safe. The
// reference declaration, the character block with its voices, the on-screen-text rule and the
// edit discipline are still composed deterministically by new-video-scaffold.ts around
// whatever comes back from here. Three reasons, each of which has bitten this repo before:
//
//   - The <IMAGE_REF_n> tags are ARITHMETIC over the image parts the job is about to send. A
//     model that miscounts binds a tag to the wrong person, and the failure looks exactly
//     like the model ignoring a reference. That seam is asserted in the client's test; it is
//     not something to hand to a model.
//   - A VOICE DESCRIPTION MUST BE VERBATIM. Google's technique for voice consistency is to
//     repeat the whole description unchanged every turn, and this model cannot edit a voice
//     at all -- so a paraphrase is a defect that can never be repaired afterwards.
//   - The rules are the platform's, not one turn's. Asking for them back each time is paying
//     a model to reproduce a constant, and a constant it can drop.
//
// So the authored text sits exactly where the officer's own string sat: in the middle, with
// the scaffold around it. The officer's original is still what the turn row stores and what
// the page shows -- this is what was SENT, not what was said.

import { pathToFileURL } from 'node:url';

import { chatComplete } from '../generation/openai-chat.js';
import type { ReasoningEffort } from '../generation/openai-chat.js';
import { INTERACTION_PROMPT_MAX_CHARS } from './gemini-interactions-client.js';

// Pinned one tier up, like every other call whose output nothing re-checks -- the
// ARTICLE_MODEL / POINTERS_MODEL / MOTION_PROMPT_MODEL precedent. The video model sees only
// what this call wrote, and a render is what it is spent on.
export const NEW_VIDEO_PROMPT_MODEL =
  process.env.OPENAI_NEW_VIDEO_PROMPT_MODEL?.trim() || 'gpt-5.6-sol';

// High rather than the 'medium' default: the judgement here is reading Marathi intent and
// deciding which quoted string is a person speaking and which is the official name of a
// scheme. Getting that backwards either burns subtitles into a government video or renames a
// scheme, and nothing downstream checks either.
export const NEW_VIDEO_PROMPT_REASONING_EFFORT: ReasoningEffort =
  (process.env.OPENAI_NEW_VIDEO_PROMPT_REASONING_EFFORT?.trim() as
    ReasoningEffort | undefined) || 'high';

// The answer is one instruction, a few paragraphs at most. An order of magnitude of headroom
// costs nothing -- billing is on tokens EMITTED -- and leaves the reasoning stage room.
const NEW_VIDEO_PROMPT_MAX_TOKENS = 4_000;

export type AuthoringCharacter = Readonly<{
  // The registry name, which is also the name the scaffold's character block binds a tag and
  // a voice to. The authored text may use it; that is what makes the two blocks refer to one
  // person. Nothing else about the character is supplied, deliberately -- see the header.
  name: string;
}>;

export type NewVideoAuthoringInput = Readonly<{
  // The officer's own words, in whatever language they typed. Read, never edited.
  prompt: string;
  // Whether this turn continues an earlier interaction. An edit is a materially different
  // request: short, one change, no re-description of the scene.
  isEdit: boolean;
  // How many reference pictures this turn attaches. The authored text never declares them --
  // it is told they exist so it does not ask for a subject the model has no picture of, and
  // so it does not try to write the declaration itself.
  imageCount: number;
  // The conversation's cast, by name only.
  characters?: readonly AuthoringCharacter[] | undefined;
}>;

const TASK = [
  'You are preparing the instruction that will be sent to gemini-omni-1.1-flash, the video',
  'model used by the Maharashtra Directorate General of Information and Public Relations',
  '(DGIPR) to generate and edit short public-information videos.',
  '',
  'A government officer has described what they want, below, in their own words. Write the',
  'instruction that asks the model for it.',
].join('\n');

// Ranked first, and stated as absolute. Everything else in this request is craft; this is the
// product rule the whole platform rests on, and an authoring pass is precisely where a model
// is tempted to "improve" an under-specified request by filling it in.
const FIDELITY_RULE = [
  'FAITHFULNESS, WHICH OUTRANKS EVERYTHING ELSE HERE',
  '- The officer’s description is the only source of facts. Never add a name, date,',
  '  amount, designation, scheme name, place or event that it does not contain.',
  '- Where it leaves something unsaid, leave it unsaid or describe it in general terms. Do',
  '  not decide it for them.',
  '- Do not add a message, a moral, a call to action or a closing line of your own.',
].join('\n');

// The documented Omni rule, and the reason it is counter-intuitive. Both halves are needed:
// the form to use, and the thing that must NOT be treated as dialogue.
const DIALOGUE_RULE = [
  'SPOKEN LINES',
  '- Write a spoken line as: Name says: the line. A colon after the speaker, and NO',
  '  quotation marks of any kind around what is said. Quotation marks make this model burn',
  '  the words onto the screen as subtitles, which is not wanted.',
  '- Reproduce every spoken line in the officer’s own words and in their own script,',
  '  character for character. A Marathi line stays Marathi in Devanagari: it is what the',
  '  character will be heard saying, so translating it would change the video’s content.',
  '- Quotation marks are not always dialogue. Marathi official prose puts the NAME of a',
  '  scheme, campaign, award or programme inside ‘ ’ — for example',
  '  ‘भारत टॅक्सी’. That is a name, not somebody speaking: keep it',
  '  exactly as written, quotation marks included, and never turn it into a line of dialogue.',
].join('\n');

const LANGUAGE_RULE = [
  'LANGUAGE',
  '- Write the direction — the setting, the people, the action, the camera, the light, the',
  '  mood — in clear English, which is what this model is prompted in.',
  '- Anything the video will SHOW or SAY stays in the officer’s own script: spoken lines,',
  '  and any words they explicitly asked to appear on screen.',
].join('\n');

const TIMING_RULE = [
  'TIMING',
  '- Only when the officer describes things happening in an order, put them on a timeline',
  '  using [0-3s] ... , [3-6s] ... blocks, or: After 3 seconds, ... . This model reads both.',
  '- If they described a single continuous moment, do not invent a sequence of shots for it.',
].join('\n');

// Emitted only on a first turn. The two branches are genuinely different requests and must
// not be blended: the documented failure on an edit is an over-described prompt.
const FIRST_TURN_RULE = [
  'THIS IS THE FIRST VIDEO IN THIS CONVERSATION',
  '- Describe the whole shot: where it is, who is in it, what happens, how it is filmed and',
  '  lit. Ground it in Maharashtra, India — Indian people, clothing, streets and offices —',
  '  unless the officer has placed it somewhere else.',
  '- Keep it to one continuous scene unless they asked for more.',
].join('\n');

const EDIT_TURN_RULE = [
  'THIS IS AN EDIT OF THE VIDEO THAT ALREADY EXISTS',
  '- Describe ONLY what changes. Simple, short instructions are what this model edits',
  '  reliably; an over-described edit makes it change things nobody asked about.',
  '- Do not re-describe the scene, the characters, the camera or the style that are staying',
  '  the same. Do not restate what the earlier video contained.',
  '- If the officer asked for several changes, say each of them plainly and briefly.',
].join('\n');

function castRule(characters: readonly AuthoringCharacter[]): string[] {
  const names = characters
    .map((character) => character.name.trim())
    .filter((name) => name !== '');
  if (names.length === 0) return [];
  return [
    '',
    'THE PEOPLE IN THIS VIDEO',
    `- This conversation has a fixed cast: ${names.join(', ')}. Refer to them by exactly`,
    '  these names wherever the officer means them.',
    '- Their appearance and their voice are declared for you in a separate block that is',
    '  added automatically. Do NOT describe what any of them looks like and do NOT describe',
    '  how any of them sounds — restating it would fight the block that fixes it.',
    '- Do not introduce a person who is not on that list.',
  ];
}

function referencesRule(imageCount: number): string[] {
  if (imageCount <= 0) return [];
  const one = imageCount === 1;
  return [
    '',
    'REFERENCE PICTURES',
    `- ${imageCount} reference ${one ? 'picture is' : 'pictures are'} attached to this`,
    `  request, and a block declaring ${one ? 'it' : 'them'} is added automatically.`,
    '  Do not write that block, and do not refer to',
    `  ${one ? 'it' : 'them'} by tag or by number — name the subject instead.`,
  ];
}

// The one rule that stops this pass duplicating the deterministic blocks. Without it the
// model helpfully writes its own reference declaration and its own "keep everything else the
// same", and the turn arrives carrying each of them twice.
const NOT_YOURS_RULE = [
  'WHAT IS ADDED AROUND YOUR TEXT, AND SO MUST NOT BE IN IT',
  '- The reference declaration block, the rule about how reference pictures are used, the',
  '  character block with each voice, the rule about on-screen text, and the instruction to',
  '  keep everything else unchanged are all added automatically.',
  '- Write only the instruction itself. No heading, no preamble, no explanation of your',
  '  choices, no notes to the officer.',
].join('\n');

/**
 * The complete request sent to the authoring model. Pure and exported so the whole of this
 * step can be asserted for free.
 */
export function buildNewVideoAuthoringRequest(
  input: NewVideoAuthoringInput,
): string {
  return [
    TASK,
    '',
    FIDELITY_RULE,
    '',
    input.isEdit ? EDIT_TURN_RULE : FIRST_TURN_RULE,
    '',
    LANGUAGE_RULE,
    '',
    DIALOGUE_RULE,
    '',
    TIMING_RULE,
    ...castRule(input.characters ?? []),
    ...referencesRule(input.imageCount),
    '',
    NOT_YOURS_RULE,
    '',
    'WHAT THE OFFICER ASKED FOR:',
    input.prompt,
    '',
    'Answer with JSON only: {"prompt": "<the instruction for gemini-omni-1.1-flash>"}.',
    'The value is sent to the video model as written, so it must contain nothing but that',
    'instruction.',
  ].join('\n');
}

/**
 * Pulls the instruction out of the model's answer.
 *
 * Tolerant in the same way and for the same reason as parseMotionPrompt: a paid render is
 * about to be spent on this value, and failing because a model wrapped its JSON in a code
 * fence would be the wrong trade. An answer with nothing usable in it throws, and the caller
 * falls back to the officer's own words.
 */
export function parseAuthoredPrompt(raw: string): string {
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
      // Answered in the right shape with nothing in it. Deliberately NOT falling through to
      // the raw text below, which here would be the literal `{"prompt":"  "}` — the caller
      // has the officer's own words to fall back to, and those are a better request than a
      // fragment of JSON.
      throw new Error('The prompt-authoring model returned an empty prompt.');
    }
  } catch (error) {
    if (error instanceof Error && error.name !== 'SyntaxError') throw error;
    // Not JSON. A model that answered with the instruction itself has still answered.
  }
  if (unfenced !== '') return unfenced;
  throw new Error('The prompt-authoring model returned nothing usable.');
}

/**
 * One call. Returns the instruction to send to Omni in place of the officer's own string.
 *
 * Throws on anything unusable, INCLUDING an answer longer than the turn cap: the caller's job
 * is to fall back to the officer's prompt, which is a known-good request, rather than to fail
 * a turn over an enrichment. A best-effort step must not become a gate
 * (shorten-narration.ts's rule).
 */
export async function authorNewVideoPrompt(
  input: NewVideoAuthoringInput,
): Promise<string> {
  if (input.prompt.trim() === '') {
    throw new Error('Nothing to author from: the prompt is empty.');
  }
  const answer = await chatComplete(
    [{ role: 'user', content: buildNewVideoAuthoringRequest(input) }],
    {
      model: NEW_VIDEO_PROMPT_MODEL,
      reasoningEffort: NEW_VIDEO_PROMPT_REASONING_EFFORT,
      responseFormat: 'json_object',
      maxTokens: NEW_VIDEO_PROMPT_MAX_TOKENS,
    },
  );
  const authored = parseAuthoredPrompt(answer);
  if (authored.length > INTERACTION_PROMPT_MAX_CHARS) {
    throw new Error(
      `The authored prompt is ${authored.length} characters; the turn limit is ` +
        `${INTERACTION_PROMPT_MAX_CHARS}.`,
    );
  }
  return authored;
}

// ---------------------------------------------------------------------------
// Free harness: npx tsx src/video/new-video-prompt.ts
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

  const MARATHI = 'मुख्यमंत्री ' + '‘भारत टॅक्सी’ ' + 'योजनेबद्दल बोलतात';

  const first = buildNewVideoAuthoringRequest({
    prompt: MARATHI,
    isEdit: false,
    imageCount: 0,
  });
  const edit = buildNewVideoAuthoringRequest({
    prompt: MARATHI,
    isEdit: true,
    imageCount: 0,
  });

  // --- the officer's words ---------------------------------------------------------------
  // The one thing this request exists to carry. Devanagari and the scheme-name quotes travel
  // code point for code point; a normalisation pass would recompose matras invisibly.
  check('the officer prompt is carried verbatim', first.includes(MARATHI));
  check(
    'the scheme-name quotes survive in the officer block',
    first.includes('‘भारत टॅक्सी’'),
  );
  check(
    'the officer block is labelled so the rules above cannot be read as theirs',
    first.includes('WHAT THE OFFICER ASKED FOR:'),
  );

  // --- the two rules that are the whole reason this step exists ---------------------------
  check(
    'dialogue is asked for in the colon form',
    first.includes('Name says: the line'),
  );
  check(
    'and quotation marks around speech are refused, with the reason',
    first.includes('NO') &&
      first.includes('quotation marks of any kind') &&
      first.includes('subtitles'),
  );
  check(
    'a quoted SCHEME NAME is protected from the same rule',
    first.includes('Quotation marks are not always dialogue') &&
      first.includes('never turn it into a line of dialogue'),
  );
  check(
    'a spoken Marathi line is kept in Devanagari rather than translated',
    first.includes('stays Marathi in Devanagari'),
  );
  check(
    'the direction is written in English',
    first.includes('in clear English'),
  );

  // --- faithfulness ------------------------------------------------------------------------
  check(
    'the never-invent rule is present and stated as outranking the craft',
    first.includes('OUTRANKS EVERYTHING ELSE') &&
      first.includes('scheme name, place or event that it does not contain'),
  );
  check(
    'and the authoring model may not add a message of its own',
    first.includes('call to action or a closing line of your own'),
  );

  // --- the two turn shapes are genuinely different -----------------------------------------
  check(
    'a first turn is asked to describe the whole shot',
    first.includes('Describe the whole shot') &&
      !first.includes('THIS IS AN EDIT'),
  );
  check(
    'a first turn is grounded in Maharashtra',
    first.includes('Maharashtra, India'),
  );
  check(
    'an edit turn is asked for ONLY what changes',
    edit.includes('Describe ONLY what changes') &&
      edit.includes('Do not re-describe the scene'),
  );
  check(
    'an edit turn is not asked to describe a whole shot',
    !edit.includes('Describe the whole shot') &&
      !edit.includes('Maharashtra, India'),
  );

  // --- timing --------------------------------------------------------------------------------
  check(
    'the timing syntax is offered, and only when there is a sequence',
    first.includes('[0-3s]') &&
      first.includes('After 3 seconds') &&
      first.includes('do not invent a sequence of shots'),
  );

  // --- what this pass must NOT write ---------------------------------------------------------
  // The division that keeps the deterministic blocks deterministic. Without this the turn
  // arrives carrying its reference declaration and its edit discipline twice.
  check(
    'the automatically-added blocks are named so they are not written twice',
    first.includes('MUST NOT BE IN IT') &&
      first.includes('reference declaration block') &&
      first.includes('character block with each voice'),
  );
  check(
    'and no preamble is invited',
    first.includes('No heading, no preamble'),
  );
  // The scaffold owns the tag arithmetic. A model that writes its own would bind a picture to
  // the wrong person, and it would look exactly like the model ignoring the reference.
  check(
    'the authoring request never shows the model a tag to copy',
    !first.includes('IMAGE_REF'),
  );

  // --- the cast ------------------------------------------------------------------------------
  const cast = buildNewVideoAuthoringRequest({
    prompt: MARATHI,
    isEdit: false,
    imageCount: 2,
    characters: [{ name: 'प्रिया देशमुख' }, { name: 'Rahul Kale' }],
  });
  check(
    'the cast is named so the authored text and the character block mean one person',
    cast.includes('fixed cast: प्रिया देशमुख, Rahul Kale'),
  );
  check(
    'the voice is explicitly NOT the authoring pass to describe',
    cast.includes('do NOT describe') && cast.includes('how any of them sounds'),
  );
  check(
    'and a person off the list may not be introduced',
    cast.includes('Do not introduce a person who is not on that list'),
  );
  check(
    'no cast: no cast block at all, rather than an empty heading',
    !first.includes('THE PEOPLE IN THIS VIDEO'),
  );
  check(
    'a cast of blank names is the same as no cast',
    buildNewVideoAuthoringRequest({
      prompt: MARATHI,
      isEdit: false,
      imageCount: 0,
      characters: [{ name: '   ' }],
    }) === first,
  );

  // --- reference pictures ----------------------------------------------------------------------
  check(
    'attached pictures are counted, and their declaration is left to the scaffold',
    cast.includes('2 reference pictures are attached') &&
      cast.includes('Do not write that block'),
  );
  check(
    'one picture reads as one picture',
    buildNewVideoAuthoringRequest({
      prompt: MARATHI,
      isEdit: false,
      imageCount: 1,
    }).includes('1 reference picture is attached'),
  );
  check(
    'no pictures: nothing is said about pictures at all',
    !first.includes('REFERENCE PICTURES'),
  );

  // --- purity / determinism ----------------------------------------------------------------------
  check(
    'the same inputs give the same request',
    buildNewVideoAuthoringRequest({
      prompt: MARATHI,
      isEdit: false,
      imageCount: 0,
    }) === first,
  );
  check('the request stays a readable size', first.length < 4_500);

  // --- the answer parser -------------------------------------------------------------------------
  check(
    'plain JSON is parsed',
    parseAuthoredPrompt('{"prompt":"A woman walks in."}') ===
      'A woman walks in.',
  );
  check(
    'fenced JSON is parsed',
    parseAuthoredPrompt('```json\n{"prompt":"A woman walks in."}\n```') ===
      'A woman walks in.',
  );
  check(
    'a bare answer is accepted rather than throwing away a usable one',
    parseAuthoredPrompt('  A woman walks in.  ') === 'A woman walks in.',
  );
  check(
    'a Devanagari line survives the parser',
    parseAuthoredPrompt(
      JSON.stringify({ prompt: `Priya says: ${MARATHI}` }),
    ).includes(MARATHI),
  );
  let threw = false;
  try {
    parseAuthoredPrompt('   ');
  } catch {
    threw = true;
  }
  check('an empty answer throws so the caller can fall back', threw);
  threw = false;
  try {
    parseAuthoredPrompt('{"prompt":"   "}');
  } catch {
    threw = true;
  }
  check('and so does an answer whose prompt field is blank', threw);

  console.log(
    failed === 0
      ? `\nAll authoring checks passed (${NEW_VIDEO_PROMPT_MODEL}, effort ${NEW_VIDEO_PROMPT_REASONING_EFFORT}, request ${first.length} chars).`
      : `\n${failed} check(s) FAILED.`,
  );
  if (failed > 0) process.exit(1);
}
