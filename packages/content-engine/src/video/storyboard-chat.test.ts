// No-network tests for STORYBOARD MODE (video/storyboard-chat.ts). `fetch` is replaced by a
// scripted OpenAI Responses server, so the whole turn — streaming, the image tool loop, the
// chain handle and the recovery path — runs without a key or a bill.
//
// Run: pnpm --filter @dgipr/content-engine storyboard:test

import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import {
  STORYBOARD_IMAGE_LIMIT,
  STORYBOARD_IMAGE_RULES,
  STORYBOARD_SYSTEM_INSTRUCTION,
  buildStoryboardImagePrompt,
  buildStoryboardInput,
  buildStoryboardRequestBody,
  functionCallsOf,
  parseImageCallArguments,
  runStoryboardTurn,
  storyboardImageSize,
  type StoryboardChatTurn,
  type StoryboardImageRequest,
} from './storyboard-chat.js';
import { CHAT_IDENTITY_RULE } from '../chat/chat-identity.js';

// ---------------------------------------------------------------------------
// A scripted Responses server
// ---------------------------------------------------------------------------

type Scripted = Readonly<{
  deltas?: readonly string[];
  // The completed response's `output`, beyond the text message built from `deltas`.
  calls?: readonly Readonly<{ callId: string; args: unknown }>[];
  // A non-2xx answer instead of a stream.
  fail?: Readonly<{ status: number; body: string }>;
}>;

let script: Scripted[] = [];
let requests: Record<string, unknown>[] = [];
const realFetch = globalThis.fetch;
let counter = 0;

function sse(frames: readonly unknown[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const text = frames
    .map((frame) => `data: ${JSON.stringify(frame)}\n\n`)
    .join('');
  return new ReadableStream({
    start(controller) {
      // Split mid-frame on purpose: the reader must survive a chunk boundary anywhere.
      const bytes = encoder.encode(text);
      const cut = Math.floor(bytes.length / 2);
      controller.enqueue(bytes.slice(0, cut));
      controller.enqueue(bytes.slice(cut));
      controller.close();
    },
  });
}

beforeEach(() => {
  script = [];
  requests = [];
  process.env.OPENAI_API_KEY = 'test-key';
  process.env.OPENAI_MAX_RETRIES = '0';
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<
      string,
      unknown
    >;
    requests.push(body);
    const next = script.shift();
    if (!next) throw new Error('the test server ran out of scripted answers');
    if (next.fail) {
      return new Response(next.fail.body, { status: next.fail.status });
    }
    counter += 1;
    const id = `resp_${counter}`;
    const deltas = next.deltas ?? [];
    const output: unknown[] = [];
    if (deltas.length > 0) {
      output.push({
        type: 'message',
        content: [{ type: 'output_text', text: deltas.join('') }],
      });
    }
    for (const call of next.calls ?? []) {
      output.push({
        type: 'function_call',
        name: 'generate_image',
        call_id: call.callId,
        arguments: JSON.stringify(call.args),
      });
    }
    const frames = [
      ...deltas.map((delta) => ({ type: 'response.output_text.delta', delta })),
      {
        type: 'response.completed',
        response: { id, status: 'completed', model: 'test-model', output },
      },
    ];
    return new Response(sse(frames), {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

const conversation: StoryboardChatTurn[] = [
  {
    role: 'user',
    content: 'शेतकरी कर्जमुक्ती योजनेवर ३० सेकंदांचा स्टोरीबोर्ड करा.',
  },
  { role: 'assistant', content: '### दृश्य १ — सकाळ\n\n- दिसते: शेत' },
  {
    role: 'user',
    content: 'दृश्य ३ साठी हे चित्र प्रेरणा म्हणून वापरा.',
    imageUrls: ['https://cdn.test/a.png', 'https://cdn.test/b.png'],
  },
];

// ---------------------------------------------------------------------------
// Pure pieces
// ---------------------------------------------------------------------------

test('the instruction is scoped to storyboards and white-labelled', () => {
  const s = STORYBOARD_SYSTEM_INSTRUCTION;
  assert.match(s, /write video scripts/);
  assert.match(s, /create storyboards/);
  assert.match(s, /change the specific scenes/);
  assert.match(s, /ONLY when the officer explicitly asks for an image/);
  assert.match(s, /falls outside this/);
  assert.match(s, /Never invent names, dates, amounts/);
  // Scenes visually separated — a presentation rule, never a schema.
  assert.match(s, /its own heading/);
  assert.match(s, /horizontal rule \(---\)/);
  assert.match(s, /no fixed template/);
  assert.match(s, /renumber them and return the COMPLETE updated storyboard/);
  assert.ok(s.includes(CHAT_IDENTITY_RULE));
  assert.ok(s.includes(`at most ${STORYBOARD_IMAGE_LIMIT}`));
});

test('the image rules are appended in code and phrased positively', () => {
  const prompt = buildStoryboardImagePrompt(
    '  A farmer at dawn in a green field.  ',
  );
  assert.ok(prompt.startsWith('A farmer at dawn in a green field.'));
  assert.ok(prompt.endsWith(STORYBOARD_IMAGE_RULES));
  assert.match(STORYBOARD_IMAGE_RULES, /Maharashtra, India/);
  assert.match(STORYBOARD_IMAGE_RULES, /plain painted panels/);
  assert.match(STORYBOARD_IMAGE_RULES, /blank sheets/);
});

test('orientation maps to gpt-image sizes, landscape by default', () => {
  assert.equal(storyboardImageSize('landscape'), '1536x1024');
  assert.equal(storyboardImageSize('portrait'), '1024x1536');
  assert.equal(storyboardImageSize('square'), '1024x1024');
  const parsed = parseImageCallArguments(
    JSON.stringify({
      prompt: 'x',
      label: 'दृश्य ३',
      orientation: 'sideways',
      use_attached_images: true,
    }),
  );
  assert.equal(parsed?.orientation, 'landscape');
  assert.equal(parsed?.size, '1536x1024');
  assert.equal(parsed?.useAttachedImages, true);
  assert.equal(parsed?.label, 'दृश्य ३');
  assert.equal(parseImageCallArguments('{"prompt":"  "}'), null);
  assert.equal(parseImageCallArguments('not json'), null);
});

test('a continued turn sends only the newest message, with its pictures as image parts', () => {
  const input = buildStoryboardInput(conversation, true);
  assert.equal(input.length, 1);
  const parts = input[0]?.content as readonly {
    type: string;
    image_url?: string;
  }[];
  assert.equal(parts.filter((part) => part.type === 'input_image').length, 2);
  assert.equal(parts[2]?.image_url, 'https://cdn.test/a.png');
  assert.equal(parts[3]?.image_url, 'https://cdn.test/b.png');
});

test('a rebuilt transcript replays everything, pictures only on the newest message', () => {
  const history: StoryboardChatTurn[] = [
    { role: 'user', content: 'पहिला', imageUrls: ['https://cdn.test/old.png'] },
    {
      role: 'assistant',
      content: 'उत्तर',
      generatedImages: [{ label: 'दृश्य १', prompt: 'A farmer' }],
    },
    { role: 'user', content: 'दुसरा', imageUrls: ['https://cdn.test/new.png'] },
  ];
  const input = buildStoryboardInput(history, false);
  assert.equal(input.length, 3);
  const first = input[0]?.content as readonly { type: string }[];
  assert.ok(first.every((part) => part.type === 'input_text'));
  assert.match(
    String(input[1]?.content),
    /Picture 1 generated for दृश्य १: A farmer/,
  );
  const last = input[2]?.content as readonly { type: string }[];
  assert.equal(last.filter((part) => part.type === 'input_image').length, 1);
});

test('instructions and the tool travel on every request, the chain only when given', () => {
  const fresh = buildStoryboardRequestBody([], undefined, 'auto', true);
  assert.equal(fresh.instructions, STORYBOARD_SYSTEM_INSTRUCTION);
  assert.equal((fresh.tools as unknown[]).length, 1);
  assert.equal(fresh.store, true);
  assert.equal(fresh.stream, true);
  assert.equal('previous_response_id' in fresh, false);
  const chained = buildStoryboardRequestBody([], 'resp_x', 'none', false);
  assert.equal(chained.previous_response_id, 'resp_x');
  assert.equal(chained.tool_choice, 'none');
  assert.equal('stream' in chained, false);
});

test('function calls are read off the completed response', () => {
  const calls = functionCallsOf({
    output: [
      { type: 'message', content: [] },
      {
        type: 'function_call',
        name: 'generate_image',
        call_id: 'c1',
        arguments: '{}',
      },
      { type: 'function_call', name: 'generate_image' },
    ],
  });
  assert.deepEqual(calls, [
    { callId: 'c1', name: 'generate_image', arguments: '{}' },
  ]);
});

// ---------------------------------------------------------------------------
// Whole turns
// ---------------------------------------------------------------------------

test('a text-only turn streams, needs one request, and returns the chain handle', async () => {
  script = [{ deltas: ['### दृश्य १', ' — सकाळ\n\n', '- दिसते: शेत'] }];
  let live = '';
  let rendered = 0;
  const reply = await runStoryboardTurn({
    turns: conversation,
    previousResponseId: 'resp_prev',
    onDelta: (chunk) => {
      live += chunk;
    },
    generateImage: async () => {
      rendered += 1;
      throw new Error('should not be called');
    },
  });
  assert.equal(reply.text, '### दृश्य १ — सकाळ\n\n- दिसते: शेत');
  assert.equal(live, reply.text);
  assert.equal(rendered, 0);
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.previous_response_id, 'resp_prev');
  assert.match(reply.responseId, /^resp_/);
});

test('an image request runs the tool, answers the call, and ends on a clean response', async () => {
  script = [
    {
      deltas: ['हे चित्र तयार करत आहे.'],
      calls: [
        {
          callId: 'call_a',
          args: {
            prompt: 'A farmer at dawn',
            label: 'दृश्य ३',
            orientation: 'portrait',
            use_attached_images: true,
          },
        },
      ],
    },
    { deltas: ['दृश्य ३ साठी चित्र वर दाखवले आहे.'] },
  ];
  const asked: StoryboardImageRequest[] = [];
  const landed: string[] = [];
  let live = '';
  const reply = await runStoryboardTurn({
    turns: conversation,
    onDelta: (chunk) => {
      live += chunk;
    },
    generateImage: async (request) => {
      asked.push(request);
      return {
        id: 'img1',
        url: 'https://cdn.test/img1.png',
        label: request.label,
        prompt: request.prompt,
      };
    },
    onImage: (image) => landed.push(image.id),
  });

  assert.equal(asked.length, 1);
  assert.equal(asked[0]?.size, '1024x1536');
  assert.equal(asked[0]?.useAttachedImages, true);
  assert.deepEqual(landed, ['img1']);
  assert.equal(reply.images.length, 1);
  // Two rounds' text, separated by exactly one blank line, and the live view agrees.
  assert.equal(
    reply.text,
    'हे चित्र तयार करत आहे.\n\nदृश्य ३ साठी चित्र वर दाखवले आहे.',
  );
  assert.equal(live, reply.text);

  assert.equal(requests.length, 2);
  const second = requests[1] as Record<string, unknown>;
  // The second round continues the first and answers its call.
  assert.match(String(second.previous_response_id), /^resp_/);
  const outputs = second.input as readonly {
    type: string;
    call_id: string;
    output: string;
  }[];
  assert.equal(outputs[0]?.type, 'function_call_output');
  assert.equal(outputs[0]?.call_id, 'call_a');
  assert.equal(JSON.parse(outputs[0]?.output ?? '{}').status, 'generated');
  // The first request continued nothing (no chain was given): the whole transcript went.
  assert.equal((requests[0]?.input as unknown[]).length, conversation.length);
});

test('the last round forbids tools, so a turn never ends on an unanswered call', async () => {
  const call = (id: string) => ({
    callId: id,
    args: {
      prompt: 'x',
      label: '',
      orientation: 'landscape',
      use_attached_images: false,
    },
  });
  script = [
    { calls: [call('c1')] },
    { calls: [call('c2')] },
    { deltas: ['पूर्ण.'] },
  ];
  const reply = await runStoryboardTurn({
    turns: conversation,
    onDelta: () => undefined,
    generateImage: async (request) => ({
      id: `i${Math.random()}`,
      url: 'https://cdn.test/i.png',
      label: request.label,
      prompt: request.prompt,
    }),
  });
  assert.equal(requests.length, 3);
  assert.equal(requests[0]?.tool_choice, 'auto');
  assert.equal(requests[1]?.tool_choice, 'auto');
  assert.equal(requests[2]?.tool_choice, 'none');
  assert.equal(reply.images.length, 2);
  assert.equal(reply.text, 'पूर्ण.');
});

test('pictures over the limit are declined, and a failed render is reported, not fatal', async () => {
  const call = (id: string) => ({
    callId: id,
    args: {
      prompt: `frame ${id}`,
      label: id,
      orientation: 'landscape',
      use_attached_images: false,
    },
  });
  script = [
    {
      calls: [call('1'), call('2'), call('3'), call('4'), call('5'), call('6')],
    },
    { deltas: ['चार चित्रे तयार झाली.'] },
  ];
  let attempts = 0;
  const reply = await runStoryboardTurn({
    turns: conversation,
    onDelta: () => undefined,
    generateImage: async (request) => {
      attempts += 1;
      if (request.label === '2') throw new Error('render failed');
      return {
        id: request.label,
        url: 'https://cdn.test/i.png',
        label: request.label,
        prompt: request.prompt,
      };
    },
  });
  // '2' fails and does not count; 1,3,4,5 fill the limit; 6 is declined without a render.
  assert.equal(attempts, 5);
  assert.deepEqual(
    reply.images.map((image) => image.id),
    ['1', '3', '4', '5'],
  );
  const outputs = (requests[1]?.input as readonly { output: string }[]).map(
    (item) => JSON.parse(item.output).status,
  );
  assert.deepEqual(outputs, [
    'generated',
    'failed',
    'generated',
    'generated',
    'generated',
    'not_generated',
  ]);
});

test('an expired chain is rebuilt once from the stored conversation', async () => {
  script = [
    {
      fail: {
        status: 400,
        body: JSON.stringify({
          error: {
            message: "Previous response with id 'resp_gone' not found.",
          },
        }),
      },
    },
    { deltas: ['पुन्हा उत्तर.'] },
  ];
  const reply = await runStoryboardTurn({
    turns: conversation,
    previousResponseId: 'resp_gone',
    onDelta: () => undefined,
    generateImage: async () => {
      throw new Error('unused');
    },
  });
  assert.equal(reply.text, 'पुन्हा उत्तर.');
  assert.equal(requests.length, 2);
  assert.equal(requests[0]?.previous_response_id, 'resp_gone');
  assert.equal('previous_response_id' in (requests[1] ?? {}), false);
  assert.equal((requests[1]?.input as unknown[]).length, conversation.length);
});

test('a turn must end with the officer’s message', async () => {
  await assert.rejects(
    runStoryboardTurn({
      turns: [{ role: 'assistant', content: 'x' }],
      onDelta: () => undefined,
      generateImage: async () => {
        throw new Error('unused');
      },
    }),
  );
});
