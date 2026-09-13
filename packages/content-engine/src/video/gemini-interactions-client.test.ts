// Offline tests for the Interactions video client. No network, no API key: everything here
// is the request builder and the response reader, which is where the experiment's contract
// actually lives.
//
// The assertions that matter most are still the NEGATIVE ones, but they are now scoped to a
// MODE rather than to the whole client. `verbatim` is the comparison stance: the officer's
// prompt is the only text, byte for byte, and a scaffold is refused rather than ignored.
// `scaffolded` is the product stance, and its own invariant is that the officer's string still
// appears inside the composed text unchanged. Request fields this repo has never sent —
// system_instruction, safety_settings, a negative prompt — are asserted absent under both,
// because they are not the scaffolding seam and their arrival would be a separate decision.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  GEMINI_VIDEO_MODEL,
  INTERACTION_IMAGE_MAX_BYTES,
  INTERACTION_MAX_IMAGES,
  INTERACTION_PROMPT_MAX_CHARS,
  InteractionRequestError,
  buildInteractionRequest,
  fileNameFromUri,
  interactionErrorMessage,
  interactionOutputOf,
  isTerminalInteractionStatus,
  rejectedCapability,
  type Interaction,
  type InteractionCapability,
} from './gemini-interactions-client.js';
import { GeminiRequestError } from '../http/gemini-request.js';
import {
  interactionModeFor,
  newVideoPromptMode,
  promptModeAuthors,
} from './new-video-prompt-mode.js';
import { buildNewVideoAuthoringRequest } from './new-video-prompt.js';
import {
  buildNewVideoScaffold,
  type ScaffoldCharacter,
} from './new-video-scaffold.js';
import { newVideoTaskFor } from './new-video-task.js';
import {
  NewVideoCharacterRequestSchema,
  NewVideoTurnRequestSchema,
  NEW_VIDEO_MAX_CAST,
  NEW_VIDEO_PROMPT_MAX_CHARS,
  NEW_VIDEO_MAX_IMAGES,
} from '@dgipr/schemas';

const MARATHI =
  'मुख्यमंत्री देवेंद्र फडणवीस यांच्या हस्ते ५०० कोटींच्या ‘भारत टॅक्सी’ योजनेचे उद्घाटन — ३१ ऑगस्ट २०२६ रोजी.';

function textPartsOf(body: ReturnType<typeof buildInteractionRequest>) {
  return body.input.filter((part) => part.type === 'text');
}

test('the model defaults to the one the experiment names', () => {
  // Env-overridable (every Gemini preview id in this repo has been renamed at least once),
  // so what is pinned here is the DEFAULT — the value a fresh clone runs on.
  const override = process.env.GEMINI_VIDEO_MODEL;
  assert.equal(GEMINI_VIDEO_MODEL, override?.trim() || 'gemini-omni-1.1-flash');
});

test('verbatim mode is the builder default, and sends nothing of ours', () => {
  const prompt =
    '  A marble rolling down a track.\n\nKeep the shot continuous.  ';
  const body = buildInteractionRequest({ prompt });
  // Naming the mode explicitly must change nothing: the default IS verbatim, so a caller that
  // has never thought about scaffolding cannot have acquired any.
  assert.deepEqual(buildInteractionRequest({ prompt, mode: 'verbatim' }), body);

  const texts = textPartsOf(body);
  assert.equal(
    texts.length,
    1,
    'exactly one text part — ours is the only voice',
  );
  // Not trimmed, not collapsed, not re-wrapped. Byte for byte.
  assert.equal(texts[0]?.text, prompt);

  // Nothing of ours rides along: no system instruction, no negative prompt, no scene plan.
  // `generation_config` is absent here because no task was ASKED for — like the aspect ratio
  // below it, the declared task is an opt-in request field rather than something this mode
  // forbids, and a field adds not one character to the officer's prompt.
  const raw = JSON.stringify(body);
  assert.ok(!('system_instruction' in body), 'no system_instruction');
  assert.ok(
    !('generation_config' in body),
    'no generation_config unless asked for',
  );
  assert.ok(!('safety_settings' in body), 'no safety_settings');
  assert.doesNotMatch(raw, /negative_prompt/i);
  // The output shape is now the officer's to choose, but it is OPT-IN: a caller that does not
  // ask for one still gets Gemini's own default, byte for byte as before that control existed.
  assert.doesNotMatch(
    raw,
    /aspect_ratio/i,
    'no aspect ratio unless one was asked for',
  );
  assert.doesNotMatch(
    raw,
    /resolution/i,
    'no resolution — Gemini defaults, per the brief',
  );
});

test("scaffolded mode wraps the prompt, and the officer's words survive inside it", () => {
  const prompt = 'A woman walks into the office.';
  const prefix = '[# References <IMAGE_REF_0>@Image1]';
  const suffix = 'Keep everything else the same.';
  const body = buildInteractionRequest({
    prompt,
    mode: 'scaffolded',
    scaffold: { prefix, suffix },
  });

  const texts = textPartsOf(body);
  assert.equal(texts.length, 1, 'still exactly one text part');
  const text = texts[0]?.text ?? '';

  // THE INVARIANT THIS MODE MUST KEEP: our text goes AROUND the officer's, never through it.
  assert.ok(text.includes(prompt), 'the prompt is present, unedited');
  assert.ok(
    text.indexOf(prefix) < text.indexOf(prompt),
    'the reference block leads',
  );
  assert.ok(
    text.indexOf(suffix) > text.indexOf(prompt),
    'the edit discipline trails',
  );
  assert.equal(text, [prefix, prompt, suffix].join('\n\n'));

  // Either half alone is a reason to compose, and the absent one must not leave a blank block.
  assert.equal(
    textPartsOf(
      buildInteractionRequest({
        prompt,
        mode: 'scaffolded',
        scaffold: { prefix },
      }),
    )[0]?.text,
    `${prefix}\n\n${prompt}`,
  );
  assert.equal(
    textPartsOf(
      buildInteractionRequest({
        prompt,
        mode: 'scaffolded',
        scaffold: { suffix },
      }),
    )[0]?.text,
    `${prompt}\n\n${suffix}`,
  );
});

test('scaffolded mode with nothing to add is byte-identical to verbatim', () => {
  // Step 0 carves the seam and fills none of it, so this is what proves the decision changed
  // no output. It also keeps an A/B honest: an empty scaffold must not become a third
  // behaviour sitting between the two stances.
  const verbatim = buildInteractionRequest({ prompt: MARATHI });

  for (const scaffold of [
    undefined,
    null,
    {},
    { prefix: '' },
    { suffix: '   ' },
    { prefix: null, suffix: undefined },
  ]) {
    assert.deepEqual(
      buildInteractionRequest({
        prompt: MARATHI,
        mode: 'scaffolded',
        scaffold,
      }),
      verbatim,
      `scaffold=${JSON.stringify(scaffold)} must add nothing`,
    );
  }
});

test('verbatim mode REFUSES a scaffold rather than dropping it', () => {
  // Dropping it silently would run a scaffolded turn's prompt through the comparison stance
  // and report the result as if the scaffolding had been tried — the one way an A/B can lie.
  for (const scaffold of [
    { prefix: '[# References <IMAGE_REF_0>@Image1]' },
    { suffix: 'Keep everything else the same.' },
  ]) {
    assert.throws(
      () =>
        buildInteractionRequest({ prompt: 'ok', mode: 'verbatim', scaffold }),
      InteractionRequestError,
    );
  }
  // Whitespace is not a scaffold, so it is not an error either.
  assert.ok(
    buildInteractionRequest({
      prompt: 'ok',
      mode: 'verbatim',
      scaffold: { prefix: '  ', suffix: '' },
    }),
  );
});

test("the lane's own scaffold composes into a real request", () => {
  // The per-block assertions live in new-video-scaffold.ts's harness. What this one is for is
  // the SEAM: the blocks that lane composes, run through this builder, must arrive as one
  // text part with the officer's Marathi still inside it unedited — which is the invariant
  // that replaced the verbatim rule, tested end to end rather than on either half alone.
  const images = [
    { data: Buffer.from('portrait-bytes'), mimeType: 'image/png' as const },
    { data: Buffer.from('logo-bytes'), mimeType: 'image/jpeg' as const },
  ];
  const body = buildInteractionRequest({
    prompt: MARATHI,
    images,
    previousInteractionId: 'v1_abc123',
    mode: 'scaffolded',
    scaffold: buildNewVideoScaffold({
      imageCount: images.length,
      isEdit: true,
    }),
  });

  const texts = textPartsOf(body);
  assert.equal(texts.length, 1, 'still exactly one text part');
  const text = texts[0]?.text ?? '';

  // One tag per image PART actually sent — a declaration naming a picture the request does
  // not carry points the model at nothing.
  const imageParts = body.input.filter((part) => part.type === 'image');
  assert.equal(imageParts.length, 2);
  assert.ok(
    text.startsWith('[# References <IMAGE_REF_0>@Image1 <IMAGE_REF_1>@Image2]'),
  );
  assert.doesNotMatch(text, /<IMAGE_REF_2>/);

  // The three things Step 1 exists to send.
  assert.ok(
    text.includes('should not be used as literal initial frames'),
    'the reference is declared a reference, not an opening frame',
  );
  assert.ok(
    text.includes('Do not add subtitles'),
    'no burned-in words the officer did not ask for',
  );
  assert.ok(
    text.includes('Keep everything else the same.'),
    'the edit discipline, on a turn that continues a chain',
  );

  // AND THE OFFICER'S STRING IS UNTOUCHED IN THE MIDDLE OF IT. Code point by code point,
  // because a normalisation pass recomposes Devanagari matras while looking identical.
  const at = text.indexOf(MARATHI);
  assert.ok(at > 0, 'the prompt sits inside the composed text');
  assert.deepEqual([...text.slice(at, at + MARATHI.length)], [...MARATHI]);
  // Nothing of ours reached INSIDE it: the scaffold is built from a count and a boolean and
  // never sees the prompt, so no quote, numeral or scheme name can have been rewritten.
  assert.equal(
    text.split(MARATHI).length,
    2,
    'the prompt appears exactly once',
  );

  // Everything this repo has never sent is still absent — scaffolding this lane is not a
  // licence to start sending a system instruction or a negative prompt.
  const raw = JSON.stringify(body);
  assert.ok(!('system_instruction' in body), 'no system_instruction');
  assert.ok(!('generation_config' in body), 'no generation_config');
  assert.doesNotMatch(raw, /negative_prompt/i);
});

test('a first turn with no pictures is scaffolded, but not with blocks that do not apply', () => {
  const body = buildInteractionRequest({
    prompt: 'A marble rolling down a track.',
    mode: 'scaffolded',
    scaffold: buildNewVideoScaffold({ imageCount: 0, isEdit: false }),
  });
  const text = textPartsOf(body)[0]?.text ?? '';

  // No reference block at all — a leading `[# References ]` would be syntax pointing at
  // nothing, and the composer drops an empty prefix rather than emitting a blank line.
  assert.ok(text.startsWith('A marble rolling down a track.'));
  assert.doesNotMatch(text, /IMAGE_REF/);
  // And nothing tells a first turn to preserve a video that does not exist yet.
  assert.doesNotMatch(text, /Keep everything else the same/);
  // The one rule that applies to every turn does apply.
  assert.ok(text.includes('Do not add subtitles'));
});

test('the lane defaults to scaffolded, and refuses a typo', () => {
  // /new-video-workflow's stance, which is a different question from what the builder does
  // with the prompt it is handed — the Dynamic Poster lane calls the same client and is
  // correctly verbatim there, its prompt having been authored a layer up.
  const original = process.env.NEW_VIDEO_PROMPT_MODE;
  try {
    delete process.env.NEW_VIDEO_PROMPT_MODE;
    assert.equal(newVideoPromptMode(), 'scaffolded');

    process.env.NEW_VIDEO_PROMPT_MODE = '  Verbatim ';
    assert.equal(newVideoPromptMode(), 'verbatim', 'trimmed and lowercased');

    process.env.NEW_VIDEO_PROMPT_MODE = ' Authored ';
    assert.equal(newVideoPromptMode(), 'authored', 'Step 5 is selectable');

    process.env.NEW_VIDEO_PROMPT_MODE = 'scaffoled';
    assert.throws(
      () => newVideoPromptMode(),
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        return (
          message.includes('scaffolded') &&
          message.includes('verbatim') &&
          message.includes('authored')
        );
      },
      'a typo must name every option rather than falling back',
    );
  } finally {
    if (original === undefined) delete process.env.NEW_VIDEO_PROMPT_MODE;
    else process.env.NEW_VIDEO_PROMPT_MODE = original;
  }
});

test('an authored turn replaces the text in the middle and nothing else', () => {
  // THE STEP 5 SEAM. The authoring pass writes the instruction; the scaffold still writes
  // everything around it. Neither module can prove that alone, so this composes the request
  // the job would send and reads both ends of it.
  //
  // `authored` is a stance of the LANE, above the client — which only ever decides whether IT
  // adds text — so it maps to `scaffolded` here and the composed shape is identical.
  assert.equal(interactionModeFor('authored'), 'scaffolded');
  assert.equal(promptModeAuthors('authored'), true);
  assert.equal(promptModeAuthors('scaffolded'), false);

  const authored =
    'A woman in a green cotton saree stands at a district office counter in Pune. ' +
    'Priya says: ' +
    MARATHI;
  const characters: ScaffoldCharacter[] = [
    {
      name: 'Priya',
      appearance: 'A woman in her early thirties in a green cotton saree.',
      voice: 'warm and measured, with a gentle Marathi accent',
      hasPortrait: true,
    },
  ];
  const body = buildInteractionRequest({
    prompt: authored,
    images: [{ data: Buffer.from('portrait'), mimeType: 'image/png' }],
    mode: interactionModeFor('authored'),
    scaffold: buildNewVideoScaffold({
      imageCount: 1,
      isEdit: false,
      characters,
    }),
    videoTask: newVideoTaskFor({ imageCount: 1, isEdit: false }),
  });
  const parts = textPartsOf(body);
  assert.equal(parts.length, 1, 'one text part, as in every other stance');
  const text = parts[0]?.text ?? '';

  // The authored instruction is what the model is asked for, unchanged.
  assert.ok(text.includes(authored), 'the authored instruction is the middle');

  // And the blocks the authoring pass is told NOT to write are still there — written by the
  // scaffold, exactly once each. A duplicate here would mean the pass had written its own.
  for (const block of [
    '[# References <IMAGE_REF_0>@Image1]',
    'CHARACTERS IN THIS VIDEO',
    'Voice: warm and measured, with a gentle Marathi accent.',
    'Do not add subtitles',
  ]) {
    assert.equal(
      text.split(block).length - 1,
      1,
      `${block} must appear exactly once`,
    );
  }

  // The tag still indexes the image part, and the declared task is still the field half of
  // the same decision — authoring changed neither.
  assert.equal(body.input[0]?.type, 'image');
  assert.equal(
    body.generation_config?.video_config?.task,
    'reference_to_video',
  );

  // The authoring REQUEST never shows the model a tag or a voice to reproduce, which is what
  // keeps the arithmetic and the verbatim description out of a model's hands.
  const request = buildNewVideoAuthoringRequest({
    prompt: MARATHI,
    isEdit: false,
    imageCount: 1,
    characters: [{ name: 'Priya' }],
  });
  assert.ok(!request.includes('IMAGE_REF'), 'no tag is shown to the author');
  assert.ok(
    !request.includes('warm and measured'),
    'a voice description is never handed to the authoring pass',
  );
  assert.ok(
    request.includes(MARATHI),
    "the officer's words reach the authoring pass unchanged",
  );
});

test('the declared task is a request field, and never rides with an edit chain', () => {
  // Step 2. Without it the task is inferred, and the inference reads an attached picture as
  // the clip's opening frame — the opposite of what this lane attaches one for.
  const first = buildInteractionRequest({
    prompt: 'A woman walks into the office.',
    images: [{ data: Buffer.from('portrait'), mimeType: 'image/png' }],
    videoTask: 'reference_to_video',
  });
  assert.deepEqual(first.generation_config, {
    video_config: { task: 'reference_to_video' },
  });

  // A FIELD, NOT A SENTENCE — the aspect-ratio rule. The prompt is still the officer's, byte
  // for byte, and carries no trace of the task.
  const texts = textPartsOf(first);
  assert.equal(texts.length, 1);
  assert.equal(texts[0]?.text, 'A woman walks into the office.');
  assert.doesNotMatch(
    texts[0]?.text ?? '',
    /reference_to_video|generation_config|task/i,
  );

  // THE INVARIANT THIS FIELD EXISTS INSIDE: a task alongside previous_interaction_id is
  // reported to break edit chains, so the builder drops it rather than trusting the caller.
  // Dropped, not refused: the turn then renders exactly as a follow-up always has, where
  // throwing would fail a turn the officer typed over a field they never asked for.
  const followUp = buildInteractionRequest({
    prompt: 'Change the background.',
    previousInteractionId: 'v1_abc123',
    videoTask: 'reference_to_video',
  });
  assert.ok(
    !('generation_config' in followUp),
    'a continued conversation declares no task',
  );
  assert.equal(followUp.previous_interaction_id, 'v1_abc123');

  // Opt-in: every caller that does not ask for one — the Dynamic Poster lane included — sends
  // no generation_config at all, byte for byte as before this field existed.
  for (const videoTask of [undefined, null] as const) {
    const body = buildInteractionRequest({ prompt: 'x', videoTask });
    assert.ok(
      !('generation_config' in body),
      'no task unless one was asked for',
    );
    assert.deepEqual(body, buildInteractionRequest({ prompt: 'x' }));
  }
});

test('the lane declares reference-to-video for a picture, and nothing for a follow-up', () => {
  // The task and the scaffold's <IMAGE_REF_n> tags are two statements of ONE decision, so
  // they are derived from the same two facts about a turn. This asserts the pair agrees in
  // the assembled request — the per-value cases live in new-video-task.ts's own harness.
  const images = [
    { data: Buffer.from('portrait'), mimeType: 'image/png' as const },
  ];
  const turn = { imageCount: images.length, isEdit: false };
  const body = buildInteractionRequest({
    prompt: MARATHI,
    images,
    mode: 'scaffolded',
    scaffold: buildNewVideoScaffold(turn),
    videoTask: newVideoTaskFor(turn),
  });

  const text = textPartsOf(body)[0]?.text ?? '';
  assert.equal(
    body.generation_config?.video_config.task,
    'reference_to_video',
    'the field says the picture is a reference',
  );
  assert.ok(
    text.startsWith('[# References <IMAGE_REF_0>@Image1]') &&
      text.includes('should not be used as literal initial frames'),
    'and the prose says the same thing',
  );
  // The officer's Marathi is untouched by either half.
  assert.ok(text.includes(MARATHI));

  // A follow-up: the scaffold gains its edit discipline exactly where the task disappears.
  const editTurn = { imageCount: 0, isEdit: true };
  const followUp = buildInteractionRequest({
    prompt: 'Change the background.',
    previousInteractionId: 'v1_abc123',
    mode: 'scaffolded',
    scaffold: buildNewVideoScaffold(editTurn),
    videoTask: newVideoTaskFor(editTurn),
  });
  assert.ok(!('generation_config' in followUp));
  assert.ok(
    (textPartsOf(followUp)[0]?.text ?? '').includes(
      'Keep everything else the same.',
    ),
  );
});

test('a cast rides every turn, and its tags line up with the parts actually sent', () => {
  // THE SEAM STEP 3 TURNS ON. The scaffold assigns <IMAGE_REF_n> by counting the cast's
  // portraits from 0; the job puts those portraits FIRST among the image parts. Neither half
  // can prove that alone — a tag pointing at the wrong picture would look exactly like the
  // model ignoring a reference, which is the complaint being fixed. So this composes one real
  // request the way the job does and reads the two ends against each other.
  const cast: ScaffoldCharacter[] = [
    {
      name: 'प्रिया देशमुख',
      appearance: 'A woman in her early thirties in a green cotton saree.',
      voice: 'warm and measured, with a gentle Marathi accent',
      hasPortrait: true,
    },
    {
      name: 'Rahul Kale',
      appearance: 'A man in his fifties in a white shirt.',
      voice: 'low and gravelly, unhurried',
      hasPortrait: true,
    },
  ];
  // Portraits first, in cast order, then the turn's own attachment — the job's ordering.
  const images = [
    { data: Buffer.from('priya-portrait'), mimeType: 'image/png' as const },
    { data: Buffer.from('rahul-portrait'), mimeType: 'image/jpeg' as const },
    { data: Buffer.from('office-photo'), mimeType: 'image/webp' as const },
  ];
  const body = buildInteractionRequest({
    prompt: MARATHI,
    images,
    mode: 'scaffolded',
    scaffold: buildNewVideoScaffold({
      imageCount: images.length,
      isEdit: false,
      characters: cast,
    }),
    videoTask: newVideoTaskFor({ imageCount: images.length, isEdit: false }),
  });

  const text = textPartsOf(body)[0]?.text ?? '';
  const imageParts = body.input.filter((part) => part.type === 'image');
  assert.equal(imageParts.length, 3);

  // One tag per part, and the first two are bound BY NAME to the first two parts — which are
  // the portraits, in cast order.
  assert.ok(
    text.startsWith(
      '[# References <IMAGE_REF_0>@Image1 <IMAGE_REF_1>@Image2 <IMAGE_REF_2>@Image3]',
    ),
  );
  assert.ok(text.includes('1. प्रिया देशमुख. Shown in <IMAGE_REF_0>.'));
  assert.ok(text.includes('2. Rahul Kale. Shown in <IMAGE_REF_1>.'));
  // The ad-hoc picture is declared but claimed by nobody — it is not a character.
  assert.doesNotMatch(text, /<IMAGE_REF_2>\./);
  // And the parts are in the order the tags name them.
  assert.equal(
    imageParts[0]?.type === 'image' ? imageParts[0].data : '',
    Buffer.from('priya-portrait').toString('base64'),
  );
  assert.equal(
    imageParts[1]?.type === 'image' ? imageParts[1].data : '',
    Buffer.from('rahul-portrait').toString('base64'),
  );

  // An attached portrait is a REFERENCE, said in prose and in the request field at once.
  assert.equal(body.generation_config?.video_config.task, 'reference_to_video');

  // The officer's Marathi is still untouched in the middle of all of it.
  const at = text.indexOf(MARATHI);
  assert.ok(at > 0);
  assert.deepEqual([...text.slice(at, at + MARATHI.length)], [...MARATHI]);
  assert.equal(text.split(MARATHI).length, 2);
});

test('a follow-up restates the voice and re-sends nothing else about the cast', () => {
  // The reason the registry exists: voice editing is NOT supported by this model, so a wrong
  // voice can never be corrected afterwards — only prevented, by restating the description on
  // every turn. Our follow-ups send just the new instruction, so before this the description
  // was stated once and never again.
  //
  // The appearance is deliberately NOT restated, and neither is the portrait: re-describing
  // or re-attaching a reference on an edit is the documented cause of unintended changes.
  const cast: ScaffoldCharacter[] = [
    {
      name: 'प्रिया देशमुख',
      appearance: 'A woman in her early thirties in a green cotton saree.',
      voice: 'warm and measured, with a gentle Marathi accent',
      // The job sets this false on a follow-up, whatever the registry holds.
      hasPortrait: false,
    },
  ];
  const body = buildInteractionRequest({
    prompt: 'पार्श्वभूमी बदला.',
    previousInteractionId: 'v1_abc123',
    mode: 'scaffolded',
    scaffold: buildNewVideoScaffold({
      imageCount: 0,
      isEdit: true,
      characters: cast,
    }),
    videoTask: newVideoTaskFor({ imageCount: 0, isEdit: true }),
  });

  const text = textPartsOf(body)[0]?.text ?? '';
  assert.ok(
    text.includes('Voice: warm and measured, with a gentle Marathi accent.'),
    'the voice is restated — the whole point of the registry',
  );
  assert.ok(
    text.includes('cannot be corrected by a later'),
    'and why it has to be right now is said out loud',
  );
  assert.doesNotMatch(text, /Appearance:/);
  assert.doesNotMatch(text, /IMAGE_REF/);
  assert.equal(
    body.input.filter((part) => part.type === 'image').length,
    0,
    'no portrait is re-sent into the middle of an edit chain',
  );
  // The edit chain is untouched by any of it.
  assert.equal(body.previous_interaction_id, 'v1_abc123');
  assert.ok(!('generation_config' in body), 'and a follow-up declares no task');
});

test('a conversation with no cast composes exactly what it did before the registry', () => {
  // The regression guard that makes every later change to this block safe to reason about:
  // an empty cast must be byte-identical to the Step 1 scaffold, so nothing of Step 3 leaks
  // into a conversation that never named a character.
  const args = { imageCount: 1, isEdit: false } as const;
  assert.deepEqual(
    buildNewVideoScaffold({ ...args, characters: [] }),
    buildNewVideoScaffold(args),
  );
  const prompt = 'A marble rolling down a track.';
  const images = [{ data: Buffer.from('x'), mimeType: 'image/png' as const }];
  assert.deepEqual(
    buildInteractionRequest({
      prompt,
      images,
      mode: 'scaffolded',
      scaffold: buildNewVideoScaffold({ ...args, characters: [] }),
    }),
    buildInteractionRequest({
      prompt,
      images,
      mode: 'scaffolded',
      scaffold: buildNewVideoScaffold(args),
    }),
  );
});

test('the wire schema and the client agree about the size of a cast', () => {
  // A character WITH a portrait spends one of the turn's reference-image slots, so a cast can
  // never be allowed to be larger than the client will accept images — the route enforces the
  // combined total, and this is the ceiling that bound is measured against.
  assert.ok(NEW_VIDEO_MAX_CAST <= INTERACTION_MAX_IMAGES);
  assert.equal(NEW_VIDEO_MAX_CAST, NEW_VIDEO_MAX_IMAGES);

  const ids = Array.from(
    { length: NEW_VIDEO_MAX_CAST },
    () => '00000000-0000-4000-8000-000000000000',
  );
  assert.ok(
    NewVideoTurnRequestSchema.safeParse({ prompt: 'x', characterIds: ids })
      .success,
  );
  assert.ok(
    !NewVideoTurnRequestSchema.safeParse({
      prompt: 'x',
      characterIds: [...ids, '00000000-0000-4000-8000-000000000001'],
    }).success,
    'one past the ceiling is refused before a render, not after',
  );
  // A cast is optional: this lane worked without one and still does.
  assert.ok(NewVideoTurnRequestSchema.safeParse({ prompt: 'x' }).success);
});

test('a character name may not carry the syntax the block is made of', () => {
  // A name is reproduced into a block that carries <IMAGE_REF_n> tags and a `[# References ]`
  // declaration, so a name containing those characters could point the model at a picture the
  // officer never attached. A person's name contains none of them.
  for (const name of [
    'Priya <IMAGE_REF_1>',
    '[# References]',
    'Rahul > Kale',
  ]) {
    assert.ok(
      !NewVideoCharacterRequestSchema.safeParse({ name }).success,
      `refused: ${name}`,
    );
  }
  // Marathi, punctuation and honorifics are all ordinary names.
  for (const name of ['प्रिया देशमुख', 'श्री. राहुल काळे', "D'Souza"]) {
    assert.ok(
      NewVideoCharacterRequestSchema.safeParse({ name }).success,
      `accepted: ${name}`,
    );
  }
  assert.ok(!NewVideoCharacterRequestSchema.safeParse({ name: '  ' }).success);
  // The registry's descriptions are prose and are left alone — only the NAME is constrained,
  // because only the name is what a tag is bound to.
  assert.ok(
    NewVideoCharacterRequestSchema.safeParse({
      name: 'Priya',
      appearance: 'Reads a sign that says <OPEN>',
      voice: 'warm',
    }).success,
  );
});

test('the chosen output shape travels as a request field, never in the prompt', () => {
  const prompt = 'A marble rolling down a track.';

  for (const aspect of ['16:9', '9:16']) {
    const body = buildInteractionRequest({ prompt, aspectRatio: aspect });

    assert.equal(body.response_format?.aspect_ratio, aspect);
    // URI delivery is untouched by it: the two live in the same object and one must not cost
    // the other.
    assert.equal(body.response_format?.delivery, 'uri');

    // THE RULE THIS FEATURE HAD TO NOT BREAK. The prompt is still the only text we send, and
    // still byte for byte the officer's — the ratio is a field, not a sentence.
    const texts = textPartsOf(body);
    assert.equal(texts.length, 1, 'still exactly one text part');
    assert.equal(texts[0]?.text, prompt);
    assert.doesNotMatch(texts[0]?.text ?? '', /aspect|ratio|16:9|9:16/i);
  }
});

test('an aspect ratio can be requested without URI delivery, and vice versa', () => {
  // The learned-capability ladder drops these independently, so neither may take the other
  // with it: a model that refuses `delivery` must still render in the shape that was asked
  // for, and one that refuses `aspect_ratio` must still deliver by URI.
  const noDelivery = buildInteractionRequest({
    prompt: 'x',
    uriDelivery: false,
    aspectRatio: '9:16',
  });
  assert.deepEqual(noDelivery.response_format, {
    type: 'video',
    aspect_ratio: '9:16',
  });

  const noAspect = buildInteractionRequest({
    prompt: 'x',
    uriDelivery: true,
    aspectRatio: null,
  });
  assert.deepEqual(noAspect.response_format, {
    type: 'video',
    delivery: 'uri',
  });

  // Neither wanted: no response_format at all rather than an empty object.
  const neither = buildInteractionRequest({
    prompt: 'x',
    uriDelivery: false,
    aspectRatio: null,
  });
  assert.equal(neither.response_format, undefined);
});

test('Marathi Unicode survives the request builder unchanged', () => {
  const body = buildInteractionRequest({ prompt: MARATHI });
  const sent = textPartsOf(body)[0]?.text;

  assert.equal(sent, MARATHI);
  // Character-for-character, which is the property a stray .normalize() would break while
  // leaving the string looking identical in a terminal.
  assert.deepEqual([...(sent ?? '')], [...MARATHI]);
  // And it survives the JSON round trip the transport performs.
  assert.equal(JSON.parse(JSON.stringify(body)).input.at(-1).text, MARATHI);
  // Devanagari digits are digits, not something to be "corrected" to Latin.
  assert.match(sent ?? '', /५०० कोटी/);
  assert.match(sent ?? '', /३१ ऑगस्ट २०२६/);

  // And under scaffolding too: our blocks sit around the Marathi, never through it. Compared
  // code point by code point, because a normalisation pass recomposes matras invisibly.
  const wrapped =
    textPartsOf(
      buildInteractionRequest({
        prompt: MARATHI,
        mode: 'scaffolded',
        scaffold: {
          prefix: 'Reference block.',
          suffix: 'Keep everything else the same.',
        },
      }),
    )[0]?.text ?? '';
  const at = wrapped.indexOf(MARATHI);
  assert.ok(at > 0, 'the Marathi survives inside the composed text');
  assert.deepEqual([...wrapped.slice(at, at + MARATHI.length)], [...MARATHI]);
});

test('the conversation is stored, and a first turn carries no previous interaction', () => {
  const body = buildInteractionRequest({ prompt: 'Make a video.' });

  // Without store:true there is nothing for the next turn to continue from.
  assert.equal(body.store, true);
  assert.ok(
    !('previous_interaction_id' in body),
    'a new conversation is independent — no prior state is referenced',
  );
});

test('a follow-up forwards previous_interaction_id, images or not', () => {
  const textOnly = buildInteractionRequest({
    prompt: 'Change the background.',
    previousInteractionId: 'v1_abc123',
  });
  assert.equal(textOnly.previous_interaction_id, 'v1_abc123');
  assert.equal(textOnly.store, true);
  assert.equal(textPartsOf(textOnly)[0]?.text, 'Change the background.');

  // A follow-up may also attach a NEW reference image.
  const withImage = buildInteractionRequest({
    prompt: 'Use this logo.',
    images: [{ data: Buffer.from([1, 2, 3]), mimeType: 'image/png' }],
    previousInteractionId: 'v1_abc123',
  });
  assert.equal(withImage.previous_interaction_id, 'v1_abc123');
  assert.equal(
    withImage.input.filter((part) => part.type === 'image').length,
    1,
  );

  // Explicitly starting over drops the chain entirely rather than sending an empty string,
  // which the API would read as a malformed reference.
  for (const previousInteractionId of [null, undefined, ''] as const) {
    const fresh = buildInteractionRequest({
      prompt: 'A fresh idea.',
      previousInteractionId,
    });
    assert.ok(
      !('previous_interaction_id' in fresh),
      `previousInteractionId=${JSON.stringify(previousInteractionId)} must start a new conversation`,
    );
  }
});

test('reference images travel as base64 parts, ahead of the instruction', () => {
  const png = Buffer.from('fake-png-bytes');
  const webp = Buffer.from('fake-webp-bytes');
  const body = buildInteractionRequest({
    prompt: 'Animate these.',
    images: [
      { data: png, mimeType: 'image/png' },
      { data: webp, mimeType: 'image/webp' },
    ],
  });

  assert.equal(body.input.length, 3);
  assert.deepEqual(
    body.input.map((part) => part.type),
    ['image', 'image', 'text'],
    'images first, then the instruction about them',
  );
  const [first, second] = body.input;
  assert.equal(
    first?.type === 'image' ? first.data : null,
    png.toString('base64'),
  );
  assert.equal(first?.type === 'image' ? first.mime_type : null, 'image/png');
  assert.equal(
    second?.type === 'image' ? second.data : null,
    webp.toString('base64'),
  );
  assert.equal(
    second?.type === 'image' ? second.mime_type : null,
    'image/webp',
  );
  // Round-tripping the base64 must give back the exact bytes the officer uploaded.
  assert.deepEqual(
    Buffer.from(first?.type === 'image' ? first.data : '', 'base64'),
    png,
  );
});

test('the request is validated before anything can be billed', () => {
  const image = { data: Buffer.from('x'), mimeType: 'image/png' as const };

  assert.throws(
    () => buildInteractionRequest({ prompt: '   ' }),
    InteractionRequestError,
    'an empty prompt is nothing to generate from',
  );
  assert.throws(
    () =>
      buildInteractionRequest({
        prompt: 'x'.repeat(INTERACTION_PROMPT_MAX_CHARS + 1),
      }),
    InteractionRequestError,
  );
  assert.throws(
    () =>
      buildInteractionRequest({
        prompt: 'ok',
        images: Array.from({ length: INTERACTION_MAX_IMAGES + 1 }, () => image),
      }),
    InteractionRequestError,
  );
  assert.throws(
    () =>
      buildInteractionRequest({
        prompt: 'ok',
        images: [{ data: Buffer.from('x'), mimeType: 'image/gif' }],
      }),
    InteractionRequestError,
    'only PNG, JPEG and WebP',
  );
  assert.throws(
    () =>
      buildInteractionRequest({
        prompt: 'ok',
        images: [
          {
            data: Buffer.alloc(INTERACTION_IMAGE_MAX_BYTES + 1),
            mimeType: 'image/png',
          },
        ],
      }),
    InteractionRequestError,
  );
  assert.throws(
    () =>
      buildInteractionRequest({
        prompt: 'ok',
        images: [{ data: Buffer.alloc(0), mimeType: 'image/png' }],
      }),
    InteractionRequestError,
  );

  // The happy path at exactly the limits is accepted, so the guards are bounds and not
  // off-by-one refusals.
  assert.ok(
    buildInteractionRequest({
      prompt: 'x'.repeat(INTERACTION_PROMPT_MAX_CHARS),
      images: Array.from({ length: INTERACTION_MAX_IMAGES }, () => image),
    }),
  );
});

test('the wire schema and the client agree about the limits', () => {
  // Two packages state these; if they drift, the browser offers what the client refuses.
  assert.equal(NEW_VIDEO_PROMPT_MAX_CHARS, INTERACTION_PROMPT_MAX_CHARS);
  assert.equal(NEW_VIDEO_MAX_IMAGES, INTERACTION_MAX_IMAGES);

  assert.ok(NewVideoTurnRequestSchema.safeParse({ prompt: MARATHI }).success);
  assert.ok(
    NewVideoTurnRequestSchema.safeParse({
      prompt: 'edit it',
      conversationId: '8383a0b6-9b4d-4597-9acc-994920b39b40',
      imageIds: ['8383a0b6-9b4d-4597-9acc-994920b39b41'],
    }).success,
  );
  assert.equal(
    NewVideoTurnRequestSchema.safeParse({ prompt: '' }).success,
    false,
  );
  assert.equal(
    NewVideoTurnRequestSchema.safeParse({
      prompt: 'x'.repeat(NEW_VIDEO_PROMPT_MAX_CHARS + 1),
    }).success,
    false,
  );
  assert.equal(
    NewVideoTurnRequestSchema.safeParse({
      prompt: 'ok',
      imageIds: Array.from(
        { length: NEW_VIDEO_MAX_IMAGES + 1 },
        () => 'not-a-uuid',
      ),
    }).success,
    false,
  );
  // The browser never names a storage path or a provider id — only ids this API minted.
  assert.equal(
    NewVideoTurnRequestSchema.safeParse({
      prompt: 'ok',
      imageIds: ['new-video-workflow/whatever.png'],
    }).success,
    false,
  );
  // The parsed prompt is the officer's string, unchanged.
  assert.equal(
    NewVideoTurnRequestSchema.parse({ prompt: MARATHI }).prompt,
    MARATHI,
  );
});

test('a generated video is found whether it is delivered by URI or inline', () => {
  const byUri: Interaction = {
    id: 'v1_a',
    status: 'completed',
    steps: [
      {
        type: 'user_input',
        content: [{ type: 'text', text: 'the prompt, echoed back' }],
      },
      {
        type: 'thought',
        content: [{ type: 'thought', text: 'planning the shot' }],
      },
      {
        type: 'model_output',
        content: [
          { type: 'text', text: 'Here is your video.' },
          {
            type: 'video',
            mime_type: 'video/mp4',
            uri: 'https://generativelanguage.googleapis.com/v1beta/files/abc-123:download?alt=media',
          },
        ],
      },
    ],
  };
  const uriOut = interactionOutputOf(byUri);
  assert.equal(
    uriOut.videoUri,
    'https://generativelanguage.googleapis.com/v1beta/files/abc-123:download?alt=media',
  );
  assert.equal(uriOut.videoData, null);
  // The echoed prompt and the model's private reasoning are NOT the answer.
  assert.equal(uriOut.text, 'Here is your video.');
  assert.equal(interactionErrorMessage(byUri), null);

  const inline: Interaction = {
    id: 'v1_b',
    status: 'completed',
    steps: [
      {
        type: 'model_output',
        content: [
          { type: 'video', mime_type: 'video/mp4', data: 'AAAAIGZ0eXBpc29t' },
        ],
      },
    ],
  };
  assert.equal(interactionOutputOf(inline).videoData, 'AAAAIGZ0eXBpc29t');
  assert.equal(interactionOutputOf(inline).videoUri, null);

  // The SDK's convenience mirror is read too — a preview API earns a tolerant reader.
  const sdkShape: Interaction = {
    id: 'v1_c',
    status: 'completed',
    output_video: {
      uri: 'https://example.invalid/files/zzz:download?alt=media',
    },
  };
  assert.equal(
    interactionOutputOf(sdkShape).videoUri,
    'https://example.invalid/files/zzz:download?alt=media',
  );

  assert.equal(interactionOutputOf({}).videoUri, null);
  assert.equal(interactionOutputOf({}).text, '');
});

test('a refusal or safety block explains itself instead of failing blankly', () => {
  const failed: Interaction = {
    id: 'v1_d',
    status: 'failed',
    errors: [
      { code: 'SAFETY', message: 'The prompt was blocked by a safety filter.' },
    ],
  };
  assert.equal(
    interactionErrorMessage(failed),
    'The prompt was blocked by a safety filter.',
  );

  // No error object, but a terminal non-success status: the model's own words are the best
  // explanation available, so they are carried rather than replaced.
  const incomplete: Interaction = {
    id: 'v1_e',
    status: 'incomplete',
    steps: [
      {
        type: 'model_output',
        content: [{ type: 'text', text: 'I cannot depict that.' }],
      },
    ],
  };
  assert.equal(
    interactionErrorMessage(incomplete),
    'Gemini ended the interaction as "incomplete": I cannot depict that.',
  );

  assert.equal(
    interactionErrorMessage({ id: 'v1_f', status: 'cancelled' }),
    'Gemini ended the interaction as "cancelled".',
  );
});

test('polling stops on every terminal status, not just success', () => {
  for (const status of ['queued', 'in_progress']) {
    assert.equal(isTerminalInteractionStatus(status), false, status);
  }
  for (const status of [
    'completed',
    'failed',
    'cancelled',
    'incomplete',
    'budget_exceeded',
    'requires_action',
  ]) {
    assert.equal(isTerminalInteractionStatus(status), true, status);
  }
});

test('the file id is recovered from a delivery URI so the download can wait for it', () => {
  assert.equal(
    fileNameFromUri(
      'https://generativelanguage.googleapis.com/v1beta/files/abc-123:download?alt=media',
    ),
    'files/abc-123',
  );
  assert.equal(fileNameFromUri('files/xyz'), 'files/xyz');
  assert.equal(fileNameFromUri('https://example.invalid/video.mp4'), null);
});

// ---------------------------------------------------------------------------
// The frame size: a request field, and the rung that drops it
// ---------------------------------------------------------------------------

test('the frame size travels as a request field beside delivery and the ratio', () => {
  const prompt = 'A flag lifting in the wind.';
  const body = buildInteractionRequest({
    prompt,
    aspectRatio: '4:5',
    resolution: '1080p',
  });

  assert.deepEqual(body.response_format, {
    type: 'video',
    delivery: 'uri',
    aspect_ratio: '4:5',
    resolution: '1080p',
  });

  // THE SAME RULE THE ASPECT RATIO HAD TO NOT BREAK. A pixel size in the PROMPT is the defect
  // the Dynamic Poster brief was rewritten to remove — a video model cannot honour it — so it
  // belongs in the body and nowhere else.
  const texts = textPartsOf(body);
  assert.equal(texts.length, 1);
  assert.equal(texts[0]?.text, prompt);
  assert.doesNotMatch(texts[0]?.text ?? '', /resolution|1080|720/i);

  // And a caller that does not ask for one sends nothing, which is every caller but this lane.
  const without = buildInteractionRequest({ prompt, resolution: null });
  assert.equal(without.response_format?.resolution, undefined);
  assert.deepEqual(without.response_format, { type: 'video', delivery: 'uri' });

  // A resolution ALONE is reason enough to send the object — the three fields are independent.
  const only = buildInteractionRequest({
    prompt,
    uriDelivery: false,
    aspectRatio: null,
    resolution: '720p',
  });
  assert.deepEqual(only.response_format, { type: 'video', resolution: '720p' });
});

// The ladder itself needs a key and a network; its ORDER does not, which is the half that fails
// silently — by dropping the wrong field — so rejectedCapability is exported to be asserted here.
const badRequest = (detail: string) =>
  new GeminiRequestError('interactions create', 400, 'Bad Request', detail);

test('a 400 naming only the resolution drops it and keeps delivery and the ratio', () => {
  const body = buildInteractionRequest({
    prompt: 'x',
    aspectRatio: '4:5',
    resolution: '1080p',
  });

  assert.equal(
    rejectedCapability(
      badRequest('Unsupported value: response_format.resolution'),
      body,
    ),
    'resolution',
  );

  // What the next attempt carries, which is the point of learning one field at a time.
  const retry = buildInteractionRequest({
    prompt: 'x',
    aspectRatio: '4:5',
    resolution: null,
  });
  assert.equal(retry.response_format?.aspect_ratio, '4:5');
  assert.equal(retry.response_format?.delivery, 'uri');
  assert.equal(retry.response_format?.resolution, undefined);
});

test('a 400 naming BOTH the resolution and the aspect ratio drops the resolution', () => {
  // THE ORDERING CASE, and the reason the rung sits where it does. This is real wording: a
  // resolution rejection routinely names the ratio it is unsupported FOR. Taking the aspect
  // rung first would discard the field that matters and keep the one that caused the 400 —
  // undoing the whole change while every other test here still passed.
  const body = buildInteractionRequest({
    prompt: 'x',
    aspectRatio: '9:16',
    resolution: '1080p',
  });
  assert.equal(
    rejectedCapability(
      badRequest('unsupported resolution 1080p for aspect ratio 9:16'),
      body,
    ),
    'resolution',
  );

  // And once resolution is learned, the SAME 400 correctly falls through to the aspect rung —
  // the fall-through the learned set exists to preserve.
  const learned = new Set<InteractionCapability>(['resolution']);
  assert.equal(
    rejectedCapability(
      badRequest('unsupported resolution 1080p for aspect ratio 9:16'),
      body,
      learned,
    ),
    'aspectRatio',
  );
});

test('a 400 naming only response_format still reaches the broad rung', () => {
  const body = buildInteractionRequest({
    prompt: 'x',
    aspectRatio: '4:5',
    resolution: '1080p',
  });
  assert.equal(
    rejectedCapability(badRequest('unknown field: response_format'), body),
    'responseFormat',
  );

  // A rung whose field this body never carried cannot fire, however the error is worded — the
  // guard that keeps a false needle match costing at most one retry.
  const bare = buildInteractionRequest({
    prompt: 'x',
    uriDelivery: false,
    aspectRatio: null,
    resolution: null,
  });
  assert.equal(bare.response_format, undefined);
  assert.equal(
    rejectedCapability(badRequest('unsupported resolution'), bare),
    null,
  );

  // Not a 400, and not a Gemini error at all: neither is an answer about a field.
  assert.equal(
    rejectedCapability(
      new GeminiRequestError(
        'interactions create',
        500,
        'Server Error',
        'resolution',
      ),
      body,
    ),
    null,
  );
  assert.equal(rejectedCapability(new Error('resolution'), body), null);
});
