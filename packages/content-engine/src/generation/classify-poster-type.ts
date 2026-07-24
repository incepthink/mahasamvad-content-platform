// Classify a note into ONE social poster type, and read off the two signals that drive
// content-aware master selection (how many body points the note supports, and whether it
// wants a photograph). Ported from the n8n `Build Classify Request` + `Classify L0` nodes
// so the routing is unchanged, then extended with `point_count` / `wants_photo` — which cost
// nothing extra because they ride the same strict-JSON call.
//
// Skipped entirely on a pinned or CMO run (the brand/pin IS the type choice), exactly as the
// old `IF Forced Type` branch did.

import { pathToFileURL } from 'node:url';
import { chatComplete } from './openai-chat.js';

// The model that classifies the note and writes the poster's visible Marathi copy. This is
// authoring, not routing plumbing: the headline it produces is the most-read text the
// product ships, so it sits on the authoring tier (terra) rather than the cheaper luna it
// launched on. Both keep Marathi in Devanagari, which is why gpt-4o-mini was retired here
// (it leaked Latin "MRI" into headlines). Env-overridable, matching OPENAI_IMAGE_MODEL /
// VEO_MODEL_* — set OPENAI_COPY_MODEL=gpt-5.6-luna to trade quality back for latency.
export const POSTER_COPY_MODEL = process.env.OPENAI_COPY_MODEL ?? 'gpt-5.6-terra';

// One entry of the type catalog the classifier routes by. Only slug + description matter to
// the router (description is the operator's editorial intent for that type).
export type PosterTypeOption = Readonly<{
  slug: string;
  description: string;
}>;

export type PosterClassification = Readonly<{
  postType: string;
  // A short Marathi working title for the post.
  title: string;
  // How many body points/bullets the note actually supports (0-12). Feeds master selection
  // (matched against a master's bulletSlots), not the copy — the copy's slot count is still
  // pinned to the chosen master's real capacity.
  pointCount: number;
  // Whether the note wants a photograph (an event, a place, people) vs. a text-only advisory.
  // Matched against a master's hasPhotoZone during selection.
  wantsPhoto: boolean;
  // One short English sentence on why this type fits (log/debug only).
  reason: string;
}>;

function buildSystemPrompt(types: readonly PosterTypeOption[]): string {
  const typeLines = types.map((t) => `- "${t.slug}": ${t.description}`);
  return [
    'You are an editorial classifier for DGIPR Maharashtra (Directorate General of Information & Public Relations).',
    'You read raw meeting notes and decide which ONE poster format best fits the PRIMARY message.',
    'If the notes cover several topics, pick the single most important/foreground topic.',
    'Respond with STRICT JSON only.',
    '',
    'Post types:',
    ...typeLines,
    '',
    'title: a short Marathi (Devanagari) working title for the post.',
    'point_count: how many distinct body points/bullets the notes actually support (an integer 0-12). Count real supporting facts, not sentences.',
    'wants_photo: true if the post would naturally carry a photograph (an event, a place, people, a building, a vehicle); false for a purely textual advisory, rule list, or statement.',
    'reason: one short English sentence on why this type fits best.',
  ].join('\n');
}

function parseJson(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start !== -1 && end > start) {
      return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
    }
    throw new Error(`Classifier did not return JSON: ${raw.slice(0, 400)}`);
  }
}

export async function classifyPosterType(
  note: string,
  types: readonly PosterTypeOption[],
): Promise<PosterClassification> {
  const trimmed = note.trim();
  if (trimmed.length === 0) throw new Error('No note to classify.');
  if (types.length === 0) throw new Error('No poster type catalog to classify against.');

  const slugs = types.map((t) => t.slug);
  const raw = await chatComplete(
    [
      { role: 'system', content: buildSystemPrompt(types) },
      { role: 'user', content: `Meeting notes:\n${trimmed}` },
    ],
    {
      model: POSTER_COPY_MODEL,
      // A misclassification picks the wrong template family and produces a structurally
      // wrong poster, so this gets real deliberation. maxTokens is the ANSWER budget;
      // reasoning gets its own headroom in openai-chat.ts.
      reasoningEffort: 'medium',
      maxTokens: 400,
      jsonSchema: {
        name: 'post_classification',
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            post_type: { type: 'string', enum: slugs },
            title: { type: 'string' },
            point_count: { type: 'integer' },
            wants_photo: { type: 'boolean' },
            reason: { type: 'string' },
          },
          required: ['post_type', 'title', 'point_count', 'wants_photo', 'reason'],
        },
      },
    },
  );

  const parsed = parseJson(raw);
  const postType = typeof parsed.post_type === 'string' ? parsed.post_type : '';
  // A slug outside the catalog is a model slip; fall back to the first offered type rather
  // than fail the run (the old node made the same fallback).
  const resolved = slugs.includes(postType) ? postType : (slugs[0] as string);
  const pointCountRaw = Number(parsed.point_count);
  return {
    postType: resolved,
    title: typeof parsed.title === 'string' ? parsed.title : '',
    pointCount: Number.isFinite(pointCountRaw)
      ? Math.min(12, Math.max(0, Math.round(pointCountRaw)))
      : 0,
    wantsPhoto: parsed.wants_photo !== false,
    reason: typeof parsed.reason === 'string' ? parsed.reason : '',
  };
}

// --- CLI harness -----------------------------------------------------------
//   tsx --env-file=../../.env src/generation/classify-poster-type.ts
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const TYPES: PosterTypeOption[] = [
    { slug: 'alert', description: 'urgent public-safety warning or advisory.' },
    { slug: 'info_bullets', description: 'general information as a headline plus a list of points.' },
    { slug: 'campaign', description: 'a drive, event, camp or service with a date and audience.' },
    { slug: 'quote', description: 'a statement or quote by a leader, with attribution.' },
  ];
  const NOTE = [
    'मुंबई महानगरपालिकेने चार प्रमुख रुग्णालयांमध्ये अत्याधुनिक एमआरआय केंद्रे सुरू करण्यास मान्यता दिली आहे.',
    'सायन, कूपर, नायर आणि केईएम या रुग्णालयांत महापालिका दरात तपासणी उपलब्ध होणार आहे.',
    'एकूण २ कोटी रुपयांची तरतूद असून ३१ ऑगस्ट २०२६ पर्यंत केंद्रे कार्यान्वित होतील.',
  ].join(' ');
  classifyPosterType(NOTE, TYPES)
    .then((c) => console.log(JSON.stringify(c, null, 2)))
    .catch((e: unknown) => {
      console.error(e);
      process.exitCode = 1;
    });
}
