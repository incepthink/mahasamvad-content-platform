// Scene planner for the explainer-video pipeline: BEFORE any narration is
// written, decide how many scenes the video needs (2-8), what each must convey,
// how long it should run (4|6|8s), and how it should be shot.
// generate-video-script.ts then writes narration/visual briefs AGAINST this
// plan, so coverage is designed, not hoped for.
//
// TWO calls, deliberately:
//   1. extractNoteFacts — list the note's citizen-relevant facts, verbatim.
//   2. the planner — pick and order those facts BY INDEX into scenes.
//
// One call doing both produced 2-scene plans off a 6-paragraph note whose
// middle scenes were invented benefit claims ("जलद व अचूक निदान होईल" — a
// phrase the note never uses). Naming such phrases as forbidden examples made
// the model echo them back verbatim, and every additional prose rule made
// compliance worse. Split up, the same model lists ten accurate facts and then
// arranges four of them. Because step 2 can only cite an index, an invented
// fact has no index to cite — the guarantee is structural, not instructed,
// which is the same move proof-read.ts makes with its verbatim-excerpt filter.
//
// The citizen-first rubric is the editorial-brief philosophy in miniature:
// benefits / eligibility / deadlines / what-the-citizen-should-do are beats;
// committee rosters and implementation machinery are compressed or dropped.
// The note stays the sole factual source throughout.
//
// The arc is prescribed (announcement → concrete detail → present situation →
// benefit) because the free-form version spent the middle of the video on the
// problem rather than the improvement, and — since the last beat was hardcoded
// as "what the citizen should do" — an announcement carrying no citizen action
// ended by restating scene 1. Hence the at-most-ONE status-quo scene and the
// conditional action ending. Each scene's fact travels on to the script writer
// as its `sourceQuote`, so a narration can name what the beat compressed (the
// four hospitals stay named even when the beat says "चार प्रमुख रुग्णालये").

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import {
  VIDEO_SCENE_BOUNDS,
  VIDEO_SCENE_LIMIT,
  type VideoDurationBucket,
  type VideoSceneDuration,
} from '@dgipr/schemas';
import { chatComplete, type ChatMessage } from '../generation/openai-chat.js';

// Step 1's output: the note's citizen-relevant facts, copied verbatim.
const FactsSchema = z.object({
  facts: z.array(z.string().trim().min(1).max(500)).min(1).max(14),
});

// Step 2 picks a fact BY INDEX rather than restating it, so a scene can only
// rest on a fact that step 1 actually found in the note. Asking one call to
// extract, select, arrange and format at once produced 2-scene plans whose
// middle scenes were invented benefit claims; the same model lists ten
// accurate facts when that is the only thing it is asked to do.
const PlanSceneSchema = z.object({
  fact_index: z.number().int().min(1),
  beat: z.string().trim().min(1).max(300),
  shot_hint: z.string().trim().min(1).max(200),
  target_duration_seconds: z.union([z.literal(4), z.literal(6), z.literal(8)]),
});

const PlanSchema = z.object({
  scenes: z.array(PlanSceneSchema).min(2).max(VIDEO_SCENE_LIMIT.max),
});

export type VideoScenePlanScene = Readonly<{
  // Marathi one-liner: the information this scene must convey.
  beat: string;
  // The verbatim note text this beat rests on. Verified against the note here;
  // passed to the script writer so narration stays anchored to the same fact.
  sourceQuote: string;
  // English shot/camera direction ("wide establishing shot, slow push-in").
  shotHint: string;
  targetDurationSeconds: VideoSceneDuration;
}>;

export type VideoScenePlan = Readonly<{
  scenes: readonly VideoScenePlanScene[];
}>;

export type VideoScenePlanOptions = Readonly<{
  durationBucket: VideoDurationBucket;
  heading?: string | undefined;
}>;

// Step 1: list the note's citizen-relevant facts, verbatim. Deliberately the
// only thing this call is asked to do — no ordering, no scene count, no shot
// language. Its output becomes the menu step 2 must choose from.
function buildFactsSystemPrompt(): string {
  return [
    'तुम्ही महाराष्ट्र शासनाच्या माहिती व जनसंपर्क महासंचालनालयासाठी (DGIPR / महासंवाद)',
    'काम करणारे मराठी संपादक आहात.',
    '',
    'दिलेल्या अधिकृत टिपणीतून नागरिकाला थेट उपयोगी पडणारी वेगवेगळी ठोस तथ्ये काढा',
    'आणि वैध JSON object म्हणून परत करा: { "facts": ["...", "..."] }',
    '',
    'नियम:',
    '1. प्रत्येक fact म्हणजे टिपणीतील एक वाक्य जसेच्या तसे कॉपी केलेले. स्वतःच्या',
    '   शब्दांत लिहू नका, सारांश देऊ नका, अक्षरे किंवा आकडे बदलू नका.',
    '2. नागरिक-प्रथम निवडा: निर्णय/घोषणा, लाभ, पात्रता, अंतिम मुदती, कुठे व कोणत्या',
    '   दराने सेवा मिळते, आकडे. समिती-रचना, प्रश्न कोणी विचारला, प्रशासकीय तपशील',
    '   वगळा.',
    '3. एकच माहिती दोनदा देऊ नका. महत्त्वाच्या क्रमाने लिहा.',
    '4. जास्तीत जास्त 12 तथ्ये.',
    '',
    'फक्त वैध JSON object परत करा. markdown, code fence किंवा स्पष्टीकरण देऊ नका.',
  ].join('\n');
}

function buildPlannerSystemPrompt(bucket: VideoDurationBucket): string {
  const preferred = VIDEO_SCENE_BOUNDS[bucket];
  return [
    'तुम्ही महाराष्ट्र शासनाच्या माहिती व जनसंपर्क महासंचालनालयासाठी (DGIPR / महासंवाद)',
    'explainer व्हिडिओंचे नियोजन करणारे अनुभवी दिग्दर्शक-संपादक आहात.',
    '',
    'तुम्हाला एक अधिकृत टिपणी आणि तिच्यातून काढलेल्या तथ्यांची क्रमांकित यादी (FACTS)',
    'दिली जाईल. त्या यादीतील तथ्ये निवडून व क्रमाने लावून व्हिडिओची दृश्य-आराखडा',
    '(scene plan) वैध JSON object स्वरूपात तयार करा:',
    '{ "scenes": [ { "fact_index": 1, "beat": "...", "shot_hint": "...",',
    '  "target_duration_seconds": 4 } ] }',
    '',
    'कठोर नियम:',
    '1. प्रत्येक दृश्य FACTS यादीतील एका तथ्यावर बेतलेले असले पाहिजे आणि त्याचा',
    '   क्रमांक fact_index मध्ये द्या. यादीबाहेरची माहिती वापरू नका — नवीन नावे,',
    '   तारखा, रक्कम, आकडे किंवा दावे योजू नका. एकच fact_index दोन दृश्यांसाठी',
    '   वापरू नका.',
    `2. दृश्यसंख्या: किमान 2, कमाल ${VIDEO_SCENE_LIMIT.max}; या व्हिडिओसाठी`,
    `   ${preferred.min} ते ${preferred.max} दृश्ये घ्या. यादीत पुरेशी तथ्ये असतील तर`,
    `   ${preferred.max} दृश्ये घ्या — प्रत्येक दृश्यासाठी वेगळे तथ्य.`,
    '3. beat: मराठीत एक ओळ — त्या तथ्यातील माहिती नागरिकाला कशी सांगाल. त्या तथ्यातील',
    '   नावे, ठिकाणे, आकडे व मुदती beat मध्ये तशाच लिहा; नावांची यादी नुसत्या आकड्यात',
    '   गुंडाळू नका (चार रुग्णालयांची नावे असतील तर ती नावे द्या).',
    '4. निवड व क्रम: पहिले दृश्य = घोषणा/निर्णय; मधली दृश्ये = ठोस तपशील (कुठे,',
    '   कोणासाठी, किती); अडचण/त्रुटी सांगणारे एकच दृश्य पुरे — व्हिडिओचा विषय सुधारणा',
    '   आहे, तक्रार नाही; शेवटचे दृश्य = नागरिकाला होणारा फायदा किंवा त्याच्यासाठी आज',
    '   उपलब्ध असलेली सुविधा. शेवटचे दृश्य पहिल्याचा पुनरुच्चार करू नये.',
    '5. target_duration_seconds: त्या मुद्द्यातील माहितीच्या प्रमाणात 4, 6 किंवा 8 —',
    '   छोटी घोषणा 4, मध्यम तपशील 6, भरगच्च मुद्दा 8. उगीच 8 देऊ नका: जितकी माहिती,',
    '   तितकाच वेळ.',
    '6. shot_hint: इंग्रजीत, shot type + camera movement (उदा. "wide establishing',
    '   shot, slow push-in" / "medium shot of hands filling a form, gentle pan").',
    '   कोणीही बोलताना किंवा कॅमेऱ्याशी संवाद साधताना दिसेल असे दृश्य योजू नका —',
    '   निवेदन (voiceover) शब्द वाहून नेते. चेहऱ्याचा close-up टाळा.',
    '7. HEADING दिले असल्यास तो व्हिडिओचा मुख्य कोन (angle) माना.',
    '',
    'फक्त वैध JSON object परत करा. markdown, code fence, स्पष्टीकरण किंवा अतिरिक्त मजकूर देऊ नका.',
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
    'वरील FACTS यादीतील तथ्ये निवडून explainer व्हिडिओची दृश्य-आराखडा JSON स्वरूपात',
    'तयार करा. प्रत्येक दृश्यासाठी वापरलेल्या तथ्याचा क्रमांक fact_index मध्ये द्या.',
    'फक्त वैध JSON object परत करा.',
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

// 1-based scene numbers that do not rest on a distinct, real fact. Step 2 can
// only point at step 1's list, so an out-of-range index or a reused one is all
// that is left to catch — the "invented benefit claim" case is now impossible
// by construction rather than by instruction.
function ungroundedScenes(
  plan: z.infer<typeof PlanSchema>,
  factCount: number,
): number[] {
  const seen = new Set<number>();
  const bad: number[] = [];
  for (const [index, scene] of plan.scenes.entries()) {
    const pick = scene.fact_index;
    if (pick < 1 || pick > factCount || seen.has(pick)) {
      bad.push(index + 1);
      continue;
    }
    seen.add(pick);
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
    { temperature: 0, responseFormat: 'json_object' },
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
  const systemPrompt = buildPlannerSystemPrompt(options.durationBucket);
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: buildPlannerUserContent(note, options.heading, facts),
    },
  ];

  const raw = await chatComplete(messages, {
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
      temperature: 0,
      responseFormat: 'json_object',
    });
    plan = validate(repaired);
  }

  // Drop any scene that reuses a fact or points outside the list. No repair
  // call: the fix is mechanical, and the remaining scenes are already valid.
  const ungrounded = ungroundedScenes(plan, facts.length);
  if (ungrounded.length > 0) {
    const drop = new Set(ungrounded);
    const kept = plan.scenes.filter((_, index) => !drop.has(index + 1));
    console.warn(
      `[video-plan] dropping ${ungrounded.length} scene(s) pointing at a ` +
        `missing or already-used fact (scenes ${ungrounded.join(', ')}).`,
    );
    if (kept.length === 0) {
      throw new Error('Video scene plan had no scene resting on a real fact.');
    }
    plan = { scenes: kept };
  }

  return {
    scenes: plan.scenes.map((scene) => ({
      beat: scene.beat,
      sourceQuote: facts[scene.fact_index - 1]!,
      shotHint: scene.shot_hint,
      targetDurationSeconds: scene.target_duration_seconds,
    })),
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
