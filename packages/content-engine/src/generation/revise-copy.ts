// Revise poster copy according to free-text user feedback ("मजकूर सुधारा" in the
// web UI). Text-only changes: post_type and scene_brief stay fixed, and the article
// remains the sole source of facts — so the caller can re-render the poster with
// the CACHED scene image (no new image-generation call).

import { CopySchema, type Copy } from '@dgipr/schemas';
import { chatComplete, type ChatMessage } from './openai-chat.js';

const SYSTEM_PROMPT = [
  'तुम्ही महाराष्ट्र शासनाच्या माहिती व जनसंपर्क महासंचालनालयासाठी (DGIPR / महासंवाद)',
  'सोशल-मीडिया पोस्टर्सचा मजकूर (copy) सुधारणारे मराठी संपादक आहात.',
  'तुम्हाला पोस्टरचा सध्याचा copy JSON, तो ज्या लेखावर आधारित आहे तो लेख, आणि',
  'वापरकर्त्याचा अभिप्राय दिला जाईल. अभिप्रायानुसार copy JSON सुधारून परत करा.',
  '',
  'कठोर नियम:',
  '1. सर्व मजकूर फक्त मराठीत (देवनागरी) लिहा.',
  '2. लेखात नसलेले काहीही जोडू नका — नावे, तारखा, रक्कम, पदनामे, योजना, ठिकाणे व आकडे',
  '   लेखातूनच, जशाच्या तशा घ्या.',
  '3. फक्त अभिप्रायाने मागितलेले बदल करा; बाकीची fields जशीच्या तशी ठेवा.',
  '4. "post_type" बदलू नका आणि "scene_brief" जसाच्या तसा ठेवा (चित्र बदलण्याचा वेगळा',
  '   मार्ग आहे).',
  '5. मजकूर पोस्टरसाठी लहान व ठळक ठेवा.',
  '',
  'फक्त वैध JSON object परत करा — सध्याच्या copy JSON सारख्याच रचनेत, कोणतेही',
  'स्पष्टीकरण, markdown किंवा अतिरिक्त मजकूर नको.',
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
        '## लेख (ARTICLE — तथ्यांचा एकमेव स्रोत):',
        article,
        '',
        '## सध्याचा copy JSON:',
        JSON.stringify(current, null, 2),
        '',
        '## वापरकर्त्याचा अभिप्राय (FEEDBACK):',
        feedback,
        '',
        '## कार्य:',
        'अभिप्रायानुसार सुधारलेला copy JSON परत करा.',
      ].join('\n'),
    },
  ];
}

export async function reviseCopy(
  current: Copy,
  feedback: string,
  article: string,
): Promise<Copy> {
  const raw = await chatComplete(buildMessages(current, feedback, article), {
    temperature: 0.3,
    responseFormat: 'json_object',
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Copy revision returned invalid JSON: ${(error as Error).message}\n---\n${raw}`,
    );
  }

  const result = CopySchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `Copy revision did not match the expected schema:\n${result.error.message}\n---\n${raw}`,
    );
  }
  if (result.data.post_type !== current.post_type) {
    throw new Error(
      `Copy revision changed post_type from "${current.post_type}" to ` +
        `"${result.data.post_type}", which the revision prompt forbids.`,
    );
  }
  // The scene stays what the user already approved; a drifting scene_brief would
  // silently change the background on the next scene regeneration.
  return { ...result.data, scene_brief: current.scene_brief };
}
