// Offline check of /chat's provider routing: what GET /chat/providers reports, the guard
// that keeps an attachment away from a model that cannot read it, and — the load-bearing
// one — that a Qwen turn never runs prepareThreadDocuments.
//
// No pod, no OpenAI and no database. The stub client below THROWS on any read of chat_files,
// which is what turns "the vector store was never built" into an assertion rather than a
// hope: the OpenAI control at the end drives the same history and does hit it.
//
// Run from apps/api:  npx tsx --env-file=../../.env src/routes/chat.check.ts
// (the env file is only for the storage variables registerChatRoutes reads at registration.)
import Fastify from 'fastify';
import { registerChatRoutes } from './chat.js';

let failed = 0;
function check(name: string, ok: boolean, detail?: unknown): void {
  if (ok) console.log('  ok   ' + name);
  else {
    failed += 1;
    console.log('  FAIL ' + name, detail === undefined ? '' : detail);
  }
}

const FILES_READ = 'STUB_CHAT_FILES_READ';
// documentId is schema-validated as a UUID, so a placeholder would be rejected before the
// guard under test is ever reached.
const PDF_ID = '11111111-1111-4111-8111-111111111111';

type Row = Record<string, unknown>;
const threads: Row[] = [
  {
    id: 't1',
    title: 'x',
    message_count: 2,
    last_message_at: null,
    // Pre-set so ensureThreadVectorStore returns without a network call; the files table
    // below is then what marks prepareThreadDocuments having run.
    vector_store_id: 'vs_stub',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
];
let messages: Row[] = [];
function seedHistory(): void {
  messages = [
    {
      id: 'm1',
      thread_id: 't1',
      role: 'user',
      content: 'earlier question',
      attachments: [{ kind: 'document', name: 'gr.pdf', documentId: 'f1' }],
      model: null,
      openai_response_id: null,
      cost_usd: null,
      error: null,
      created_at: '2026-01-01T00:00:00Z',
    },
    {
      id: 'm2',
      thread_id: 't1',
      role: 'assistant',
      content: 'earlier answer',
      attachments: [],
      model: 'gpt-5.6-terra',
      openai_response_id: 'resp_old',
      cost_usd: null,
      error: null,
      created_at: '2026-01-01T00:00:01Z',
    },
  ];
}

let inserted: Row[] = [];

function builder(table: string): unknown {
  const state: { op: string; payload?: Row } = { op: 'select' };
  const result = (): { data: unknown; error: null } => {
    if (table === 'chat_files') throw new Error(FILES_READ);
    if (table === 'chat_threads') {
      return { data: state.op === 'select' ? threads[0] : null, error: null };
    }
    if (table === 'chat_messages') {
      if (state.op === 'insert') {
        const row = {
          id: `new-${inserted.length + 1}`,
          thread_id: 't1',
          role: 'user',
          content: '',
          attachments: [],
          model: null,
          openai_response_id: null,
          cost_usd: null,
          error: null,
          created_at: '2026-01-01T00:00:02Z',
          ...(state.payload ?? {}),
        };
        inserted.push(row);
        messages.push(row);
        return { data: row, error: null };
      }
      return { data: messages, error: null };
    }
    return { data: null, error: null };
  };
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'order', 'update', 'limit']) {
    chain[m] = () => chain;
  }
  chain.insert = (payload: Row) => {
    state.op = 'insert';
    state.payload = payload;
    return chain;
  };
  chain.range = () => Promise.resolve(result());
  chain.maybeSingle = () => Promise.resolve(result());
  chain.single = () => Promise.resolve(result());
  chain.then = (
    resolve: (v: unknown) => unknown,
    reject?: (e: unknown) => unknown,
  ) => {
    try {
      return Promise.resolve(result()).then(resolve, reject);
    } catch (e) {
      return Promise.resolve()
        .then(() => {
          throw e;
        })
        .then(resolve, reject);
    }
  };
  return chain;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const client = { from: (table: string) => builder(table) } as any;

const app = Fastify();
registerChatRoutes(app, client);

async function send(body: unknown): Promise<{ status: number; text: string }> {
  const res = await app.inject({
    method: 'POST',
    url: '/chat/threads/t1/messages',
    payload: body as Record<string, unknown>,
  });
  return { status: res.statusCode, text: res.payload };
}

async function providers(): Promise<unknown[]> {
  const res = await app.inject({ method: 'GET', url: '/chat/providers' });
  return JSON.parse(res.payload) as unknown[];
}

function frames(text: string): { type: string; [k: string]: unknown }[] {
  return text
    .split('\n\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => JSON.parse(line.slice(6)) as { type: string });
}

async function main(): Promise<void> {
  delete process.env.QWEN_BASE_URL;

  console.log('GET /chat/providers');
  const unset = (await providers()) as { id: string }[];
  check(
    'qwen absent when QWEN_BASE_URL is unset',
    unset.length === 1 && unset[0]?.id === 'openai',
    unset,
  );
  process.env.QWEN_BASE_URL = 'http://127.0.0.1:9/v1';
  const set = (await providers()) as {
    id: string;
    supportsPdf: boolean;
    supportsImages: boolean;
  }[];
  const qwen = set.find((p) => p.id === 'qwen');
  check('qwen listed once configured', set.length === 2 && !!qwen, set);
  check(
    'qwen reports no pdf and no images',
    qwen?.supportsPdf === false && qwen?.supportsImages === false,
    qwen,
  );

  console.log('\ncapability guard (refused BEFORE the turn is persisted)');
  seedHistory();
  inserted = [];
  const pdfOnQwen = await send({
    content: 'read this',
    provider: 'qwen',
    attachments: [{ kind: 'document', name: 'gr.pdf', documentId: PDF_ID }],
  });
  // A 400 rather than the stub's FILES_READ is also the proof that the refusal costs no
  // database round trip: resolving that documentId would have read chat_files.
  check(
    'a PDF on a Qwen turn is a 400, with no chat_files read',
    pdfOnQwen.status === 400,
    pdfOnQwen,
  );
  check(
    '…in Marathi, naming Qwen',
    /Qwen/.test(pdfOnQwen.text) && /वाचू शकत नाही/.test(pdfOnQwen.text),
    pdfOnQwen.text,
  );
  check('…and nothing was persisted', inserted.length === 0, inserted);

  inserted = [];
  const imageOnQwen = await send({
    content: 'what is this',
    provider: 'qwen',
    attachments: [
      {
        kind: 'image',
        name: 'a.jpg',
        imageUrl: 'https://example.invalid/chat/a.jpg',
      },
    ],
  });
  check(
    'an image on a Qwen turn is a 400',
    imageOnQwen.status === 400,
    imageOnQwen,
  );
  check('…and nothing was persisted', inserted.length === 0, inserted);

  inserted = [];
  const pdfOnOpenAi = await send({
    content: 'read this',
    attachments: [{ kind: 'document', name: 'gr.pdf', documentId: PDF_ID }],
  });
  check(
    'the guard leaves the OpenAI lane alone (reaches the DB, not a 400)',
    pdfOnOpenAi.status !== 400,
    pdfOnOpenAi.status,
  );

  console.log('\nQwen turn with QWEN_BASE_URL unset');
  delete process.env.QWEN_BASE_URL;
  seedHistory();
  inserted = [];
  const notConfigured = await send({ content: 'hello', provider: 'qwen' });
  const evts = frames(notConfigured.text);
  const err = evts.find((e) => e.type === 'error');
  check(
    'the stream opens with a 200',
    notConfigured.status === 200,
    notConfigured.status,
  );
  check('an error frame arrives', !!err, evts);
  check(
    'carrying the typed notConfigured Marathi sentence, not the generic one',
    typeof err?.message === 'string' &&
      /Qwen सेवा अद्याप योग्य प्रकारे सेट केलेली नाही/.test(
        err.message as string,
      ),
    err,
  );
  check(
    'the officer’s turn was still persisted',
    inserted.some((r) => r.role === 'user'),
    inserted,
  );
  const assistant = inserted.find((r) => r.role === 'assistant');
  check(
    'the assistant row carries the English diagnosis',
    typeof assistant?.error === 'string' &&
      /QWEN_BASE_URL/.test(assistant.error as string),
    assistant?.error,
  );
  check(
    'and NO openai_response_id',
    assistant !== undefined &&
      !('openai_response_id' in assistant && assistant.openai_response_id),
    assistant,
  );
  check(
    'prepareThreadDocuments was SKIPPED (the files table was never read)',
    !/STUB_CHAT_FILES_READ/.test(String(assistant?.error ?? '')),
    assistant?.error,
  );

  console.log('\ncontrol: the OpenAI lane DOES prepare documents');
  seedHistory();
  inserted = [];
  const openaiTurn = await send({ content: 'hello' });
  const oaErr = frames(openaiTurn.text).find((e) => e.type === 'error');
  const oaRow = inserted.find((r) => r.role === 'assistant');
  check(
    'the same history makes the OpenAI lane read chat_files',
    /STUB_CHAT_FILES_READ/.test(String(oaRow?.error ?? '')),
    oaRow?.error,
  );
  check(
    'and an untyped failure keeps the generic Marathi fallback',
    oaErr?.message === 'उत्तर तयार करता आले नाही. पुन्हा प्रयत्न करा.',
    oaErr,
  );

  console.log(failed === 0 ? '\nAll checks passed.' : `\n${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
