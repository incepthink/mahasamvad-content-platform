// Turns already-final Marathi voiceover into a visual plan without ever asking
// a model to rewrite the narration. Scene boundaries are deterministic word
// boundaries; the model supplies only title/style/visual metadata.

import { z } from 'zod';
import {
  VIDEO_CLIP_MAX_SECONDS,
  VIDEO_KEY_POINT_MAX_CHARS,
  VIDEO_NARRATION_MAX_CHARS,
  VIDEO_SCENE_LIMIT,
  VIDEO_SCRIPT_MAX_SECONDS,
  VIDEO_STYLE_MAX_CHARS,
  allocateVideoSceneDurations,
  estimateNarrationSeconds,
  normalizeVideoNarrationScript,
} from '@dgipr/schemas';
import {
  chatComplete,
  VIDEO_CHAT_MODEL,
  type ChatMessage,
} from '../generation/openai-chat.js';
import {
  keyPointOf,
  type GeneratedVideoScript,
} from './generate-video-script.js';

const VisualSceneSchema = z.object({
  beat: z.string().trim().min(1).max(240),
  visual_brief: z.string().trim().min(1),
  end_visual_brief: z.string().trim().optional(),
  shot_hint: z.string().trim().min(1).max(160),
  // Uncapped on purpose — an over-long overlay line costs that scene its
  // overlay inside keyPointOf, never the whole plan. The narration is already
  // final here, so failing the parse would throw away a paid call over a
  // decoration.
  key_point: z.string().trim().optional(),
});

function visualPlanSchema(sceneCount: number) {
  return z.object({
    title: z.string().trim().min(1).max(200),
    style: z.string().trim().min(1).max(VIDEO_STYLE_MAX_CHARS),
    scenes: z.array(VisualSceneSchema).length(sceneCount),
  });
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

function segmentLength(words: readonly string[], start: number, end: number) {
  let length = Math.max(0, end - start - 1);
  for (let index = start; index < end; index++) {
    length += words[index]!.length;
  }
  return length;
}

function endsSentence(word: string): boolean {
  return /[.!?।॥]["'’”)]*$/.test(word);
}

// Balanced contiguous partition with a preference for sentence endings. The
// returned chunks rejoin byte-for-byte to the whitespace-normalized script.
export function splitReadyVideoScript(script: string): string[] {
  const normalized = normalizeVideoNarrationScript(script);
  const estimatedSeconds = estimateNarrationSeconds(normalized);
  if (estimatedSeconds > VIDEO_SCRIPT_MAX_SECONDS) {
    throw new Error('Ready narration exceeds the two-minute video limit.');
  }

  const requestedScenes = Math.max(
    1,
    Math.ceil(estimatedSeconds / VIDEO_CLIP_MAX_SECONDS),
  );
  const words = normalized.split(' ');
  if (words.some((word) => word.length > VIDEO_NARRATION_MAX_CHARS)) {
    throw new Error(
      `Ready narration contains a word longer than ${VIDEO_NARRATION_MAX_CHARS} characters.`,
    );
  }
  const sceneCount = Math.min(
    VIDEO_SCENE_LIMIT.max,
    requestedScenes,
    words.length,
  );
  const target = normalized.length / sceneCount;
  const infinity = Number.POSITIVE_INFINITY;
  const costs = Array.from({ length: sceneCount + 1 }, () =>
    Array<number>(words.length + 1).fill(infinity),
  );
  const previous = Array.from({ length: sceneCount + 1 }, () =>
    Array<number>(words.length + 1).fill(-1),
  );
  costs[0]![0] = 0;

  for (let parts = 1; parts <= sceneCount; parts++) {
    const minimumEnd = parts;
    const maximumEnd = words.length - (sceneCount - parts);
    for (let end = minimumEnd; end <= maximumEnd; end++) {
      for (let start = parts - 1; start < end; start++) {
        const prior = costs[parts - 1]![start]!;
        if (!Number.isFinite(prior)) continue;
        const length = segmentLength(words, start, end);
        if (length > VIDEO_NARRATION_MAX_CHARS) continue;
        const distance = length - target;
        const sentenceReward =
          parts < sceneCount && endsSentence(words[end - 1]!)
            ? target * target * 0.2
            : 0;
        const cost = prior + distance * distance - sentenceReward;
        if (cost < costs[parts]![end]!) {
          costs[parts]![end] = cost;
          previous[parts]![end] = start;
        }
      }
    }
  }

  if (!Number.isFinite(costs[sceneCount]![words.length]!)) {
    throw new Error(
      'Ready narration could not be divided into eight provider-sized scenes.',
    );
  }

  const chunks: string[] = [];
  let end = words.length;
  for (let parts = sceneCount; parts > 0; parts--) {
    const start = previous[parts]![end]!;
    chunks.unshift(words.slice(start, end).join(' '));
    end = start;
  }
  if (chunks.join(' ') !== normalized) {
    throw new Error(
      'Ready narration changed while it was divided into scenes.',
    );
  }
  return chunks;
}

function systemPrompt(sceneCount: number): string {
  return [
    'Plan visuals for an already-final Marathi government explainer voiceover.',
    'The supplied scene narrations are authoritative and immutable. Do not return, rewrite, correct, shorten, translate, or paraphrase narration.',
    `Return visual metadata for exactly ${sceneCount} scenes, in the supplied order.`,
    'Each visual_brief must describe one realistic live-action shot in Maharashtra, India.',
    'Write beat and key_point in Marathi. Write visual_brief, end_visual_brief, shot_hint and style in English.',
    'Usually leave end_visual_brief empty; use it only when the shot needs a precise final state.',
    `key_point is optional, must be directly supported by that scene narration, and must be at most ${VIDEO_KEY_POINT_MAX_CHARS} characters. Leave it empty rather than exceeding that.`,
    'style is one consistent English live-action look shared by every scene.',
    'Return only JSON:',
    '{ "title": "...", "style": "...", "scenes": [ { "beat": "...", "visual_brief": "...", "end_visual_brief": "", "shot_hint": "...", "key_point": "" } ] }',
  ].join('\n');
}

function userContent(
  chunks: readonly string[],
  heading: string | undefined,
): string {
  const lines = chunks.map(
    (narration, index) =>
      `<SCENE number="${index + 1}">\n${narration}\n</SCENE>`,
  );
  return [
    ...(heading
      ? ['<HEADING purpose="requested_title">', heading, '</HEADING>', '']
      : []),
    '<FINAL_NARRATION purpose="visual_planning_only">',
    ...lines,
    '</FINAL_NARRATION>',
    '',
    '<TASK>',
    'Return visual metadata only. Never include narration in the response.',
    '</TASK>',
  ].join('\n');
}

export async function planReadyVideoScript(
  script: string,
  options: Readonly<{ heading?: string | undefined }> = {},
): Promise<GeneratedVideoScript> {
  const normalized = normalizeVideoNarrationScript(script);
  const chunks = splitReadyVideoScript(normalized);
  const schema = visualPlanSchema(chunks.length);
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt(chunks.length) },
    { role: 'user', content: userContent(chunks, options.heading) },
  ];
  const raw = await chatComplete(messages, {
    model: VIDEO_CHAT_MODEL,
    temperature: 0.3,
    responseFormat: 'json_object',
  });
  const result = schema.safeParse(parseJson(raw));
  if (!result.success) {
    throw new Error(
      `Ready-script visual plan did not match the expected schema:\n${result.error.message}`,
    );
  }

  const plannedDurations = allocateVideoSceneDurations(
    chunks.map((chunk) => Math.max(1, estimateNarrationSeconds(chunk))),
    Math.ceil(estimateNarrationSeconds(normalized)),
  );
  return {
    title: options.heading ?? result.data.title,
    style: result.data.style,
    scenes: chunks.map((narration, index) => {
      const visual = result.data.scenes[index]!;
      const endVisualBrief = visual.end_visual_brief?.trim();
      return {
        narration,
        visualBrief: visual.visual_brief,
        ...(endVisualBrief ? { endVisualBrief } : {}),
        keyPoint: keyPointOf(visual.key_point, narration),
        beat: visual.beat,
        shotHint: visual.shot_hint,
        plannedDurationSeconds: plannedDurations[index]!,
      };
    }),
    referenceTitle: null,
    referenceUrl: null,
  };
}
