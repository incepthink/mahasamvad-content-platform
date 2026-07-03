// Revise the poster's background-scene description according to user feedback
// ("चित्र बदला" in the web UI). Returns only a new scene_brief; the caller builds
// the full text-free image prompt with buildScenePrompt (poster-renderer) and pays
// for one new image-generation call.

import { chatComplete, type ChatMessage } from './openai-chat.js';

const SYSTEM_PROMPT = [
  'तुम्ही महाराष्ट्र शासनाच्या माहिती व जनसंपर्क महासंचालनालयासाठी (DGIPR / महासंवाद)',
  'पोस्टरच्या पार्श्वभूमी-दृश्याचे वर्णन (scene brief) लिहिणारे कला-दिग्दर्शक आहात.',
  'तुम्हाला सध्याचे दृश्य-वर्णन आणि वापरकर्त्याचा अभिप्राय दिला जाईल. अभिप्रायानुसार',
  'सुधारलेले नवीन दृश्य-वर्णन तयार करा.',
  '',
  'नियम:',
  '1. वर्णन थोडक्यात, ठोस व चित्रात्मक ठेवा (एक-दोन वाक्ये) — पोस्टरच्या पार्श्वभूमीतील',
  '   छायाचित्रात काय दिसावे ते सांगा.',
  '2. दृश्यात कोणताही मजकूर, अक्षरे, लोगो किंवा चिन्हे नसावीत — फक्त दृश्याचे वर्णन.',
  '3. अभिप्रायाने मागितलेले बदल करा; बाकी सध्याच्या वर्णनाशी सुसंगत रहा.',
  '4. विशिष्ट व्यक्तींची नावे किंवा ओळखता येतील असे चेहरे सुचवू नका.',
  '',
  'फक्त {"scene_brief": "..."} या स्वरूपात वैध JSON object परत करा — कोणतेही',
  'स्पष्टीकरण किंवा अतिरिक्त मजकूर नको.',
].join('\n');

export async function reviseSceneBrief(
  currentSceneBrief: string,
  feedback: string,
): Promise<string> {
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        '## सध्याचे दृश्य-वर्णन (CURRENT SCENE BRIEF):',
        currentSceneBrief,
        '',
        '## वापरकर्त्याचा अभिप्राय (FEEDBACK):',
        feedback,
        '',
        '## कार्य:',
        'सुधारलेले नवीन दृश्य-वर्णन JSON स्वरूपात परत करा.',
      ].join('\n'),
    },
  ];

  const raw = await chatComplete(messages, {
    temperature: 0.4,
    responseFormat: 'json_object',
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Scene revision returned invalid JSON: ${(error as Error).message}\n---\n${raw}`,
    );
  }

  const sceneBrief = (parsed as { scene_brief?: unknown }).scene_brief;
  if (typeof sceneBrief !== 'string' || sceneBrief.trim().length === 0) {
    throw new Error(`Scene revision returned no scene_brief:\n---\n${raw}`);
  }
  return sceneBrief.trim();
}
