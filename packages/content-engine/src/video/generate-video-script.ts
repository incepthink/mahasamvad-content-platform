// Per-scene explainer-video script from a user note (gate 1 of the video
// pipeline). The scene BREAKDOWN comes first from the planner
// (plan-video-scenes.ts — citizen-first beats, scene count, per-scene target
// window + shot hint); this module then writes narration/visual briefs
// AGAINST that plan (one gpt-4o JSON call + one repair — the generate-copy.ts
// pattern), and runs ONE bounded coverage round: a gpt-4o-mini check listing
// plan beats the narrations fail to convey, and if any, ONE gpt-4o repair of
// only the flagged scenes. Accepted either way — gate 1's human review is the
// real gate, this pass just catches the obvious drops cheaply.
//
// Guardrails mirror generate-article.ts: the note is the SOLE factual source
// (never invent names/dates/amounts/designations/schemes/locations), the RAG
// exemplar steers tone/structure only, and every scene's visual brief must be
// generic/symbolic, text-free AND speech-free — nobody shown talking, because
// narration carries the words and video models glitch on mouths.

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import {
  VIDEO_NARRATION_MAX_CHARS,
  type VideoDurationBucket,
  type VideoSceneDuration,
} from '@dgipr/schemas';
import { chatComplete, type ChatMessage } from '../generation/openai-chat.js';
import { retrieveReferenceArticle } from '../retrieval/retrieve-references.js';
import {
  planVideoScenes,
  stripBom,
  type VideoScenePlan,
} from './plan-video-scenes.js';

// Spoken-Marathi pace used to turn a scene's target window into a word budget
// for the writer. The real duration is MEASURED from the synthesized WAV later
// (fitSceneDurationSeconds); this only has to be close enough that the writer
// fills the window instead of leaving half of it silent.
const NARRATION_WORDS_PER_SECOND = 4.5;

function wordBudgetFor(seconds: VideoSceneDuration): number {
  return Math.round(seconds * NARRATION_WORDS_PER_SECOND);
}

const SceneSchema = z.object({
  narration: z.string().trim().min(1).max(VIDEO_NARRATION_MAX_CHARS),
  visual_brief: z.string().trim().min(1).max(600),
});

function scriptSchemaFor(sceneCount: number) {
  return z.object({
    title: z.string().trim().min(1).max(200),
    style: z.string().trim().min(1).max(600),
    scenes: z.array(SceneSchema).length(sceneCount),
  });
}

export type VideoScriptScene = Readonly<{
  narration: string;
  visualBrief: string;
  // Carried through from the plan so the runner can persist them per scene.
  beat: string;
  shotHint: string;
  targetDurationSeconds: VideoSceneDuration;
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

function buildSystemPrompt(sceneCount: number): string {
  return [
    'तुम्ही महाराष्ट्र शासनाच्या माहिती व जनसंपर्क महासंचालनालयासाठी (DGIPR / महासंवाद)',
    'माहिती समजावून सांगणाऱ्या ॲनिमेटेड व्हिडिओंसाठी दृश्यनिहाय संहिता (script) लिहिणारे',
    'अनुभवी मराठी संपादक आहात.',
    '',
    'तुम्हाला एक अधिकृत टिपणी आणि दृश्य-आराखडा (PLAN) दिला जाईल. PLAN मधील प्रत्येक',
    'दृश्यासाठी निवेदन व दृश्यवर्णन लिहून वैध JSON object तयार करा:',
    '{ "title": "...", "style": "...", "scenes": [ { "narration": "...", "visual_brief": "..." } ] }',
    '',
    'कठोर नियम:',
    '1. टिपणी हाच तथ्यांचा एकमेव स्रोत आहे. टिपणीत नसलेली नावे, तारखा, रक्कम, पदनामे,',
    '   योजना, ठिकाणे, आकडे, संस्था, निर्णय किंवा दावे तयार करू नका.',
    `2. scenes मध्ये नेमकी ${sceneCount} दृश्ये द्या — PLAN मधील दृश्यांच्याच क्रमाने,`,
    '   प्रत्येक दृश्यात त्याच्या beat मधील माहिती पूर्णपणे पोहोचवा.',
    '3. narration: फक्त मराठीत, देवनागरी लिपीत. प्रत्येक दृश्याच्या PLAN मध्ये दिलेल्या',
    '   शब्दसंख्येच्या जवळपास लिहा — त्याहून खूप कमी नको (क्लिप मुकी राहते) आणि जास्त',
    '   नको (निवेदन घाईचे होते). निवेदन सलग ऐकल्यावर एक सुसंगत, नागरिकाभिमुख कथा',
    '   तयार झाली पाहिजे: सुरुवातीला घोषणा/विषय, मध्ये ठोस तपशील, शेवटी नागरिकाला',
    '   होणारा ठोस फायदा — नागरिकाने करावयाची कृती टिपणीत असेल तरच ती शेवटी द्या,',
    '   नसेल तर कृती तयार करू नका.',
    '   beat मध्ये आलेली ठोस नावे, ठिकाणे, आकडे व मुदती narration मध्ये जशीच्या तशी',
    '   वापरा — त्यांच्याऐवजी "काही", "अनेक", "चार प्रमुख" असे सर्वसाधारण शब्द वापरू नका.',
    '4. visual_brief: इंग्रजीत, त्या दृश्याच्या ॲनिमेशनसाठी सर्वसाधारण, प्रतीकात्मक दृश्याचे',
    '   वर्णन — PLAN मधील shot सूचनेशी सुसंगत. टिपणीत नसलेली विशिष्ट व्यक्ती, चेहरा,',
    '   घटना, ठिकाण किंवा समारंभ दाखवू नका. कोणतीही व्यक्ती बोलताना, तोंड हलवताना',
    '   किंवा कॅमेऱ्याशी संवाद साधताना दाखवू नका — निवेदन शब्द वाहून नेते. कोणताही',
    '   मजकूर, अक्षरे, आकडे, पाट्या, बॅनर, लोगो दाखवू नका.',
    '5. style: इंग्रजीत एक परिच्छेद — संपूर्ण व्हिडिओसाठी एकच दृश्यशैली (उदा. flat 2D',
    '   motion-graphics, रंगसंगती, आकृतिबंध). ही शैली विषयाला साजेशी निवडा; ती प्रत्येक',
    '   दृश्याला सारखीच लागू होईल.',
    '6. भाषा शासकीय, नागरिकाभिमुख, संयत आणि विश्वासार्ह ठेवा. अतिनाट्यमय किंवा',
    '   जाहिरातीसारखी भाषा वापरू नका.',
    '7. REFERENCE फक्त शैली/रचनेसाठी आहे; त्यातील तथ्ये वापरू नका.',
    '',
    'फक्त वैध JSON object परत करा. markdown, code fence, स्पष्टीकरण किंवा अतिरिक्त मजकूर देऊ नका.',
  ].join('\n');
}

function buildPlanBlock(plan: VideoScenePlan): string {
  const lines = plan.scenes.map((scene, index) => {
    const budget = wordBudgetFor(scene.targetDurationSeconds);
    return (
      `दृश्य ${index + 1}: beat: ${scene.beat} | shot: ${scene.shotHint} | ` +
      `कालावधी: ${scene.targetDurationSeconds} से. | निवेदन: सुमारे ${budget} शब्द` +
      // The planner's verified verbatim anchor: the writer expands THIS, so a
      // narration cannot drift off the fact the beat was grounded in.
      `\n  आधार (टिपणीतील मजकूर): ${scene.sourceQuote}`
    );
  });
  return [
    '<PLAN purpose="scene_plan_follow_exactly">',
    ...lines,
    '</PLAN>',
  ].join('\n');
}

function buildUserContent(
  note: string,
  heading: string | undefined,
  referenceText: string | null,
  plan: VideoScenePlan,
): string {
  const parts: string[] = [
    '<NOTE purpose="only_authoritative_fact_source">',
    note.trim(),
    '</NOTE>',
    '',
    buildPlanBlock(plan),
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
    'वरील टिपणी व PLAN वरून explainer व्हिडिओची दृश्यनिहाय संहिता JSON स्वरूपात तयार करा.',
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

// One cheap check: which plan beats do the narrations fail to convey? Returns
// 1-based scene numbers. Any failure here returns [] — the coverage round is
// best-effort by design and must never sink a script that already validated.
async function findUncoveredBeats(
  plan: VideoScenePlan,
  script: ScriptShape,
): Promise<number[]> {
  try {
    const pairs = plan.scenes.map((scene, index) => ({
      scene: index + 1,
      beat: scene.beat,
      narration: script.scenes[index]?.narration ?? '',
    }));
    const raw = await chatComplete(
      [
        {
          role: 'system',
          content: [
            'तुम्ही explainer व्हिडिओच्या संहितेचे परीक्षक आहात. प्रत्येक दृश्यासाठी beat',
            '(अपेक्षित माहिती) आणि narration (प्रत्यक्ष निवेदन) दिले आहे.',
            'ज्या दृश्यांचे narration त्याच्या beat मधील माहिती पोहोचवत नाही, त्यांचेच',
            'क्रमांक द्या. शब्दशः जुळणी अपेक्षित नाही — माहिती पोहोचली की नाही एवढेच पाहा.',
            'शंका असल्यास दृश्य वगळा (उत्तीर्ण माना).',
            'फक्त वैध JSON object परत करा: { "uncovered": [दृश्य क्रमांक] }',
          ].join('\n'),
        },
        { role: 'user', content: JSON.stringify(pairs, null, 2) },
      ],
      { temperature: 0, responseFormat: 'json_object', model: 'gpt-4o-mini' },
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
            buildPlanBlock(plan),
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
            'UNCOVERED मधील दृश्यांचे narration (गरज असल्यास visual_brief) असे पुन्हा लिहा',
            'की beat मधील माहिती पोहोचेल — फक्त टिपणीतील तथ्ये वापरून. इतर सर्व दृश्ये,',
            'title आणि style जशीच्या तशी ठेवा. संपूर्ण script चा वैध JSON object परत करा.',
            '</TASK>',
          ].join('\n'),
        },
      ],
      { temperature: 0, responseFormat: 'json_object' },
    );
    const result = scriptSchemaFor(plan.scenes.length).safeParse(parseJson(raw));
    return result.success ? result.data : script;
  } catch (error) {
    console.warn('[video-script] coverage repair failed (keeping draft):', error);
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
  const systemPrompt = buildSystemPrompt(plan.scenes.length);
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: buildUserContent(
        note,
        options.heading,
        reference?.text ?? null,
        plan,
      ),
    },
  ];

  const raw = await chatComplete(messages, {
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
          buildPlanBlock(plan),
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
    );
  }

  return {
    title: script.title,
    style: script.style,
    scenes: script.scenes.map((scene, index) => ({
      narration: scene.narration,
      visualBrief: scene.visual_brief,
      beat: plan.scenes[index]!.beat,
      shotHint: plan.scenes[index]!.shotHint,
      targetDurationSeconds: plan.scenes[index]!.targetDurationSeconds,
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
// PREFER --file: see the note on plan-video-scenes.ts's harness — npx on
// Windows silently truncates a multi-line argument at the first newline.
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
