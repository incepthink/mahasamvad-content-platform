// Turns already-final Marathi voiceover into a visual plan without ever asking
// a model to rewrite the narration. Scene boundaries are deterministic word
// boundaries; the model supplies only title/style/visual metadata.

import { z } from 'zod';
import {
  VIDEO_KEY_POINT_MAX_CHARS,
  VIDEO_NARRATION_MAX_CHARS,
  VIDEO_SCENE_LABEL_MAX_CHARS,
  VIDEO_SCENE_MAX_SECONDS,
  VIDEO_STYLE_MAX_CHARS,
  allocateVideoSceneDurations,
  estimateNarrationSeconds,
  normalizeVideoNarrationScript,
} from '@dgipr/schemas';
import {
  chatComplete,
  VIDEO_CHAT_MODEL,
  type AnyChatMessage,
} from '../generation/openai-chat.js';
import { type GeneratedVideoScript } from './generate-video-script.js';
import { keyPointOf } from './video-key-point.js';
import { READY_SCRIPT_VIDEO_TASK, withPromptImages } from './script-brief.js';

const VisualSceneSchema = z.object({
  beat: z.string().trim().min(1).max(240),
  // The card's own storyboard title. Optional so a model that omits it costs
  // this scene its subtitle rather than costing the whole plan — every other
  // field here is load-bearing.
  scene_label: z.string().trim().max(VIDEO_SCENE_LABEL_MAX_CHARS).optional(),
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

// The application contract is carried by Structured Outputs instead of prompt
// prose. This keeps the natural-language instruction exactly as requested while
// still giving the review UI a dependable object to render.
function visualPlanJsonSchema(sceneCount: number): unknown {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['title', 'style', 'scenes'],
    properties: {
      title: { type: 'string', minLength: 1, maxLength: 200 },
      style: {
        type: 'string',
        minLength: 1,
        maxLength: VIDEO_STYLE_MAX_CHARS,
      },
      scenes: {
        type: 'array',
        minItems: sceneCount,
        maxItems: sceneCount,
        items: {
          type: 'object',
          additionalProperties: false,
          required: [
            'scene_label',
            'beat',
            'visual_brief',
            'end_visual_brief',
            'shot_hint',
            'key_point',
          ],
          properties: {
            scene_label: {
              type: 'string',
              maxLength: VIDEO_SCENE_LABEL_MAX_CHARS,
            },
            beat: { type: 'string', minLength: 1, maxLength: 240 },
            visual_brief: { type: 'string', minLength: 1 },
            end_visual_brief: { type: 'string' },
            shot_hint: { type: 'string', minLength: 1, maxLength: 160 },
            key_point: {
              type: 'string',
              maxLength: VIDEO_KEY_POINT_MAX_CHARS,
            },
          },
        },
      },
    },
  };
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

// How long the supplied script ACTUALLY speaks, and therefore how many clips it
// needs. `measuredSeconds` is the duration of a real synthesized WAV of this
// exact text in the configured voice; the char-rate estimate is only the
// fallback for a deployment with no TTS key (which renders silent anyway).
//
// This distinction is the whole point of the parameter. DEFAULT_NARRATION_CHARS_
// PER_SECOND is one number for every voice, and the voices genuinely differ —
// bulbul reads this Marathi at ~16.5 chars/s where ElevenLabs v3 reads it at
// ~10.9. On the ready-script lane the words may never be trimmed or sped up, so
// a rate 50% too fast plans too few clips and the narrate gate then REFUSES a
// project the officer has already approved. Measuring first removes the guess.
function scriptSeconds(normalized: string, measuredSeconds?: number): number {
  return measuredSeconds !== undefined && measuredSeconds > 0
    ? measuredSeconds
    : estimateNarrationSeconds(normalized);
}

// Chars a single clip's worth of speech can hold, at the rate this very script
// was measured at. Falls back to the configured rate's ceiling when nothing was
// measured. Bounding the DP by this rather than by VIDEO_NARRATION_MAX_CHARS is
// what keeps the per-scene cap honest for a slow voice.
function maxSceneChars(normalized: string, seconds: number): number {
  if (seconds <= 0) return VIDEO_NARRATION_MAX_CHARS;
  const charsPerSecond = normalized.length / seconds;
  return Math.max(1, Math.floor(VIDEO_SCENE_MAX_SECONDS * charsPerSecond));
}

// Prefix sums over "this word plus one joining space", so the length of any
// word range is O(1). It used to be an inner loop, which made the partition
// below O(scenes x words^3) — invisible while a script could not exceed two
// minutes (~330 words), and the reason a ten-minute one would have hung the
// job rather than merely costing more.
function lengthPrefix(words: readonly string[]): number[] {
  const prefix = new Array<number>(words.length + 1).fill(0);
  for (const [index, word] of words.entries()) {
    prefix[index + 1] = prefix[index]! + word.length + 1;
  }
  return prefix;
}

// Chars in `words[start..end)` joined by single spaces.
function segmentLength(prefix: readonly number[], start: number, end: number) {
  return end > start ? prefix[end]! - prefix[start]! - 1 : 0;
}

function endsSentence(word: string): boolean {
  return /[.!?।॥]["'’”)]*$/.test(word);
}

// Balanced contiguous partition into exactly `sceneCount` chunks of at most
// `sceneCharCap` characters, preferring sentence endings. Returns null when no
// such partition exists — the caller answers that by allowing one more scene,
// which is why this reports rather than throws.
function partitionWords(
  words: readonly string[],
  sceneCount: number,
  sceneCharCap: number,
): string[] | null {
  const prefix = lengthPrefix(words);
  const target = segmentLength(prefix, 0, words.length) / sceneCount;
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
      // Walk BACKWARDS from the nearest split and stop at the char cap: a
      // segment only grows as `start` moves left, so everything beyond the
      // first over-long one is over-long too. That bound is what keeps a long
      // script's partition cheap.
      for (let start = end - 1; start >= parts - 1; start--) {
        const length = segmentLength(prefix, start, end);
        if (length > sceneCharCap) break;
        const prior = costs[parts - 1]![start]!;
        if (!Number.isFinite(prior)) continue;
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

  if (!Number.isFinite(costs[sceneCount]![words.length]!)) return null;

  const chunks: string[] = [];
  let end = words.length;
  for (let parts = sceneCount; parts > 0; parts--) {
    const start = previous[parts]![end]!;
    chunks.unshift(words.slice(start, end).join(' '));
    end = start;
  }
  return chunks;
}

// Balanced contiguous partition with a preference for sentence endings. The
// returned chunks rejoin byte-for-byte to the whitespace-normalized script.
export function splitReadyVideoScript(
  script: string,
  measuredSeconds?: number,
): string[] {
  const normalized = normalizeVideoNarrationScript(script);
  const seconds = scriptSeconds(normalized, measuredSeconds);

  // How many five-second clips this narration needs, with no ceiling on the
  // number of scenes. The spend decision stays at gate 2, where the estimate
  // is priced from exactly this count.
  const requestedScenes = Math.max(
    1,
    Math.ceil(seconds / VIDEO_SCENE_MAX_SECONDS),
  );
  const sceneCharCap = maxSceneChars(normalized, seconds);
  const words = normalized.split(' ');
  if (words.some((word) => word.length > sceneCharCap)) {
    throw new Error(
      `Ready narration contains a word longer than ${sceneCharCap} characters.`,
    );
  }

  // The derived count is a FLOOR, not the answer. ceil(seconds / 5) leaves as
  // little as a fraction of a second of slack across the whole script, and the
  // split can only cut between words — so a script whose speech lands just past
  // a multiple of 5 has no legal partition at that count and simply needs one
  // more scene. (Latent before this change too, and it aborted the project.)
  // An extra scene costs nothing but a shorter clip: the windows are allocated
  // from the same measured total.
  for (
    let sceneCount = Math.min(requestedScenes, words.length);
    sceneCount <= words.length;
    sceneCount++
  ) {
    const chunks = partitionWords(words, sceneCount, sceneCharCap);
    if (!chunks) continue;
    if (chunks.join(' ') !== normalized) {
      throw new Error(
        'Ready narration changed while it was divided into scenes.',
      );
    }
    return chunks;
  }
  throw new Error(
    `Ready narration could not be divided into scenes of at most ${sceneCharCap} characters.`,
  );
}

function systemPrompt(): string {
  return READY_SCRIPT_VIDEO_TASK;
}

function userContent(
  chunks: readonly string[],
  options: DescribeVideoScenesOptions,
): string {
  const prompt = options.aiPrompt?.trim();
  return JSON.stringify(
    {
      script: chunks,
      ...(prompt ? { prompt } : {}),
    },
    null,
    2,
  );
}

// One scene's visual metadata — everything the pipeline derives FROM a
// narration rather than reading out of it.
// The officer's direction for the project, and the reference pictures they
// attached to it. Both reach this call AND gate 1's re-plan, which is why they
// are read off the ROW rather than passed once at create time.
export interface DescribeVideoScenesOptions {
  aiPrompt?: string | undefined;
  promptImageUrls?: readonly string[] | undefined;
}

export interface DescribedVideoScene {
  visualBrief: string;
  // Short English storyboard title. Empty when the model returned none.
  sceneLabel: string;
  endVisualBrief?: string | undefined;
  keyPoint: string;
  beat: string;
  shotHint: string;
}

export interface DescribedVideoScenes {
  title: string;
  style: string;
  scenes: DescribedVideoScene[];
}

// The AI half of the ready-script plan, with the split taken as GIVEN.
//
// Split out from `planReadyVideoScript` (2026-08-14) because the two halves
// have different owners once a project exists: the boundaries become the
// officer's, edited card by card at gate 1, while the visuals stay the
// pipeline's to (re)derive. `planReadyVideoScript` still owns both at create
// time; the gate-1 re-plan supplies the officer's own chunks and calls only
// this.
//
// The narration is passed for CONTEXT and for the key-point digit guard, and is
// never returned — the prompt says so twice, and every field this produces is
// derived rather than transcribed.
export async function describeVideoScenes(
  chunks: readonly string[],
  options: Readonly<DescribeVideoScenesOptions> = {},
): Promise<DescribedVideoScenes> {
  if (chunks.length === 0) {
    throw new Error('Cannot plan visuals for an empty scene list.');
  }
  const schema = visualPlanSchema(chunks.length);
  const messages: AnyChatMessage[] = withPromptImages(
    [
      { role: 'system', content: systemPrompt() },
      { role: 'user', content: userContent(chunks, options) },
    ],
    options.promptImageUrls ?? [],
  );
  const raw = await chatComplete(messages, {
    model: VIDEO_CHAT_MODEL,
    temperature: 0.3,
    jsonSchema: {
      name: 'video_storyboard',
      schema: visualPlanJsonSchema(chunks.length),
    },
    // Room for the ANSWER, and it grows with the script: the plan carries a
    // beat, two briefs, a shot hint and an overlay line PER SCENE, so the
    // 4096 default silently truncated the JSON once a script needed more than
    // ~10 scenes — and a truncated plan fails the parse AFTER the call is
    // billed. Billing is on tokens emitted, so an unused ceiling is free.
    maxTokens: Math.max(4096, 600 + chunks.length * 450),
  });
  const result = schema.safeParse(parseJson(raw));
  if (!result.success) {
    throw new Error(
      `Ready-script visual plan did not match the expected schema:\n${result.error.message}`,
    );
  }
  return {
    title: result.data.title,
    style: result.data.style,
    scenes: chunks.map((narration, index) => {
      const visual = result.data.scenes[index]!;
      const endVisualBrief = visual.end_visual_brief?.trim();
      return {
        visualBrief: visual.visual_brief,
        sceneLabel: visual.scene_label?.trim() ?? '',
        ...(endVisualBrief ? { endVisualBrief } : {}),
        keyPoint: keyPointOf(visual.key_point, narration),
        beat: visual.beat,
        shotHint: visual.shot_hint,
      };
    }),
  };
}

export async function planReadyVideoScript(
  script: string,
  options: Readonly<
    DescribeVideoScenesOptions & {
      // Duration of a real synthesized WAV of this exact script in the
      // configured voice. Supply it whenever TTS is available: it decides the
      // scene count, the per-scene char cap and the clip windows, none of which
      // a fixed chars-per-second constant can get right across two TTS
      // providers.
      measuredSeconds?: number | undefined;
      // The project's title when the officer named one. Legacy rows only — the
      // create form's शीर्षक field was replaced by the AI prompt — so it is
      // normally absent and the model's own title stands.
      title?: string | undefined;
    }
  > = {},
): Promise<GeneratedVideoScript> {
  const normalized = normalizeVideoNarrationScript(script);
  const chunks = splitReadyVideoScript(normalized, options.measuredSeconds);
  const described = await describeVideoScenes(chunks, {
    ...(options.aiPrompt !== undefined ? { aiPrompt: options.aiPrompt } : {}),
    ...(options.promptImageUrls !== undefined
      ? { promptImageUrls: options.promptImageUrls }
      : {}),
  });

  // Weights stay char-derived (they are relative, so the rate cancels out), but
  // the TOTAL is the measured one when we have it — that is what the clip
  // windows have to cover.
  const plannedDurations = allocateVideoSceneDurations(
    chunks.map((chunk) => Math.max(1, estimateNarrationSeconds(chunk))),
    Math.ceil(scriptSeconds(normalized, options.measuredSeconds)),
  );
  return {
    title: options.title ?? described.title,
    style: described.style,
    scenes: chunks.map((narration, index) => {
      const visual = described.scenes[index]!;
      return {
        narration,
        visualBrief: visual.visualBrief,
        ...(visual.endVisualBrief !== undefined
          ? { endVisualBrief: visual.endVisualBrief }
          : {}),
        keyPoint: visual.keyPoint,
        beat: visual.beat,
        sceneLabel: visual.sceneLabel,
        shotHint: visual.shotHint,
        plannedDurationSeconds: plannedDurations[index]!,
      };
    }),
    referenceTitle: null,
    referenceUrl: null,
  };
}
