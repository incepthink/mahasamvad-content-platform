// What /new-video-workflow puts AROUND the officer's prompt, and nothing else.
//
// Step 0 (new-video-prompt-mode.ts) retired this lane's verbatim rule and carved an empty
// seam. This module fills the free half of it: the prompt-construction blocks the Omni docs
// call for, which cost nothing to send and which the officers' report traces back to three
// times over.
//
// THE INVARIANT THIS MODULE EXISTS INSIDE: our text goes AROUND the officer's, never through
// it. Everything here is a prefix or a suffix; nothing rewrites, trims, translates or
// re-punctuates what was typed. That is not fastidiousness — it is what keeps Marathi intact
// code point for code point, and it is why the documented "strip the quotation marks from
// dialogue" remedy is expressed here as an INSTRUCTION rather than as a regex over the
// officer's prose. A blind quote-stripper would be actively wrong on this product's input:
// Marathi press-note prose marks SCHEME NAMES with ‘…’ (‘भारत टॅक्सी’ — see
// generation/resolve-poster-subject.ts, which strips exactly those), so a stripper aimed at
// dialogue would silently mangle the one string that must survive verbatim. Rewriting the
// officer's intent into well-formed Omni prompt language is Step 5's job, and it belongs to
// an LLM pass with the whole sentence in front of it (the Dynamic Poster lane's
// generation/motion-prompt.ts), not to a pattern match here.
//
// A CHARACTER IS NOT AN EXCEPTION TO THAT. The registry's fields are the officer's too, but
// they are REGISTRY DATA rather than the prompt — typed once into named boxes, and reproduced
// into a block of ours that carries <IMAGE_REF_n> syntax. So they are whitespace-collapsed
// (`flatten`) to keep that block's line structure intact, which is the only structural thing
// about them, and otherwise reproduced word for word. The prompt itself is still never
// touched by anything in this file.
//
// WHAT EACH BLOCK IS FOR, and the reported complaint it answers:
//
//   the reference declaration + role rule -> "characters are not consistent". Omni binds a
//   reference image to a ROLE with an inline <IMAGE_REF_n> tag declared in a leading block.
//   We were sending bare, untagged image parts, so nothing said the picture was a character
//   to hold steady rather than a frame to start from.
//
//   the CHARACTER BLOCK -> "characters are not consistent, especially when chats are
//   switched, and each character's voice is wrong". See its own note below; it is the reason
//   Step 3 exists.
//
//   the on-screen-text rule -> "asking to add or remove text does not work". Omni renders
//   burned-in subtitles when dialogue is quoted, and there is no negative_prompt parameter
//   for this model, so in-prompt negative guidance is the documented substitute.
//
//   the edit discipline -> drifting follow-ups. "Simple prompts work best for video editing;
//   overly descriptive prompts can lead to unintended changes", plus the documented
//   "Keep everything else the same."

import { pathToFileURL } from 'node:url';

import type { InteractionScaffold } from './gemini-interactions-client.js';

// The Omni reference-declaration syntax, e.g.
//   [# References <IMAGE_REF_0>@Image1 <IMAGE_REF_1>@Image2]
// Tags are 0-indexed and the labels beside them are 1-indexed, which looks like a typo and is
// not: that is the form the docs give. The labels are generic rather than the officer's file
// names — a name is theirs to choose and may carry anything, and this block is syntax. A
// character is bound to its tag in PROSE instead, in the character block below, which is
// exactly what the docs' own example does ("The woman in <VIDEO_REF_0> is playing the violin
// shown in <IMAGE_REF_0>.").
export function referenceDeclaration(imageCount: number): string {
  if (imageCount <= 0) return '';
  const tags = Array.from(
    { length: imageCount },
    (_, i) => `<IMAGE_REF_${i}>@Image${i + 1}`,
  );
  return `[# References ${tags.join(' ')}]`;
}

// The documented boilerplate, then the sentence that makes the tag worth sending. The first
// half is Google's own wording for the exact misreading we are in: an attached image read as
// the literal opening frame. The second half is this repo's long-standing reference doctrine
// (video-prompts.ts' SUPPLIED_REFERENCE_RULE) — reference MATERIAL, not a frame to reproduce,
// or an attached picture quietly overrides the shot that was asked for.
const REFERENCE_ROLE_RULE =
  'Use the given image(s) as references for video generation. The images should not be ' +
  'used as literal initial frames. Each <IMAGE_REF_n> shows a character, subject or style ' +
  'to keep consistent for the whole video: reproduce that appearance faithfully wherever ' +
  'the instruction refers to it, and take the framing, action, camera and lighting from ' +
  'the instruction rather than from the picture.';

// Phrased with the officer's own instruction OUTRANKING it, which is the whole difficulty.
// A blanket "no text" would be the wrong rule on this lane: one of the four reported
// complaints is that asking to ADD text does not work, and Omni does support affirmative
// text control. So this forbids only text nobody asked for.
//
// The second half is the repo's hardest-won image-prompt lesson (NO_TEXT_RULE's history on
// the production /video lane): a bare prohibition contradicts a scene that contains a
// signboard or a form, so the model paints one anyway and fills it with gibberish — a real
// render read `मरी रूटूम`, which is not a word. Say what to show INSTEAD.
const ON_SCREEN_TEXT_RULE =
  'Do not add subtitles, captions, titles or any on-screen words that the instruction ' +
  'above did not ask for: spoken dialogue is heard, never displayed. Where the instruction ' +
  'does call for on-screen text, show exactly the words it names and nothing else. Signs, ' +
  'door plates, forms, documents and screens that merely furnish the scene are plain ' +
  'painted panels, blank sheets and switched-off displays.';

// Follow-up turns only. The documented sentence stands ALONE as its own sentence — that is
// the form it was reported working in, and folding it into a longer clause
// ("Keep everything else the same, including ...") is the kind of paraphrase that quietly
// stops being the thing that was tested. The elaboration follows it, naming the voice among
// what must hold, because voice cannot be repaired by a later turn and an edit is where it
// drifts.
const EDIT_DISCIPLINE_RULE =
  'This instruction is an edit of the existing video. Apply only the change it describes. ' +
  'Keep everything else the same. That includes every character’s face, build, clothing and ' +
  'voice, the location, the lighting, the camera work and the pacing.';

// ---------------------------------------------------------------------------
// The character block (Step 3)
// ---------------------------------------------------------------------------
//
// WHY THIS EXISTS. Google's documented technique for voice consistency is to repeat the
// ENTIRE voice description, unchanged, on every turn — and voice editing is not supported by
// this model at all, so a wrong voice can never be corrected afterwards, only prevented. Our
// follow-ups send just the new instruction, which is the whole point of
// `previous_interaction_id`, so before the registry a voice description was stated once and
// never again. That is exactly the reported symptom. The cast is now re-emitted on EVERY
// turn of the conversation, from a stored registry entry, without the officer retyping it.
//
// AND IT IS WHAT ACTUALLY REPRODUCES "SWITCHING CHATS". A new chat in the Gemini app carries
// nothing over; consistency there comes from the user re-supplying the same portrait and the
// same description by hand. A stored cast does that automatically for a fresh conversation,
// which is why the plan puts the registry ahead of forking an interaction.

export type ScaffoldCharacter = Readonly<{
  // The canonical name the block binds a tag and a voice to.
  name: string;
  // What they look like. Emitted on the turn that ESTABLISHES the character and deliberately
  // NOT on an edit — see the block builder.
  appearance: string;
  // Re-emitted on every turn, first or follow-up. The field this whole step exists for.
  voice: string;
  // Whether THIS turn attaches their portrait as a reference image. The tag index is derived
  // from it, which is only correct because the caller puts character portraits FIRST among
  // the image parts, in cast order — stated again at the call site, and asserted in the
  // client's seam test.
  hasPortrait: boolean;
}>;

// Collapses whitespace so a registry field cannot break the block's line structure — a name
// with a newline in it would put half of itself on a line of its own, where it reads as a
// separate character. Nothing else is changed: the words, their order and their script are
// the officer's.
function flatten(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

// The one sentence that carries the documented reason. Emitted only when at least one
// character actually has a voice described, since otherwise it points at nothing.
const VOICE_LOCK_RULE =
  'Use exactly the voice described for each character, in every shot and every line they ' +
  'speak, and never substitute another: a voice cannot be corrected by a later ' +
  'instruction, so it has to be right in this one.';

function characterBlock(
  characters: readonly ScaffoldCharacter[],
  isEdit: boolean,
): string {
  if (characters.length === 0) return '';

  // The tag index counts only characters whose portrait is attached to THIS turn, in cast
  // order — which lines up with the image parts because the caller sends those portraits
  // first. A character described in words alone consumes no tag.
  let nextRef = 0;
  const lines = characters.map((character, index) => {
    const name = flatten(character.name);
    const appearance = flatten(character.appearance);
    const voice = flatten(character.voice);
    const ref = character.hasPortrait ? nextRef++ : null;

    const parts = [`${index + 1}. ${name}.`];
    if (ref !== null) parts.push(`Shown in <IMAGE_REF_${ref}>.`);
    // Appearance is deliberately absent from an edit turn. Re-describing a reference on an
    // edit is a documented cause of unintended changes ("overly descriptive prompts"), and
    // the edit-discipline rule already says the face, build and clothing must not move — so
    // restating them here would be spending the model's attention to fight its own diff.
    if (!isEdit && appearance !== '') parts.push(`Appearance: ${appearance}.`);
    if (voice !== '') parts.push(`Voice: ${voice}.`);
    return parts.join(' ');
  });

  const heading = isEdit
    ? 'CHARACTERS IN THIS VIDEO — the same people as in the video being edited. Do not ' +
      'change how any of them looks or sounds.'
    : 'CHARACTERS IN THIS VIDEO — each of these is one and the same person in every shot, ' +
      'and must look and sound exactly as described here throughout.';

  const anyVoice = characters.some(
    (character) => flatten(character.voice) !== '',
  );

  return [heading, ...lines, ...(anyVoice ? [VOICE_LOCK_RULE] : [])].join('\n');
}

export type NewVideoScaffoldInput = Readonly<{
  // How many reference images THIS turn attaches, character portraits included. Only this
  // turn's: a tag indexes the image parts of the request being built, so counting a
  // conversation's whole history would point every tag at the wrong picture.
  imageCount: number;
  // Whether the turn continues an earlier interaction. Derived from the chain point rather
  // than from the turn's position, because a turn whose predecessor failed legitimately
  // starts a fresh chain and is not an edit of anything.
  isEdit: boolean;
  // The conversation's cast, in the order it was picked — which is the order their portraits
  // are attached in. Optional so every existing caller is unchanged and a turn with no cast
  // composes exactly the blocks it did before Step 3.
  characters?: readonly ScaffoldCharacter[] | undefined;
}>;

/**
 * The blocks /new-video-workflow wraps one turn's prompt in.
 *
 * Every block is conditional on something knowable WITHOUT reading the prompt, so this
 * function is pure, free and offline — which is what lets the whole of Steps 1 and 3 be
 * verified without a paid render.
 */
export function buildNewVideoScaffold({
  imageCount,
  isEdit,
  characters = [],
}: NewVideoScaffoldInput): InteractionScaffold {
  const suffix = [
    ...(imageCount > 0 ? [REFERENCE_ROLE_RULE] : []),
    ON_SCREEN_TEXT_RULE,
    ...(isEdit ? [EDIT_DISCIPLINE_RULE] : []),
  ].join('\n\n');

  return {
    // The declaration leads, because it declares names the instruction may then use, and the
    // character block follows it immediately for the same reason — it binds those tags to
    // people, so the officer's instruction below can simply name them. The rules trail,
    // which is the position these models weight most and the position the "not literal
    // initial frames" boilerplate is documented in.
    prefix: [
      referenceDeclaration(imageCount),
      characterBlock(characters, isEdit),
    ]
      .filter((block) => block !== '')
      .join('\n\n'),
    suffix,
  };
}

// Free harness: npx tsx src/video/new-video-scaffold.ts
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

  // --- the reference declaration -------------------------------------------------------
  check('no images: no declaration block', referenceDeclaration(0) === '');
  check(
    'no images: a negative count is not a crash',
    referenceDeclaration(-1) === '',
  );
  check(
    'one image: tags are 0-indexed and labels 1-indexed',
    referenceDeclaration(1) === '[# References <IMAGE_REF_0>@Image1]',
  );
  check(
    'four images: every attached picture gets its own tag',
    referenceDeclaration(4) ===
      '[# References <IMAGE_REF_0>@Image1 <IMAGE_REF_1>@Image2 ' +
        '<IMAGE_REF_2>@Image3 <IMAGE_REF_3>@Image4]',
  );

  // --- what each turn shape carries ----------------------------------------------------
  const firstNoImages = buildNewVideoScaffold({ imageCount: 0, isEdit: false });
  const firstWithImage = buildNewVideoScaffold({
    imageCount: 1,
    isEdit: false,
  });
  const editNoImages = buildNewVideoScaffold({ imageCount: 0, isEdit: true });
  const editWithImages = buildNewVideoScaffold({ imageCount: 2, isEdit: true });
  const suffixOf = (s: InteractionScaffold): string => s.suffix ?? '';
  const prefixOf = (s: InteractionScaffold): string => s.prefix ?? '';

  check(
    'a turn with no pictures declares no references',
    firstNoImages.prefix === '' && editNoImages.prefix === '',
  );
  check(
    'a turn with no pictures does not explain a reference it never sent',
    !suffixOf(firstNoImages).includes('IMAGE_REF_n') &&
      !suffixOf(editNoImages).includes('literal initial frames'),
  );
  check(
    'an attached picture is declared AND explained',
    firstWithImage.prefix === '[# References <IMAGE_REF_0>@Image1]' &&
      suffixOf(firstWithImage).includes('literal initial frames'),
  );
  check(
    'an attached picture is named a character to hold, not a frame to start from',
    suffixOf(firstWithImage).includes('keep consistent for the whole video') &&
      suffixOf(firstWithImage).includes(
        'take the framing, action, camera and lighting from the instruction',
      ),
  );

  // --- the on-screen-text rule ---------------------------------------------------------
  for (const [label, scaffold] of [
    ['first turn', firstNoImages],
    ['first turn with a picture', firstWithImage],
    ['edit turn', editNoImages],
  ] as const) {
    check(
      `${label}: refuses subtitles nobody asked for`,
      suffixOf(scaffold).includes('Do not add subtitles'),
    );
  }
  check(
    'the text rule is ranked BELOW the officer, not above them',
    suffixOf(firstNoImages).includes('the instruction above did not ask for') &&
      suffixOf(firstNoImages).includes('does call for on-screen text'),
  );
  check(
    'the text rule says what to show instead, rather than only what not to',
    suffixOf(firstNoImages).includes('plain painted panels'),
  );

  // --- the edit discipline -------------------------------------------------------------
  check(
    'a first turn is not told to preserve a video that does not exist',
    !suffixOf(firstNoImages).includes('Keep everything else the same') &&
      !suffixOf(firstWithImage).includes('an edit of the existing video'),
  );
  check(
    'an edit turn carries the documented sentence verbatim',
    suffixOf(editNoImages).includes('Keep everything else the same.'),
  );
  check(
    'an edit turn is asked for ONE change',
    suffixOf(editNoImages).includes('Apply only the change it describes'),
  );
  check(
    'an edit turn names the VOICE among what must not drift',
    suffixOf(editNoImages).includes('voice'),
  );

  // --- composition ----------------------------------------------------------------------
  const editBlocks = suffixOf(editWithImages).split('\n\n');
  check(
    'blocks are separated by a blank line, and none is empty',
    editBlocks.length === 3 && editBlocks.every((block) => block.trim() !== ''),
  );
  check(
    'the reference rule leads the suffix and the edit discipline closes it',
    suffixOf(editWithImages).indexOf('literal initial frames') <
      suffixOf(editWithImages).indexOf('Do not add subtitles') &&
      suffixOf(editWithImages).indexOf('Do not add subtitles') <
        suffixOf(editWithImages).indexOf('Keep everything else the same.'),
  );
  // Nothing here may be the officer's PROMPT. The scaffold is built from a count, a boolean
  // and registry rows, and never sees the prompt at all, which is the structural half of the
  // around-never-through rule.
  check(
    'the scaffold is pure: the same inputs give the same blocks',
    JSON.stringify(buildNewVideoScaffold({ imageCount: 2, isEdit: true })) ===
      JSON.stringify(editWithImages),
  );

  // --- the character block (Step 3) ------------------------------------------------------
  const priya: ScaffoldCharacter = {
    name: 'प्रिया देशमुख',
    appearance: 'A woman in her early thirties in a green cotton saree.',
    voice: 'warm and measured, with a gentle Marathi accent',
    hasPortrait: true,
  };
  const rahul: ScaffoldCharacter = {
    name: 'Rahul Kale',
    appearance: 'A man in his fifties in a white shirt.',
    voice: 'low and gravelly, unhurried',
    hasPortrait: false,
  };

  check(
    'no cast: the prefix is exactly what it was before Step 3',
    JSON.stringify(
      buildNewVideoScaffold({ imageCount: 1, isEdit: false, characters: [] }),
    ) === JSON.stringify(firstWithImage),
  );

  const firstCast = buildNewVideoScaffold({
    imageCount: 2,
    isEdit: false,
    characters: [priya, rahul],
  });
  const firstCastPrefix = prefixOf(firstCast);
  check(
    'a first turn declares the cast after the reference block',
    firstCastPrefix.startsWith(
      '[# References <IMAGE_REF_0>@Image1 <IMAGE_REF_1>@Image2]',
    ) && firstCastPrefix.includes('CHARACTERS IN THIS VIDEO'),
  );
  check(
    'every character is named, Devanagari included',
    firstCastPrefix.includes('1. प्रिया देशमुख.') &&
      firstCastPrefix.includes('2. Rahul Kale.'),
  );
  // The point of the tag: the picture and the name are bound to each other in prose, which is
  // the form the docs' own example uses.
  check(
    'a character WITH a portrait is bound to a tag',
    firstCastPrefix.includes('1. प्रिया देशमुख. Shown in <IMAGE_REF_0>.'),
  );
  check(
    'a character described in words alone consumes no tag',
    !firstCastPrefix.includes('2. Rahul Kale. Shown in'),
  );
  check(
    'a first turn carries the appearance',
    firstCastPrefix.includes('Appearance: A woman in her early thirties'),
  );
  // THE FIELD THIS STEP EXISTS FOR.
  check(
    'every character carries their voice, verbatim',
    firstCastPrefix.includes(
      'Voice: warm and measured, with a gentle Marathi accent.',
    ) && firstCastPrefix.includes('Voice: low and gravelly, unhurried.'),
  );
  check(
    'and the reason a voice must be right the first time is stated',
    firstCastPrefix.includes('cannot be corrected by a later'),
  );

  // A follow-up: the voice is restated (it can never be repaired), the appearance is not
  // (re-describing a reference on an edit is a documented cause of unintended changes).
  const editCast = buildNewVideoScaffold({
    imageCount: 0,
    isEdit: true,
    characters: [{ ...priya, hasPortrait: false }],
  });
  const editCastPrefix = prefixOf(editCast);
  check(
    'a follow-up restates the VOICE — the whole reason the registry exists',
    editCastPrefix.includes(
      'Voice: warm and measured, with a gentle Marathi accent.',
    ),
  );
  check(
    'a follow-up does NOT re-describe the appearance',
    !editCastPrefix.includes('Appearance:'),
  );
  check(
    'a follow-up says these are the same people, not new ones',
    editCastPrefix.includes('the same people as in the video being edited'),
  );
  check(
    'a follow-up with no picture still declares no references',
    !editCastPrefix.includes('IMAGE_REF'),
  );

  // Index arithmetic: tags count only the portraits THIS turn attached, in cast order, so a
  // character with no picture must not shift the next one's tag.
  const mixedCast = buildNewVideoScaffold({
    imageCount: 2,
    isEdit: false,
    characters: [
      { ...rahul, hasPortrait: false },
      { ...priya, hasPortrait: true },
      { name: 'Sana', appearance: '', voice: '', hasPortrait: true },
    ],
  });
  check(
    'tags are assigned in cast order, skipping characters with no picture',
    prefixOf(mixedCast).includes('2. प्रिया देशमुख. Shown in <IMAGE_REF_0>.') &&
      prefixOf(mixedCast).includes('3. Sana. Shown in <IMAGE_REF_1>.'),
  );

  // Empty fields are omitted rather than rendered as an empty label — the
  // simple-article-prompt rule: a heading with nothing under it invites the model to fill it.
  const bareCast = buildNewVideoScaffold({
    imageCount: 0,
    isEdit: false,
    characters: [
      { name: 'Sana', appearance: '', voice: '', hasPortrait: false },
    ],
  });
  check(
    'an undescribed character is named and nothing is invented around them',
    prefixOf(bareCast).includes('1. Sana.') &&
      !prefixOf(bareCast).includes('Appearance:') &&
      !prefixOf(bareCast).includes('Voice:'),
  );
  check(
    'the voice rule is not emitted when no character has a voice',
    !prefixOf(bareCast).includes('cannot be corrected by a later'),
  );

  // A registry field is officer-typed and lands in a block that carries syntax, so its line
  // structure is normalised — and nothing else about it is.
  const messy = buildNewVideoScaffold({
    imageCount: 0,
    isEdit: false,
    characters: [
      {
        name: '  प्रिया\n  देशमुख ',
        appearance: 'A woman\n\nin a green saree',
        voice: 'warm   and  measured',
        hasPortrait: false,
      },
    ],
  });
  check(
    'a multi-line registry field cannot break the block into false characters',
    prefixOf(messy).split('\n').length === 3 &&
      prefixOf(messy).includes('1. प्रिया देशमुख.'),
  );
  check(
    'collapsing whitespace is the only thing done to a registry field',
    prefixOf(messy).includes('Appearance: A woman in a green saree.') &&
      prefixOf(messy).includes('Voice: warm and measured.'),
  );

  console.log(
    failed === 0
      ? '\nAll scaffold checks passed.'
      : `\n${failed} check(s) FAILED.`,
  );
  if (failed > 0) process.exit(1);
}
