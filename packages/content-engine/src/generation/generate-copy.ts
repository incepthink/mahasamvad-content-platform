// Derive poster-ready structured "copy" from a generated Marathi article
// (PROJECT_CONTEXT step 14). One JSON-mode LLM call chooses the single best
// post_type (which master template fits the article) and emits the Marathi copy
// fields for that type.
//
// Guardrails mirror generate-article.ts: the article is the sole source of facts.
// Poster-visible text must be Marathi (Devanagari). Schema/control values such as
// field names, post_type and icon_hint remain in English because the renderer/schema
// expects those exact values.

import { CopySchema, type Copy } from '@dgipr/schemas';
import { chatComplete, type ChatMessage } from './openai-chat.js';

const SYSTEM_PROMPT = [
  'तुम्ही महाराष्ट्र शासनाच्या माहिती व जनसंपर्क महासंचालनालयासाठी (DGIPR / महासंवाद)',
  'सोशल-मीडिया पोस्टर्ससाठी मजकूर (copy) तयार करणारे अनुभवी मराठी संपादक आहात.',
  'तुम्हाला एक तयार मराठी लेख दिला जाईल. त्या लेखातील माहितीवरून एका पोस्टरसाठी',
  'संक्षिप्त, ठळक आणि विश्वासार्ह मराठी copy तयार करून ती वैध JSON object स्वरूपात परत करा.',
  '',
  'कठोर नियम:',
  '1. JSON field names, post_type values आणि icon_hint values schema नुसार इंग्रजीतच ठेवा.',
  '2. पोस्टरवर दिसणारा सर्व मजकूर फक्त मराठीत आणि देवनागरी लिपीत लिहा.',
  '3. लेख हाच तथ्यांचा एकमेव स्रोत आहे. लेखात नसलेली नावे, तारखा, रक्कम, पदनामे, योजना,',
  '   ठिकाणे, आकडे, संस्था, कायदे, निर्णय, आश्वासने किंवा दावे तयार करू नका.',
  '4. लेखातील तथ्ये बदलू नका. पोस्टरसाठी आवश्यक असल्यास संक्षिप्त व ठळक पुनर्मांडणी करू शकता;',
  '   पण अर्थ बदलू नका आणि नवीन तथ्य जोडू नका.',
  '5. मजकूर पोस्टरसाठी लहान, स्पष्ट आणि प्रभावी ठेवा. headline, subhead आणि bullets अनावश्यकपणे लांब करू नका.',
  '6. भाषा शासकीय, नागरिकाभिमुख, संयत आणि विश्वासार्ह ठेवा. अतिनाट्यमय, क्लिकबेट किंवा जाहिरातीसारखी भाषा वापरू नका.',
  '7. लेखात स्पष्ट उल्लेख नसल्यास कोणतीही व्यक्ती बोलली, भेट दिली, पाहणी केली, घोषणा केली किंवा आवाहन केले असे लिहू नका.',
  '8. एखादी माहिती पोस्टरसाठी उपयोगी नसल्यास ती जबरदस्तीने field मध्ये भरू नका; optional fields गरजेनुसार वगळा.',
  '',
  'post_type निवडण्याचे नियम — लेखाला सर्वात योग्य असा एकच प्रकार निवडा:',
  '- "alert": अंतिम तारीख, तातडीची सूचना, इशारा, आदेश, निर्देश, अनुपालन किंवा कायदेशीर कार्यवाही यावर मुख्य भर असल्यास.',
  '- "campaign": मोहीम, योजना, जनजागृती, नागरिक सहभाग, लाभ घेण्याचे आवाहन किंवा सार्वजनिक उपक्रम हा मुख्य विषय असल्यास.',
  '- "info_bullets": प्रशासकीय माहिती, आढावा, अहवाल, प्रक्रिया, जबाबदाऱ्या, निर्देश किंवा मुख्य मुद्दे सोप्या पद्धतीने मांडायचे असल्यास.',
  '- "quote": लेखात स्पष्ट अवतरण, विधान किंवा एखाद्या व्यक्ती/संस्थेने म्हटलेले वाक्य असल्यासच. थेट quote नसल्यास हा प्रकार निवडू नका.',
  '- "timeline": लेखात दोन किंवा अधिक स्पष्ट तारखा, टप्पे किंवा क्रमवार प्रक्रिया असल्यासच.',
  '',
  'प्रकारानुसार अपेक्षित fields:',
  '- "alert": kicker?, headline, subhead?, bullets (नक्की 3, प्रत्येक {text, emphasis?}), scene_brief.',
  '- "campaign": kicker?, headline, subhead?, schedule?{date?,time?}, audience?, cta?, stats?[{value,label,icon_hint}], scene_brief.',
  '- "info_bullets": kicker?, headline, subhead?, bullets[{text, emphasis?}], scene_brief.',
  '- "quote": topic_label?, headline?, quote_text, attribution?{name?,title?}, points?[{text,icon_hint}], scene_brief.',
  '- "timeline": side_label?, headline, intro?, milestones[{date,text}], scene_brief.',
  '',
  'field-specific नियम:',
  '- headline: लहान, स्पष्ट आणि मुख्य संदेश देणारे असावे.',
  '- subhead: headline ची पुनरावृत्ती करू नका; पूरक माहिती द्या.',
  '- bullets: प्रत्येक मुद्दा स्वतंत्र, ठोस आणि लेखावर आधारित असावा.',
  '- emphasis: मुद्द्यातील 1 ते 4 शब्द ठळक करण्यासाठी द्या; नसल्यास field वगळा.',
  '- schedule: लेखात तारीख/वेळ स्पष्ट असल्यासच द्या.',
  '- stats: लेखात स्पष्ट आकडे, रक्कम, संख्या किंवा कालमर्यादा असल्यासच द्या.',
  '- cta: लेखात आवाहन, सूचना किंवा अपेक्षित कृती स्पष्ट असल्यासच द्या; नसल्यास वगळा.',
  '- attribution: लेखात नाव आणि/किंवा पद स्पष्ट असल्यासच द्या.',
  '- icon_hint: renderer ला उपयोगी पडेल असा लहान इंग्रजी शब्द द्या, उदा. "calendar", "rupee", "people", "shield", "report", "child", "law".',
  '- scene_brief: पार्श्वभूमीसाठी सर्वसाधारण, प्रतीकात्मक दृश्य लिहा. लेखात नसलेली विशिष्ट व्यक्ती, घटना, ठिकाण, उद्घाटन, गर्दी किंवा प्रत्यक्ष प्रसंग दाखवू नका. scene_brief पोस्टरवर मजकूर म्हणून दिसणार नाही.',
  '',
  'फक्त वैध JSON object परत करा. markdown, code fence, स्पष्टीकरण किंवा अतिरिक्त मजकूर देऊ नका.',
].join('\n');

function buildMessages(article: string): ChatMessage[] {
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        '<ARTICLE purpose="only_authoritative_fact_source">',
        article.trim(),
        '</ARTICLE>',
        '',
        '<TASK>',
        'वरील लेखावर आधारित एकच सर्वात योग्य post_type निवडून poster copy JSON तयार करा.',
        'फक्त वैध JSON object परत करा.',
        '</TASK>',
      ].join('\n'),
    },
  ];
}

function buildRepairMessages(
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
        '<INVALID_OUTPUT>',
        raw,
        '</INVALID_OUTPUT>',
        '',
        '<SCHEMA_ERROR>',
        errorMessage,
        '</SCHEMA_ERROR>',
        '',
        '<TASK>',
        'वरील INVALID_OUTPUT schema शी जुळत नाही.',
        'लेखातील तथ्ये न बदलता आणि नवीन तथ्य न जोडता ते दुरुस्त करा.',
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

function validateCopy(parsed: unknown, raw: string): Copy {
  const result = CopySchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `Copy generation did not match the expected schema:\n${result.error.message}\n---\n${raw}`,
    );
  }
  return result.data;
}

// Generates and validates the poster copy for an article. The returned Copy
// carries its own post_type (discriminated union), which the caller passes on to
// the poster renderer.
export async function generateCopy(article: string): Promise<Copy> {
  const raw = await chatComplete(buildMessages(article), {
    temperature: 0.25,
    responseFormat: 'json_object',
  });

  try {
    return validateCopy(parseJson(raw), raw);
  } catch (firstError) {
    const repaired = await chatComplete(
      buildRepairMessages(article, raw, (firstError as Error).message),
      {
        temperature: 0,
        responseFormat: 'json_object',
      },
    );

    try {
      return validateCopy(parseJson(repaired), repaired);
    } catch (repairError) {
      throw new Error(
        [
          'Copy generation failed after repair attempt.',
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
