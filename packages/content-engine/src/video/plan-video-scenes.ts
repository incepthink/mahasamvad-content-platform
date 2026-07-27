// Scene planner for the explainer-video pipeline: BEFORE any narration is
// written, plan TWO parallel tracks for the same running time:
//
//   - the voice track selects facts and orders the spoken explanation;
//   - the visual track independently selects the clearest filmable ideas and
//     writes the animation-safe start/end frames.
//
// They share scene boundaries only because narration duration determines clip
// duration. A frame is never asked to illustrate every word spoken over it.
// This separation is load-bearing: when the script writer owned both tracks it
// repeatedly converted a detailed sentence into a crowded "show everything"
// photograph that an image-to-video model could not animate cleanly.
//
// Durations are NOT planned here: narration is budgeted against the project's
// TOTAL time (VIDEO_TOTAL_SECONDS), and each clip's length is later DERIVED
// from its measured narration audio — audio sets the window, not the content
// of the shot. generate-video-script.ts writes only narration and overlays
// against this already-directed visual storyboard.
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
  NARRATION_WORDS_PER_SECOND,
  VIDEO_CLIP_MAX_SECONDS,
  VIDEO_CLIP_MIN_SECONDS,
  VIDEO_SCENE_BOUNDS,
  VIDEO_SCENE_LIMIT,
  VIDEO_TOTAL_SECONDS,
  videoNarrationBudgetWords,
  type VideoDurationBucket,
} from '@dgipr/schemas';
import {
  chatComplete,
  VIDEO_CHAT_MODEL,
  type ChatMessage,
} from '../generation/openai-chat.js';

// Step 1's output: the note's citizen-relevant facts, copied verbatim.
const FactsSchema = z.object({
  facts: z.array(z.string().trim().min(1).max(500)).min(1).max(14),
});

// Step 2 picks a fact BY INDEX rather than restating it, so a scene can only
// rest on a fact that step 1 actually found in the note. Asking one call to
// extract, select, arrange and format at once produced 2-scene plans whose
// middle scenes were invented benefit claims; the same model lists ten
// accurate facts when that is the only thing it is asked to do.
// No duration field: clip lengths are DERIVED from each scene's measured
// narration audio (audio leads, clips follow), so the planner never chooses a
// window — it only decides how the total narration budget is spread across
// beats.
const PlanSceneSchema = z.object({
  fact_index: z.number().int().min(1),
  beat: z.string().trim().min(1).max(300),
  // The visual track gets its own fact anchor. It MAY differ from fact_index:
  // the best sentence to say at second 8 is not necessarily the best thing to
  // photograph at second 8.
  visual_fact_index: z.number().int().min(1),
  // Split subject from action so the planner has to make an explicit,
  // inspectable choice instead of hiding a crowd/montage in one prose blob.
  visual_subject: z.string().trim().min(1).max(220),
  visual_action: z.string().trim().min(1).max(260),
  end_visual_action: z.string().trim().max(220).optional(),
  shot_hint: z.string().trim().min(1).max(160),
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
  // The animation-safe visual track, authored before narration. `visualBrief`
  // is deliberately only subject + one opening action; it does not receive the
  // voice track's beat or narration.
  visualSourceQuote: string;
  visualBrief: string;
  endVisualBrief?: string;
  // English shot/camera direction ("close-up of a shared action, slow push-in").
  shotHint: string;
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
  const totalSeconds = VIDEO_TOTAL_SECONDS[bucket];
  const totalWords = videoNarrationBudgetWords(bucket);
  const maxSceneWords = Math.round(
    VIDEO_CLIP_MAX_SECONDS * NARRATION_WORDS_PER_SECOND,
  );
  return [
    'तुम्ही महाराष्ट्र शासनाच्या माहिती व जनसंपर्क महासंचालनालयासाठी (DGIPR / महासंवाद)',
    'explainer व्हिडिओंचे नियोजन करणारे अनुभवी दिग्दर्शक-संपादक आहात.',
    '',
    'तुम्हाला एक अधिकृत टिपणी आणि तिच्यातून काढलेल्या तथ्यांची क्रमांकित यादी (FACTS)',
    'दिली जाईल. एकाच कालावधीसाठी दोन स्वतंत्र आराखडे तयार करा: (A) ऐकू येणारे',
    'निवेदन आणि (B) आवाज बंद असतानाही माहिती समजावणारी दृश्य-कथा. दृश्य हे त्या',
    'क्षणाच्या निवेदनाचे शब्दशः चित्र नसते. वैध JSON object असे द्या:',
    '{ "scenes": [ { "fact_index": 1, "beat": "...", "visual_fact_index": 2,',
    '  "visual_subject": "...", "visual_action": "...",',
    '  "end_visual_action": "", "shot_hint": "..." } ] }',
    '',
    'कठोर नियम:',
    '1. दोन स्वतंत्र tracks:',
    '   VOICE: fact_index + beat म्हणजे त्या वेळेत निवेदनात सांगायची माहिती.',
    '   VISUAL: visual_fact_index + visual_subject + visual_action +',
    '   end_visual_action + shot_hint म्हणजे स्वतःच्या क्रमाने चालणारी दृश्य-कथा.',
    '   दोन्ही क्रमांक FACTS मधलेच असावेत; यादीबाहेरची माहिती वापरू नका — नवीन नावे,',
    '   तारखा, रक्कम, आकडे किंवा दावे योजू नका. एका track मध्ये एकच fact पुन्हा वापरू',
    '   नका. एका scene चे fact_index व visual_fact_index समान असू शकतात, पण फक्त तेच',
    '   तथ्य त्या क्षणी बोलायलाही आणि दाखवायलाही सर्वोत्तम असेल तेव्हा. केवळ sync',
    '   साधण्यासाठी दृश्य निवडू नका.',
    `2. दृश्यसंख्या: किमान 2, कमाल ${VIDEO_SCENE_LIMIT.max}; या व्हिडिओसाठी`,
    `   ${preferred.min} ते ${preferred.max} दृश्ये घ्या. यादीत पुरेशी तथ्ये असतील तर`,
    `   ${preferred.max} दृश्ये घ्या — प्रत्येक दृश्यासाठी वेगळे तथ्य.`,
    '3. beat: मराठीत एक ओळ — त्या तथ्यातील माहिती नागरिकाला कशी सांगाल. जी नावे,',
    '   ठिकाणे, आकडे व मुदती beat मध्ये घ्याल ती तथ्यातल्याप्रमाणे जशीच्या तशी लिहा —',
    '   अर्धवट किंवा मोघम ("काही", "अनेक") लिहू नका. मात्र तथ्यातील सर्वच तपशील एका',
    '   beat मध्ये कोंबण्याची गरज नाही: नागरिकाला थेट उपयोगी तपशील निवडा आणि उरलेले',
    '   वगळा. लांब यादी असेल तर एकतर ती स्वतंत्र दृश्य करा, नाहीतर तिच्यातील',
    '   महत्त्वाचे मोजकेच घटक नावानिशी द्या — मोघम गुंडाळणी मात्र करू नका.',
    '4. निवड व क्रम: पहिले दृश्य = घोषणा/निर्णय; मधली दृश्ये = ठोस तपशील (कुठे,',
    '   कोणासाठी, किती); अडचण/त्रुटी सांगणारे एकच दृश्य पुरे — व्हिडिओचा विषय सुधारणा',
    '   आहे, तक्रार नाही; शेवटचे दृश्य = नागरिकाला होणारा फायदा किंवा त्याच्यासाठी आज',
    '   उपलब्ध असलेली सुविधा. शेवटचे दृश्य पहिल्याचा पुनरुच्चार करू नये.',
    `5. संपूर्ण व्हिडिओचे निवेदन मिळून सुमारे ${totalSeconds} सेकंदांचे (~${totalWords} शब्द) असते.`,
    `   प्रत्येक दृश्याची क्लिप त्याच्या निवेदनाइतकी लांब होते — किमान ${VIDEO_CLIP_MIN_SECONDS}, कमाल`,
    `   ${VIDEO_CLIP_MAX_SECONDS} सेकंद (सुमारे ${maxSceneWords} शब्द). महत्त्वाच्या तथ्याला जास्त वेळ द्या,`,
    `   दुय्यमाला कमी. ${maxSceneWords} शब्दांत सांगता येणार नाही इतकी माहिती एका beat मध्ये`,
    '   कोंबू नका — ती दोन दृश्यांत विभागा (म्हणूनच दृश्यसंख्या वाढवण्याची मुभा आहे);',
    '   एकूण वेळेचे बजेट मात्र ओलांडू नका. याउलट एका ओळीत संपणारे तोकडे दृश्यही',
    '   नको — क्लिप मुकी राहते.',
    '6. VISUAL TRACK हा स्वतंत्र मूक explainer आहे. संपूर्ण visual track पाहिल्यावर',
    '   नागरिकाला विषय, सेवा/बदल आणि परिणाम समजला पाहिजे; पण एका frame ने संपूर्ण',
    '   लेख सांगायचा नाही. सर्वात filmable आणि नागरिकाला लगेच कळणाऱ्या 3–8 visual',
    '   moments निवडा. अमूर्त घोषणा किंवा अनेक आकडे frame मध्ये कोंबण्याऐवजी त्या',
    '   निर्णयाशी थेट जोडलेली एक सेवा, वस्तू, नागरिकाची कृती किंवा दिसणारा परिणाम निवडा.',
    '   visual_subject: इंग्रजीत फक्त shot मधला HERO inventory लिहा — एक प्रमुख',
    '   व्यक्ती किंवा वस्तू; अत्यावश्यक असेल तर एकाच कृतीत असलेल्या जास्तीत जास्त दोन',
    '   व्यक्ती; जास्तीत जास्त 2–3 महत्त्वाच्या वस्तू. Background people, crowd, traffic,',
    '   दुसरे वाहन, स्वतंत्र activity, सजावटीचे तपशील लिहू नका. उदा. "One woman commuter',
    '   beside the open front door of a single red city bus" — संपूर्ण रस्ता, दोन buses,',
    '   taxi traffic आणि प्रवाशांची रांग नाही.',
    '   visual_action: इंग्रजीत opening frame मधील एकच स्वच्छ, थांबलेली किंवा सुरू',
    '   होणारी कृती. visual_subject मधील inventory बाहेरची व्यक्ती/वस्तू जोडू नका.',
    '   narration/beat मधील इतर तपशील येथे आणू नका. Frame ला infographic, poster,',
    '   collage किंवा माहितीची यादी बनवू नका.',
    '   end_visual_action: OPTIONAL. त्याच subject आणि त्याच 2–3 वस्तूंमध्ये काही',
    '   सेकंदांत होणारा एक छोटा physical change असल्यासच इंग्रजीत लिहा. नवीन व्यक्ती,',
    '   नवीन वस्तू, प्रवेश/निर्गमन, चालणारी गर्दी, मोठी हालचाल, बदललेली जागा किंवा',
    '   दुसरे event नको. योग्य छोटा बदल नसेल तर रिकामी ("") ठेवा — single start frame',
    '   वर subtle camera motion करणे हे खराब end frame तयार करण्यापेक्षा चांगले.',
    '   shot_hint: इंग्रजीत detail shot, close-up किंवा medium close-up + locked camera',
    '   किंवा एकच subtle push/pan. Wide/establishing/long/crowd shot कधीही नको.',
    '   एक focal plane; quiet soft-focus background; subject भोवती स्वच्छ negative',
    '   space. Frame इतकी साधी असावी की video model ला फक्त hero subject ची एकच',
    '   हालचाल सोडवावी लागेल. अनेक चेहरे, अनेक चाके/वाहने, पाने/फांद्यांची दाटी,',
    '   shelves, screens, machinery किंवा architecture चे बारकावे टाळा.',
    '   Visual sequence मध्ये shot scale व विषय बदलून rhythm द्या, पण प्रत्येक स्वतंत्र',
    '   shot साधा ठेवा. दोन दृश्ये एकाच ठिकाणची व एकाच कृतीची असू नयेत.',
    '   हे खरे चित्रीकरण आहे, animation नाही. कोणीही बोलताना किंवा कॅमेऱ्याशी संवाद',
    '   साधताना दिसेल असे दृश्य योजू नका — निवेदन (voiceover) शब्द वाहून नेते.',
    '   प्रत्येक दृश्य म्हणजे एकाच ठिकाणचा, एकाच कॅमेऱ्याचा सलग focused shot असतो — montage,',
    '   कट, split screen, collage किंवा अनेक ठिकाणे एका दृश्यात योजू नका. (क्लिप पहिल्या फ्रेमपासून शेवटच्या',
    '   फ्रेमपर्यंत सलग तयार होते, त्यामुळे कट तांत्रिकदृष्ट्या शक्यच नाही.) अनेक ठिकाणे',
    '   दाखवायची असतील तर त्यांतले एकच प्रातिनिधिक ठिकाण निवडा.',
    '   पाटी, फलक, बॅनर, अर्जावरील मजकूर, पडद्यावरील आकडे — असे लिहिलेल्या मजकुरावरच',
    '   बेतलेले shot कधीही योजू नका (उदा. "push-in toward the sign", "pan across the',
    '   displayed charges"). फ्रेममध्ये कोणताही मजकूर दिसणार नाही; माहिती कृतीतून',
    '   दाखवा — माणसे, जागा, वस्तू, घडणारी क्रिया.',
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
    'वरील FACTS मधून स्वतंत्र voice track आणि स्वतंत्र visual track असलेला explainer',
    'व्हिडिओ आराखडा तयार करा. Voice साठी fact_index आणि visual साठी visual_fact_index',
    'द्या. Visual track ने narration चे शब्द चित्रात कोंबू नयेत.',
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

// 1-based scene numbers whose voice OR visual track does not rest on a
// distinct, real fact. The tracks have separate seen sets because their order
// is intentionally independent.
function ungroundedScenes(
  plan: z.infer<typeof PlanSchema>,
  factCount: number,
): number[] {
  const seenVoice = new Set<number>();
  const seenVisual = new Set<number>();
  const bad: number[] = [];
  for (const [index, scene] of plan.scenes.entries()) {
    const voicePick = scene.fact_index;
    const visualPick = scene.visual_fact_index;
    if (
      voicePick < 1 ||
      voicePick > factCount ||
      visualPick < 1 ||
      visualPick > factCount ||
      seenVoice.has(voicePick) ||
      seenVisual.has(visualPick)
    ) {
      bad.push(index + 1);
      continue;
    }
    seenVoice.add(voicePick);
    seenVisual.add(visualPick);
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

  // Drop any scene that reuses a fact or points outside the list. No repair
  // call: the fix is mechanical, and the remaining scenes are already valid.
  const ungrounded = ungroundedScenes(plan, facts.length);
  if (ungrounded.length > 0) {
    const drop = new Set(ungrounded);
    const kept = plan.scenes.filter((_, index) => !drop.has(index + 1));
    console.warn(
      `[video-plan] dropping ${ungrounded.length} scene(s) whose voice or ` +
        `visual track points at a missing/already-used fact (scenes ` +
        `${ungrounded.join(', ')}).`,
    );
    if (kept.length === 0) {
      throw new Error('Video scene plan had no scene resting on a real fact.');
    }
    plan = { scenes: kept };
  }

  return {
    scenes: plan.scenes.map((scene) => {
      const endVisualBrief = scene.end_visual_action?.trim();
      return {
        beat: scene.beat,
        sourceQuote: facts[scene.fact_index - 1]!,
        visualSourceQuote: facts[scene.visual_fact_index - 1]!,
        // These are deliberately assembled from constrained fields rather than
        // asking the script writer for another 600-character scene description.
        // The image prompt adds setting/style/negative rules downstream.
        visualBrief: `${scene.visual_subject.trim()}. ${scene.visual_action.trim()}`,
        ...(endVisualBrief ? { endVisualBrief } : {}),
        shotHint: scene.shot_hint,
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
