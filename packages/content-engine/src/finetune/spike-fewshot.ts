// Step 0 — few-shot validation spike (de-risk before building the FT pipeline).
//
// Question this answers: can the current gpt-4o, given only a category label + ONE real
// example article of that category as a style reference, already produce clearly distinct
// news vs. scheme voices from the SAME set of facts? If yes, fine-tuning may be unnecessary
// (or deferred). If close-but-inconsistent, fine-tuning is justified — and this script has
// already given us the prompt/label format and a hand test note to reuse.
//
// Run: `tsx --env-file=../../.env src/finetune/spike-fewshot.ts`
// Cost: two gpt-4o completions (a few cents). Writes both outputs to data/finetune/spike/.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { extractParagraphs } from '../chunking/chunk-articles.js';
import { chatComplete, type ChatMessage } from '../generation/openai-chat.js';
import type { FinetuneCategory, LabeledPost } from './build-corpus.js';

// One-line voice descriptor per category — the style the model should match. Kept short;
// the real style signal comes from the in-context EXAMPLE article.
const STYLE_DESCRIPTOR: Record<FinetuneCategory, string> = {
  scheme:
    'योजना-लेख (feature): सविस्तर, चिंतनशील, पार्श्वभूमी–उद्देश–तपशील–यंत्रणा–समारोप ' +
    'अशी रचना; सकारात्मक, शासकीय सूर; लांबी मोठी.',
  news:
    'बातमी (news report): नेमकी, वस्तुनिष्ठ, महत्त्वाची माहिती सुरुवातीलाच (dateline/' +
    'ठिकाण-दिनांक शैली); त्रोटक परिच्छेद; कमी लांबी.',
};

const CATEGORY_LABEL: Record<FinetuneCategory, string> = {
  scheme: 'योजना-लेख',
  news: 'बातमी',
};

// A hand-written note with concrete HARD FACTS (names, numbers, dates, a scheme) so the
// same facts can be rendered in both voices AND we can eyeball faithfulness afterwards.
const TEST_NOTE = [
  '- योजना: पुण्यश्लोक अहिल्यादेवी होळकर शेतकरी कर्जमुक्ती योजना २०२६',
  '- जिल्हा: नांदेड; एकूण पात्र शेतकरी: १,२०,०००',
  '- नांदेड जिल्हा मध्यवर्ती सहकारी बँकेमार्फत ४५,००० खातेधारकांची माहिती पोर्टलवर अपलोड',
  '- जिल्हाधिकारी श्री. राजेश कुमार यांनी माहिती दिली',
  '- अर्ज/पडताळणीची अंतिम मुदत: ३१ ऑगस्ट २०२६',
  '- ‘एकवेळ समझोता’ (One Time Settlement) सुविधा पात्र शेतकऱ्यांना उपलब्ध',
].join('\n');

function buildMessages(
  category: FinetuneCategory,
  example: string,
  note: string,
): ChatMessage[] {
  const system = [
    'तुम्ही महाराष्ट्र शासनाच्या माहिती व जनसंपर्क महासंचालनालयासाठी (महासंवाद) लिहिणारे',
    'मराठी लेखक आहात. फक्त मराठीत (देवनागरी) लिहा.',
    '',
    `श्रेणी (CATEGORY): ${CATEGORY_LABEL[category]}`,
    `शैली: ${STYLE_DESCRIPTOR[category]}`,
    '',
    'कठोर नियम: दिलेल्या "टिपणी"तील माहिती हाच एकमेव तथ्य-स्रोत आहे. नवीन नावे, आकडे,',
    'तारखा, रक्कम किंवा योजना स्वतःहून तयार करू नका. शैलीदार जोडणी/पार्श्वभूमी चालेल,',
    'पण नवीन ठोस तथ्ये नकोत. खालील उदाहरण-लेखाची फक्त शैली, रचना व लांबी अनुसरा (त्यातील',
    'तथ्ये वापरू नका).',
  ].join('\n');

  const user = [
    `## उदाहरण-लेख (${CATEGORY_LABEL[category]} शैली — फक्त शैली/रचनेसाठी):`,
    example,
    '',
    '## टिपणी (NOTES — एकमेव तथ्य-स्रोत):',
    note,
    '',
    `## कार्य: वरील टिपणीतील माहिती ${CATEGORY_LABEL[category]} शैलीत मांडून लेख लिहा.`,
  ].join('\n');

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

// Reconstruct an article's clean paragraph text (from contentHtml, so paragraph
// boundaries survive) for use as an in-context style example.
function articleText(post: LabeledPost['post']): string {
  return extractParagraphs(post.contentHtml).join('\n\n');
}

// Pick a representative example per category: the longest scheme post (a true feature)
// and a mid-length news post (a typical bulletin, not an outlier).
function pickExample(
  corpus: LabeledPost[],
  category: FinetuneCategory,
): LabeledPost {
  const ofCat = corpus
    .filter((item) => item.category === category)
    .sort((a, b) => a.post.contentText.length - b.post.contentText.length);
  if (ofCat.length === 0) {
    throw new Error(`No ${category} posts in corpus.`);
  }
  return category === 'scheme'
    ? (ofCat[ofCat.length - 1] as LabeledPost) // longest = feature
    : (ofCat[Math.floor(ofCat.length / 2)] as LabeledPost); // median = typical bulletin
}

async function main(): Promise<void> {
  const dataDir = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../data',
  );
  const corpus = JSON.parse(
    await readFile(resolve(dataDir, 'finetune/corpus.json'), 'utf8'),
  ) as LabeledPost[];

  const outDir = resolve(dataDir, 'finetune/spike');
  await mkdir(outDir, { recursive: true });
  await writeFile(resolve(outDir, 'test-note.txt'), TEST_NOTE, 'utf8');

  for (const category of ['scheme', 'news'] as const) {
    const example = pickExample(corpus, category);
    const messages = buildMessages(
      category,
      articleText(example.post),
      TEST_NOTE,
    );
    console.log(
      `\n=== ${CATEGORY_LABEL[category]} (${category}) — example: "${example.post.title}" ===\n`,
    );
    const output = await chatComplete(messages, { temperature: 0.4 });
    console.log(output);
    await writeFile(resolve(outDir, `${category}.md`), output, 'utf8');
  }

  console.log(`\n\nSaved both outputs to ${outDir}`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
