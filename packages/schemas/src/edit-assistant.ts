// The edit assistant: one conversational box that replaced the "AI ला सूचना द्या" fold on
// the poster and caption cards. The officer describes what they want in their own words;
// `POST /api/generations/:id/assist` reads the whole conversation plus the run's current
// state and answers with a PLAN — do something, ask one question, or just reply. The web
// then carries the plan out through the EXISTING routes (caption feedback, caption generate,
// poster image-feedback, poster regenerate), so every guard, activity row and job those
// routes already have applies unchanged. The assistant decides; it never gets a side door.
//
// Nothing here is stored. The conversation lives in the browser (per run, per surface) and
// is re-sent in full on every turn, which is what lets "आता थोडा लहान करा" mean something.

import { z } from 'zod';
import { PosterClearActionSchema } from './api.js';

/** How many turns of history travel with a request — the newest are kept. */
export const EDIT_ASSISTANT_MAX_MESSAGES = 20;
/** One message's ceiling. Generous for a request, far below a pasted article. */
export const EDIT_ASSISTANT_MESSAGE_MAX_CHARS = 2_000;

// Which card the conversation is on, which decides what it can do:
//   social  — a twitter/facebook run: caption AND poster (SocialPostView)
//   caption — the caption of a run whose poster edits live elsewhere (the carousel)
//   poster  — an article poster or YouTube thumbnail (PosterPanel)
export const EditAssistantSurfaceSchema = z.enum([
  'social',
  'caption',
  'poster',
]);
export type EditAssistantSurface = z.infer<typeof EditAssistantSurfaceSchema>;

export const EditAssistantMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  text: z.string().trim().min(1).max(EDIT_ASSISTANT_MESSAGE_MAX_CHARS),
});
export type EditAssistantMessage = z.infer<typeof EditAssistantMessageSchema>;

// What is marked on the poster right now. Positions stay in the browser — the plan only
// needs to know how many marks there are and what the officer already wrote beside them,
// so it can supply the notes the image-feedback route requires for the ones left blank.
export const EditAssistantMarkerSchema = z.object({
  note: z.string().trim().max(500).default(''),
});
export const EditAssistantClearRegionSchema = z.object({
  action: PosterClearActionSchema.default('displace'),
  note: z.string().trim().max(500).default(''),
});

export const EditAssistantRequestSchema = z
  .object({
    surface: EditAssistantSurfaceSchema,
    messages: z
      .array(EditAssistantMessageSchema)
      .min(1)
      .max(EDIT_ASSISTANT_MAX_MESSAGES),
    markers: z.array(EditAssistantMarkerSchema).max(3).default([]),
    clearRegions: z.array(EditAssistantClearRegionSchema).max(2).default([]),
  })
  .superRefine((value, ctx) => {
    if (value.messages[value.messages.length - 1]?.role !== 'user') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'The conversation must end with the officer’s message.',
        path: ['messages'],
      });
    }
  });
export type EditAssistantRequest = z.input<typeof EditAssistantRequestSchema>;

// The executable half of a plan. At most one caption action and one poster action — a
// request that touches both ("कॅप्शन लहान करा आणि पोस्टरवरचा फोटो बदला") becomes both,
// carried out in that order (the caption job runs beside a poster render, not instead of it).
export const EditAssistantActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('caption_revise'), instruction: z.string() }),
  z.object({ type: z.literal('caption_generate') }),
  z.object({
    type: z.literal('poster_edit'),
    // May be '' when the marks alone carry the request.
    instruction: z.string(),
    // One per mark, in mark order — the officer's own note where they wrote one.
    markerNotes: z.array(z.string()),
  }),
  z.object({ type: z.literal('poster_redesign') }),
  z.object({ type: z.literal('poster_heading'), heading: z.string() }),
]);
export type EditAssistantAction = z.infer<typeof EditAssistantActionSchema>;

export const EditAssistantPlanSchema = z.object({
  // act = carry out `actions`; clarify = `message` is a question; reply = just an answer.
  kind: z.enum(['act', 'clarify', 'reply']),
  // Marathi, shown in the conversation as the assistant's turn.
  message: z.string(),
  actions: z.array(EditAssistantActionSchema),
});
export type EditAssistantPlan = z.infer<typeof EditAssistantPlanSchema>;
