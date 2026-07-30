// One creative directing pass after narration has been measured. It turns the
// planner's broad visual idea into (a) the exact opening moment the storyboard
// should show and (b) a chronological performance for the clip model.

import { z } from 'zod';
import {
  chatComplete,
  VIDEO_CHAT_MODEL,
  type ChatMessage,
} from '../generation/openai-chat.js';

const DirectedSceneSchema = z.object({
  // All three UNCAPPED, matching RegenerateStillRequestSchema: no provider on
  // this path imposes a limit of our own making (the frame models take far
  // more, and Kling's 3072-char prompt cap is absorbed by fitClipPrompt, which
  // sheds the briefs before the protected setting/no-talking/no-text rules). A
  // long brief must not fail the parse and burn a repair round — it degrades at
  // render time instead.
  opening_visual_brief: z.string().trim().min(1),
  motion_brief: z.string().trim().min(1),
  camera_direction: z.string().trim().min(1),
});

function resultSchemaFor(sceneCount: number) {
  return z.object({
    scenes: z.array(DirectedSceneSchema).length(sceneCount),
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

export type VideoMotionSceneInput = Readonly<{
  narration: string;
  beat?: string | undefined;
  visualBrief: string;
  endVisualBrief?: string | undefined;
  shotHint?: string | undefined;
  durationSeconds: number;
}>;

export type VideoMotionDirection = Readonly<{
  openingVisualBrief: string;
  motionBrief: string;
  shotHint: string;
}>;

export type DirectVideoMotionInput = Readonly<{
  title?: string | null | undefined;
  style?: string | null | undefined;
  scenes: readonly VideoMotionSceneInput[];
}>;

function systemPrompt(): string {
  return [
    'You are an exceptionally imaginative live-action film director.',
    'Turn every supplied scene into vivid, expressive and highly specific screen direction that makes the shot feel alive for its exact duration.',
    'Describe the complete visible performance in chronological order: changing facial expressions, eye focus, posture, gestures, hands and objects, environmental life, and purposeful camera choreography.',
    'Create a true opening moment before the action begins, so the video model has somewhere to go.',
    'Be bold, cinematic and emotionally observant. Use your own creative judgement; there are no house-style rules or stock action templates.',
    'Return only JSON in this shape:',
    '{ "scenes": [ { "opening_visual_brief": "...", "motion_brief": "...", "camera_direction": "..." } ] }',
  ].join('\n');
}

function userContent(input: DirectVideoMotionInput): string {
  return JSON.stringify(
    {
      title: input.title ?? undefined,
      visual_style: input.style ?? undefined,
      scenes: input.scenes.map((scene, index) => ({
        scene: index + 1,
        duration_seconds: scene.durationSeconds,
        narration: scene.narration,
        beat: scene.beat,
        visual_goal: scene.visualBrief,
        planned_final_frame: scene.endVisualBrief,
        existing_camera_idea: scene.shotHint,
      })),
    },
    null,
    2,
  );
}

export async function directVideoMotion(
  input: DirectVideoMotionInput,
): Promise<readonly VideoMotionDirection[]> {
  if (input.scenes.length === 0) return [];

  const schema = resultSchemaFor(input.scenes.length);
  const system = systemPrompt();
  const user = userContent(input);
  const messages: ChatMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
  const raw = await chatComplete(messages, {
    model: VIDEO_CHAT_MODEL,
    temperature: 0.9,
    responseFormat: 'json_object',
  });

  const validate = (candidate: string) => {
    const result = schema.safeParse(parseJson(candidate));
    if (!result.success) {
      throw new Error(
        `Video motion direction did not match the expected schema:\n${result.error.message}\n---\n${candidate}`,
      );
    }
    return result.data;
  };

  let result: z.infer<typeof schema>;
  try {
    result = validate(raw);
  } catch (firstError) {
    const repaired = await chatComplete(
      [
        ...messages,
        { role: 'assistant', content: raw },
        {
          role: 'user',
          content: [
            'Return the same creative direction as valid JSON matching the requested shape.',
            `Validation error: ${(firstError as Error).message}`,
          ].join('\n'),
        },
      ],
      {
        model: VIDEO_CHAT_MODEL,
        temperature: 0,
        responseFormat: 'json_object',
      },
    );
    result = validate(repaired);
  }

  return result.scenes.map((scene) => ({
    openingVisualBrief: scene.opening_visual_brief,
    motionBrief: scene.motion_brief,
    shotHint: scene.camera_direction,
  }));
}
