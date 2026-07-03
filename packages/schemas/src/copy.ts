// Poster "copy" — the structured, poster-ready Marathi content derived from a
// generated article. Shape mirrors the DGIPR n8n workflow so the same prompt
// assembly logic (packages/poster-renderer) can consume it. The LLM chooses the
// post_type (which master template fits the article); the user chooses the
// design_mode.

import { z } from 'zod';

// Master template the poster is built around; the LLM picks the best fit for
// the article content.
export const PostTypeSchema = z.enum([
  'alert',
  'campaign',
  'info_bullets',
  'quote',
  'timeline',
]);
export type PostType = z.infer<typeof PostTypeSchema>;

// How much freedom the image model gets vs. the master template. User-selected.
export const DesignModeSchema = z.enum(['fresh', 'adaptive', 'onbrand']);
export type DesignMode = z.infer<typeof DesignModeSchema>;

const BulletSchema = z.object({
  text: z.string(),
  emphasis: z.array(z.string()).optional(),
});

const StatSchema = z.object({
  value: z.string(),
  label: z.string(),
  icon_hint: z.string(),
});

const PointSchema = z.object({
  text: z.string(),
  icon_hint: z.string(),
});

const MilestoneSchema = z.object({
  date: z.string(),
  text: z.string(),
});

// scene_brief describes the background imagery only and must never cover the text.
const AlertCopySchema = z.object({
  post_type: z.literal('alert'),
  kicker: z.string().optional(),
  headline: z.string(),
  subhead: z.string().optional(),
  bullets: z.array(BulletSchema),
  scene_brief: z.string(),
});

const CampaignCopySchema = z.object({
  post_type: z.literal('campaign'),
  kicker: z.string().optional(),
  headline: z.string(),
  subhead: z.string().optional(),
  schedule: z
    .object({ date: z.string().optional(), time: z.string().optional() })
    .optional(),
  audience: z.string().optional(),
  cta: z.string().optional(),
  stats: z.array(StatSchema).optional(),
  scene_brief: z.string(),
});

const InfoBulletsCopySchema = z.object({
  post_type: z.literal('info_bullets'),
  kicker: z.string().optional(),
  headline: z.string(),
  subhead: z.string().optional(),
  bullets: z.array(BulletSchema),
  scene_brief: z.string(),
});

const QuoteCopySchema = z.object({
  post_type: z.literal('quote'),
  topic_label: z.string().optional(),
  headline: z.string().optional(),
  quote_text: z.string(),
  attribution: z
    .object({ name: z.string().optional(), title: z.string().optional() })
    .optional(),
  points: z.array(PointSchema).optional(),
  scene_brief: z.string(),
});

const TimelineCopySchema = z.object({
  post_type: z.literal('timeline'),
  side_label: z.string().optional(),
  headline: z.string(),
  intro: z.string().optional(),
  milestones: z.array(MilestoneSchema),
  scene_brief: z.string(),
});

export const CopySchema = z.discriminatedUnion('post_type', [
  AlertCopySchema,
  CampaignCopySchema,
  InfoBulletsCopySchema,
  QuoteCopySchema,
  TimelineCopySchema,
]);

export type Copy = z.infer<typeof CopySchema>;
