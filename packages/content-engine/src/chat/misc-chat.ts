// The general assistant behind /chat.
//
// *** THERE IS NO SYSTEM PROMPT, AND THAT IS THE DESIGN. ***
//
// Every other model call in this repo opens with a page of DGIPR rules, because every other
// call has one job and must do it the department's way. This one does not have a job. It is
// the surface an officer reaches for when the question is not an article, a poster, a
// translation or a proofread — and any house prompt we add here can only narrow what it is
// able to help with. A Marathi-first instruction would make it answer an English question in
// Marathi; a "you are a government communication assistant" persona would make it decline or
// hedge on the ordinary work people actually bring to a chat box.
//
// So the request carries the conversation and nothing else. If this file ever grows a
// SYSTEM_PROMPT constant, that is a product decision to take with the department, not a
// tidy-up. The consequences are real and were accepted: this page does NOT inherit the
// glossary's name spellings, the never-invent rules or the Marathi-first contract. Anything an
// officer intends to publish should go through /dlo or /proofread, which do.
//
// What this module DOES own is the shape of the request: which turns are replayed, how an
// attachment's text is folded into the turn that carried it, and the concurrency lane.

import {
  chatCompleteStream,
  type AnyChatMessage,
  type ChatContentPart,
} from '../generation/openai-chat.js';

// The tier. terra is the authoring/judgement tier and the right default for open-ended work;
// it is also what VISION_MODEL uses, which matters because a chat turn can carry photographs
// and the model has to be able to read them. Env-overridable so a deployment can trade
// quality for latency without touching any other caller (the VIDEO_CHAT_MODEL precedent).
export const MISC_CHAT_MODEL =
  process.env.OPENAI_MISC_CHAT_MODEL ?? 'gpt-5.6-terra';

// Room for the ANSWER (chatCompleteStream adds the reasoning headroom on top). Generous
// because "write me a two-page covering letter" is an ordinary request here, where the
// pipeline's callers all produce something bounded.
const MISC_CHAT_MAX_TOKENS = 8_192;

// A conversational surface should feel responsive, and a chat answer is read as it arrives —
// so deliberation is dialled DOWN from the repo-wide 'medium' default. The pipeline's callers
// buy quality with latency because nobody is watching them; this one is being watched.
// Env-overridable for a deployment that would rather wait.
function miscChatReasoningEffort(): 'none' | 'low' | 'medium' | 'high' {
  const raw =
    process.env.OPENAI_MISC_CHAT_REASONING_EFFORT?.trim().toLowerCase();
  return raw === 'none' || raw === 'low' || raw === 'medium' || raw === 'high'
    ? raw
    : 'low';
}

// One stored turn, as the API hands it over. Structurally the persisted row minus the columns
// the model has no use for — deliberately not importing @dgipr/database, which this package
// does not depend on.
export type MiscChatTurn = Readonly<{
  role: 'user' | 'assistant';
  content: string;
  attachments?: readonly Readonly<{
    kind: 'image' | 'document' | 'audio' | 'youtube';
    name: string;
    imageUrl?: string | undefined;
    text?: string | undefined;
  }>[];
}>;

// How an attached file's text is introduced. A delimiter, not a sentence: an instruction
// ("the user has attached a file, please consider it") is a system prompt in disguise, and
// the model does not need to be told what a labelled block of text is.
function attachmentBlock(name: string, text: string): string {
  return `--- ${name} ---\n${text}`;
}

// Fold one stored turn into what the model receives.
//
// The typed text and the attachments' text are stored SEPARATELY (so the bubble can render
// file chips instead of a wall of extracted text) and are joined only here. Text first: it is
// what the officer actually asked, and burying the question under forty pages of a scanned GR
// is how a model ends up answering the document instead of the question.
function toRequestMessage(turn: MiscChatTurn): AnyChatMessage {
  const attachments = turn.attachments ?? [];
  const images = attachments.filter(
    (attachment) => attachment.kind === 'image' && attachment.imageUrl,
  );
  const texts = attachments.filter(
    (attachment) => attachment.kind !== 'image' && attachment.text,
  );

  const textBody = [
    turn.content,
    ...texts.map((attachment) =>
      attachmentBlock(attachment.name, attachment.text ?? ''),
    ),
  ]
    .filter((part) => part.trim() !== '')
    .join('\n\n');

  if (images.length === 0) {
    return { role: turn.role, content: textBody };
  }

  // A multimodal turn. The text part comes first for the same reason as above, and an image
  // with no accompanying words still needs one — a content array of images alone gives the
  // model nothing to answer.
  const parts: ChatContentPart[] = [
    { type: 'text', text: textBody === '' ? ' ' : textBody },
    ...images.map((attachment): ChatContentPart => ({
      type: 'image_url',
      image_url: { url: attachment.imageUrl ?? '' },
    })),
  ];
  return { role: turn.role, content: parts };
}

export type MiscChatReply = Readonly<{
  text: string;
  model: string;
}>;

// Stream one reply. `turns` is the whole conversation INCLUDING the new user turn, oldest
// first; the caller has already trimmed it to the history window it wants to pay for.
//
// Throws whatever chatCompleteStream throws. The caller decides what to do with a partial
// answer — see the turn route, which stores it rather than discarding paid tokens.
export async function streamMiscChatReply(
  turns: readonly MiscChatTurn[],
  onDelta: (chunk: string) => void,
): Promise<MiscChatReply> {
  const model = MISC_CHAT_MODEL;
  const text = await chatCompleteStream(turns.map(toRequestMessage), {
    onDelta,
    model,
    maxTokens: MISC_CHAT_MAX_TOKENS,
    reasoningEffort: miscChatReasoningEffort(),
    // The whole point of the lane: this answer is being watched, so it must not queue behind
    // an article generation — nor make one queue behind it.
    lane: 'chat',
  });
  return { text, model };
}
