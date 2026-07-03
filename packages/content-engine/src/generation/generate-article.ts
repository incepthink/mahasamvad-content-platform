// Generate a Mahasamvad-style Marathi article from meeting notes + a retrieved style
// reference (PROJECT_CONTEXT step 12), followed by a traceability appendix (step 13).
// This is the reusable entry point a future backend API will import.
//
// Guardrails (from AGENTS.md): output must be Marathi (Devanagari); the NOTES are the
// ONLY source of information AND the completeness spec — the article must convey ALL of
// the notes (facts AND responsibilities/objectives/purposes) and INVENT nothing not in
// them. Retrieved reference articles inform STYLE/STRUCTURE/PHRASING only; names, dates,
// amounts, designations, scheme names, and locations must never be invented.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { generatePoster } from '@dgipr/poster-renderer';
import {
  retrieveReferenceArticle,
  type ReferenceArticle,
} from '../retrieval/retrieve-references.js';
import { chatComplete, type ChatMessage } from './openai-chat.js';
import { generateCopy } from './generate-copy.js';
import {
  findMissingInformation,
  findUnsupportedClaims,
} from './verify-coverage.js';

// Delimiter the model uses to separate the article from its traceability appendix, so a
// caller can split the two if needed.
export const FACT_CHECK_DELIMITER = '---तथ्य-तपासणी---';

// Exported so revise-article.ts can reuse the exact same guardrails when applying
// user feedback (the notes stay the sole source of facts).
export const SYSTEM_PROMPT = [
  'तुम्ही महाराष्ट्र शासनाच्या माहिती व जनसंपर्क महासंचालनालयासाठी (DGIPR / महासंवाद)',
  'लेख लिहिणारे मराठी लेखक आहात. तुम्ही "महासंवाद" शैलीतील सविस्तर, चिंतनशील',
  'फीचर-लेख (feature article) तयार करता.',
  '',
  'कठोर नियम:',
  '1. संपूर्ण लेख फक्त मराठीत (देवनागरी) लिहा. इंग्रजीत भाषांतर करू नका.',
  '2. दिलेली "टिपणी" (NOTES) हाच माहितीचा एकमेव व अधिकृत स्रोत आहे आणि तीच लेखाच्या',
  '   संपूर्णतेचा मापदंड आहे. टिपणीतील प्रत्येक माहिती-घटक लेखात आलाच पाहिजे — फक्त नावे,',
  '   तारखा, रक्कम, पदनामे, योजना व ठिकाणेच नव्हे, तर प्रत्येक समितीची कार्ये, जबाबदाऱ्या,',
  '   उद्दिष्टे, उद्देश, प्रक्रिया व अटी हेही आलेच पाहिजेत. एकही घटक वगळू नका किंवा गाळून',
  '   सारांश करू नका. आकडे, नावे व तारखा जशाच्या तशा ठेवा, त्यांचा अर्थ बदलू नका.',
  '3. टिपणीत नसलेले काहीही स्वतःहून तयार करू नका किंवा अंदाजे लिहू नका — कोणतेही नवीन',
  '   तथ्य, अट, जबाबदारी, पदनाम, आकडा किंवा दावा जोडू नका.',
  '4. "संदर्भ लेख" (REFERENCE) हा फक्त लेखनशैली, रचना, ओघ व लांबीसाठी आहे — त्यातील तथ्ये',
  '   वापरू नका. एखादी माहिती (उदा. समितीची रचना व जबाबदाऱ्या) कशी मांडायची याबद्दल शंका',
  '   असल्यास, संदर्भ लेखातील मांडणी व शैलीचे अनुकरण करा.',
  '5. लेखाची रचना: आकर्षक व अर्थपूर्ण शीर्षक, प्रस्तावनात्मक सुरुवात (hook), संदर्भ/',
  '   पार्श्वभूमी, योजनेचा उद्देश व तपशील, अंमलबजावणीची यंत्रणा आणि समारोप. जिथे अनेक',
  '   समित्या/घटक आहेत तिथे प्रत्येक समितीचे सदस्य व तिच्या जबाबदाऱ्या एकत्र, स्पष्टपणे',
  '   मांडा — एका समितीची माहिती दुसऱ्या समितीत मिसळू नका. सूर सकारात्मक व शासकीय ठेवा.',
  '6. लेखाच्या शेवटी "Team DGIPR" असे कर्तृत्व (byline) द्या.',
  '',
  `7. लेखानंतर एका नवीन ओळीवर "${FACT_CHECK_DELIMITER}" हा विभाजक लिहा आणि त्याखाली`,
  '   तथ्य-तपासणी यादी द्या: लेखात मांडलेला प्रत्येक माहिती-घटक (नाव / तारीख / रक्कम /',
  '   पदनाम / योजना / ठिकाण / जबाबदारी / उद्दिष्ट) आणि तो टिपणीतील नेमक्या कोणत्या भागातून',
  '   घेतला ते नमूद करा. जर एखादा घटक टिपणीत नसेल तर तो लेखात वापरूच नका.',
].join('\n');

// Build the chat messages: guardrail system prompt + the notes (source + completeness
// spec) and one full retrieved article (style/structure/length/phrasing).
export function buildMessages(
  note: string,
  reference: ReferenceArticle | null,
): ChatMessage[] {
  const refBlock = reference
    ? `शीर्षक: ${reference.title}\n\n${reference.text}`
    : '(संदर्भ लेख उपलब्ध नाही — केवळ टिपणीतील माहितीवर आधारित महासंवाद शैलीत लिहा.)';

  const userPrompt = [
    '## टिपणी (NOTES — माहितीचा एकमेव स्रोत व संपूर्णतेचा मापदंड):',
    note,
    '',
    '## संदर्भ लेख (REFERENCE — फक्त शैली/रचना/ओघ/लांबीसाठी, तथ्यांसाठी नाही):',
    refBlock,
    '',
    '## कार्य:',
    'वरील टिपणीतील संपूर्ण माहिती (सर्व तथ्ये आणि प्रत्येक समितीची कार्ये, जबाबदाऱ्या व',
    'उद्दिष्टे यांसह) संदर्भ लेखाच्या शैली, रचना व लांबीत मांडून एक संपूर्ण महासंवाद-शैलीतील',
    'मराठी फीचर-लेख तयार करा. नियमांचे काटेकोर पालन करा, टिपणीतील एकही घटक वगळू नका,',
    'टिपणीत नसलेले काहीही जोडू नका, आणि शेवटी तथ्य-तपासणी यादी द्या.',
  ].join('\n');

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userPrompt },
  ];
}

export type GeneratedArticle = Readonly<{
  // Full model output: the article followed by the traceability appendix.
  content: string;
  // The article portion (before the traceability delimiter).
  article: string;
  // The traceability appendix (after the delimiter), if present.
  factCheck: string | null;
  // The single full article retrieved and fed as a style/structure reference.
  reference: ReferenceArticle | null;
}>;

// Notes longer than this (characters) are split into sections and generated
// part-by-part, then merged — a single pass over a very long note tends to summarize
// and silently drop information. Mirrors MAX_QUERY_CHARS in retrieve-references.ts.
const SECTION_THRESHOLD_CHARS = 6000;

// Split notes into sections on blank-line boundaries, packing consecutive blocks up
// to `maxChars` so each generated part stays focused. Falls back to the whole note.
export function splitNoteIntoSections(
  note: string,
  maxChars = SECTION_THRESHOLD_CHARS,
): string[] {
  const blocks = note
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0);

  const sections: string[] = [];
  let buffer: string[] = [];
  let bufferChars = 0;
  const flush = (): void => {
    if (buffer.length === 0) return;
    sections.push(buffer.join('\n\n'));
    buffer = [];
    bufferChars = 0;
  };
  for (const block of blocks) {
    if (buffer.length > 0 && bufferChars + block.length > maxChars) flush();
    buffer.push(block);
    bufferChars += block.length;
  }
  flush();
  return sections.length > 0 ? sections : [note];
}

// Prompt for drafting one section into detailed Marathi prose (no title/byline/
// appendix — this is one part of a larger article the assembly pass will merge).
const PASSAGE_SYSTEM_PROMPT = [
  'तुम्ही महासंवाद शैलीत लिहिणारे मराठी लेखक आहात. दिलेल्या टिपणीच्या भागावरून एक',
  'सविस्तर, ओघवता मराठी (देवनागरी) मजकूर लिहा.',
  '',
  'नियम:',
  '1. फक्त मराठीत (देवनागरी) लिहा.',
  '2. या भागातील संपूर्ण माहिती वापरा — नावे, तारखा, रक्कम, पदनामे, योजना व ठिकाणेच नव्हे,',
  '   तर समित्यांची कार्ये, जबाबदाऱ्या, उद्दिष्टे व प्रक्रिया हेही. एकही घटक वगळू नका.',
  '3. टिपणीत नसलेले काहीही स्वतःहून तयार करू नका किंवा जोडू नका.',
  '4. शीर्षक, byline किंवा तथ्य-तपासणी लिहू नका — फक्त मजकूर लिहा.',
].join('\n');

// Draft a single section of notes into a detailed Marathi passage.
async function generatePassage(sectionNote: string): Promise<string> {
  const messages: ChatMessage[] = [
    { role: 'system', content: PASSAGE_SYSTEM_PROMPT },
    {
      role: 'user',
      content: ['## टिपणी (भाग):', sectionNote, '', '## मजकूर:'].join('\n'),
    },
  ];
  return (await chatComplete(messages)).trim();
}

// Long-note path: draft each section, then run one assembly pass that merges the
// drafts into a single coherent Mahasamvad article (one intro/conclusion), still fed
// the full notes (completeness) and the reference article (structure/length).
async function generateSectioned(
  note: string,
  reference: ReferenceArticle | null,
): Promise<string> {
  const sections = splitNoteIntoSections(note);
  const passages: string[] = [];
  for (const section of sections) {
    passages.push(await generatePassage(section));
  }
  const draft = passages.join('\n\n');
  // Assemble from the drafted prose, but keep the original notes as the completeness
  // spec so the assembly pass can restore anything a section draft compressed.
  const messages = buildMessages(note, reference);
  messages.push({
    role: 'user',
    content: [
      '## भागश: तयार केलेला मसुदा (DRAFT — यावर आधारित अंतिम लेख रचा):',
      draft,
    ].join('\n'),
  });
  return chatComplete(messages);
}

// Trim trailing markdown-only noise (horizontal rules / bare heading markers) the model
// sometimes emits just before the delimiter, e.g. "...Team DGIPR\n\n---\n\n### ".
function trimTrailingMarkers(text: string): string {
  return text.replace(/(?:\s*[\n]\s*(?:#+|[-*_]{3,})\s*)+$/u, '').trim();
}

// Split full model output into the article body and the traceability appendix. The model
// may decorate the delimiter (e.g. "### ---तथ्य-तपासणी---"), so we locate the delimiter
// substring and drop any heading/rule prefix left dangling on the article side.
export function splitContent(content: string): {
  article: string;
  factCheck: string | null;
} {
  const delimiterIndex = content.indexOf(FACT_CHECK_DELIMITER);
  const article =
    delimiterIndex === -1
      ? trimTrailingMarkers(content)
      : trimTrailingMarkers(content.slice(0, delimiterIndex));
  const factCheck =
    delimiterIndex === -1
      ? null
      : content.slice(delimiterIndex + FACT_CHECK_DELIMITER.length).trim();
  return { article, factCheck };
}

// Ask the model to rewrite a draft so it also covers the information the coverage check
// found missing, keeping style, structure, length and the traceability appendix intact.
function buildCoverageRevisionMessages(
  draft: string,
  missingInfo: string[],
): ChatMessage[] {
  const missingBlock = missingInfo.map((item) => `- ${item}`).join('\n');
  const userPrompt = [
    '## आधीचा लेख (DRAFT):',
    draft,
    '',
    '## लेखात न आलेली माहिती (MISSING INFORMATION):',
    missingBlock,
    '',
    '## कार्य:',
    'वरील लेखात खालील माहिती गहाळ आहे. तीच शैली, रचना व लांबी कायम ठेवून, ही सर्व गहाळ',
    'माहिती योग्य ठिकाणी (संबंधित समिती/विभागात) समाविष्ट करून संपूर्ण लेख पुन्हा लिहा.',
    'आकडे, नावे व तारखा जशाच्या तशा ठेवा. टिपणीत नसलेले काहीही जोडू नका. शेवटी',
    'तथ्य-तपासणी यादी पुन्हा द्या.',
  ].join('\n');
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userPrompt },
  ];
}

// Ask the model to rewrite a draft removing/repairing claims the faithfulness check
// found to be unsupported by the notes, without dropping any genuine information.
function buildFaithfulnessRevisionMessages(
  draft: string,
  unsupported: string[],
): ChatMessage[] {
  const unsupportedBlock = unsupported.map((item) => `- ${item}`).join('\n');
  const userPrompt = [
    '## आधीचा लेख (DRAFT):',
    draft,
    '',
    '## टिपणीत नसलेली (असमर्थित) विधाने (UNSUPPORTED CLAIMS):',
    unsupportedBlock,
    '',
    '## कार्य:',
    'वरील विधाने टिपणीत नाहीत. तीच शैली, रचना व लांबी कायम ठेवून ही असमर्थित विधाने',
    'काढून टाका किंवा टिपणीशी सुसंगत करा. टिपणीतील खरी माहिती मात्र वगळू नका. शेवटी',
    'तथ्य-तपासणी यादी पुन्हा द्या.',
  ].join('\n');
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userPrompt },
  ];
}

// Max revision passes in the coverage loop before we return the best draft as-is, so
// generation never loops forever if a unit genuinely cannot be placed.
const MAX_COVERAGE_REVISIONS = 2;

// Pipeline phases reported through onProgress, in order, so a caller (the API job
// runner) can surface user-visible progress while generation runs.
export type GenerateArticlePhase =
  | 'retrieve'
  | 'draft'
  | 'coverage'
  | 'faithfulness';

export type GenerateArticleOptions = Readonly<{
  onProgress?: (phase: GenerateArticlePhase) => void;
}>;

export async function generateArticle(
  note: string,
  options?: GenerateArticleOptions,
): Promise<GeneratedArticle> {
  const onProgress = options?.onProgress ?? (() => {});

  onProgress('retrieve');
  const reference = await retrieveReferenceArticle(note);

  onProgress('draft');
  let content =
    note.length > SECTION_THRESHOLD_CHARS
      ? await generateSectioned(note, reference)
      : await chatComplete(buildMessages(note, reference));

  // Coverage loop: verify the article body conveys every information unit in the notes;
  // if any are missing, re-prompt with only the missing ones and regenerate. Bounded by
  // MAX_COVERAGE_REVISIONS.
  onProgress('coverage');
  for (let pass = 0; pass < MAX_COVERAGE_REVISIONS; pass++) {
    const { article } = splitContent(content);
    const missing = await findMissingInformation(article, note);
    if (missing.length === 0) break;
    console.log(
      `[coverage] pass ${pass + 1}: ${missing.length} घटक गहाळ, पुन्हा लिहित आहे...`,
    );
    content = await chatComplete(
      buildCoverageRevisionMessages(content, missing),
    );
  }

  // Faithfulness pass: strip/repair anything the article asserts that the notes do not
  // support ("invent nothing").
  onProgress('faithfulness');
  const { article: coveredArticle } = splitContent(content);
  const unsupported = await findUnsupportedClaims(coveredArticle, note);
  if (unsupported.length > 0) {
    console.log(
      `[faithfulness] ${unsupported.length} असमर्थित विधाने, सुधारित करत आहे...`,
    );
    content = await chatComplete(
      buildFaithfulnessRevisionMessages(content, unsupported),
    );
  }

  const { article, factCheck } = splitContent(content);
  return { content, article, factCheck, reference };
}

// Run directly: `tsx --env-file=../../.env src/generation/generate-article.ts`.
// Reads the notes from data/sample-note.txt and prints the reference + article + appendix.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const dataDir = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../data',
  );
  const notePath = join(dataDir, 'sample-note.txt');
  const outputDir = join(dataDir, 'output');

  readFile(notePath, 'utf8')
    .then(async (note) => {
      const result = await generateArticle(note);

      console.log('\n=== संदर्भ लेख (retrieved style reference) ===\n');
      if (result.reference) {
        console.log(
          `similarity=${result.reference.similarity.toFixed(4)}  ${result.reference.title}`,
        );
        console.log(`(${result.reference.text.length} अक्षरे / chars)`);
      } else {
        console.log('(संदर्भ लेख आढळला नाही.)');
      }

      console.log('\n=== तयार केलेला लेख (generated article) ===\n');
      console.log(result.article);

      console.log('\n=== तथ्य-तपासणी (traceability) ===\n');
      console.log(result.factCheck ?? '(तथ्य-तपासणी विभाग आढळला नाही.)');

      // Save the full output (article + traceability appendix) to data/output.
      await mkdir(outputDir, { recursive: true });
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const outputPath = join(outputDir, `article-${timestamp}.md`);
      await writeFile(outputPath, result.content, 'utf8');
      console.log(`\n=== जतन केले (saved) ===\n${outputPath}`);

      // Matching poster (PROJECT_CONTEXT step 14): derive structured copy from the
      // article, then render the DGIPR poster. The image model paints ONLY a text-free
      // background photo; the headline, stats, header emblem and footer are typeset from
      // this (already-correct) Marathi copy in HTML and screenshotted with Chromium, so
      // the Devanagari conjuncts are never mangled. The LLM picks the post_type.
      console.log('\n=== पोस्टर तयार करत आहे ===\n');
      const copy = await generateCopy(result.article);
      console.log(`post_type: ${copy.post_type}`);
      const poster = await generatePoster({ copy });

      // Save the poster PNG, the copy JSON and the (text-free) scene prompt + photo so
      // each render can be proofread (Devanagari accuracy) and re-run cheaply. The saved
      // scene image can be fed back to `poster:preview` to re-typeset without paying for
      // a new image. Same timestamp as the article.
      const posterPath = join(outputDir, `poster-${timestamp}.png`);
      const copyPath = join(outputDir, `poster-${timestamp}.copy.json`);
      const scenePromptPath = join(outputDir, `poster-${timestamp}.scene-prompt.txt`);
      const scenePath = join(outputDir, `poster-${timestamp}.scene.png`);
      await writeFile(posterPath, poster.png);
      await writeFile(copyPath, JSON.stringify(copy, null, 2), 'utf8');
      await writeFile(scenePromptPath, poster.scenePrompt ?? '', 'utf8');
      await writeFile(scenePath, poster.sceneImage);
      console.log(
        `\n=== पोस्टर जतन केले (poster saved) ===\n${posterPath}\n${copyPath}\n${scenePromptPath}\n${scenePath}`,
      );
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
