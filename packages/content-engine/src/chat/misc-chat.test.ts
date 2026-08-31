import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MISC_CHAT_MODEL,
  MISC_CHAT_SYSTEM_INSTRUCTION,
  buildOpenAiResponseInput,
  fileSearchTools,
  readResponseStream,
  searchableDocumentsLine,
  textFromOpenAiResponse,
  type MiscChatTurn,
} from './misc-chat.js';
import { MISC_CHAT_PDF_MAX_BYTES } from './file-search.js';

test('chat defaults to the top OpenAI text tier and a broad honest assistant prompt', () => {
  // /chat has no deterministic post-filter behind it, so the single call is the product.
  assert.equal(MISC_CHAT_MODEL, 'gpt-5.6-sol');
  // File Search's own per-file ceiling, not ours. It replaced the Responses file-input path
  // precisely because that path's 50 MB was the binding limit on what an officer could ask
  // about, so a silent regression here would take the whole feature back with it.
  assert.equal(MISC_CHAT_PDF_MAX_BYTES, 512 * 1024 * 1024);
  assert.match(
    MISC_CHAT_SYSTEM_INSTRUCTION,
    /general-purpose AI chat assistant/,
  );
  assert.match(MISC_CHAT_SYSTEM_INSTRUCTION, /Match the language/);
  assert.match(MISC_CHAT_SYSTEM_INSTRUCTION, /Do not claim/);
  assert.match(MISC_CHAT_SYSTEM_INSTRUCTION, /never invent facts/);
  assert.doesNotMatch(MISC_CHAT_SYSTEM_INSTRUCTION, /Act as.*Gemini/i);
  // The model is no longer handed the document itself, so it has to be told the tool exists
  // and that the attachment is behind it. Without this it answers "I cannot see an
  // attachment" about a PDF sitting in its own index.
  assert.match(MISC_CHAT_SYSTEM_INSTRUCTION, /file_search/);
  assert.match(MISC_CHAT_SYSTEM_INSTRUCTION, /not shown to you in full/);
});

test('a document reaches the model as a searchable NAME, never as file input', () => {
  const withDocuments: MiscChatTurn = {
    role: 'user',
    content: 'Compare these.',
    attachments: [
      { kind: 'document', name: 'gr.pdf', documentFileId: 'file-gr' },
      { kind: 'document', name: 'budget.pdf', documentFileId: 'file-budget' },
      // Indexing has not finished for this one, so it must not be named: the model would
      // search for it, find nothing, and report the document as empty.
      { kind: 'document', name: 'pending.pdf' },
    ],
  };
  assert.equal(
    searchableDocumentsLine(withDocuments),
    'Attached documents, searchable with the file_search tool: gr.pdf, budget.pdf',
  );
  assert.equal(
    searchableDocumentsLine({ role: 'user', content: 'Hello.' }),
    null,
  );

  const input = buildOpenAiResponseInput([withDocuments], false);
  const parts = input[0]?.content;
  assert.ok(Array.isArray(parts));
  // The regression that matters: a document must never come back as an `input_file` part,
  // which is what capped this surface at 50 MB.
  assert.equal(
    parts.some((part) => part.type === 'input_file'),
    false,
  );
  assert.deepEqual(parts, [
    { type: 'input_text', text: 'Compare these.' },
    {
      type: 'input_text',
      text: 'Attached documents, searchable with the file_search tool: gr.pdf, budget.pdf',
    },
  ]);
});

test('the file_search tool is offered only when the thread has a store', () => {
  assert.deepEqual(fileSearchTools(undefined), []);
  const tools = fileSearchTools('vs_123');
  assert.equal(tools.length, 1);
  assert.equal(tools[0]?.type, 'file_search');
  // ONE id. The field is an array and the API accepts several, but only the first is
  // searched, so a second store here would silently hide a chat's other documents.
  assert.deepEqual(tools[0]?.vector_store_ids, ['vs_123']);
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

test('stateless recovery replays roles, extracted text, searchable PDFs and images', () => {
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
        type: 'input_text',
        text: 'Attached documents, searchable with the file_search tool: report.pdf',
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
