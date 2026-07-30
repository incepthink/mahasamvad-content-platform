// Writes the Marathi narration, optional on-screen key points and one shared
// live-action style for the planner's scene sequence. Clip durations are
// derived later from measured narration audio.

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import {
  estimateNarrationSeconds,
  VIDEO_CLIP_MAX_SECONDS,
  VIDEO_KEY_POINT_MAX_CHARS,
  VIDEO_NARRATION_MAX_CHARS,
  VIDEO_STYLE_MAX_CHARS,
  VIDEO_TOTAL_FIT_TOLERANCE,
  VIDEO_TOTAL_SECONDS,
  videoNarrationBudgetWords,
  type VideoDurationBucket,
} from '@dgipr/schemas';
import {
  chatComplete,
  VIDEO_CHAT_MODEL,
  type ChatMessage,
} from '../generation/openai-chat.js';
import { retrieveReferenceArticle } from '../retrieval/retrieve-references.js';
import {
  planVideoScenes,
  stripBom,
  type VideoScenePlan,
} from './plan-video-scenes.js';

const SceneSchema = z.object({
  narration: z.string().trim().min(1).max(VIDEO_NARRATION_MAX_CHARS),
  // The on-screen line. Optional AND allowed to be empty: a scene with no hard
  // number or name in it should say so rather than invent something to display,
  // and an old draft has no such field at all.
  key_point: z.string().trim().max(VIDEO_KEY_POINT_MAX_CHARS).optional(),
});

function scriptSchemaFor(sceneCount: number) {
  return z.object({
    title: z.string().trim().min(1).max(200),
    style: z.string().trim().min(1).max(VIDEO_STYLE_MAX_CHARS),
    scenes: z.array(SceneSchema).length(sceneCount),
  });
}

// A key point is BURNED onto the finished video, where a wrong number is worse
// than no number at all — nobody re-reads a caption against the note. So the
// model only proposes it and a deterministic check decides, exactly as
// lock-scheme-names.ts and proof-read.ts do: every digit run it contains must
// occur in the note. Devanagari and Latin digits are compared in one script so
// "31 ऑगस्ट" is accepted against a note that wrote ३१, which is a re-scripting,
// not a different number.
//
// Failure DROPS the key point (that scene loses its overlay) rather than
// failing the run — the shorten-narration.ts rule: a best-effort step must not
// become a gate.
const DEVANAGARI_ZERO = 0x0966;

function toLatinDigits(text: string): string {
  return text.replace(/[०-९]/g, (digit) =>
    String(digit.codePointAt(0)! - DEVANAGARI_ZERO),
  );
}

// The scene's key point as it will be stored: trimmed, or empty when the model
// omitted it or proposed a number the note does not support.
export function keyPointOf(raw: string | undefined, note: string): string {
  const keyPoint = (raw ?? '').trim();
  if (keyPoint === '') return '';
  if (keyPointIsGrounded(keyPoint, note)) return keyPoint;
  console.warn(
    `[video-script] dropping on-screen key point "${keyPoint}" — it carries a ` +
      'number that is not in the note. That scene will render without an overlay.',
  );
  return '';
}

export function keyPointIsGrounded(keyPoint: string, note: string): boolean {
  const numbers = toLatinDigits(keyPoint).match(/\d+/g);
  if (!numbers) return true;
  const haystack = toLatinDigits(note);
  return numbers.every((number) => haystack.includes(number));
}

export type VideoScriptScene = Readonly<{
  narration: string;
  visualBrief: string;
  endVisualBrief?: string;
  // Short Marathi line for the burned-in overlay. Empty when the model had no
  // hard detail to show, or when the digit check rejected what it proposed.
  keyPoint: string;
  // Carried through from the plan so the runner can persist them per scene.
  beat: string;
  shotHint: string;
  plannedDurationSeconds: number;
}>;

export type GeneratedVideoScript = Readonly<{
  title: string;
  // One English style paragraph for the whole project, embedded verbatim in
  // every keyframe/motion prompt — the cross-scene consistency mechanism.
  style: string;
  scenes: readonly VideoScriptScene[];
  referenceTitle: string | null;
  referenceUrl: string | null;
}>;

export type VideoScriptOptions = Readonly<{
  durationBucket: VideoDurationBucket;
  heading?: string | undefined;
}>;

function buildSystemPrompt(
  sceneCount: number,
  bucket: VideoDurationBucket,
): string {
  const totalSeconds = VIDEO_TOTAL_SECONDS[bucket];
  const totalWords = videoNarrationBudgetWords(bucket);
  return [
    'Write the best clear and engaging Marathi voiceover for a realistic Government of Maharashtra explainer video.',
    'The NOTE is the factual source. Follow the supplied PLAN and make the complete narration flow naturally.',
    'Compose ONE continuous voiceover for the complete video first; only then divide that same narration among the scene entries.',
    'Scene boundaries are visual cuts, not pauses, paragraphs, or separate mini-scripts. A sentence may continue into the next scene.',
    'When every scene narration is joined with a single space, it must read and sound like one uninterrupted passage.',
    'Carry ideas naturally across visual changes. Do not restart, reintroduce the subject, summarize, or conclude at every scene boundary.',
    'Use each PLAN scene duration as its visual window and distribute the narration accordingly, while allowing sentences to bridge those cuts.',
    `Return exactly ${sceneCount} scenes whose combined narration is about ${totalSeconds} seconds or ${totalWords} Marathi words.`,
    `The visual timeline gives each scene at most ${VIDEO_CLIP_MAX_SECONDS} seconds, but optimise the complete voiceover rather than writing isolated scene speeches.`,
    `key_point is an optional Marathi on-screen phrase of at most ${VIDEO_KEY_POINT_MAX_CHARS} characters; leave it empty when it does not help.`,
    'style is one English paragraph describing a consistent, realistic live-action look in Maharashtra, India.',
    'The optional REFERENCE may inspire the writing style, but its facts are not part of the note.',
    'Return only JSON in this shape:',
    '{ "title": "...", "style": "...", "scenes": [ { "narration": "...", "key_point": "..." } ] }',
  ].join('\n');
}

function buildPlanBlock(
  plan: VideoScenePlan,
  bucket: VideoDurationBucket,
): string {
  const lines = plan.scenes.map(
    (scene, index) =>
      `दृश्य ${index + 1}:` +
      `\n  सांगायचा मुद्दा: ${scene.beat}` +
      `\n  तथ्य: ${scene.sourceQuote}` +
      `\n  दृश्य कालावधी: ${scene.durationSeconds} सेकंद` +
      `\n  दृश्य: ${scene.visualBrief}` +
      (scene.endVisualBrief
        ? ` → ${scene.endVisualBrief}`
        : ' → video model chooses the motion') +
      ` | ${scene.shotHint}`,
  );
  return [
    '<PLAN purpose="scene_plan_follow_exactly">',
    ...lines,
    '</PLAN>',
    '',
    '<BUDGET purpose="total_narration_budget">',
    `एकूण निवेदन: सुमारे ${VIDEO_TOTAL_SECONDS[bucket]} सेकंद / ${videoNarrationBudgetWords(bucket)} शब्द. ` +
      `एका दृश्याची कमाल मर्यादा ${VIDEO_CLIP_MAX_SECONDS} सेकंद.`,
    '</BUDGET>',
  ].join('\n');
}

function buildUserContent(
  note: string,
  heading: string | undefined,
  referenceText: string | null,
  plan: VideoScenePlan,
  bucket: VideoDurationBucket,
): string {
  const parts: string[] = [
    '<NOTE purpose="only_authoritative_fact_source">',
    note.trim(),
    '</NOTE>',
    '',
    buildPlanBlock(plan, bucket),
  ];
  if (heading) {
    parts.push(
      '',
      '<HEADING purpose="requested_angle">',
      heading,
      '</HEADING>',
    );
  }
  if (referenceText) {
    parts.push(
      '',
      '<REFERENCE purpose="style_reference_only">',
      referenceText,
      '</REFERENCE>',
    );
  }
  parts.push(
    '',
    '<TASK>',
    'वरील टिपणी व PLAN वरून आधी संपूर्ण व्हिडिओसाठी एक सलग, नैसर्गिक निवेदन लिहा.',
    'नंतर केवळ दृश्य बदलाच्या ठिकाणी ते scenes मध्ये विभागा; दृश्य बदलताना निवेदनात विराम, नव्याने सुरुवात किंवा प्रत्येक वेळी निष्कर्ष देऊ नका.',
    'सर्व scenes मधील narration क्रमाने जोडल्यावर ते एकाच अखंड संहितेसारखे ऐकू आले पाहिजे.',
    'फक्त वैध JSON object परत करा.',
    '</TASK>',
  );
  return parts.join('\n');
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

type ScriptShape = z.infer<ReturnType<typeof scriptSchemaFor>>;

// One check: which plan beats do the narrations fail to convey? Returns 1-based scene
// numbers. Any failure here returns [] — the coverage round is best-effort by design and
// must never sink a script that already validated. It runs on the authoring tier (not a
// cheap model as it once did): judging whether a Marathi narration conveys a beat without
// demanding verbatim overlap is exactly the call a weak model gets wrong in both
// directions, and it decides whether a repair round is spent.
async function findUncoveredBeats(
  plan: VideoScenePlan,
  script: ScriptShape,
): Promise<number[]> {
  try {
    const pairs = plan.scenes.map((scene, index) => ({
      scene: index + 1,
      beat: scene.beat,
      // A beat may deliberately bridge a visual cut. Give the judge the
      // neighbouring slices so it does not "repair" a good hand-off back into
      // a self-contained mini-script.
      narration_context: [
        script.scenes[index - 1]?.narration ?? '',
        script.scenes[index]?.narration ?? '',
        script.scenes[index + 1]?.narration ?? '',
      ]
        .filter(Boolean)
        .join(' '),
    }));
    const raw = await chatComplete(
      [
        {
          role: 'system',
          content: [
            'तुम्ही explainer व्हिडिओच्या संहितेचे परीक्षक आहात. प्रत्येक दृश्यासाठी beat',
            '(अपेक्षित माहिती) आणि त्या दृश्याभोवतीचे सलग narration_context दिले आहे.',
            'दृश्य बदलाच्या सीमेवर वाक्य पुढे सुरू राहू शकते. संपूर्ण context पाहूनही beat मधील माहिती पोहोचत नसेल, त्यांचेच',
            'क्रमांक द्या. शब्दशः जुळणी अपेक्षित नाही — माहिती पोहोचली की नाही एवढेच पाहा.',
            'शंका असल्यास दृश्य वगळा (उत्तीर्ण माना).',
            'फक्त वैध JSON object परत करा: { "uncovered": [दृश्य क्रमांक] }',
          ].join('\n'),
        },
        { role: 'user', content: JSON.stringify(pairs, null, 2) },
      ],
      {
        model: VIDEO_CHAT_MODEL,
        temperature: 0,
        responseFormat: 'json_object',
      },
    );
    const parsed = z
      .object({ uncovered: z.array(z.number().int().min(1)) })
      .safeParse(parseJson(raw));
    if (!parsed.success) return [];
    return parsed.data.uncovered.filter((n) => n <= plan.scenes.length);
  } catch (error) {
    console.warn('[video-script] coverage check failed (skipping):', error);
    return [];
  }
}

// ONE repair of only the flagged scenes; the rest of the script must come back
// byte-identical. Returns the original script when the repair fails validation.
async function repairUncoveredScenes(
  note: string,
  systemPrompt: string,
  plan: VideoScenePlan,
  script: ScriptShape,
  uncovered: readonly number[],
  bucket: VideoDurationBucket,
): Promise<ScriptShape> {
  try {
    const flagged = uncovered
      .map((n) => `दृश्य ${n}: beat: ${plan.scenes[n - 1]!.beat}`)
      .join('\n');
    const raw = await chatComplete(
      [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: [
            '<NOTE purpose="only_authoritative_fact_source">',
            note.trim(),
            '</NOTE>',
            '',
            buildPlanBlock(plan, bucket),
            '',
            '<CURRENT_SCRIPT>',
            JSON.stringify(script, null, 2),
            '</CURRENT_SCRIPT>',
            '',
            '<UNCOVERED purpose="scenes_missing_their_beat">',
            flagged,
            '</UNCOVERED>',
            '',
            '<TASK>',
            'UNCOVERED मधील दृश्यांचे narration असे पुन्हा लिहा की VOICE beat मधील',
            'माहिती पोहोचेल — फक्त टिपणीतील तथ्ये वापरून. संपूर्ण निवेदनाचा सलगपणा आणि दृश्यांमधील नैसर्गिक hand-off कायम ठेवा;',
            'दुरुस्त दृश्याला स्वतंत्र सुरुवात किंवा निष्कर्ष देऊ नका. VISUAL track बदलू नका; तो',
            'output schema चा भागही नाही. इतर सर्व दृश्ये, title आणि style जशीच्या तशी',
            'ठेवा. संपूर्ण script चा वैध JSON object परत करा.',
            '</TASK>',
          ].join('\n'),
        },
      ],
      {
        model: VIDEO_CHAT_MODEL,
        temperature: 0,
        responseFormat: 'json_object',
      },
    );
    const result = scriptSchemaFor(plan.scenes.length).safeParse(
      parseJson(raw),
    );
    return result.success ? result.data : script;
  } catch (error) {
    console.warn(
      '[video-script] coverage repair failed (keeping draft):',
      error,
    );
    return script;
  }
}

export async function generateVideoScript(
  note: string,
  options: VideoScriptOptions,
): Promise<GeneratedVideoScript> {
  // The plan decides how many scenes the note needs and what each must say —
  // a planner failure IS a script failure (it has its own repair call).
  const plan = await planVideoScenes(note, {
    durationBucket: options.durationBucket,
    heading: options.heading,
  });

  // One style exemplar, like proof-read.ts: tone/structure only, never facts.
  // Retrieval failure must not sink the script — the note alone suffices.
  let reference: Awaited<ReturnType<typeof retrieveReferenceArticle>> = null;
  try {
    reference = await retrieveReferenceArticle(note, null, options.heading);
  } catch (error) {
    console.warn('[video-script] reference retrieval failed:', error);
  }

  const schema = scriptSchemaFor(plan.scenes.length);
  const systemPrompt = buildSystemPrompt(
    plan.scenes.length,
    options.durationBucket,
  );
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: buildUserContent(
        note,
        options.heading,
        reference?.text ?? null,
        plan,
        options.durationBucket,
      ),
    },
  ];

  const raw = await chatComplete(messages, {
    model: VIDEO_CHAT_MODEL,
    temperature: 0.4,
    responseFormat: 'json_object',
  });

  const validate = (candidate: string) => {
    const result = schema.safeParse(parseJson(candidate));
    if (!result.success) {
      throw new Error(
        `Video script did not match the expected schema:\n${result.error.message}\n---\n${candidate}`,
      );
    }
    return result.data;
  };

  let script: ScriptShape;
  try {
    script = validate(raw);
  } catch (firstError) {
    const repairMessages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: [
          '<NOTE purpose="only_authoritative_fact_source">',
          note.trim(),
          '</NOTE>',
          '',
          buildPlanBlock(plan, options.durationBucket),
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
    try {
      script = validate(repaired);
    } catch (repairError) {
      throw new Error(
        [
          'Video script generation failed after repair attempt.',
          '',
          'First error:',
          (firstError as Error).message,
          '',
          'Repair error:',
          (repairError as Error).message,
        ].join('\n'),
      );
    }
  }

  // One bounded coverage round (check + at most one repair), accepted either way.
  const uncovered = await findUncoveredBeats(plan, script);
  if (uncovered.length > 0) {
    script = await repairUncoveredScenes(
      note,
      systemPrompt,
      plan,
      script,
      uncovered,
      options.durationBucket,
    );
  }

  // Free advisory only — the narrate phase enforces the budget with real WAV
  // measurements, and the gate-1 UI shows the officer the same estimate. This
  // just makes a grossly over-written script visible in the job log/harness.
  const totalEstimate = script.scenes.reduce(
    (sum, scene) => sum + estimateNarrationSeconds(scene.narration),
    0,
  );
  const totalTarget = VIDEO_TOTAL_SECONDS[options.durationBucket];
  if (totalEstimate > totalTarget * (VIDEO_TOTAL_FIT_TOLERANCE + 0.15)) {
    console.warn(
      `[video-script] narration estimates to ~${totalEstimate.toFixed(0)}s ` +
        `against a ${totalTarget}s target — the narrate phase will shorten ` +
        'the continuous script if the measured WAV confirms the overrun.',
    );
  }

  return {
    title: script.title,
    style: script.style,
    scenes: script.scenes.map((scene, index) => ({
      narration: scene.narration,
      visualBrief: plan.scenes[index]!.visualBrief,
      ...(plan.scenes[index]!.endVisualBrief
        ? { endVisualBrief: plan.scenes[index]!.endVisualBrief }
        : {}),
      keyPoint: keyPointOf(scene.key_point, note),
      beat: plan.scenes[index]!.beat,
      shotHint: plan.scenes[index]!.shotHint,
      plannedDurationSeconds: plan.scenes[index]!.durationSeconds,
    })),
    referenceTitle: reference?.title ?? null,
    referenceUrl: reference?.url ?? null,
  };
}

// Run directly to eyeball a script without any video spend (needs
// OPENAI_API_KEY + Supabase env for retrieval):
//
//   tsx --env-file=../../.env src/video/generate-video-script.ts --file=note.txt [short|long]
//   tsx --env-file=../../.env src/video/generate-video-script.ts "<टिपणी>" [short|long]
//
// `--check` runs the on-screen key point's digit guard offline instead (free,
// no API key needed):
//
//   tsx src/video/generate-video-script.ts --check
//
// PREFER --file: see the note on plan-video-scenes.ts's harness — npx on
// Windows silently truncates a multi-line argument at the first newline.
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
  // The point of comparing in one script: Marathi prose writes ३१, and a key
  // point that renders the SAME number as 31 has changed nothing.
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
  // The guard only ever DROPS: it must never rewrite a number it accepted.
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
  const bucket = (process.argv[3] ?? 'short') as VideoDurationBucket;
  if (!note) {
    console.error(
      'Usage: tsx --env-file=../../.env src/video/generate-video-script.ts (--file=note.txt | "<टिपणी>") [short|long]',
    );
    process.exit(1);
  }
  generateVideoScript(note, { durationBucket: bucket })
    .then((script) => {
      console.log(JSON.stringify(script, null, 2));
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
