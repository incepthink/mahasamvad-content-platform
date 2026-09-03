// The note lane deliberately uses two minimal model instructions:
//   1. make a script from the provided text;
//   2. make a storyboard from the generated script (planReadyVideoScript).
// Output structure is enforced through structured output, outside the
// natural-language prompt; narration length has no whole-video ceiling.

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { VIDEO_KEY_POINT_MAX_CHARS } from '@dgipr/schemas';
import {
  chatComplete,
  VIDEO_CHAT_MODEL,
  type AnyChatMessage,
} from '../generation/openai-chat.js';
import { planReadyVideoScript } from './plan-ready-video-script.js';
import { NOTE_VIDEO_TASK, withPromptImages } from './script-brief.js';
import { keyPointOf } from './video-key-point.js';

export { keyPointIsGrounded, keyPointOf } from './video-key-point.js';

export type VideoScriptScene = Readonly<{
  narration: string;
  visualBrief: string;
  endVisualBrief?: string;
  keyPoint: string;
  beat: string;
  sceneLabel: string;
  shotHint: string;
  plannedDurationSeconds: number;
}>;

export type GeneratedVideoScript = Readonly<{
  title: string;
  style: string;
  scenes: readonly VideoScriptScene[];
  referenceTitle: string | null;
  referenceUrl: string | null;
}>;

export type VideoScriptOptions = Readonly<{
  aiPrompt?: string | undefined;
  promptImageUrls?: readonly string[] | undefined;
}>;

const ScriptSchema = z.object({
  // Deliberately no total-duration-derived ceiling. The storyboard pass
  // divides the generated narration into as many five-second scenes as needed.
  script: z.string().trim().min(1),
});

function scriptJsonSchema(): unknown {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['script'],
    properties: {
      script: { type: 'string', minLength: 1 },
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

function inputContent(note: string, aiPrompt?: string): string {
  const prompt = aiPrompt?.trim();
  if (!prompt) return note.trim();
  return JSON.stringify({ text: note.trim(), prompt }, null, 2);
}

export async function generateVideoScript(
  note: string,
  options: VideoScriptOptions,
): Promise<GeneratedVideoScript> {
  const imageUrls = options.promptImageUrls ?? [];
  const messages: AnyChatMessage[] = withPromptImages(
    [
      { role: 'system', content: NOTE_VIDEO_TASK },
      { role: 'user', content: inputContent(note, options.aiPrompt) },
    ],
    imageUrls,
  );
  const raw = await chatComplete(messages, {
    model: VIDEO_CHAT_MODEL,
    temperature: 0.4,
    jsonSchema: {
      name: 'video_script',
      schema: scriptJsonSchema(),
    },
  });
  const generated = ScriptSchema.safeParse(parseJson(raw));
  if (!generated.success) {
    throw new Error(
      `Video script did not match the expected output shape:\n${generated.error.message}`,
    );
  }

  return planReadyVideoScript(generated.data.script, {
    ...(options.aiPrompt !== undefined ? { aiPrompt: options.aiPrompt } : {}),
    ...(options.promptImageUrls !== undefined
      ? { promptImageUrls: options.promptImageUrls }
      : {}),
  });
}

function stripBom(text: string): string {
  return text.replace(/\uFEFF/g, '');
}

// Free checks for the deterministic on-screen key-point guard:
//   tsx src/video/generate-video-script.ts --check
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href &&
  process.argv.includes('--check')
) {
  const note =
    'राज्यातील ४ महापालिका रुग्णालयांत एमआरआय सेवा सुरू. ' +
    'शेतकऱ्यांना २ लाखांपर्यंत कर्जमाफी. अर्जाची मुदत ३१ ऑगस्ट २०२६.';
  const failures: string[] = [];
  const check = (label: string, ok: boolean): void => {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
    if (!ok) failures.push(label);
  };

  check('empty key point stays empty', keyPointOf('', note) === '');
  check('undefined key point stays empty', keyPointOf(undefined, note) === '');
  check(
    'digit-free key point is kept',
    keyPointOf('मोफत एमआरआय सेवा', note) === 'मोफत एमआरआय सेवा',
  );
  check(
    'key point whose numbers are in the note is kept',
    keyPointOf('२ लाखांपर्यंत कर्जमाफी', note) === '२ लाखांपर्यंत कर्जमाफी',
  );
  check(
    'Latin digits are accepted against Devanagari in the note',
    keyPointOf('मुदत: 31 ऑगस्ट', note) === 'मुदत: 31 ऑगस्ट',
  );
  check(
    'an invented number is dropped',
    keyPointOf('७ लाखांपर्यंत कर्जमाफी', note) === '',
  );
  check(
    'one bad number among good ones drops the whole line',
    keyPointOf('४ रुग्णालये, ९ जिल्हे', note) === '',
  );
  check(
    'whitespace is trimmed',
    keyPointOf('  मोफत सेवा  ', note) === 'मोफत सेवा',
  );
  check(
    'a key point at the budget is kept',
    keyPointOf('क'.repeat(VIDEO_KEY_POINT_MAX_CHARS), note) ===
      'क'.repeat(VIDEO_KEY_POINT_MAX_CHARS),
  );
  check(
    'a key point one character over the budget is dropped',
    keyPointOf('क'.repeat(VIDEO_KEY_POINT_MAX_CHARS + 1), note) === '',
  );
  check(
    'an accepted key point is returned byte-for-byte',
    keyPointOf('४ महापालिका रुग्णालये', note) === '४ महापालिका रुग्णालये',
  );

  console.log(
    failures.length === 0
      ? '\nAll key-point checks passed.'
      : `\n${failures.length} check(s) FAILED.`,
  );
  process.exitCode = failures.length === 0 ? 0 : 1;
} else if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const first = process.argv[2];
  const note = first?.startsWith('--file=')
    ? stripBom(readFileSync(first.slice('--file='.length), 'utf8'))
    : first;
  if (!note) {
    console.error(
      'Usage: tsx --env-file=../../.env src/video/generate-video-script.ts (--file=note.txt | "<टिपणी>")',
    );
    process.exit(1);
  }
  generateVideoScript(note, {})
    .then((script) => {
      console.log(JSON.stringify(script, null, 2));
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
