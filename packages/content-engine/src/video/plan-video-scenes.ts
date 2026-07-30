// A deliberately small two-call planning stage:
//   1. extract the useful facts for a video;
//   2. turn those facts into the best realistic sequence for the selected time.
//
// The planner chooses the scene count. A deterministic timeline then distributes
// the selected 30/60 seconds across those scenes, so the script writer knows the
// visual windows before composing one continuous narration.

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import {
  VIDEO_CLIP_MAX_SECONDS,
  VIDEO_CLIP_MIN_SECONDS,
  VIDEO_SCENE_LIMIT,
  VIDEO_TOTAL_SECONDS,
  type VideoDurationBucket,
} from '@dgipr/schemas';
import {
  chatComplete,
  VIDEO_CHAT_MODEL,
  type ChatMessage,
} from '../generation/openai-chat.js';

const FactsSchema = z.object({
  facts: z.array(z.string().trim().min(1).max(1000)).min(1),
});

const PlanSceneSchema = z.object({
  fact_index: z.number().int().min(1),
  beat: z.string().trim().min(1).max(300),
  visual_brief: z.string().trim().min(1).max(600),
  end_visual_brief: z.string().trim().max(600).optional(),
  shot_hint: z.string().trim().min(1).max(160),
});

const PlanSchema = z.object({
  scenes: z
    .array(PlanSceneSchema)
    .min(VIDEO_SCENE_LIMIT.min)
    .max(VIDEO_SCENE_LIMIT.max),
});

export type VideoScenePlanScene = Readonly<{
  // Marathi one-liner: the information this scene must convey.
  beat: string;
  // The verbatim note text this beat rests on. Verified against the note here;
  // passed to the script writer so narration stays anchored to the same fact.
  sourceQuote: string;
  visualSourceQuote: string;
  visualBrief: string;
  endVisualBrief?: string;
  // English shot/camera direction ("close-up of a shared action, slow push-in").
  shotHint: string;
  // Provisional visual window supplied to the script writer. The measured
  // continuous WAV may extend the complete timeline later, never insert gaps.
  durationSeconds: number;
}>;

export type VideoScenePlan = Readonly<{
  scenes: readonly VideoScenePlanScene[];
}>;

export type VideoScenePlanOptions = Readonly<{
  durationBucket: VideoDurationBucket;
  heading?: string | undefined;
}>;

function plannedSceneDurations(
  sceneCount: number,
  totalSeconds: number,
): number[] {
  if (sceneCount <= 0) return [];
  const capacity = sceneCount * VIDEO_CLIP_MAX_SECONDS;
  const floor = sceneCount * VIDEO_CLIP_MIN_SECONDS;
  const total = Math.max(floor, Math.min(capacity, totalSeconds));
  const base = Math.floor(total / sceneCount);
  const remainder = total - base * sceneCount;
  return Array.from(
    { length: sceneCount },
    (_, index) => base + (index < remainder ? 1 : 0),
  );
}

function buildFactsSystemPrompt(): string {
  return [
    'We are making the best possible explainer video from an official note.',
    'Extract the facts from the note that will be most useful for that video.',
    'Return only JSON in this shape: { "facts": ["...", "..."] }',
  ].join('\n');
}

function buildPlannerSystemPrompt(bucket: VideoDurationBucket): string {
  const totalSeconds = VIDEO_TOTAL_SECONDS[bucket];
  const minimumScenesForTimeline = Math.ceil(
    totalSeconds / VIDEO_CLIP_MAX_SECONDS,
  );
  return [
    'Plan the best realistic live-action explainer video from the supplied facts.',
    `The complete video should fit about ${totalSeconds} seconds. Each clip can be ${VIDEO_CLIP_MIN_SECONDS}-${VIDEO_CLIP_MAX_SECONDS} seconds.`,
    `Choose freely how many scenes the story needs, from ${VIDEO_SCENE_LIMIT.min} to ${VIDEO_SCENE_LIMIT.max}.`,
    `Use at least ${minimumScenesForTimeline} scenes so their combined visual timeline can hold the complete ${totalSeconds}-second voiceover.`,
    'Each scene should explain one useful idea through a natural, engaging action.',
    'Keep the number of active people as low as possible: prefer one person, and use two only when their interaction matters.',
    'Write beat in Marathi. Write visual_brief, end_visual_brief and shot_hint in English.',
    'Usually leave end_visual_brief empty so the video model can animate freely from the start frame.',
    'Use an end_visual_brief only when the shot must land on a clearly different final state, such as a door fully closing or an object being handed over.',
    'Return only JSON in this shape:',
    '{ "scenes": [ { "fact_index": 1, "beat": "...", "visual_brief": "...", "end_visual_brief": "", "shot_hint": "..." } ] }',
  ].join('\n');
}

function buildPlannerUserContent(
  note: string,
  heading: string | undefined,
  facts: readonly string[],
): string {
  const parts: string[] = [
    '<NOTE purpose="only_authoritative_fact_source">',
    note.trim(),
    '</NOTE>',
    '',
    '<FACTS purpose="choose_scenes_from_these">',
    ...facts.map((fact, index) => `${index + 1}. ${fact}`),
    '</FACTS>',
  ];
  if (heading) {
    parts.push(
      '',
      '<HEADING purpose="requested_angle">',
      heading,
      '</HEADING>',
    );
  }
  parts.push(
    '',
    '<TASK>',
    'Create the best realistic explainer-video plan from these facts.',
    'Return only the requested JSON.',
    '</TASK>',
  );
  return parts.join('\n');
}

// Whitespace/BOM-insensitive comparison text. The model reproduces a quote
// across a paragraph break or with collapsed spacing often enough that a raw
// substring test would reject correct quotes; every other character must match.
function normalizeForMatch(text: string): string {
  return stripBom(text).replace(/\s+/g, ' ').trim();
}

// A byte-order mark survives file reads and pasted text and would otherwise
// count as a character in every comparison below.
export function stripBom(text: string): string {
  return text.replace(/\uFEFF/g, '');
}

// A scene must point to a fact that exists. Reusing an important fact is valid:
// one idea may need more than one clip to explain well.
function ungroundedScenes(
  plan: z.infer<typeof PlanSchema>,
  factCount: number,
): number[] {
  const bad: number[] = [];
  for (const [index, scene] of plan.scenes.entries()) {
    if (scene.fact_index < 1 || scene.fact_index > factCount) {
      bad.push(index + 1);
    }
  }
  return bad;
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    const firstBrace = raw.indexOf('{');
    const lastBrace = raw.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      return JSON.parse(raw.slice(firstBrace, lastBrace + 1));
    }
    throw new Error('Response did not contain a valid JSON object.');
  }
}

// Step 1. A failure here IS a planner failure: without a fact list step 2 has
// nothing to choose from, and falling back to "plan straight from the note" is
// exactly the single-call shape this split exists to replace.
async function extractNoteFacts(note: string): Promise<string[]> {
  const raw = await chatComplete(
    [
      { role: 'system', content: buildFactsSystemPrompt() },
      {
        role: 'user',
        content: [
          '<NOTE purpose="only_authoritative_fact_source">',
          note.trim(),
          '</NOTE>',
        ].join('\n'),
      },
    ],
    { model: VIDEO_CHAT_MODEL, temperature: 0, responseFormat: 'json_object' },
  );
  const result = FactsSchema.safeParse(parseJson(raw));
  if (!result.success) {
    throw new Error(
      `Video note fact extraction did not match the expected schema:\n${result.error.message}\n---\n${raw}`,
    );
  }
  // Deduplicate on normalized text: a repeated fact would let two scenes rest
  // on the same information behind different indices.
  const seen = new Set<string>();
  const facts: string[] = [];
  for (const fact of result.data.facts) {
    const key = normalizeForMatch(fact);
    if (key.length === 0 || seen.has(key)) continue;
    seen.add(key);
    facts.push(fact.trim());
  }
  if (facts.length === 0) {
    throw new Error('Video note fact extraction returned no usable facts.');
  }
  return facts;
}

export async function planVideoScenes(
  note: string,
  options: VideoScenePlanOptions,
): Promise<VideoScenePlan> {
  const facts = await extractNoteFacts(note);
  const totalSeconds = VIDEO_TOTAL_SECONDS[options.durationBucket];
  const minimumScenesForTimeline = Math.ceil(
    totalSeconds / VIDEO_CLIP_MAX_SECONDS,
  );
  const systemPrompt = buildPlannerSystemPrompt(options.durationBucket);
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: buildPlannerUserContent(note, options.heading, facts),
    },
  ];

  const raw = await chatComplete(messages, {
    model: VIDEO_CHAT_MODEL,
    temperature: 0,
    responseFormat: 'json_object',
  });

  const validate = (candidate: string) => {
    const result = PlanSchema.safeParse(parseJson(candidate));
    if (!result.success) {
      throw new Error(
        `Video scene plan did not match the expected schema:\n${result.error.message}\n---\n${candidate}`,
      );
    }
    if (result.data.scenes.length < minimumScenesForTimeline) {
      throw new Error(
        `Video scene plan needs at least ${minimumScenesForTimeline} scenes to hold ${totalSeconds} seconds.`,
      );
    }
    return result.data;
  };

  let plan: z.infer<typeof PlanSchema>;
  try {
    plan = validate(raw);
  } catch (firstError) {
    const repairMessages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: [
          buildPlannerUserContent(note, options.heading, facts),
          '',
          '<INVALID_OUTPUT>',
          raw,
          '</INVALID_OUTPUT>',
          '',
          '<SCHEMA_ERROR>',
          (firstError as Error).message,
          '</SCHEMA_ERROR>',
          '',
          '<TASK>',
          'वरील INVALID_OUTPUT schema शी जुळत नाही.',
          'टिपणीतील तथ्ये न बदलता आणि नवीन तथ्य न जोडता ते दुरुस्त करा.',
          'फक्त अपेक्षित schema शी जुळणारा वैध JSON object परत करा.',
          '</TASK>',
        ].join('\n'),
      },
    ];
    const repaired = await chatComplete(repairMessages, {
      model: VIDEO_CHAT_MODEL,
      temperature: 0,
      responseFormat: 'json_object',
    });
    plan = validate(repaired);
  }

  // Drop a scene whose fact index points outside the extracted list. No repair
  // call is needed for this mechanical failure.
  const ungrounded = ungroundedScenes(plan, facts.length);
  if (ungrounded.length > 0) {
    const drop = new Set(ungrounded);
    const kept = plan.scenes.filter((_, index) => !drop.has(index + 1));
    console.warn(
      `[video-plan] dropping ${ungrounded.length} scene(s) whose voice or ` +
        `visual plan points at a missing fact (scenes ` +
        `${ungrounded.join(', ')}).`,
    );
    if (kept.length === 0) {
      throw new Error('Video scene plan had no scene resting on a real fact.');
    }
    plan = { scenes: kept };
  }

  if (plan.scenes.length < minimumScenesForTimeline) {
    throw new Error(
      `Video scene plan needs at least ${minimumScenesForTimeline} scenes to hold ${totalSeconds} seconds.`,
    );
  }
  const durations = plannedSceneDurations(plan.scenes.length, totalSeconds);

  return {
    scenes: plan.scenes.map((scene, index) => {
      const endVisualBrief = scene.end_visual_brief?.trim();
      const sourceQuote = facts[scene.fact_index - 1]!;
      return {
        beat: scene.beat,
        sourceQuote,
        visualSourceQuote: sourceQuote,
        visualBrief: scene.visual_brief,
        ...(endVisualBrief ? { endVisualBrief } : {}),
        shotHint: scene.shot_hint,
        durationSeconds: durations[index]!,
      };
    }),
  };
}

// Run directly to eyeball a plan without any video spend (needs OPENAI_API_KEY):
//
//   tsx --env-file=../../.env src/video/plan-video-scenes.ts --file=note.txt [short|long]
//   tsx --env-file=../../.env src/video/plan-video-scenes.ts "<टिपणी>" [short|long]
//
// PREFER --file for anything longer than one line: npx on Windows truncates a
// multi-line argument at the first newline, so `"$(cat note.txt)"` silently
// plans from the headline alone and every scene looks thin for no visible
// reason. Nothing warns you — the run just quietly gets a different note.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const first = process.argv[2];
  const note = first?.startsWith('--file=')
    ? stripBom(readFileSync(first.slice('--file='.length), 'utf8'))
    : first;
  const bucket = (process.argv[3] ?? 'short') as VideoDurationBucket;
  if (!note) {
    console.error(
      'Usage: tsx --env-file=../../.env src/video/plan-video-scenes.ts (--file=note.txt | "<टिपणी>") [short|long]',
    );
    process.exit(1);
  }
  planVideoScenes(note, { durationBucket: bucket })
    .then((plan) => {
      console.log(JSON.stringify(plan, null, 2));
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
