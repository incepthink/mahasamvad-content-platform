// Derive poster-ready structured "copy" from a generated Marathi article
// (PROJECT_CONTEXT step 14). One JSON-mode LLM call chooses the single best
// post_type (which master template fits the article) and emits the Marathi copy
// fields for that type — spelled exactly, inventing nothing beyond the article.
//
// Guardrails mirror generate-article.ts: Marathi (Devanagari) only; the article
// is the sole source of facts. Names, dates, amounts, designations, scheme names
// and locations must never be invented.

import { CopySchema, type Copy } from '@dgipr/schemas';
import { chatComplete, type ChatMessage } from './openai-chat.js';

const SYSTEM_PROMPT = [
  'तुम्ही महाराष्ट्र शासनाच्या माहिती व जनसंपर्क महासंचालनालयासाठी (DGIPR / महासंवाद)',
  'सोशल-मीडिया पोस्टर्ससाठी मजकूर (copy) तयार करणारे मराठी संपादक आहात.',
  'तुम्हाला एक तयार मराठी लेख दिला जाईल. त्या लेखातील माहितीवरून एका पोस्टरसाठी',
  'संक्षिप्त, ठळक मराठी मजकूर तयार करा आणि तो JSON स्वरूपात परत करा.',
  '',
  'कठोर नियम:',
  '1. सर्व मजकूर फक्त मराठीत (देवनागरी) लिहा. इंग्रजीत भाषांतर करू नका.',
  '2. लेखात नसलेले काहीही तयार करू नका — नावे, तारखा, रक्कम, पदनामे, योजना, ठिकाणे व',
  '   आकडे जशाच्या तशा, लेखातूनच घ्या. कोणतेही नवीन तथ्य जोडू नका.',
  '3. मजकूर पोस्टरसाठी लहान व ठळक ठेवा (शीर्षक थोडक्यात, मुद्दे संक्षिप्त).',
  '',
  'पोस्टरचा प्रकार (post_type) निवडा — लेखाला सर्वात योग्य असा एकच प्रकार:',
  '- "alert": तातडीची सूचना/इशारा. fields: kicker?, headline, subhead?, bullets (नक्की 3, प्रत्येक {text, emphasis?}), scene_brief.',
  '- "campaign": मोहीम/कार्यक्रम/योजना. fields: kicker?, headline, subhead?, schedule?{date?,time?}, audience?, cta?, stats?[{value,label,icon_hint}], scene_brief.',
  '- "info_bullets": माहितीचे मुद्दे. fields: kicker?, headline, subhead?, bullets[{text, emphasis?}], scene_brief.',
  '- "quote": अवतरण/विधान. fields: topic_label?, headline?, quote_text, attribution?{name?,title?}, points?[{text,icon_hint}], scene_brief.',
  '- "timeline": टप्पे/कालरेषा. fields: side_label?, headline, intro?, milestones[{date,text}], scene_brief.',
  '',
  'नियम:',
  '- फक्त निवडलेल्या प्रकाराची fields द्या आणि "post_type" हे field अवश्य समाविष्ट करा.',
  '- "emphasis" म्हणजे मुद्द्यातील ठळक करायचे शब्द (नसल्यास वगळा). "icon_hint" म्हणजे',
  '  त्या घटकासाठी सुचवलेले चिन्ह (उदा. "calendar", "rupee", "people").',
  '- "scene_brief": पोस्टरच्या पार्श्वभूमीतील दृश्याचे थोडक्यात वर्णन (मजकुरावर येणार नाही असे).',
  '',
  'फक्त वैध JSON object परत करा — कोणतेही स्पष्टीकरण, markdown किंवा अतिरिक्त मजकूर नको.',
].join('\n');

function buildMessages(article: string): ChatMessage[] {
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: 'लेख:\n\n' + article + '\n\nया लेखासाठी पोस्टर copy JSON तयार करा.',
    },
  ];
}

// Generates and validates the poster copy for an article. The returned Copy
// carries its own post_type (discriminated union), which the caller passes on to
// the poster renderer.
export async function generateCopy(article: string): Promise<Copy> {
  const raw = await chatComplete(buildMessages(article), {
    temperature: 0.3,
    responseFormat: 'json_object',
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Copy generation returned invalid JSON: ${(error as Error).message}\n---\n${raw}`,
    );
  }

  const result = CopySchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `Copy generation did not match the expected schema:\n${result.error.message}\n---\n${raw}`,
    );
  }
  return result.data;
}
