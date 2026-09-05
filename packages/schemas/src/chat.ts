// Shared shapes for the general assistant at /chat.
//
// The wire contract between apps/api and apps/web. Both halves parse these, so the API and the
// web must ship together — the same rule the /transcribe and pointer payloads carry.
//
// Note what is NOT here: no system prompt, no persona, no house style. That is the product
// decision this whole surface rests on (see chat/misc-chat.ts in @dgipr/content-engine), not an
// omission to be tidied up later.

import { z } from 'zod';

export const ChatRoleSchema = z.enum(['user', 'assistant']);
export type ChatRole = z.infer<typeof ChatRoleSchema>;

// Which model answers one turn.
//
// Per TURN rather than per thread, and deliberately NOT a column: `chat_messages.model`
// already records the model id that answered, which is everything the bubble and /analytics
// need — so this needed no migration.
//
// It is also what makes a MIXED thread safe with no special case. Only the OpenAI lane
// writes `openai_response_id`, so an OpenAI turn that follows a Qwen one finds a null on the
// previous assistant row and replays the bounded transcript statelessly — which is exactly
// right, because the Qwen turn is not in OpenAI's stored response chain and chaining past it
// would answer with a hole in the conversation.
//
// Absent = 'qwen', so every chat uses the self-hosted model unless a caller explicitly names
// another provider.
export const ChatProviderSchema = z.enum(['openai', 'qwen']);
export type ChatProvider = z.infer<typeof ChatProviderSchema>;

export const DEFAULT_CHAT_PROVIDER: ChatProvider = 'qwen';

export const ChatAttachmentKindSchema = z.enum([
  'image',
  'document',
  'audio',
  'youtube',
]);
export type ChatAttachmentKind = z.infer<typeof ChatAttachmentKindSchema>;

// How much typed text one turn may carry. Generous — an officer pasting a whole GR into the
// box is a normal thing to do here — and separate from the attachment budget below, which is
// what a file's extracted text is measured against.
export const CHAT_MESSAGE_MAX_CHARS = 60_000;

// Total extracted/transcribed text one turn's attachments may carry. A 60k-char scanned
// booklet plus a meeting transcript is already a large request; past this the officer is
// better served by /dlo, which is built for it.
export const CHAT_ATTACHMENT_TEXT_MAX_CHARS = 200_000;

// Per turn. Native OpenAI response state means earlier attachments are not retransmitted on
// normal follow-ups; this remains a UI and request-complexity bound.
export const CHAT_MAX_ATTACHMENTS = 10;

// How many past turns are replayed to the model. A chat is unbounded but a request is not, and
// a 200-turn conversation would eventually cost more in replayed history than in new answer.
// Counted in MESSAGES, not tokens: it is the number a reader can reason about, and the char
// caps above bound each one.
export const CHAT_HISTORY_TURNS = 40;

// One attachment as it is submitted and as it comes back. The union is deliberately flat
// rather than discriminated: every field is optional and validated by kind in the route,
// because a discriminated union here would need four near-identical branches and the route
// has to re-check the invariants anyway.
export const ChatAttachmentSchema = z.object({
  kind: ChatAttachmentKindSchema,
  name: z.string().min(1).max(300),
  // 'image' only. Set by POST /chat/attachments/image — never accepted from the client as an
  // arbitrary URL, which would let a request point the model at anything on the internet.
  imageUrl: z.string().url().optional(),
  // Native PDF only. This is our chat_files row, never a client-supplied provider id.
  documentId: z.string().uuid().optional(),
  // Audio, YouTube and legacy non-PDF documents: extracted/transcribed text.
  text: z.string().max(CHAT_ATTACHMENT_TEXT_MAX_CHARS).optional(),
  chars: z.number().int().nonnegative().optional(),
  // 'youtube' only — the canonical watch URL, so the bubble can link the source.
  sourceUrl: z.string().url().optional(),
});
export type ChatAttachment = z.infer<typeof ChatAttachmentSchema>;

export const ChatMessageSchema = z.object({
  id: z.string(),
  role: ChatRoleSchema,
  content: z.string(),
  attachments: z.array(ChatAttachmentSchema),
  model: z.string().nullable(),
  costUsd: z.number().nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const ChatThreadSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  messageCount: z.number().int().nonnegative(),
  lastMessageAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ChatThreadSummary = z.infer<typeof ChatThreadSummarySchema>;

export const ChatThreadDetailSchema = ChatThreadSummarySchema.extend({
  messages: z.array(ChatMessageSchema),
});
export type ChatThreadDetail = z.infer<typeof ChatThreadDetailSchema>;

export const ChatThreadListSchema = z.array(ChatThreadSummarySchema);

// The turn. Either the text or at least one attachment must be present — a message carrying
// neither is nothing to answer — which the route enforces rather than the schema, so the
// refusal can be a Marathi sentence instead of a zod path.
export const SendChatMessageRequestSchema = z.object({
  content: z.string().max(CHAT_MESSAGE_MAX_CHARS),
  attachments: z
    .array(ChatAttachmentSchema)
    .max(CHAT_MAX_ATTACHMENTS)
    .optional(),
  // Omitted = DEFAULT_CHAT_PROVIDER. The browser sends this NAME and nothing else: the
  // endpoint and key of a self-hosted provider are resolved server-side and never leave it.
  provider: ChatProviderSchema.optional(),
});
export type SendChatMessageRequest = z.infer<
  typeof SendChatMessageRequestSchema
>;

export const CreateChatThreadResponseSchema = z.object({ id: z.string() });

// What GET /api/chat/providers hands the composer: which providers THIS deployment has
// configured, and what each one may be given. Ids, labels and capabilities ONLY — never a
// base URL and never a key, so a self-hosted endpoint stays server-side. The
// GET /api/canva/accounts precedent, and the reason this is a request rather than a
// NEXT_PUBLIC_* build-time copy, which would drift the moment .env changed on the box.
//
// Capabilities are REPORTED rather than assumed, because they follow what is actually
// served: a text-only model behind vLLM has no vision and no File Search equivalent, so it
// takes neither pictures nor native PDFs. Audio and YouTube are deliberately absent from
// this list — both are reduced to plain text before any model is contacted, so they work
// everywhere and there is nothing to gate.
export const ChatProviderInfoSchema = z.object({
  id: ChatProviderSchema,
  label: z.string(),
  supportsImages: z.boolean(),
  // DOCX and TXT, which reach the model as extracted text like a transcript does.
  supportsTextDocuments: z.boolean(),
  // A PDF read natively by the provider. Kept apart from the flag above because the one
  // दस्तऐवज picker accepts .pdf, .docx and .txt, and only the PDF half is provider-specific.
  supportsPdf: z.boolean(),
});
export type ChatProviderInfo = z.infer<typeof ChatProviderInfoSchema>;

export const ChatProviderListSchema = z.array(ChatProviderInfoSchema);

export const ChatImageUploadResponseSchema = z.object({
  name: z.string(),
  imageUrl: z.string().url(),
});
export type ChatImageUploadResponse = z.infer<
  typeof ChatImageUploadResponseSchema
>;

export const ChatDocumentUploadResponseSchema = z.object({
  documentId: z.string().uuid(),
  name: z.string(),
});
export type ChatDocumentUploadResponse = z.infer<
  typeof ChatDocumentUploadResponseSchema
>;

// ---------------------------------------------------------------------------
// The event stream
// ---------------------------------------------------------------------------
//
// Server-sent events over a POST, so the client reads them with fetch + a ReadableStream
// rather than EventSource (which can only GET). Four event types, all carried in the `data:`
// field as JSON so there is exactly one framing to parse:
//
//   { type: 'delta', text }   — the next piece of the answer
//   { type: 'done', messageId, userMessageId, title? } — persisted; title on the first turn
//   { type: 'reasoning', text } — the model thinking out loud, when it does so visibly
//   { type: 'error', message } — a Marathi sentence to show in place of the answer
//
// A 'done' always follows the last 'delta' on a successful turn. An 'error' may arrive after
// deltas: the partial answer stays on screen and is stored, because those tokens are paid for.
export const ChatStreamEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('delta'), text: z.string() }),
  // A reasoning model's deliberation, streamed so the officer sees progress instead of a
  // dead pane while it thinks. NOT part of the answer: it is never added to `content` and
  // never stored, which also keeps us right about multi-turn history — Qwen3's own guidance
  // is that prior thinking must not be replayed into a later turn.
  //
  // Additive to this union on purpose: the reader in apps/web/lib/api.ts skips a frame it
  // does not recognise, precisely so a new event type cannot break a client mid-answer.
  z.object({ type: z.literal('reasoning'), text: z.string() }),
  z.object({
    type: z.literal('done'),
    messageId: z.string(),
    userMessageId: z.string(),
    title: z.string().optional(),
  }),
  z.object({ type: z.literal('error'), message: z.string() }),
]);
export type ChatStreamEvent = z.infer<typeof ChatStreamEventSchema>;

// A chat's name in the rail, derived from its first user message. Deliberately deterministic
// and free — asking a model to title the chat would be a second call on every first turn, for
// something the first sentence already says.
export const CHAT_TITLE_MAX_CHARS = 60;

export function chatTitleFrom(content: string, fallback: string): string {
  // Collapse newlines first: a pasted note's first line may be blank, and a title made of
  // whitespace is worse than the fallback.
  const flat = content.replace(/\s+/g, ' ').trim();
  if (flat === '') return fallback;
  if (flat.length <= CHAT_TITLE_MAX_CHARS) return flat;
  // Cut at a word boundary where there is one reasonably near the limit, so a title does not
  // end mid-word. Devanagari uses spaces between words, so this works the same in both scripts.
  const cut = flat.slice(0, CHAT_TITLE_MAX_CHARS);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > CHAT_TITLE_MAX_CHARS * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
