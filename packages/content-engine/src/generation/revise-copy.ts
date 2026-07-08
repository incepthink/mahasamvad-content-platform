// Revise poster copy according to free-text user feedback ("मजकूर सुधारा" in the
// web UI). Text-only changes: post_type and scene_brief stay fixed, and the article
// remains the sole source of facts — so the caller can re-render the poster with
// the CACHED scene image (no new image-generation call).

import { CopySchema, type Copy } from '@dgipr/schemas';
import { chatComplete, type ChatMessage } from './openai-chat.js';

const SYSTEM_PROMPT = [
  'तुम्ही महाराष्ट्र शासनाच्या माहिती व जनसंपर्क महासंचालनालयासाठी (DGIPR / महासंवाद)',
  'सोशल-मीडिया पोस्टर्सचा मजकूर (copy) सुधारणारे अनुभवी मराठी संपादक आहात.',
  'तुम्हाला पोस्टरचा सध्याचा copy JSON, तो ज्या लेखावर आधारित आहे तो लेख, आणि',
  'वापरकर्त्याचा अभिप्राय दिला जाईल. अभिप्रायानुसार copy JSON सुधारून परत करा.',
  '',
  'कठोर नियम:',
  '1. JSON field names, post_type values आणि icon_hint values schema नुसार इंग्रजीतच ठेवा.',
  '2. पोस्टरवर दिसणारा सर्व मजकूर फक्त मराठीत आणि देवनागरी लिपीत लिहा.',
  '3. लेख हाच तथ्यांचा एकमेव स्रोत आहे. लेखात नसलेली नावे, तारखा, रक्कम, पदनामे, योजना,',
  '   ठिकाणे, आकडे, संस्था, कायदे, निर्णय, आश्वासने किंवा दावे तयार करू नका.',
  '4. सध्याचा copy JSON हा फक्त सुधारायचा मजकूर आहे; तो स्वतंत्र तथ्य-स्रोत नाही.',
  '5. वापरकर्त्याचा अभिप्राय हा फक्त शैली, शब्दरचना, लांबी, भर, स्पष्टता आणि मांडणी यासाठी आहे;',
  '   तो तथ्य-स्रोत नाही.',
  '6. अभिप्रायात नवीन तथ्य, नाव, तारीख, रक्कम, पदनाम, ठिकाण, योजना, कायदा, दावा, quote किंवा',
  '   आकडा सुचवला असल्यास तो फक्त लेखात स्पष्ट आधार असल्यासच वापरा.',
  '7. अभिप्राय आणि लेख यांच्यात विरोध असेल तर लेखाला प्राधान्य द्या आणि विरोधी अभिप्राय दुर्लक्ष करा.',
  '8. फक्त अभिप्रायाने मागितलेले मजकूरबदल करा; इतर fields शक्य तितकी जशीच्या तशी ठेवा.',
  '9. post_type बदलू नका.',
  '10. scene_brief बदलू नका. चित्र बदलण्याचा वेगळा मार्ग आहे; हा flow फक्त मजकूरासाठी आहे.',
  '11. मजकूर पोस्टरसाठी लहान, स्पष्ट, ठळक आणि वाचनीय ठेवा. अतिनाट्यमय, क्लिकबेट किंवा जाहिरातीसारखी भाषा वापरू नका.',
  '',
  'field-specific नियम:',
  '- headline: लहान, स्पष्ट आणि मुख्य संदेश देणारे असावे.',
  '- subhead: headline ची पुनरावृत्ती करू नका; पूरक माहिती द्या.',
  '- bullets: प्रत्येक मुद्दा स्वतंत्र, ठोस आणि लेखावर आधारित असावा.',
  '- emphasis: मुद्द्यातील 1 ते 4 शब्द ठळक करण्यासाठी द्या; नसल्यास field वगळू शकता.',
  '- schedule: लेखात तारीख/वेळ स्पष्ट असल्यासच ठेवा किंवा बदला.',
  '- stats: लेखात स्पष्ट आकडे, रक्कम, संख्या किंवा कालमर्यादा असल्यासच ठेवा किंवा बदला.',
  '- cta: लेखात आवाहन, सूचना किंवा अपेक्षित कृती स्पष्ट असल्यासच ठेवा किंवा बदला.',
  '- attribution: लेखात नाव आणि/किंवा पद स्पष्ट असल्यासच ठेवा किंवा बदला.',
  '- icon_hint: renderer ला उपयोगी पडेल असा लहान इंग्रजी शब्द ठेवा.',
  '',
  'फक्त वैध JSON object परत करा — सध्याच्या copy JSON सारख्याच रचनेत.',
  'markdown, code fence, स्पष्टीकरण किंवा अतिरिक्त मजकूर देऊ नका.',
].join('\n');

function buildMessages(
  current: Copy,
  feedback: string,
  article: string,
): ChatMessage[] {
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        '<ARTICLE purpose="only_authoritative_fact_source">',
        article.trim(),
        '</ARTICLE>',
        '',
        '<CURRENT_COPY_JSON purpose="copy_to_revise_not_fact_source">',
        JSON.stringify(current, null, 2),
        '</CURRENT_COPY_JSON>',
        '',
        '<FEEDBACK purpose="style_wording_length_emphasis_only_not_fact_source">',
        feedback.trim(),
        '</FEEDBACK>',
        '',
        '<TASK>',
        'वरील FEEDBACK नुसार CURRENT_COPY_JSON मधील poster-visible मजकूर सुधारा.',
        'post_type आणि scene_brief बदलू नका.',
        'लेखात नसलेले कोणतेही तथ्य जोडू नका.',
        'फक्त वैध JSON object परत करा.',
        '</TASK>',
      ].join('\n'),
    },
  ];
}

function buildRepairMessages(
  current: Copy,
  feedback: string,
  article: string,
  raw: string,
  errorMessage: string,
): ChatMessage[] {
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        '<ARTICLE purpose="only_authoritative_fact_source">',
        article.trim(),
        '</ARTICLE>',
        '',
        '<CURRENT_COPY_JSON purpose="copy_to_revise_not_fact_source">',
        JSON.stringify(current, null, 2),
        '</CURRENT_COPY_JSON>',
        '',
        '<FEEDBACK purpose="style_wording_length_emphasis_only_not_fact_source">',
        feedback.trim(),
        '</FEEDBACK>',
        '',
        '<INVALID_OUTPUT>',
        raw,
        '</INVALID_OUTPUT>',
        '',
        '<SCHEMA_ERROR>',
        errorMessage,
        '</SCHEMA_ERROR>',
        '',
        '<TASK>',
        'वरील INVALID_OUTPUT schema शी जुळत नाही किंवा revision नियम मोडतो.',
        'लेखातील तथ्ये न बदलता, नवीन तथ्य न जोडता आणि post_type व scene_brief कायम ठेवून दुरुस्त JSON परत करा.',
        'फक्त अपेक्षित schema शी जुळणारा वैध JSON object परत करा.',
        'markdown, code fence किंवा स्पष्टीकरण देऊ नका.',
        '</TASK>',
      ].join('\n'),
    },
  ];
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

function validateRevisedCopy(
  parsed: unknown,
  raw: string,
  current: Copy,
): Copy {
  const result = CopySchema.safeParse(parsed);

  if (!result.success) {
    throw new Error(
      `Copy revision did not match the expected schema:\n${result.error.message}\n---\n${raw}`,
    );
  }

  if (result.data.post_type !== current.post_type) {
    throw new Error(
      `Copy revision changed post_type from "${current.post_type}" to "${result.data.post_type}", which the revision prompt forbids.`,
    );
  }

  return {
    ...result.data,
    post_type: current.post_type,
    scene_brief: current.scene_brief,
  } as Copy;
}

export async function reviseCopy(
  current: Copy,
  feedback: string,
  article: string,
): Promise<Copy> {
  const raw = await chatComplete(buildMessages(current, feedback, article), {
    temperature: 0.25,
    responseFormat: 'json_object',
  });

  try {
    return validateRevisedCopy(parseJson(raw), raw, current);
  } catch (firstError) {
    const repaired = await chatComplete(
      buildRepairMessages(
        current,
        feedback,
        article,
        raw,
        (firstError as Error).message,
      ),
      {
        temperature: 0,
        responseFormat: 'json_object',
      },
    );

    try {
      return validateRevisedCopy(parseJson(repaired), repaired, current);
    } catch (repairError) {
      throw new Error(
        [
          'Copy revision failed after repair attempt.',
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
