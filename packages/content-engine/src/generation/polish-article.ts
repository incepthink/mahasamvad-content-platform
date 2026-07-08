// Optional Marathi editor-polish step (Sarvam-30B).
//
// Runs AFTER the OpenAI/RAG draft + coverage check and BEFORE the existing faithfulness
// (findUnsupportedClaims) check in generate-article.ts.
//
// This improves ONLY the Marathi prose — flow, sentence rhythm, formal government tone,
// and Mahasamvad-style phrasing — and must NOT change any fact. Because the faithfulness
// pass runs immediately after this, any unsupported drift is caught and repaired downstream.
//
// Env-gated with:
//   ENABLE_SARVAM_POLISH=true

import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { sarvamChatComplete } from './sarvam-chat.js';
import type { ChatMessage } from './openai-chat.js';
import { CATEGORY_LABEL, type ArticleCategory } from './category-prompt.js';

const POLISH_SYSTEM_PROMPT = [
  'तुम्ही महाराष्ट्र शासनाच्या माहिती व जनसंपर्क महासंचालनालयाचे (DGIPR / महासंवाद) अनुभवी',
  'मराठी संपादक आहात. तुमच्याकडे आधीच तयार असलेला मराठी लेख संपादनासाठी येतो. तुमचे काम',
  'फक्त भाषिक संपादन (copy-editing) आहे — लेखाचा ओघ, वाक्यरचना, वाक्यांची लय, औपचारिक',
  'शासकीय सूर आणि महासंवाद-शैलीतील अधिकृत भाषा सुधारणे.',
  '',
  'कठोर नियम:',
  '1. टिपणी (NOTES) हाच तथ्यांचा एकमेव व अधिकृत स्रोत आहे.',
  '2. कोणतेही तथ्य जोडू, वगळू किंवा बदलू नका.',
  '3. टिपणीत नसलेली नवीन नावे, तारखा, ठिकाणे, रक्कम/आकडे, पदनामे, कायदे, योजना,',
  '   अवतरणे (quotes), byline किंवा दावे तयार करू नका.',
  '4. फक्त शब्दयोजना, परिच्छेदांचा ओघ, औपचारिक सूर आणि संपादकीय भाषाशैली सुधारा.',
  '   तथ्यांश जसाच्या तसा ठेवा. नावे, आकडे, तारखा, पदनामे आणि ठिकाणे बदलू नका.',
  '5. लेखाची मुख्य रचना, शीर्षक असल्यास शीर्षक, आणि परिच्छेदांचा मूळ क्रम शक्य तितका कायम ठेवा.',
  '   लेखात byline आधीपासून असल्यासच ते कायम ठेवा; नसल्यास नवीन byline जोडू नका.',
  '6. लेख लहान करू नका, सारांश करू नका किंवा माहिती कमी करू नका. फक्त भाषाशैली सुधारा.',
  '7. सारांशसदृश वाक्यरचना टाळा — उदा. "करायचे आहे", "तपासणे आवश्यक आहे",',
  '   "यांचा समावेश आहे", "आढावा घ्यायचा आहे", "हे पाहणे गरजेचे आहे".',
  '8. त्याऐवजी अधिकृत महासंवाद-शैलीतील वाक्यरचना वापरा — उदा. "निर्देश दिले आहेत",',
  '   "सूचना देण्यात आल्या आहेत", "आयोगाने स्पष्ट केले आहे", "आयोगाने नमूद केले आहे",',
  '   "अहवालात समावेश अपेक्षित आहे".',
  '9. “आढावा घ्यायचा आहे” ऐवजी “आढावा घेण्याचे निर्देश दिले आहेत” अशी अधिकृत रचना वापरा.',
  '10. “तपासणे आवश्यक आहे” ऐवजी “तपासणी करण्याच्या सूचना देण्यात आल्या आहेत” अशी रचना वापरा.',
  '11. “यांचा समावेश आहे” ऐवजी “अहवालात यांचा समावेश अपेक्षित आहे” अशी रचना वापरा.',
  '12. अंतिम उत्तरात फक्त संपादित लेख द्या — कोणतेही स्पष्टीकरण, टिपण्या, markdown शीर्षके,',
  '    bullet points, JSON किंवा तथ्य-तपासणी यादी देऊ नका.',
].join('\n');

export function isSarvamPolishEnabled(): boolean {
  return process.env.ENABLE_SARVAM_POLISH === 'true';
}

export async function polishArticleWithSarvam(
  note: string,
  article: string,
  category: ArticleCategory,
): Promise<string> {
  const userPrompt = [
    '<NOTES purpose="only_authoritative_fact_source">',
    note.trim(),
    '</NOTES>',
    '',
    '<ARTICLE purpose="draft_to_polish_not_fact_source">',
    article.trim(),
    '</ARTICLE>',
    '',
    '<TASK>',
    `वरील लेख ${CATEGORY_LABEL[category]} श्रेणीतील आहे. या लेखाचे फक्त भाषिक संपादन करा.`,
    'ओघ, वाक्यरचना, वाक्यांची लय, औपचारिक शासकीय सूर आणि अधिकृत महासंवाद-शैलीतील भाषा सुधारा.',
    'NOTES मध्ये नसलेले कोणतेही तथ्य जोडू नका.',
    'लेखातील कोणतेही तथ्य बदलू किंवा वगळू नका.',
    'लेख लहान करू नका किंवा सारांश करू नका.',
    'सारांशसदृश वाक्ये अधिकृत वाक्यरचनेत रूपांतरित करा.',
    'अंतिम उत्तरात फक्त संपादित लेख द्या.',
    '</TASK>',
  ].join('\n');

  const messages: ChatMessage[] = [
    { role: 'system', content: POLISH_SYSTEM_PROMPT },
    { role: 'user', content: userPrompt },
  ];

  return (await sarvamChatComplete(messages, { temperature: 0.25 })).trim();
}

export async function maybePolishArticleWithSarvam(
  note: string,
  article: string,
  category: ArticleCategory,
): Promise<string> {
  if (!isSarvamPolishEnabled()) {
    return article;
  }

  return polishArticleWithSarvam(note, article, category);
}

// Run directly to eyeball the polish in isolation:
//
//   ENABLE_SARVAM_POLISH=true SARVAM_API_KEY=... \
//   tsx --env-file=../../.env src/generation/polish-article-sarvam.ts
//
// Reads data/sample-note.txt and data/sample-article.txt if present.
// Falls back to a tiny inline sample when those files are absent.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const dataDir = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../data',
  );

  const readOrNull = async (path: string): Promise<string | null> => {
    try {
      return await readFile(path, 'utf8');
    } catch {
      return null;
    }
  };

  const SAMPLE_NOTE =
    'मुख्यमंत्र्यांच्या अध्यक्षतेखाली आज मंत्रालयात राज्यस्तरीय आढावा बैठक झाली. ' +
    'ग्रामीण भागातील पाणीपुरवठा योजनांचा आढावा घेण्यात आला. संबंधित विभागांना ' +
    '३१ जुलैपर्यंत अहवाल सादर करण्यास सांगितले. प्रलंबित कामे पूर्ण करण्याबाबत चर्चा झाली.';

  const SAMPLE_ARTICLE =
    'मुख्यमंत्र्यांच्या अध्यक्षतेखाली राज्यस्तरीय आढावा बैठक झाली. या बैठकीत ग्रामीण ' +
    'भागातील पाणीपुरवठा योजनांचा आढावा घ्यायचा आहे. संबंधित विभागांनी ३१ जुलैपर्यंत ' +
    'अहवाल सादर करायचा आहे. प्रलंबित कामे पूर्ण करायची आहेत.';

  Promise.all([
    readOrNull(join(dataDir, 'sample-note.txt')),
    readOrNull(join(dataDir, 'sample-article.txt')),
  ])
    .then(async ([noteFile, articleFile]) => {
      const note = noteFile ?? SAMPLE_NOTE;
      const article = articleFile ?? SAMPLE_ARTICLE;

      console.log('\n=== मूळ लेख (input article) ===\n');
      console.log(article);

      const polished = await polishArticleWithSarvam(note, article, 'news');

      console.log('\n=== संपादित लेख (Sarvam-polished) ===\n');
      console.log(polished);
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
