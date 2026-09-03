// Offline tests for the Interactions video client. No network, no API key: everything here
// is the request builder and the response reader, which is where the experiment's contract
// actually lives.
//
// The assertions that matter most are the NEGATIVE ones. This surface exists to compare
// Gemini's API against the Gemini chat app, so anything this repo adds to the prompt — a
// system instruction, a house style, a negative prompt, a scene plan — invalidates the
// comparison silently. Those are asserted absent, not merely "not added today".

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
  type Interaction,
} from './gemini-interactions-client.js';
import {
  NewVideoTurnRequestSchema,
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

test('the prompt reaches Gemini verbatim, as the only text we send', () => {
  const prompt =
    '  A marble rolling down a track.\n\nKeep the shot continuous.  ';
  const body = buildInteractionRequest({ prompt });

  const texts = textPartsOf(body);
  assert.equal(
    texts.length,
    1,
    'exactly one text part — ours is the only voice',
  );
  // Not trimmed, not collapsed, not re-wrapped. Byte for byte.
  assert.equal(texts[0]?.text, prompt);

  // Nothing of ours rides along: no system instruction, no negative prompt, no scene plan,
  // no generation config. Each of these would change the output away from Gemini chat.
  const raw = JSON.stringify(body);
  assert.ok(!('system_instruction' in body), 'no system_instruction');
  assert.ok(!('generation_config' in body), 'no generation_config');
  assert.ok(!('safety_settings' in body), 'no safety_settings');
  assert.doesNotMatch(raw, /negative_prompt/i);
  assert.doesNotMatch(
    raw,
    /aspect_ratio/i,
    'no aspect ratio — Gemini defaults, per the brief',
  );
  assert.doesNotMatch(
    raw,
    /resolution/i,
    'no resolution — Gemini defaults, per the brief',
  );
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
