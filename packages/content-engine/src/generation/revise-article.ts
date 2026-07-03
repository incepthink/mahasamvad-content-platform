// Revise a generated article according to free-text user feedback (the web UI's
// feedback loop), under the SAME guardrails as generation: the original notes stay
// the ONLY source of facts, so feedback can reshape tone/structure/emphasis but can
// never smuggle in new names, dates, amounts or claims. After the revision we run
// one faithfulness check + repair pass — feedback is the highest-risk path for the
// model to "helpfully" invent supporting details.

import { chatComplete, type ChatMessage } from './openai-chat.js';
import {
  SYSTEM_PROMPT,
  splitContent,
} from './generate-article.js';
import { findUnsupportedClaims } from './verify-coverage.js';

export type RevisedArticle = Readonly<{
  // Full model output: the article followed by the traceability appendix.
  content: string;
  article: string;
  factCheck: string | null;
}>;

function buildRevisionMessages(
  note: string,
  currentContent: string,
  feedback: string,
): ChatMessage[] {
  const userPrompt = [
    '## टिपणी (NOTES — माहितीचा एकमेव स्रोत):',
    note,
    '',
    '## आधीचा लेख (CURRENT ARTICLE):',
    currentContent,
    '',
    '## वापरकर्त्याचा अभिप्राय (FEEDBACK):',
    feedback,
    '',
    '## कार्य:',
    'वरील अभिप्रायानुसार लेख सुधारून संपूर्ण लेख पुन्हा लिहा. टिपणी हाच माहितीचा एकमेव',
    'स्रोत आहे — टिपणीत नसलेले कोणतेही नवीन तथ्य, नाव, तारीख, रक्कम, पदनाम किंवा दावा',
    'जोडू नका. अभिप्रायाने मागितलेले बदल शैली, रचना, भर व मांडणीपुरते करा; टिपणीतील',
    'खरी माहिती वगळू नका. शेवटी तथ्य-तपासणी यादी पुन्हा द्या.',
  ].join('\n');
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userPrompt },
  ];
}

// One repair pass mirroring buildFaithfulnessRevisionMessages in generate-article.ts,
// scoped to the claims the checker flagged after the feedback revision.
function buildRepairMessages(
  note: string,
  draft: string,
  unsupported: string[],
): ChatMessage[] {
  const unsupportedBlock = unsupported.map((item) => `- ${item}`).join('\n');
  const userPrompt = [
    '## टिपणी (NOTES — माहितीचा एकमेव स्रोत):',
    note,
    '',
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

export async function reviseArticle(
  note: string,
  currentContent: string,
  feedback: string,
): Promise<RevisedArticle> {
  let content = await chatComplete(
    buildRevisionMessages(note, currentContent, feedback),
  );

  const { article: revisedArticle } = splitContent(content);
  const unsupported = await findUnsupportedClaims(revisedArticle, note);
  if (unsupported.length > 0) {
    content = await chatComplete(buildRepairMessages(note, content, unsupported));
  }

  const { article, factCheck } = splitContent(content);
  return { content, article, factCheck };
}
