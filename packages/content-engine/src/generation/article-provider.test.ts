import assert from 'node:assert/strict';
import { test } from 'node:test';
import { writeArticleDraft } from './article-provider.js';
import { QwenChatError } from '../chat/qwen-errors.js';
import { buildQwenRequestBody } from '../chat/qwen-chat.js';

const messages = [
  {
    role: 'system' as const,
    content: 'Write a Marathi article using only source facts.',
  },
  {
    role: 'user' as const,
    content:
      'SOURCE INFORMATION\nमहाराष्ट्र शासनाची बैठक.\nMAHASAMVAD STYLE REFERENCES\nसंदर्भ लेख.',
  },
];

async function withPod(
  measured: unknown,
  run: (
    requests: { url: string; body: Record<string, unknown> }[],
  ) => Promise<void>,
  finishReason = 'stop',
) {
  const savedEnv = { ...process.env };
  const savedFetch = globalThis.fetch;
  const requests: { url: string; body: Record<string, unknown> }[] = [];
  process.env.ARTICLE_PROVIDER = 'qwen';
  process.env.QWEN_BASE_URL = 'https://pod.example/proxy/v1/';
  process.env.QWEN_MODEL = 'Qwen/Test';
  process.env.QWEN_API_KEY = 'test-only';
  // The article generator supplies its own answer allowance.
  process.env.QWEN_MAX_OUTPUT_TOKENS = '1024';
  delete process.env.QWEN_ARTICLE_TIMEOUT_MS;
  delete process.env.QWEN_TIMEOUT_MS;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    requests.push({ url, body });
    assert.equal(
      new Headers(init?.headers).get('authorization'),
      'Bearer test-only',
    );
    if (url.endsWith('/tokenize')) return Response.json(measured);
    assert.equal(url, 'https://pod.example/proxy/v1/chat/completions');
    if (finishReason === 'request-timeout') {
      throw new DOMException(
        'The operation was aborted due to timeout',
        'TimeoutError',
      );
    }
    const event = (data: unknown) => `data: ${JSON.stringify(data)}\n\n`;
    if (finishReason === 'timeout') {
      let sent = false;
      return new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            if (!sent) {
              sent = true;
              controller.enqueue(
                new TextEncoder().encode(
                  event({
                    choices: [
                      { delta: { content: '<think>विचार</think>अपूर्ण लेख' } },
                    ],
                  }),
                ),
              );
            } else {
              controller.error(
                new DOMException(
                  'The operation was aborted due to timeout',
                  'TimeoutError',
                ),
              );
            }
          },
        }),
      );
    }
    return new Response(
      event({
        choices: [{ delta: { content: '<think>विचार</think>लेख तयार आहे.' } }],
      }) +
        (finishReason === 'eof'
          ? ''
          : event({ choices: [{ delta: {}, finish_reason: finishReason }] })) +
        'data: [DONE]\n\n',
    );
  };
  try {
    await run(requests);
  } finally {
    globalThis.fetch = savedFetch;
    for (const name of [
      'ARTICLE_PROVIDER',
      'QWEN_BASE_URL',
      'QWEN_MODEL',
      'QWEN_API_KEY',
      'QWEN_MAX_OUTPUT_TOKENS',
      'QWEN_ARTICLE_TIMEOUT_MS',
      'QWEN_TIMEOUT_MS',
    ]) {
      if (savedEnv[name] === undefined) delete process.env[name];
      else process.env[name] = savedEnv[name];
    }
  }
}

for (const inputTokens of [8193, 12000, 2000]) {
  test(`Qwen article fits measured ${inputTokens}-token prompt in 32768-token pod`, async () => {
    await withPod(
      { count: inputTokens, max_model_len: 32768 },
      async (requests) => {
        const deltas: string[] = [];
        const article = await writeArticleDraft(messages, {
          maxTokens: 8192,
          reasoningEffort: 'low',
          onDelta: (chunk) => deltas.push(chunk),
        });
        assert.equal(article, 'लेख तयार आहे.');
        assert.equal(deltas.join(''), article);
        assert.equal(requests.length, 2);
        assert.equal(requests[0]?.url, 'https://pod.example/proxy/tokenize');
        assert.deepEqual(requests[0]?.body.messages, messages);
        assert.deepEqual(requests[1]?.body.messages, messages);
        assert.equal(requests[0]?.body.add_generation_prompt, true);
        assert.equal(requests[0]?.body.add_special_tokens, false);
        assert.equal(requests[1]?.body.model, requests[0]?.body.model);
        assert.equal(requests[1]?.body.max_tokens, 8192);
        assert.deepEqual(requests[1]?.body.chat_template_kwargs, {
          enable_thinking: false,
        });
        assert.deepEqual(
          requests[0]?.body.chat_template_kwargs,
          requests[1]?.body.chat_template_kwargs,
        );
      },
    );
  });
}

test('disabling article thinking leaves chat requests unchanged', async () => {
  await withPod({ count: 2000, max_model_len: 32768 }, async () => {
    const body = buildQwenRequestBody([{ role: 'user', content: 'नमस्कार' }]);
    assert.equal(body.chat_template_kwargs, undefined);
    assert.equal(body.max_tokens, 1024 + 16384);
  });
});

test('plain article text reaches the officer before the model finishes', async () => {
  await withPod({ count: 2000, max_model_len: 32768 }, async () => {
    const stub = globalThis.fetch;
    const encoder = new TextEncoder();
    let output: ReadableStreamDefaultController<Uint8Array> | undefined;
    globalThis.fetch = async (input, init) => {
      if (String(input).endsWith('/tokenize')) return stub(input, init);
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            output = controller;
            controller.enqueue(
              encoder.encode(
                'data: ' +
                  JSON.stringify({
                    choices: [{ delta: { content: 'लेख सुरू झाला.' } }],
                  }) +
                  '\n\n',
              ),
            );
          },
        }),
      );
    };
    let received: () => void = () => {};
    const firstDelta = new Promise<void>((resolve) => {
      received = resolve;
    });
    const chunks: string[] = [];
    const pending = writeArticleDraft(messages, {
      maxTokens: 8192,
      reasoningEffort: 'low',
      onDelta: (chunk) => {
        chunks.push(chunk);
        received();
      },
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        firstDelta,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error('Article text was buffered until EOF')),
            1000,
          );
        }),
      ]);
      assert.equal(chunks.join(''), 'लेख सुरू झाला.');
    } finally {
      clearTimeout(timer);
      output?.enqueue(
        encoder.encode(
          'data: ' +
            JSON.stringify({
              choices: [{ delta: {}, finish_reason: 'stop' }],
            }) +
            '\n\ndata: [DONE]\n\n',
        ),
      );
      output?.close();
      assert.equal(await pending, 'लेख सुरू झाला.');
    }
  });
});

test('Qwen article refuses a source with insufficient answer room before generation', async () => {
  await withPod({ count: 25000, max_model_len: 32768 }, async (requests) => {
    await assert.rejects(
      writeArticleDraft(messages, { maxTokens: 8192, reasoningEffort: 'low' }),
      (error: unknown) =>
        error instanceof QwenChatError && error.kind === 'contextOverflow',
    );
    assert.equal(requests.length, 1);
  });
});

test('article transport uses its own longer deadline and honors its override', async (t) => {
  const deadlines: number[] = [];
  t.mock.method(AbortSignal, 'timeout', (ms: number) => {
    deadlines.push(ms);
    return new AbortController().signal;
  });
  for (const [configured, expected] of [
    [undefined, 1_800_000],
    ['1200000', 1_200_000],
    ['invalid', 1_800_000],
  ] as const) {
    await withPod({ count: 2000, max_model_len: 32768 }, async () => {
      if (configured !== undefined)
        process.env.QWEN_ARTICLE_TIMEOUT_MS = configured;
      // This old chat setting must not cap the article's total generation time.
      process.env.QWEN_TIMEOUT_MS = '5000';
      deadlines.length = 0;
      await writeArticleDraft(messages, {
        maxTokens: 8192,
        reasoningEffort: 'low',
      });
      assert.deepEqual(deadlines, [5000, expected]);
    });
  }
});

test('a mid-stream article timeout is diagnosed with progress and never retried', async () => {
  await withPod(
    { count: 2000, max_model_len: 32768 },
    async (requests) => {
      const deltas: string[] = [];
      await assert.rejects(
        writeArticleDraft(messages, {
          maxTokens: 8192,
          reasoningEffort: 'low',
          onDelta: (chunk) => deltas.push(chunk),
        }),
        (error: unknown) => {
          assert.ok(error instanceof QwenChatError);
          assert.equal(error.kind, 'timeout');
          assert.match(error.message, /failed during stream/);
          assert.match(error.message, /articleTimeoutMs=1800000/);
          assert.match(error.message, /contentChars=[1-9]/);
          assert.doesNotMatch(error.userMessage, /बंद आहे/);
          return true;
        },
      );
      assert.ok(deltas.join('').includes('अपूर्ण लेख'));
      assert.equal(requests.length, 2);
    },
    'timeout',
  );
});

test('a stream that closes without finishing cannot pass as a completed article', async () => {
  await withPod(
    { count: 2000, max_model_len: 32768 },
    async (requests) => {
      await assert.rejects(
        writeArticleDraft(messages, {
          maxTokens: 8192,
          reasoningEffort: 'low',
        }),
        /ended without a finish reason/,
      );
      assert.equal(requests.length, 2);
    },
    'eof',
  );
});

test('a timeout before response headers does not resubmit the article', async () => {
  await withPod(
    { count: 2000, max_model_len: 32768 },
    async (requests) => {
      await assert.rejects(
        writeArticleDraft(messages, {
          maxTokens: 8192,
          reasoningEffort: 'low',
        }),
        (error: unknown) =>
          error instanceof QwenChatError &&
          error.kind === 'timeout' &&
          error.message.includes('failed during request'),
      );
      assert.equal(requests.length, 2);
    },
    'request-timeout',
  );
});

test('Qwen article never accepts a partial answer when its output budget is exhausted', async () => {
  await withPod(
    { count: 12000, max_model_len: 32768 },
    async (requests) => {
      await assert.rejects(
        writeArticleDraft(messages, {
          maxTokens: 8192,
          reasoningEffort: 'low',
        }),
        (error: unknown) =>
          error instanceof QwenChatError &&
          error.message.includes('finish_reason: length'),
      );
      // No automatic regeneration after answer tokens have already been emitted.
      assert.equal(requests.length, 2);
    },
    'length',
  );
});

test('Qwen article rejects missing or invalid token measurements before generation', async () => {
  for (const measured of [
    null,
    {},
    { count: -1, max_model_len: 32768 },
    { count: 100, max_model_len: 0 },
    { count: '100', max_model_len: 32768 },
    { count: 1.5, max_model_len: 32768 },
  ]) {
    await withPod(measured, async (requests) => {
      await assert.rejects(
        writeArticleDraft(messages, {
          maxTokens: 8192,
          reasoningEffort: 'low',
        }),
        /invalid token counts/,
      );
      assert.equal(requests.length, 1);
    });
  }
});
