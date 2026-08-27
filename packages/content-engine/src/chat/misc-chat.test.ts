import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MISC_CHAT_MODEL,
  MISC_CHAT_PDF_MAX_BYTES,
  MISC_CHAT_SYSTEM_INSTRUCTION,
  buildOpenAiResponseInput,
  readResponseStream,
  textFromOpenAiResponse,
  type MiscChatTurn,
} from './misc-chat.js';

test('chat defaults to the top OpenAI text tier and a broad honest assistant prompt', () => {
  // /chat has no deterministic post-filter behind it, so the single call is the product.
  assert.equal(MISC_CHAT_MODEL, 'gpt-5.6-sol');
  assert.equal(MISC_CHAT_PDF_MAX_BYTES, 50 * 1024 * 1024);
  assert.match(
    MISC_CHAT_SYSTEM_INSTRUCTION,
    /general-purpose AI chat assistant/,
  );
  assert.match(MISC_CHAT_SYSTEM_INSTRUCTION, /Match the language/);
  assert.match(MISC_CHAT_SYSTEM_INSTRUCTION, /Do not claim/);
  assert.match(MISC_CHAT_SYSTEM_INSTRUCTION, /never invent facts/);
  assert.doesNotMatch(MISC_CHAT_SYSTEM_INSTRUCTION, /Act as.*Gemini/i);
});

const turns: readonly MiscChatTurn[] = [
  {
    role: 'user',
    content: 'Summarise this.',
    attachments: [
      {
        kind: 'document',
        name: 'report.pdf',
        documentFileId: 'file-report',
      },
      {
        kind: 'audio',
        name: 'note.mp3',
        text: 'A short transcript.',
      },
    ],
  },
  { role: 'assistant', content: 'Earlier answer.' },
  {
    role: 'user',
    content: 'What changed?',
    attachments: [
      {
        kind: 'image',
        name: 'chart.png',
        imageUrl: 'https://example.test/chart.png',
      },
    ],
  },
];

test('stateless recovery replays roles, extracted text, native PDFs and images', () => {
  const input = buildOpenAiResponseInput(turns, false);
  assert.equal(input.length, 3);
  assert.deepEqual(input[0], {
    role: 'user',
    content: [
      {
        type: 'input_text',
        text: 'Summarise this.\n\n--- note.mp3 ---\nA short transcript.',
      },
      {
        type: 'input_file',
        file_id: 'file-report',
        detail: 'auto',
      },
    ],
  });
  assert.deepEqual(input[1], {
    role: 'assistant',
    content: 'Earlier answer.',
  });
  assert.deepEqual(input[2], {
    role: 'user',
    content: [
      { type: 'input_text', text: 'What changed?' },
      {
        type: 'input_image',
        image_url: 'https://example.test/chart.png',
        detail: 'auto',
      },
    ],
  });
});

test('stateful continuation sends only the newest user turn', () => {
  const input = buildOpenAiResponseInput(turns, true);
  assert.equal(input.length, 1);
  assert.deepEqual(input[0], {
    role: 'user',
    content: [
      { type: 'input_text', text: 'What changed?' },
      {
        type: 'input_image',
        image_url: 'https://example.test/chart.png',
        detail: 'auto',
      },
    ],
  });
});

test('response text is committed only from final message output', () => {
  assert.equal(
    textFromOpenAiResponse({
      status: 'completed',
      output: [
        { type: 'reasoning' },
        {
          type: 'message',
          content: [
            { type: 'output_text', text: 'Complete answer.' },
            { type: 'annotation' },
          ],
        },
      ],
    }),
    'Complete answer.',
  );
  assert.equal(
    textFromOpenAiResponse({
      status: 'completed',
      output: [
        {
          type: 'message',
          content: [{ type: 'refusal', refusal: 'I cannot help with that.' }],
        },
      ],
    }),
    'I cannot help with that.',
  );
});

// --- streaming ------------------------------------------------------------
//
// The answer must reach the browser a piece at a time. It arrived in one lump for as long as
// this module waited for a completed response before calling onDelta, and nothing on a running
// instance distinguishes "streamed fast" from "delivered whole" reliably enough to catch a
// regression, so it is pinned here.

function sseStream(frames: readonly string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(frame));
      controller.close();
    },
  });
}

function frame(payload: unknown): string {
  return `event: x\ndata: ${JSON.stringify(payload)}\n\n`;
}

test('output_text deltas are forwarded one at a time, in order', async () => {
  const chunks: string[] = [];
  const final = await readResponseStream(
    sseStream([
      frame({ type: 'response.created' }),
      frame({ type: 'response.output_text.delta', delta: 'नम' }),
      frame({ type: 'response.output_text.delta', delta: 'स्कार' }),
      frame({ type: 'response.output_text.delta', delta: '!' }),
      frame({
        type: 'response.completed',
        response: {
          id: 'resp_1',
          status: 'completed',
          model: 'gpt-5.6-sol',
          output: [
            {
              type: 'message',
              content: [{ type: 'output_text', text: 'नमस्कार!' }],
            },
          ],
        },
      }),
    ]),
    (chunk) => chunks.push(chunk),
    () => undefined,
  );
  assert.deepEqual(chunks, ['नम', 'स्कार', '!']);
  assert.equal(final?.id, 'resp_1');
  assert.equal(final?.status, 'completed');
});

test('a frame split across chunk boundaries still parses', async () => {
  const whole = frame({ type: 'response.output_text.delta', delta: 'split' });
  const chunks: string[] = [];
  await readResponseStream(
    sseStream([
      whole.slice(0, 20),
      whole.slice(20),
      frame({
        type: 'response.completed',
        response: { id: 'resp_2', status: 'completed' },
      }),
    ]),
    (chunk) => chunks.push(chunk),
    () => undefined,
  );
  assert.deepEqual(chunks, ['split']);
});

test('a refusal streams like text, and an unparseable frame is skipped', async () => {
  const chunks: string[] = [];
  const final = await readResponseStream(
    sseStream([
      'data: {not json\n\n',
      frame({ type: 'response.refusal.delta', delta: 'I cannot help.' }),
      frame({
        type: 'response.incomplete',
        response: {
          id: 'resp_3',
          status: 'incomplete',
          incomplete_details: { reason: 'max_output_tokens' },
        },
      }),
    ]),
    (chunk) => chunks.push(chunk),
    () => undefined,
  );
  assert.deepEqual(chunks, ['I cannot help.']);
  // Reported, not swallowed: streamMiscChatReply throws on any non-completed status.
  assert.equal(final?.status, 'incomplete');
});

test('an error frame fails the turn rather than settling it', async () => {
  await assert.rejects(
    readResponseStream(
      sseStream([
        frame({ type: 'response.output_text.delta', delta: 'Hello! I am' }),
        frame({ type: 'error', error: { message: 'server overloaded' } }),
      ]),
      () => undefined,
      () => undefined,
    ),
    /server overloaded/,
  );
});

test('a stream that ends without a completed response reports no final', async () => {
  const final = await readResponseStream(
    sseStream([
      frame({ type: 'response.output_text.delta', delta: 'partial' }),
    ]),
    () => undefined,
    () => undefined,
  );
  assert.equal(final, null);
});
