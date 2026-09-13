// Shared shapes for /new-video-workflow — Gemini-style conversational video generation.
//
// The wire contract between apps/api and apps/web, so the two halves ship together (the /chat
// and /transcribe rule).
//
// ISOLATED ON PURPOSE. Nothing here touches the production explainer-video pipeline: no
// scenes, no tiers, no aspect ratio, no narration, no captions, no branding. `video.ts` beside
// this file is that pipeline and stays untouched.
//
// PERSISTED SINCE migration 0050. This surface shipped as an in-process experiment with a
// 3-hour TTL and no history at all; conversations now live in `new_video_conversations` /
// `new_video_turns`, so a reload, a closed tab or another machine all pick the conversation
// back up and the rail can list past work. Nothing on this wire is a provider handle: a
// Gemini interaction id and a storage path stay inside the API.

import { z } from 'zod';

// The prompt travels to Gemini VERBATIM, so this is a request-size bound and nothing else —
// no truncation, no trimming, no rewriting anywhere in this lane. Kept in step with
// INTERACTION_PROMPT_MAX_CHARS in @dgipr/content-engine (asserted by that package's test).
export const NEW_VIDEO_PROMPT_MAX_CHARS = 20_000;

// Reference images per turn. Each one travels to the model as base64 inside a JSON body.
export const NEW_VIDEO_MAX_IMAGES = 4;

// Per reference image, matching INTERACTION_IMAGE_MAX_BYTES. Stated in MB as well so the
// Marathi copy and the number actually enforced cannot disagree.
export const NEW_VIDEO_IMAGE_MAX_MB = 7;
export const NEW_VIDEO_IMAGE_MAX_BYTES = NEW_VIDEO_IMAGE_MAX_MB * 1024 * 1024;

// PNG, JPEG and WebP, per the brief. A distinct list from IMAGE_FILE_ACCEPT in dlo.ts because
// that one serves the OCR intake and may legitimately change without this following.
export const NEW_VIDEO_IMAGE_ACCEPT =
  'image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp';

// THE SHAPE OF THE OUTPUT VIDEO, CHOSEN BY THE OFFICER, PER TURN.
//
// The Interactions API takes this natively as `response_format.aspect_ratio` ('16:9' | '9:16',
// 16:9 being its own documented default), so the officer's choice is rendered rather than asked
// for in words: nothing is appended to the prompt, which keeps this lane's one hard rule — the
// prompt reaches Gemini VERBATIM — intact, and nothing is cropped afterwards, so no frame the
// department paid for is thrown away to change its shape.
//
// Only the two the API names. There is deliberately no 'source' option as on the Dynamic
// Poster lane (MOTION_ASPECTS): there the source is a poster with a shape of its own, and here
// a turn may be text alone.
export const NEW_VIDEO_ASPECTS = ['16:9', '9:16'] as const;
export const NewVideoAspectSchema = z.enum(NEW_VIDEO_ASPECTS);
export type NewVideoAspect = z.infer<typeof NewVideoAspectSchema>;

// Landscape, matching both the API's own default and what a department publishes most of.
export const DEFAULT_NEW_VIDEO_ASPECT: NewVideoAspect = '16:9';

// ---------------------------------------------------------------------------
// The character & voice registry (migration 0054)
// ---------------------------------------------------------------------------
//
// Reusable ACROSS conversations, which is the whole point: a new conversation seeded from the
// same entry is what reproduces the Gemini app's good case, where consistency comes from the
// user re-supplying the same picture and the same description by hand.

// A name is one line and is reproduced into a prompt block that carries <IMAGE_REF_n> syntax,
// so the four characters that syntax is made of are refused outright. A person's name contains
// none of them, and letting one through would let a registry entry point the model at a
// picture the officer never attached.
export const NEW_VIDEO_CHARACTER_NAME_MAX_CHARS = 80;
export const NEW_VIDEO_CHARACTER_APPEARANCE_MAX_CHARS = 600;
export const NEW_VIDEO_CHARACTER_VOICE_MAX_CHARS = 400;

// Characters per conversation. Capped at the per-turn image limit because a character WITH a
// portrait spends one of those slots on the turn that establishes it; the route enforces the
// combined total, which is the rule that actually binds.
export const NEW_VIDEO_MAX_CAST = NEW_VIDEO_MAX_IMAGES;

const NAME_SYNTAX_CHARACTERS = /[<>[\]]/;

export const NewVideoCharacterSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  appearance: z.string(),
  voice: z.string(),
  // The public portrait URL, or null for a character described in words alone. The storage
  // path and mime type stay in the API — a browser never sees either.
  portraitUrl: z.string().url().nullable(),
  createdAt: z.string(),
});
export type NewVideoCharacter = z.infer<typeof NewVideoCharacterSchema>;

export const NewVideoCharacterListSchema = z.array(NewVideoCharacterSchema);

// `portraitImageId` is an id this API minted at upload, exactly as a turn's `imageIds` are:
// the browser never supplies a storage path or a URL for something a paid render will read.
// Explicit `null` CLEARS the portrait; omitting the field leaves it alone — the three-state
// rule /video's scene reference image already follows.
export const NewVideoCharacterRequestSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(NEW_VIDEO_CHARACTER_NAME_MAX_CHARS)
    .refine((value) => !NAME_SYNTAX_CHARACTERS.test(value), {
      message: 'A character name may not contain < > [ or ].',
    }),
  appearance: z
    .string()
    .max(NEW_VIDEO_CHARACTER_APPEARANCE_MAX_CHARS)
    .optional(),
  voice: z.string().max(NEW_VIDEO_CHARACTER_VOICE_MAX_CHARS).optional(),
  portraitImageId: z.string().uuid().nullable().optional(),
});
export type NewVideoCharacterRequest = z.infer<
  typeof NewVideoCharacterRequestSchema
>;

// Every field optional: an edit may change one of them without restating the rest.
export const NewVideoCharacterPatchSchema =
  NewVideoCharacterRequestSchema.partial();
export type NewVideoCharacterPatch = z.infer<
  typeof NewVideoCharacterPatchSchema
>;

// How a turn is progressing, exactly as the brief asks. `queued` is set by the ROUTE before
// it answers 202 — the client refreshes the moment the 202 lands, and a turn with no status
// yet would read as finished (the /dlo re-extract rule).
export const NewVideoTurnStatusSchema = z.enum([
  'queued',
  'generating',
  'completed',
  'failed',
]);
export type NewVideoTurnStatus = z.infer<typeof NewVideoTurnStatusSchema>;

// One reference image, as it comes back from the upload route and as it is echoed on a turn.
// `url` is a public bucket URL, exactly like a /chat image — never a storage path and never
// an authenticated Gemini URL.
export const NewVideoImageSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  url: z.string().url(),
});
export type NewVideoImage = z.infer<typeof NewVideoImageSchema>;

export const NewVideoTurnSchema = z.object({
  id: z.string().uuid(),
  prompt: z.string(),
  images: z.array(NewVideoImageSchema),
  status: NewVideoTurnStatusSchema,
  // A public URL for the re-hosted MP4. Present only once the turn completes.
  videoUrl: z.string().url().nullable(),
  // Any prose the model returned beside the video — a refusal explains itself here.
  modelText: z.string().nullable(),
  // The provider's own words on failure. Shown as-is on this page: the experiment exists to
  // read what the API says, so a canned sentence would defeat it.
  error: z.string().nullable(),
  createdAt: z.string(),
});
export type NewVideoTurn = z.infer<typeof NewVideoTurnSchema>;

export const NewVideoConversationSchema = z.object({
  id: z.string().uuid(),
  // Derived from the first prompt and truncated, so the rail has a handle for finding this
  // conversation again. Empty until the first turn lands.
  title: z.string(),
  turns: z.array(NewVideoTurnSchema),
  // The cast, resolved from the registry. Present on every read so the page can name who is
  // in this conversation and stop offering to change it — the cast is fixed once the first
  // turn has landed.
  characters: z.array(NewVideoCharacterSchema),
  // True while any turn is queued or generating — what the poll and the composer gate on.
  busy: z.boolean(),
  createdAt: z.string(),
});
export type NewVideoConversation = z.infer<typeof NewVideoConversationSchema>;

// One row of the rail. Deliberately carries NO turns and no prompt: a prompt runs to 20,000
// characters and the list is polled while a render is in flight, which is exactly why 0050
// denormalizes the title and the counters onto the conversation row.
export const NewVideoConversationSummarySchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  turnCount: z.number().int().nonnegative(),
  lastTurnAt: z.string().nullable(),
  createdAt: z.string(),
});
export type NewVideoConversationSummary = z.infer<
  typeof NewVideoConversationSummarySchema
>;

export const NewVideoConversationListSchema = z.array(
  NewVideoConversationSummarySchema,
);

// How long a rail title may run before it is cut. Shared so the API's derivation and any
// client-side preview cannot disagree about where the ellipsis falls.
export const NEW_VIDEO_TITLE_MAX_CHARS = 80;

// The rail's handle for a conversation, from its first prompt. Deliberately the same shape as
// chatTitleFrom: first line, collapsed whitespace, cut on a word boundary where one is near
// the limit so a title does not end mid-word.
export function newVideoTitleFrom(prompt: string): string {
  const firstLine = prompt.split(/\r?\n/).find((line) => line.trim() !== '');
  const flat = (firstLine ?? '').replace(/\s+/g, ' ').trim();
  if (flat.length <= NEW_VIDEO_TITLE_MAX_CHARS) return flat;
  const cut = flat.slice(0, NEW_VIDEO_TITLE_MAX_CHARS);
  const space = cut.lastIndexOf(' ');
  return `${(space > NEW_VIDEO_TITLE_MAX_CHARS * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

// The turn. Omitting `conversationId` starts a NEW, independent conversation — which is all
// the "New conversation" button does, so there is no separate route to get wrong.
//
// `imageIds` are ids this API minted at upload. The browser never supplies a storage path, a
// data URI or a provider file id: a request must not be able to point the model at something
// we did not accept.
export const NewVideoTurnRequestSchema = z.object({
  conversationId: z.string().uuid().optional(),
  prompt: z.string().min(1).max(NEW_VIDEO_PROMPT_MAX_CHARS),
  imageIds: z.array(z.string().uuid()).max(NEW_VIDEO_MAX_IMAGES).optional(),
  // The CAST, from the registry. Meaningful only on a conversation's FIRST turn: a character's
  // portrait is attached on the turn that establishes them, and stacking a new reference into
  // the middle of an edit chain is a documented failure mode. A follow-up may echo the stored
  // cast (a well-behaved client does) but may not change it — the route answers a Marathi 400
  // rather than rendering a different character than the one the officer can see.
  characterIds: z.array(z.string().uuid()).max(NEW_VIDEO_MAX_CAST).optional(),
  // FORKING (Step 4). Continue from THIS turn's video instead of from the latest one — the
  // API's own documented "reference an older interaction id with a different prompt", which
  // is what answers drift past the reported turn-4 editing ceiling.
  //
  // A TURN ID, never an interaction id: the provider handle stays inside the API (the rule
  // this whole surface is built around), so the browser names a turn it can see and the
  // route resolves it. Meaningful only on a FOLLOW-UP, and only for a turn of this very
  // conversation that actually produced a video — anything else is a Marathi 400 rather than
  // a paid render continuing from somewhere nobody chose.
  //
  // Omitted means the ordinary case: continue from whatever last succeeded.
  fromTurnId: z.string().uuid().optional(),
  // Optional so an older client — or a request written by hand — still sends a valid turn;
  // the route supplies DEFAULT_NEW_VIDEO_ASPECT in its place rather than leaving the shape to
  // whatever the model feels like.
  aspect: NewVideoAspectSchema.optional(),
});
export type NewVideoTurnRequest = z.infer<typeof NewVideoTurnRequestSchema>;

export const NewVideoTurnResponseSchema = z.object({
  conversationId: z.string().uuid(),
  turnId: z.string().uuid(),
});
export type NewVideoTurnResponse = z.infer<typeof NewVideoTurnResponseSchema>;

export const NewVideoImageUploadResponseSchema = NewVideoImageSchema;
export type NewVideoImageUploadResponse = z.infer<
  typeof NewVideoImageUploadResponseSchema
>;
