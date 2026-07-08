// Revise the poster's background-scene description according to user feedback
// ("चित्र बदला" in the web UI). Returns only a new scene_brief; the caller builds
// the full text-free image prompt with buildScenePrompt (poster-renderer) and pays
// for one new image-generation call.

import { chatComplete, type ChatMessage } from './openai-chat.js';

const SYSTEM_PROMPT = [
  'तुम्ही महाराष्ट्र शासनाच्या माहिती व जनसंपर्क महासंचालनालयासाठी (DGIPR / महासंवाद)',
  'पोस्टरच्या पार्श्वभूमी-दृश्याचे वर्णन (scene brief) लिहिणारे अनुभवी कला-दिग्दर्शक आहात.',
  'तुम्हाला सध्याचे दृश्य-वर्णन आणि वापरकर्त्याचा अभिप्राय दिला जाईल. अभिप्रायानुसार',
  'सुधारलेले नवीन दृश्य-वर्णन तयार करा.',
  '',
  'मुख्य उद्देश:',
  'हे scene_brief पोस्टरच्या पार्श्वभूमीतील text-free दृश्यासाठी आहे. पोस्टरवरील headline,',
  'मुद्दे, चिन्हे, लोगो, शिक्के किंवा इतर मजकूर वेगळ्या renderer मधून बसवले जातील.',
  '',
  'कठोर नियम:',
  '1. फक्त {"scene_brief": "..."} या स्वरूपात वैध JSON object परत करा.',
  '2. scene_brief चे मूल्य मराठीत आणि देवनागरी लिपीत लिहा.',
  '3. scene_brief थोडक्यात, ठोस आणि चित्रात्मक ठेवा — साधारण एक ते दोन वाक्ये.',
  '4. दृश्यात कोणताही मजकूर, अक्षरे, अंक, फलक, कागदावरील वाचनीय मजकूर, लोगो, शिक्का,',
  '   सरकारी चिन्ह, watermark किंवा UI elements नसावेत.',
  '5. अभिप्रायाने मागितलेले दृश्यात्मक बदल करा; पण दृश्य सध्याच्या वर्णनाशी आणि शासकीय',
  '   पोस्टरच्या संयत, विश्वासार्ह शैलीशी सुसंगत ठेवा.',
  '6. विशिष्ट व्यक्तींची नावे, ओळखता येतील असे चेहरे, राजकीय नेते, मंत्री, अधिकारी,',
  '   celebrity किंवा खऱ्या व्यक्तींचे likeness सुचवू नका.',
  '7. जर अभिप्रायात फोटोमध्ये मजकूर, लोगो, चेहरा, ओळखता येणारी व्यक्ती किंवा तथ्यात्मक',
  '   दावा दाखवण्याची मागणी असेल, तर ती मागणी दृश्यात समाविष्ट करू नका; त्याऐवजी सुरक्षित,',
  '   प्रतीकात्मक आणि text-free दृश्य सुचवा.',
  '8. भीतीदायक, धक्कादायक, हिंसक, शोषणात्मक किंवा अति नाट्यमय दृश्ये सुचवू नका.',
  '9. बालकांशी संबंधित विषय असल्यास मुलांना संकटात, रडताना, जखमी, असुरक्षित किंवा ओळखता',
  '   येईल अशा पद्धतीने दाखवू नका; सुरक्षित, सन्मानजनक आणि प्रतीकात्मक वातावरण दाखवा.',
  '10. दृश्य हे पार्श्वभूमीसाठी असावे — खूप गर्दीचे, अतितपशीलवार किंवा मजकुरासाठी अडथळा',
  '    निर्माण करणारे नसावे.',
  '',
  'फक्त वैध JSON object परत करा. स्पष्टीकरण, markdown, code fence किंवा अतिरिक्त मजकूर देऊ नका.',
].join('\n');

function buildMessages(
  currentSceneBrief: string,
  feedback: string,
): ChatMessage[] {
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        '<CURRENT_SCENE_BRIEF>',
        currentSceneBrief.trim(),
        '</CURRENT_SCENE_BRIEF>',
        '',
        '<FEEDBACK purpose="visual_direction_only">',
        feedback.trim(),
        '</FEEDBACK>',
        '',
        '<TASK>',
        'FEEDBACK नुसार सुधारलेले नवीन scene_brief JSON स्वरूपात परत करा.',
        'दृश्य text-free, लोगो-मुक्त, सुरक्षित आणि प्रतीकात्मक ठेवा.',
        '</TASK>',
      ].join('\n'),
    },
  ];
}

function buildRepairMessages(
  currentSceneBrief: string,
  feedback: string,
  raw: string,
  errorMessage: string,
): ChatMessage[] {
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        '<CURRENT_SCENE_BRIEF>',
        currentSceneBrief.trim(),
        '</CURRENT_SCENE_BRIEF>',
        '',
        '<FEEDBACK purpose="visual_direction_only">',
        feedback.trim(),
        '</FEEDBACK>',
        '',
        '<INVALID_OUTPUT>',
        raw,
        '</INVALID_OUTPUT>',
        '',
        '<ERROR>',
        errorMessage,
        '</ERROR>',
        '',
        '<TASK>',
        'वरील INVALID_OUTPUT दुरुस्त करा.',
        'फक्त {"scene_brief": "..."} या स्वरूपातील वैध JSON object परत करा.',
        'scene_brief मराठीत, text-free दृश्यासाठी, एक-दोन वाक्यांत लिहा.',
        'स्पष्टीकरण, markdown किंवा code fence देऊ नका.',
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

function validateSceneBrief(parsed: unknown, raw: string): string {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(
      `Scene revision did not return a JSON object:\n---\n${raw}`,
    );
  }

  const sceneBrief = (parsed as { scene_brief?: unknown }).scene_brief;

  if (typeof sceneBrief !== 'string' || sceneBrief.trim().length === 0) {
    throw new Error(`Scene revision returned no scene_brief:\n---\n${raw}`);
  }

  const trimmed = sceneBrief.trim();

  if (trimmed.length > 450) {
    throw new Error(
      `Scene revision returned an overly long scene_brief (${trimmed.length} chars):\n---\n${raw}`,
    );
  }

  return trimmed;
}

export async function reviseSceneBrief(
  currentSceneBrief: string,
  feedback: string,
): Promise<string> {
  const raw = await chatComplete(buildMessages(currentSceneBrief, feedback), {
    temperature: 0.35,
    responseFormat: 'json_object',
  });

  try {
    return validateSceneBrief(parseJson(raw), raw);
  } catch (firstError) {
    const repaired = await chatComplete(
      buildRepairMessages(
        currentSceneBrief,
        feedback,
        raw,
        (firstError as Error).message,
      ),
      {
        temperature: 0,
        responseFormat: 'json_object',
      },
    );

    try {
      return validateSceneBrief(parseJson(repaired), repaired);
    } catch (repairError) {
      throw new Error(
        [
          'Scene revision failed after repair attempt.',
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
