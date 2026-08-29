// One model call that carries both a prompt and the officer's actual source files.
//
// Every other text call in this repo goes through `chatComplete` (Chat Completions, text
// only), because every other call is handed text somebody already extracted. The new /dlo
// lane has no such text: the PDF, the photograph and the DOCX go to the model as they are.
// That needs the Responses API, which is the only transport that takes an `input_file`, so
// this module is the seam — the one place that turns the repo's ordinary `ChatMessage[]`
// prompt into a Responses request with files attached.
//
// It is DELIBERATELY NOT built on `chat/misc-chat.ts`, which also speaks Responses. That
// module is a conversation transport with its own streaming, storage and continuation
// concerns; coupling article generation to it would make every change there a change to the
// article. The overlap is three fields' worth, not a shared concern — the same judgement
// `openai-doc.ts` records for declaring its own copy of these types.
//
// The prompt is unchanged by the presence of files. `buildArticleMessagesForReferenceMode`
// produces exactly the system and user messages the text lane uses, and the files are
// appended to the user turn as extra parts. So the specification, the officer's request, the
// designations and the style rules are all byte-identical to what the old lane sent — only
// the SOURCE INFORMATION arrives as documents instead of as OCR'd text.

import { pathToFileURL } from 'node:url';

import { recordChatUsage, type ChatUsage } from '../cost/cost-meter.js';
import { openAiFetch } from '../http/openai-request.js';
import type { ChatMessage } from './openai-chat.js';
import type { SourceFileRef } from '../intake/openai-source-files.js';

const RESPONSES_URL = 'https://api.openai.com/v1/responses';

function requireApiKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY is not set.');
  return key;
}

type InputPart =
  | Readonly<{ type: 'input_text'; text: string }>
  | Readonly<{ type: 'input_file'; file_id: string }>
  | Readonly<{
      type: 'input_image';
      file_id: string;
      detail: 'auto' | 'low' | 'high';
    }>;

type InputMessage = Readonly<{
  role: 'user' | 'assistant';
  content: readonly InputPart[];
}>;

// Responses reports `input_tokens`/`output_tokens` where Chat Completions reported
// `prompt_tokens`/`completion_tokens`. The cost meter speaks the latter, so the mapping
// happens here — the same translation `openai-doc.ts` and `misc-chat.ts` each make.
type ResponsesUsage = Readonly<{
  input_tokens?: number;
  output_tokens?: number;
  input_tokens_details?: Readonly<{ cached_tokens?: number }>;
}>;

type ResponsesBody = Readonly<{
  model?: string;
  status?: string;
  output?: readonly Readonly<{
    content?: readonly Readonly<{
      type?: string;
      text?: string;
      refusal?: string;
    }>[];
  }>[];
  error?: Readonly<{ message?: string }> | null;
  incomplete_details?: Readonly<{ reason?: string }> | null;
  usage?: ResponsesUsage;
}>;

function recordUsage(body: ResponsesBody, fallbackModel: string): void {
  const usage = body.usage;
  const cached = usage?.input_tokens_details?.cached_tokens;
  const mapped: ChatUsage | undefined = usage
    ? {
        ...(usage.input_tokens !== undefined
          ? { prompt_tokens: usage.input_tokens }
          : {}),
        ...(usage.output_tokens !== undefined
          ? { completion_tokens: usage.output_tokens }
          : {}),
        ...(cached !== undefined
          ? { prompt_tokens_details: { cached_tokens: cached } }
          : {}),
      }
    : undefined;
  recordChatUsage(body.model ?? fallbackModel, mapped);
}

function textFrom(body: ResponsesBody): string {
  return (body.output ?? [])
    .flatMap((item) => item.content ?? [])
    .map((part) =>
      part.type === 'output_text'
        ? (part.text ?? '')
        : part.type === 'refusal'
          ? (part.refusal ?? '')
          : '',
    )
    .join('');
}

/**
 * The files, as the parts a Responses user turn carries.
 *
 * Each is preceded by a short line naming the officer's own file name. Without it the model
 * receives several unlabelled documents and cannot say which one a fact came from — which
 * matters here, because the officer reviews the article against the files they attached.
 *
 * A photograph becomes `input_image`, not `input_file`: the Files API accepts both, but only
 * the image part gives the model the picture as an image. `detail: 'auto'` matches /chat.
 */
function filePartsFor(files: readonly SourceFileRef[]): InputPart[] {
  return files.flatMap((file): InputPart[] => [
    { type: 'input_text', text: `=== स्रोत: ${file.name} ===` },
    file.kind === 'image'
      ? { type: 'input_image', file_id: file.fileId, detail: 'auto' }
      : { type: 'input_file', file_id: file.fileId },
  ]);
}

/**
 * Builds the Responses request from an ordinary prompt plus the attached sources.
 *
 * Exported for the no-network harness: the shape of this body is the one thing about this
 * module that cannot be checked by reading it, and it is what a provider change breaks.
 */
export function buildSourcesRequest(options: {
  messages: readonly ChatMessage[];
  files: readonly SourceFileRef[];
  model: string;
  maxOutputTokens: number;
  reasoningEffort: 'none' | 'low' | 'medium' | 'high';
}): Record<string, unknown> {
  // The system message becomes `instructions`, which is where Responses puts it. Several
  // system messages are joined rather than dropped — the prompt builders emit one today, and
  // silently losing a second one would be a specification quietly going missing.
  const instructions = options.messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content)
    .join('\n\n');

  const turns = options.messages.filter((message) => message.role !== 'system');
  const input: InputMessage[] = turns.map((message) => ({
    role: message.role === 'assistant' ? 'assistant' : 'user',
    content: [{ type: 'input_text', text: message.content }],
  }));

  // The files ride on the LAST user turn, immediately after the prompt that describes what to
  // do with them. Where there is no user turn at all (a prompt that is entirely system), they
  // become one — a request with files and no input would be rejected.
  const fileParts = filePartsFor(options.files);
  if (fileParts.length > 0) {
    const lastUser = [...input].reverse().find((turn) => turn.role === 'user');
    if (lastUser) {
      const index = input.indexOf(lastUser);
      input[index] = {
        role: 'user',
        content: [...lastUser.content, ...fileParts],
      };
    } else {
      input.push({ role: 'user', content: fileParts });
    }
  }

  return {
    model: options.model,
    ...(instructions ? { instructions } : {}),
    input,
    // Nothing here is a conversation, so there is nothing to continue from and no reason to
    // leave the request on OpenAI's side. `openai-doc.ts` stores nothing for the same reason.
    store: false,
    max_output_tokens: options.maxOutputTokens,
    reasoning: { effort: options.reasoningEffort },
  };
}

/**
 * Runs one prompt against the attached source files and returns the model's text.
 *
 * Throws rather than returning a fragment when the response did not reach `completed`: an
 * article assembled from a truncated answer is the one failure an officer cannot see, since
 * it reads as a short article rather than as an error.
 */
export async function respondWithSources(options: {
  label: string;
  messages: readonly ChatMessage[];
  files: readonly SourceFileRef[];
  model: string;
  maxOutputTokens: number;
  reasoningEffort?: 'none' | 'low' | 'medium' | 'high';
  timeoutMs?: number;
}): Promise<string> {
  const body = buildSourcesRequest({
    messages: options.messages,
    files: options.files,
    model: options.model,
    maxOutputTokens: options.maxOutputTokens,
    reasoningEffort: options.reasoningEffort ?? 'medium',
  });

  const response = await openAiFetch(RESPONSES_URL, {
    label: options.label,
    apiKey: requireApiKey(),
    // The article lane, serialized with every other pipeline call: this IS the pipeline's
    // model call, not document-reading traffic queued alongside it.
    body,
    ...(options.timeoutMs !== undefined
      ? { timeoutMs: options.timeoutMs }
      : {}),
  });

  const result = (await response.json()) as ResponsesBody;
  recordUsage(result, options.model);

  const text = textFrom(result).trim();
  if (result.status !== 'completed') {
    throw new Error(
      `OpenAI ${options.label} did not complete (${result.status ?? 'unknown status'}): ` +
        (result.error?.message ??
          result.incomplete_details?.reason ??
          'no reason reported') +
        // A `max_output_tokens` exhaustion is the likely cause and is fixable from the outside,
        // so name the knob rather than leave the reader to find it.
        '. If this is a token limit, raise ARTICLE_BODY_MAX_TOKENS.',
    );
  }
  if (text === '') {
    throw new Error(`OpenAI ${options.label} returned no content.`);
  }
  return text;
}

// --- CLI harness -----------------------------------------------------------
//   tsx src/generation/responses-with-sources.ts
// Pure request assembly — no model call, no spend. The body's SHAPE is the one thing about
// this module that cannot be checked by reading it, and it is what a provider change breaks.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const failures: string[] = [];
  const check = (ok: boolean, label: string) => {
    if (!ok) failures.push(label);
  };

  const messages: ChatMessage[] = [
    { role: 'system', content: 'SPEC' },
    { role: 'user', content: 'INPUTS' },
  ];
  const files: SourceFileRef[] = [
    { fileId: 'file-a', kind: 'document', name: 'gr.pdf' },
    { fileId: 'file-b', kind: 'image', name: 'photo.jpg' },
  ];
  const body = buildSourcesRequest({
    messages,
    files,
    model: 'm',
    maxOutputTokens: 100,
    reasoningEffort: 'medium',
  });

  // The system message must become `instructions`, never an input turn: a `system` role in
  // Responses input is not the same thing and would be silently down-weighted.
  check(
    body.instructions === 'SPEC',
    'system message did not become instructions',
  );
  const input = body.input as InputMessage[];
  check(input.length === 1, `expected one user turn, got ${input.length}`);
  check(input[0]?.role === 'user', 'turn is not a user turn');
  const parts = input[0]?.content ?? [];
  check(parts[0]?.type === 'input_text', 'prompt text is not first');
  check(
    (parts[0] as { text?: string })?.text === 'INPUTS',
    'prompt text was altered',
  );
  // A document is input_file and a photograph input_image — the Files API accepts both ids,
  // but only the image part hands the model a picture.
  check(
    parts.some((p) => p.type === 'input_file' && p.file_id === 'file-a'),
    'the document did not travel as input_file',
  );
  check(
    parts.some((p) => p.type === 'input_image' && p.file_id === 'file-b'),
    'the photograph did not travel as input_image',
  );
  // Each file is labelled with the officer's own name, so the model can say which document a
  // fact came from.
  check(
    parts.some((p) => p.type === 'input_text' && p.text.includes('gr.pdf')),
    'the document was not labelled with its file name',
  );
  check(
    body.store === false,
    'store must be false — this is not a conversation',
  );

  // No files ⇒ the request must be byte-identical to a plain text call, so the two lanes
  // cannot diverge for a run that happens to attach nothing.
  const bare = buildSourcesRequest({
    messages,
    files: [],
    model: 'm',
    maxOutputTokens: 100,
    reasoningEffort: 'medium',
  });
  const bareParts = (bare.input as InputMessage[])[0]?.content ?? [];
  check(bareParts.length === 1, 'a file-less request grew extra parts');

  // A prompt that is entirely system must still produce a turn: a request with files and no
  // input is rejected.
  const systemOnly = buildSourcesRequest({
    messages: [{ role: 'system', content: 'SPEC' }],
    files,
    model: 'm',
    maxOutputTokens: 100,
    reasoningEffort: 'low',
  });
  check(
    (systemOnly.input as InputMessage[]).length === 1,
    'a system-only prompt with files produced no input turn',
  );

  if (failures.length > 0) {
    console.error(`\n${failures.length} FAILURE(S):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exitCode = 1;
  } else {
    console.log('All responses-with-sources assertions passed.');
  }
}
