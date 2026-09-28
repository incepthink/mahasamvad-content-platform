// STORYBOARD MODE of /new-video-workflow — a scoped conversational assistant on OpenAI.
//
// The page has two conversation modes (migration 0060). VIDEO mode is the Gemini lane in the
// files beside this one; STORYBOARD mode is this: an ordinary chat, restricted to writing
// scripts, creating and revising storyboards, changing the scenes the officer names,
// answering questions about them, and generating a picture when — and only when — one is
// explicitly asked for.
//
// THREE DECISIONS WORTH KEEPING.
//
// 1. NO STRUCTURED STORYBOARD. The assistant writes Markdown and that Markdown is the whole
//    record (`new_video_turns.model_text`). There are no scene rows, no required fields, and no
//    parser pulling scenes back out of the text: "shorten scene 2" is answered by the next
//    message, exactly as it would be in any chat. The instruction below asks for headings and
//    rules between scenes so a many-scene answer reads well — a presentation rule, never a
//    schema.
//
// 2. IMAGES ARE A FUNCTION TOOL WE RUN, not OpenAI's built-in image tool. The model decides
//    WHEN (only on an explicit ask — its instruction says so) and WHAT (an English frame
//    description); the caller renders it on this repo's own gpt-image path and stores it.
//    That keeps the render on the model, size and quality the rest of the product uses, lets
//    the officer's attached pictures be handed to the edit endpoint as real pixels, and keeps
//    the no-writing rule in CODE (`buildStoryboardImagePrompt`) rather than in a sentence the
//    model may paraphrase away — the NO_TEXT_RULE lesson.
//
// 3. THE CHAIN IS A RESPONSE ID, like /chat's. A follow-up sends only the new message with
//    `previous_response_id`; if OpenAI no longer holds that response, the turn is rebuilt once
//    from our own rows. The final response of a turn never has an unanswered function call
//    (the last round is sent with tool_choice 'none'), because a stored response with a
//    pending call poisons the next turn's continuation.

import { recordChatUsage } from '../cost/cost-meter.js';
import { CHAT_IDENTITY_RULE } from '../chat/chat-identity.js';
import { MISC_CHAT_MODEL } from '../chat/misc-chat.js';
import { openAiFetch } from '../http/openai-request.js';
import { readResponseStream } from '../http/openai-response-stream.js';

const RESPONSES_URL = 'https://api.openai.com/v1/responses';

// /chat's tier by default: this is the same kind of work — one call that IS the answer, with
// no post-filter re-checking it — so it takes the same model unless told otherwise.
export const STORYBOARD_CHAT_MODEL =
  process.env.OPENAI_STORYBOARD_MODEL?.trim() || MISC_CHAT_MODEL;

// Pictures one answer may generate. Mirrors STORYBOARD_MAX_GENERATED_IMAGES in
// @dgipr/schemas; this package does not import schemas, so the number is restated and the
// instruction below quotes it.
export const STORYBOARD_IMAGE_LIMIT = 4;

// Request rounds per turn: the answer, then up to two rounds answering image calls. The LAST
// round is always sent with tool_choice 'none', so a turn cannot end on an unanswered call.
const MAX_ROUNDS = 3;

export const STORYBOARD_SYSTEM_INSTRUCTION = `You are the storyboard assistant inside Mahasamvad's video workspace. Officers of the Directorate General of Information and Public Relations (DGIPR), Government of Maharashtra, use you to plan public-information videos.

WHAT YOU DO — and only this:
- write video scripts (narration / voiceover) from what the officer supplies;
- create storyboards: the video broken into scenes;
- revise a whole storyboard (tone, length, pace, audience, emotion, language);
- change the specific scenes the officer names — shorten, lengthen, rewrite, add a scene after another, split, merge, reorder or remove;
- answer questions about the script, the storyboard, its scenes, shots, pacing and visual treatment;
- generate a picture with the generate_image tool, but ONLY when the officer explicitly asks for an image, picture, frame, visual or illustration. Never generate one on your own initiative, and never as part of an ordinary storyboard answer.

If a request falls outside this (general questions, articles, translation, posters, coding, anything unrelated to a script or storyboard), say briefly and politely that this mode handles only scripts, storyboards, scene revisions and storyboard images, and that a new conversation in the general chat is the place for anything else. Do not carry out the out-of-scope request.

LANGUAGE: reply in the language the officer writes in. Write narration and any on-screen lines in the language the officer asks for, and in their language when they do not say.

FACTS: the officer's messages and attached pictures are the only source of facts. Never invent names, dates, amounts, designations, scheme names, places, statistics or quotations. Where a scene needs a fact that was not supplied, put a clearly marked placeholder such as [तारीख] or [योजनेचे नाव] and say in one line what is missing.

FORMAT: there is no fixed template. Write clear, readable Markdown:
- give every scene its own heading, for example "### दृश्य १ — शेतकऱ्याची सकाळ", with a blank line before and after it, and put a horizontal rule (---) between scenes;
- under a scene, use short labelled lines or bullets for only what is useful to that scene — what is seen, what is heard, an on-screen line, a duration. You do not have to use the same labels every time;
- number scenes consecutively. When scenes are added, removed, split, merged or reordered, renumber them and return the COMPLETE updated storyboard;
- when the officer changes only one or two scenes without changing the numbering, return those scenes in full as they now read, and say in one line what changed;
- keep any opening or closing remark to one or two lines.

REFERENCE PICTURES: pictures attached to a message are context for that message. Use them as the officer says — inspiration for a scene's look, setting, people, framing or style — and say briefly how you used them. Do not claim to see details you cannot see.

GENERATING PICTURES, when explicitly asked:
- call generate_image once per picture asked for, at most ${STORYBOARD_IMAGE_LIMIT} in one answer; if more are asked for, generate the first ${STORYBOARD_IMAGE_LIMIT} and offer to continue;
- write the prompt in English as one concrete frame drawn from the storyboard: setting, people, action, camera angle, light and mood;
- the setting is Maharashtra, India, with Indian people, unless the storyboard says otherwise;
- do not ask for readable text, captions, logos or signboards in the picture;
- choose the orientation that suits the video being planned (landscape unless a vertical reel or a square post is meant);
- set use_attached_images to true only when the officer asks for the picture to be based on the pictures attached to their latest message;
- after the pictures are made, reply in a line or two naming which scene each is for. Never write out a URL; the pictures are shown beside your answer.

${CHAT_IDENTITY_RULE}`;

// ---------------------------------------------------------------------------
// The image tool
// ---------------------------------------------------------------------------

export const STORYBOARD_IMAGE_ORIENTATIONS = [
  'landscape',
  'portrait',
  'square',
] as const;
export type StoryboardImageOrientation =
  (typeof STORYBOARD_IMAGE_ORIENTATIONS)[number];

// gpt-image's three sizes. Landscape is the default for a video storyboard frame.
export function storyboardImageSize(
  orientation: StoryboardImageOrientation,
): string {
  return orientation === 'portrait'
    ? '1024x1536'
    : orientation === 'square'
      ? '1024x1024'
      : '1536x1024';
}

export const STORYBOARD_IMAGE_TOOL = {
  type: 'function',
  name: 'generate_image',
  description:
    'Generate one storyboard picture. Call this ONLY when the officer explicitly asks for an image, picture, frame, visual or illustration.',
  strict: true,
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['prompt', 'label', 'orientation', 'use_attached_images'],
    properties: {
      prompt: {
        type: 'string',
        description:
          'An English description of one frame: setting, people, action, camera angle, light, mood. No text, captions or logos.',
      },
      label: {
        type: 'string',
        description:
          'What the picture is for, short, in the officer\'s language — e.g. "दृश्य ३" or "सुरुवातीचे दृश्य".',
      },
      orientation: {
        type: 'string',
        enum: [...STORYBOARD_IMAGE_ORIENTATIONS],
      },
      use_attached_images: {
        type: 'boolean',
        description:
          'True only when the officer asked for this picture to be based on the pictures attached to their latest message.',
      },
    },
  },
} as const;

// Appended to every prompt the model writes, in code, so it cannot be paraphrased away.
// Phrased POSITIVELY about the objects that would otherwise carry writing: a bare "no text"
// makes an image model paint the sign anyway and fill it with gibberish Devanagari.
export const STORYBOARD_IMAGE_RULES = [
  'Storyboard frame for a Government of Maharashtra public-information video: one clear, well-composed shot.',
  'Unless the description says otherwise, the setting is Maharashtra, India, with Indian people, clothing, streets and interiors.',
  'Keep the picture free of writing: signboards and banners are plain painted panels, papers and forms are blank sheets, screens are switched off, and there are no captions, logos, watermarks or labels anywhere.',
].join(' ');

export function buildStoryboardImagePrompt(description: string): string {
  return `${description.trim()}\n\n${STORYBOARD_IMAGE_RULES}`;
}

export type StoryboardImageRequest = Readonly<{
  prompt: string;
  label: string;
  orientation: StoryboardImageOrientation;
  // gpt-image size string for the orientation, computed here so the caller need not.
  size: string;
  useAttachedImages: boolean;
}>;

export type StoryboardGeneratedImage = Readonly<{
  id: string;
  url: string;
  label: string;
  prompt: string;
}>;

// Parses one call's arguments. Tolerant, because a strict schema is a request, not a promise:
// a missing orientation falls back to landscape and an empty prompt is refused so it is not
// rendered as a random picture.
export function parseImageCallArguments(
  raw: string,
): StoryboardImageRequest | null {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  const prompt = typeof parsed.prompt === 'string' ? parsed.prompt.trim() : '';
  if (prompt === '') return null;
  const orientation = STORYBOARD_IMAGE_ORIENTATIONS.includes(
    parsed.orientation as StoryboardImageOrientation,
  )
    ? (parsed.orientation as StoryboardImageOrientation)
    : 'landscape';
  const label =
    typeof parsed.label === 'string' && parsed.label.trim() !== ''
      ? parsed.label.trim().slice(0, 80)
      : '';
  return {
    prompt,
    label,
    orientation,
    size: storyboardImageSize(orientation),
    useAttachedImages: parsed.use_attached_images === true,
  };
}

// ---------------------------------------------------------------------------
// The conversation, as the model sees it
// ---------------------------------------------------------------------------

export type StoryboardChatTurn = Readonly<{
  role: 'user' | 'assistant';
  content: string;
  // Public URLs of the pictures the officer attached to this message (user turns only).
  imageUrls?: readonly string[];
  // What the assistant generated on this turn (assistant turns only). Only the labels and
  // descriptions travel back into a rebuilt transcript — the model never needs the pixels of
  // its own earlier pictures to answer a follow-up about them.
  generatedImages?: readonly Readonly<{ label: string; prompt: string }>[];
}>;

type InputPart =
  | Readonly<{ type: 'input_text'; text: string }>
  | Readonly<{ type: 'input_image'; image_url: string; detail: 'auto' }>;

type InputMessage = Readonly<{
  role: 'user' | 'assistant';
  content: string | readonly InputPart[];
}>;

type FunctionCallOutput = Readonly<{
  type: 'function_call_output';
  call_id: string;
  output: string;
}>;

type InputItem = InputMessage | FunctionCallOutput;

function assistantText(turn: StoryboardChatTurn): string {
  const images = (turn.generatedImages ?? []).map(
    (image, index) =>
      `[Picture ${index + 1} generated${image.label !== '' ? ` for ${image.label}` : ''}: ${image.prompt}]`,
  );
  const body = [turn.content, ...images]
    .filter((part) => part.trim() !== '')
    .join('\n\n');
  return body === '' ? ' ' : body;
}

// `withImages`: the newest message carries its pictures as real image parts. Earlier messages
// in a rebuilt transcript carry a one-line note instead — the spec is that a picture is
// context for the message it was attached to, and a recovery path that re-sent every picture
// of a long conversation would multiply its cost for a case that is rare by design.
function userInput(
  turn: StoryboardChatTurn,
  withImages: boolean,
): InputMessage {
  const urls = turn.imageUrls ?? [];
  const parts: InputPart[] = [
    {
      type: 'input_text',
      text: turn.content.trim() === '' ? ' ' : turn.content,
    },
  ];
  if (urls.length > 0) {
    parts.push({
      type: 'input_text',
      text: withImages
        ? `The officer attached ${urls.length} reference picture${urls.length === 1 ? '' : 's'} to this message, in this order.`
        : `(The officer attached ${urls.length} reference picture${urls.length === 1 ? '' : 's'} to this message.)`,
    });
  }
  if (withImages) {
    for (const url of urls) {
      parts.push({ type: 'input_image', image_url: url, detail: 'auto' });
    }
  }
  return { role: 'user', content: parts };
}

// Exported for the no-network test. `continuing` = the response chain is intact, so only the
// newest message is sent; otherwise the whole stored conversation is replayed once.
export function buildStoryboardInput(
  turns: readonly StoryboardChatTurn[],
  continuing: boolean,
): readonly InputMessage[] {
  const chosen = continuing ? turns.slice(-1) : turns;
  const last = chosen.length - 1;
  return chosen.map((turn, index) =>
    turn.role === 'assistant'
      ? { role: 'assistant', content: assistantText(turn) }
      : userInput(turn, index === last),
  );
}

// ---------------------------------------------------------------------------
// One request, streamed
// ---------------------------------------------------------------------------

type OutputContent = Readonly<{
  type?: string;
  text?: string;
  refusal?: string;
}>;

type OutputItem = Readonly<{
  type?: string;
  content?: readonly OutputContent[];
  name?: string;
  call_id?: string;
  arguments?: string;
}>;

type ResponseBody = Readonly<{
  id?: string;
  model?: string;
  status?: string;
  output?: readonly OutputItem[];
  error?: Readonly<{ message?: string }> | null;
  incomplete_details?: Readonly<{ reason?: string }> | null;
  usage?: Readonly<{
    input_tokens?: number;
    input_tokens_details?: Readonly<{ cached_tokens?: number }>;
    output_tokens?: number;
  }>;
}>;

function apiKey(): string {
  const value = process.env.OPENAI_API_KEY?.trim();
  if (!value) {
    throw new Error('Missing required environment variable OPENAI_API_KEY.');
  }
  return value;
}

function reasoningEffort(): 'none' | 'low' | 'medium' | 'high' {
  const raw =
    process.env.OPENAI_STORYBOARD_REASONING_EFFORT?.trim().toLowerCase();
  return raw === 'none' || raw === 'medium' || raw === 'high' ? raw : 'low';
}

function timeoutMs(): number {
  const configured = Number(process.env.OPENAI_STORYBOARD_TIMEOUT_MS);
  return Number.isFinite(configured) && configured >= 1_000
    ? configured
    : 300_000;
}

function maxOutputTokens(): number {
  const configured = Number(process.env.OPENAI_STORYBOARD_MAX_OUTPUT_TOKENS);
  return Number.isFinite(configured) && configured >= 1_024
    ? Math.floor(configured)
    : 16_384;
}

// Exported for the no-network test: the tool, the instruction and the chain handle all have to
// be on EVERY request — neither instructions nor tools carry over a previous_response_id.
export function buildStoryboardRequestBody(
  input: readonly InputItem[],
  previousResponseId: string | undefined,
  toolChoice: 'auto' | 'none',
  stream: boolean,
): Record<string, unknown> {
  return {
    model: STORYBOARD_CHAT_MODEL,
    instructions: STORYBOARD_SYSTEM_INSTRUCTION,
    input,
    store: true,
    max_output_tokens: maxOutputTokens(),
    reasoning: { effort: reasoningEffort() },
    tools: [STORYBOARD_IMAGE_TOOL],
    tool_choice: toolChoice,
    parallel_tool_calls: true,
    ...(stream ? { stream: true } : {}),
    ...(previousResponseId ? { previous_response_id: previousResponseId } : {}),
  };
}

function textOf(response: ResponseBody): string {
  return (response.output ?? [])
    .filter((item) => item.type === 'message')
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

export type StoryboardFunctionCall = Readonly<{
  callId: string;
  name: string;
  arguments: string;
}>;

// Exported for the no-network test.
export function functionCallsOf(
  response: Readonly<{ output?: readonly OutputItem[] }>,
): StoryboardFunctionCall[] {
  return (response.output ?? [])
    .filter(
      (item) =>
        item.type === 'function_call' &&
        typeof item.call_id === 'string' &&
        typeof item.name === 'string',
    )
    .map((item) => ({
      callId: item.call_id as string,
      name: item.name as string,
      arguments: item.arguments ?? '{}',
    }));
}

function recordUsage(result: ResponseBody): string {
  const model = result.model ?? STORYBOARD_CHAT_MODEL;
  const cached = result.usage?.input_tokens_details?.cached_tokens;
  recordChatUsage(
    model,
    result.usage
      ? {
          ...(result.usage.input_tokens !== undefined
            ? { prompt_tokens: result.usage.input_tokens }
            : {}),
          ...(result.usage.output_tokens !== undefined
            ? { completion_tokens: result.usage.output_tokens }
            : {}),
          ...(cached !== undefined
            ? { prompt_tokens_details: { cached_tokens: cached } }
            : {}),
        }
      : undefined,
  );
  return model;
}

function request(
  input: readonly InputItem[],
  previousResponseId: string | undefined,
  toolChoice: 'auto' | 'none',
  stream: boolean,
): Promise<Response> {
  return openAiFetch(RESPONSES_URL, {
    label: 'storyboard response',
    apiKey: apiKey(),
    lane: 'chat',
    timeoutMs: timeoutMs(),
    body: buildStoryboardRequestBody(
      input,
      previousResponseId,
      toolChoice,
      stream,
    ),
  });
}

// One round. Streams text through `onDelta`; falls back to a blocking call only when nothing
// has streamed yet (past the first token those tokens are billed and on screen). The
// completed frame is the authority on the text: a dropped delta's tail is emitted before the
// round settles, so what streamed and what is returned are the same string.
async function streamRound(
  input: readonly InputItem[],
  previousResponseId: string | undefined,
  toolChoice: 'auto' | 'none',
  onDelta: (chunk: string) => void,
): Promise<{ result: ResponseBody; text: string }> {
  let streamed = '';
  const onText = (chunk: string) => {
    streamed += chunk;
  };

  let result: ResponseBody;
  try {
    const response = await request(input, previousResponseId, toolChoice, true);
    if (!response.body) throw new Error('response carried no body');
    const final = await readResponseStream<ResponseBody>(
      response.body,
      onDelta,
      onText,
      'storyboard',
    );
    if (final === null) {
      throw new Error('the stream ended before the response completed');
    }
    result = final;
  } catch (error) {
    if (streamed !== '') throw error;
    if (isMissingPreviousResponse(error)) throw error;
    console.warn(
      `[storyboard] stream unavailable (${String(error)}); falling back to a non-streaming call`,
    );
    const response = await request(
      input,
      previousResponseId,
      toolChoice,
      false,
    );
    result = (await response.json()) as ResponseBody;
  }

  if (result.status !== 'completed') {
    throw new Error(
      `OpenAI storyboard response did not complete: ${
        result.error?.message ??
        result.incomplete_details?.reason ??
        result.status ??
        'unknown status'
      }.`,
    );
  }
  if (!result.id) {
    throw new Error('OpenAI completed the storyboard response without an id.');
  }

  const authoritative = textOf(result);
  let text = streamed;
  if (authoritative !== '' && authoritative !== streamed) {
    if (streamed === '' || authoritative.startsWith(streamed)) {
      const tail = authoritative.slice(streamed.length);
      if (tail !== '') onDelta(tail);
      text = authoritative;
    }
  }
  recordUsage(result);
  return { result, text };
}

// A stored response can age out or be deleted; the turn is then rebuilt from our own rows.
export function isMissingPreviousResponse(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    /request failed: (?:400|404)\b/.test(message) &&
    /previous_response_id|response.+(?:not found|does not exist|expired)/i.test(
      message,
    )
  );
}

// ---------------------------------------------------------------------------
// One storyboard turn
// ---------------------------------------------------------------------------

export type StoryboardTurnRequest = Readonly<{
  // The whole stored conversation, oldest first, ending with the officer's new message.
  turns: readonly StoryboardChatTurn[];
  // The chain point: the response id the previous successful turn ended on, if any.
  previousResponseId?: string | undefined;
  // Live text. Receives the answer as it is written, across rounds, including the blank line
  // that separates one round's text from the next.
  onDelta: (chunk: string) => void;
  // Renders and stores one picture. Owned by the caller (the API job), which holds storage.
  // A throw is reported back to the model as a failed call, never as a failed turn.
  generateImage: (
    request: StoryboardImageRequest,
  ) => Promise<StoryboardGeneratedImage>;
  // Called as each picture lands, so it can be shown before the answer finishes.
  onImage?: (image: StoryboardGeneratedImage) => void;
}>;

export type StoryboardTurnReply = Readonly<{
  text: string;
  responseId: string;
  images: readonly StoryboardGeneratedImage[];
}>;

export async function runStoryboardTurn({
  turns,
  previousResponseId,
  onDelta,
  generateImage,
  onImage,
}: StoryboardTurnRequest): Promise<StoryboardTurnReply> {
  if (turns.length === 0 || turns[turns.length - 1]?.role !== 'user') {
    throw new Error('A storyboard turn must end with the officer’s message.');
  }

  let text = '';
  // Separate one round's text from the next, lazily, so a round that writes nothing adds no
  // stray blank lines and the live view and the returned text stay identical.
  let roundStarted = false;
  const emit = (chunk: string) => {
    if (!roundStarted) {
      roundStarted = true;
      if (text.trim() !== '' && !text.endsWith('\n\n')) {
        const gap = text.endsWith('\n') ? '\n' : '\n\n';
        text += gap;
        onDelta(gap);
      }
    }
    text += chunk;
    onDelta(chunk);
  };

  const images: StoryboardGeneratedImage[] = [];
  let input: readonly InputItem[] = buildStoryboardInput(
    turns,
    previousResponseId !== undefined,
  );
  let chain = previousResponseId;
  let responseId = '';

  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    roundStarted = false;
    const toolChoice = round < MAX_ROUNDS - 1 ? 'auto' : 'none';
    let outcome: { result: ResponseBody; text: string };
    try {
      outcome = await streamRound(input, chain, toolChoice, emit);
    } catch (error) {
      // Only the FIRST round of a continued turn can be missing its previous response, and
      // only while nothing has been shown: rebuild from our own rows once.
      if (
        round === 0 &&
        chain !== undefined &&
        text === '' &&
        isMissingPreviousResponse(error)
      ) {
        console.warn(
          '[storyboard] previous response unavailable; replaying the stored conversation',
        );
        input = buildStoryboardInput(turns, false);
        chain = undefined;
        outcome = await streamRound(input, chain, toolChoice, emit);
      } else {
        throw error;
      }
    }
    responseId = outcome.result.id as string;

    const calls = functionCallsOf(outcome.result);
    if (calls.length === 0) break;

    // Every call is answered — rendered, failed, or declined over the limit — because a
    // response left with an unanswered call cannot be continued.
    const outputs: FunctionCallOutput[] = [];
    for (const call of calls) {
      let output: Record<string, unknown>;
      const parsed =
        call.name === 'generate_image'
          ? parseImageCallArguments(call.arguments)
          : null;
      if (call.name !== 'generate_image') {
        output = { status: 'failed', error: `Unknown tool ${call.name}.` };
      } else if (parsed === null) {
        output = {
          status: 'failed',
          error: 'The picture description was empty or unreadable.',
        };
      } else if (images.length >= STORYBOARD_IMAGE_LIMIT) {
        output = {
          status: 'not_generated',
          reason: `Only ${STORYBOARD_IMAGE_LIMIT} pictures can be generated in one answer. Offer to make the rest next.`,
        };
      } else {
        try {
          const image = await generateImage(parsed);
          images.push(image);
          onImage?.(image);
          output = {
            status: 'generated',
            picture_number: images.length,
            label: image.label,
            note: 'The picture is shown to the officer beside your answer. Do not write a URL.',
          };
        } catch (error) {
          console.warn(
            `[storyboard] image generation failed: ${error instanceof Error ? error.message : String(error)}`,
          );
          output = {
            status: 'failed',
            error: 'The picture could not be generated this time.',
          };
        }
      }
      outputs.push({
        type: 'function_call_output',
        call_id: call.callId,
        output: JSON.stringify(output),
      });
    }

    input = outputs;
    chain = responseId;
  }

  if (text.trim() === '' && images.length === 0) {
    throw new Error('OpenAI completed the storyboard turn without any answer.');
  }
  return { text, responseId, images };
}
