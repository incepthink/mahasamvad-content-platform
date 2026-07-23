// Revise a social post's caption according to free-text user feedback ("कॅप्शनमध्ये
// बदल हवा आहे?" in the web UI). This is the caption counterpart of revise-copy.ts:
// twitter/facebook runs store their caption in generations.article, but the article
// revision path (reviseArticle) is a Mahasamvad long-form editor and rejects social
// categories by design — a caption is one short social post with hashtags, not an
// article.
//
// The note stays the only fact source; the feedback may only steer wording, length,
// tone, emphasis, and script. One chat call, plus one repair call if the model's JSON
// is malformed.

import { pathToFileURL } from 'node:url';
import { chatComplete, type ChatMessage } from './openai-chat.js';

const SYSTEM_PROMPT = [
  'तुम्ही महाराष्ट्र शासनाच्या माहिती व जनसंपर्क महासंचालनालयासाठी (DGIPR / महासंवाद)',
  'सोशल-मीडिया पोस्टची कॅप्शन सुधारणारे अनुभवी मराठी संपादक आहात.',
  'तुम्हाला मूळ टिपणी, पोस्टची सध्याची कॅप्शन आणि वापरकर्त्याचा अभिप्राय दिला जाईल.',
  'अभिप्रायानुसार कॅप्शन सुधारून परत करा.',
  '',
  'कठोर नियम:',
  '1. मूळ टिपणी हाच तथ्यांचा एकमेव स्रोत आहे. टिपणीत नसलेली नावे, तारखा, रक्कम, पदनामे,',
  '   योजना, ठिकाणे, आकडे, संस्था, निर्णय, आश्वासने किंवा दावे तयार करू नका.',
  '2. सध्याची कॅप्शन हा फक्त सुधारायचा मजकूर आहे; तो स्वतंत्र तथ्य-स्रोत नाही.',
  '3. वापरकर्त्याचा अभिप्राय फक्त शैली, शब्दरचना, लांबी, भर, स्पष्टता, लिपी आणि मांडणी',
  '   यासाठी आहे; तो तथ्य-स्रोत नाही. अभिप्रायात नवीन तथ्य सुचवले असल्यास ते फक्त',
  '   टिपणीत स्पष्ट आधार असल्यासच वापरा.',
  '4. अभिप्राय आणि टिपणी यांच्यात विरोध असेल तर टिपणीला प्राधान्य द्या.',
  '5. कॅप्शन मराठीत व देवनागरी लिपीतच ठेवा.',
  '6. सध्याच्या कॅप्शनमधील हॅशटॅग, @handles आणि इमोजी जसेच्या तसे ठेवा — अभिप्रायात',
  '   त्यांविषयी स्पष्ट सूचना असल्यासच बदला.',
  '7. अंक देवनागरी (०-९) व इंग्रजी (0-9) यांमध्ये बदलण्यास परवानगी आहे — अभिप्रायात तसे',
  '   मागितले असेल तेव्हा. मात्र आकड्याचे मूल्य कधीही बदलू नका (५०० → 500 चालेल,',
  '   ५०० → ६०० चालणार नाही).',
  '8. फक्त अभिप्रायाने मागितलेला बदल करा; बाकी कॅप्शन शक्य तितकी जशीच्या तशी ठेवा.',
  '9. कॅप्शन शासकीय, सन्मानजनक आणि सोप्या मराठीत ठेवा. अतिनाट्यमय, क्लिकबेट किंवा',
  '   जाहिरातीसारखी भाषा वापरू नका.',
  '',
  'फक्त {"caption": "..."} या रचनेचा वैध JSON object परत करा.',
  'markdown, code fence, अवतरणचिन्हे, स्पष्टीकरण किंवा अतिरिक्त मजकूर देऊ नका.',
].join('\n');

// The platform's hard cap, stated as a rule only when the caller has one (X: 280
// weighted characters; a Facebook post has no practical limit).
function lengthRule(maxLength: number | undefined): string[] {
  if (!maxLength) return [];
  return [
    '',
    'लांबीची मर्यादा:',
    `- सुधारित कॅप्शन जास्तीत जास्त ${maxLength} अक्षरांची असावी (हॅशटॅगसह).`,
    '- मर्यादेत बसण्यासाठी कमी महत्त्वाचे तपशील वगळा; तथ्ये बदलू नका.',
  ];
}

function buildUserTurn(
  input: ReviseCaptionInput,
  invalid?: { raw: string; errorMessage: string },
): string {
  return [
    '<NOTE purpose="only_authoritative_fact_source">',
    input.note.trim(),
    '</NOTE>',
    '',
    '<CURRENT_CAPTION purpose="caption_to_revise_not_fact_source">',
    input.caption.trim(),
    '</CURRENT_CAPTION>',
    '',
    '<FEEDBACK purpose="style_wording_length_emphasis_script_only_not_fact_source">',
    input.feedback.trim(),
    '</FEEDBACK>',
    ...(invalid
      ? [
          '',
          '<INVALID_OUTPUT>',
          invalid.raw,
          '</INVALID_OUTPUT>',
          '',
          '<SCHEMA_ERROR>',
          invalid.errorMessage,
          '</SCHEMA_ERROR>',
        ]
      : []),
    '',
    '<TASK>',
    invalid
      ? 'वरील INVALID_OUTPUT अपेक्षित रचनेशी जुळत नाही. तेच काम पुन्हा करा आणि'
      : 'वरील FEEDBACK नुसार CURRENT_CAPTION सुधारा.',
    'टिपणीत नसलेले कोणतेही तथ्य जोडू नका.',
    'फक्त {"caption": "..."} अशा वैध JSON object स्वरूपात उत्तर द्या.',
    '</TASK>',
  ].join('\n');
}

function buildMessages(
  input: ReviseCaptionInput,
  invalid?: { raw: string; errorMessage: string },
): ChatMessage[] {
  return [
    {
      role: 'system',
      content: [SYSTEM_PROMPT, ...lengthRule(input.maxLength)].join('\n'),
    },
    { role: 'user', content: buildUserTurn(input, invalid) },
  ];
}

// Same tolerant extraction as revise-copy.ts: response_format keeps this rare, but a
// stray code fence must not fail a revision.
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

// The expected shape is one string field, so a hand-written guard keeps this package
// free of a zod dependency (only @dgipr/schemas carries one).
function validateRevisedCaption(parsed: unknown, raw: string): string {
  const caption =
    typeof parsed === 'object' && parsed !== null
      ? (parsed as { caption?: unknown }).caption
      : undefined;
  if (typeof caption !== 'string' || caption.trim().length === 0) {
    throw new Error(
      `Caption revision did not return a non-empty "caption" string:\n${raw}`,
    );
  }
  return caption.trim();
}

export type ReviseCaptionInput = Readonly<{
  // The caption as it stands (generations.article on a social row).
  caption: string;
  feedback: string;
  // The run's original note — the only thing new facts may come from.
  note: string;
  // Platform character cap, when the platform has one. Stated in the prompt; not
  // enforced in code (an overshoot is still worth showing — the web counter makes it
  // visible and the publish route is the hard gate).
  maxLength?: number | undefined;
}>;

export async function reviseCaption(
  input: ReviseCaptionInput,
): Promise<string> {
  const raw = await chatComplete(buildMessages(input), {
    temperature: 0.25,
    responseFormat: 'json_object',
    // A caption is a few hundred characters; the article-sized default is wasteful.
    maxTokens: 1024,
  });

  try {
    return validateRevisedCaption(parseJson(raw), raw);
  } catch (firstError) {
    const repaired = await chatComplete(
      buildMessages(input, {
        raw,
        errorMessage: (firstError as Error).message,
      }),
      { temperature: 0, responseFormat: 'json_object', maxTokens: 1024 },
    );

    try {
      return validateRevisedCaption(parseJson(repaired), repaired);
    } catch (repairError) {
      throw new Error(
        [
          'Caption revision failed after repair attempt.',
          '',
          'First error:',
          (firstError as Error).message,
          '',
          'Repair error:',
          (repairError as Error).message,
          '',
          'Original output:',
          raw,
          '',
          'Repaired output:',
          repaired,
        ].join('\n'),
      );
    }
  }
}

// --- CLI harness -----------------------------------------------------------
// Exercise the revision without the API or the web UI:
//
//   tsx --env-file=../../.env src/generation/revise-caption.ts ["feedback"]
//
// The default feedback checks the two asks this feature was built for: shortening to
// X's limit, and re-scripting the numerals — the amounts must survive both.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const feedback =
    process.argv.slice(2).join(' ').trim() ||
    'कॅप्शन २८० अक्षरांपेक्षा लहान करा आणि सर्व आकडे मराठी अंकांत लिहा.';

  const SAMPLE_NOTE = [
    'मुख्यमंत्री यांच्या हस्ते आज मुंबईत नमो शेतकरी महासन्मान निधी योजनेच्या दुसऱ्या टप्प्याचे',
    'उद्घाटन झाले. या टप्प्यात राज्यातील 500 शेतकरी कुटुंबांना थेट लाभ मिळणार असून त्यासाठी',
    'एकूण 2 कोटी रुपयांची तरतूद करण्यात आली आहे. अर्ज करण्याची अंतिम मुदत 31 ऑगस्ट 2026 आहे.',
  ].join(' ');

  const SAMPLE_CAPTION = [
    'नमो शेतकरी महासन्मान निधी योजनेच्या दुसऱ्या टप्प्याचे मुंबईत मुख्यमंत्री यांच्या हस्ते उद्घाटन.',
    'राज्यातील 500 शेतकरी कुटुंबांना थेट लाभ मिळणार असून यासाठी 2 कोटी रुपयांची भरीव तरतूद',
    'करण्यात आली आहे. पात्र शेतकऱ्यांनी 31 ऑगस्ट 2026 पूर्वी अर्ज करावेत, असे आवाहन करण्यात आले आहे.',
    '#महासंवाद #शेतकरी',
  ].join(' ');

  reviseCaption({
    caption: SAMPLE_CAPTION,
    feedback,
    note: SAMPLE_NOTE,
    maxLength: 280,
  })
    .then((revised) => {
      console.log('\n=== feedback ===\n');
      console.log(feedback);
      console.log(
        `\n=== revised caption (${Array.from(revised.normalize('NFC')).length} chars) ===\n`,
      );
      console.log(revised);
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
