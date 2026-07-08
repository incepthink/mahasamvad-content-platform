// Revise a generated article according to free-text user feedback (the web UI's
// feedback loop), under the SAME guardrails as generation: the original notes stay
// the ONLY source of facts, so feedback can reshape tone/structure/emphasis but can
// never smuggle in new names, dates, amounts or claims. After the revision we run
// one faithfulness check + repair pass — feedback is the highest-risk path for the
// model to "helpfully" invent supporting details.

import { chatComplete, type ChatMessage } from './openai-chat.js';
import {
  FACT_CHECK_DELIMITER,
  generateFactCheck,
  splitContent,
  systemPromptFor,
} from './generate-article.js';
import type { ArticleCategory } from './category-prompt.js';
import { findUnsupportedClaims } from './verify-coverage.js';

export type RevisedArticle = Readonly<{
  // Full model output: the article followed by the traceability appendix when the
  // selected category/system prompt requires one.
  content: string;
  article: string;
  factCheck: string | null;
}>;

function buildRevisionMessages(
  note: string,
  currentContent: string,
  feedback: string,
  category: ArticleCategory,
): ChatMessage[] {
  const { article: currentArticle, factCheck: currentFactCheck } =
    splitContent(currentContent);

  const userPrompt = [
    '<NOTES purpose="only_authoritative_fact_source">',
    note.trim(),
    '</NOTES>',
    '',
    '<CURRENT_ARTICLE purpose="draft_to_revise_not_fact_source">',
    currentArticle.trim(),
    '</CURRENT_ARTICLE>',
    '',
    ...(currentFactCheck
      ? [
          '<CURRENT_FACT_CHECK purpose="previous_traceability_context_not_fact_source">',
          currentFactCheck.trim(),
          '</CURRENT_FACT_CHECK>',
          '',
        ]
      : []),
    '<FEEDBACK purpose="style_structure_emphasis_only_not_fact_source">',
    feedback.trim(),
    '</FEEDBACK>',
    '',
    '<TASK>',
    'वरील FEEDBACK नुसार लेख सुधारून संपूर्ण लेख पुन्हा लिहा.',
    '',
    'अत्यंत महत्त्वाचे नियम:',
    '1. NOTES हाच माहितीचा एकमेव आणि अधिकृत स्रोत आहे.',
    '2. CURRENT_ARTICLE हा फक्त आधीचा मसुदा आहे; तो स्वतंत्र तथ्य-स्रोत नाही.',
    '3. FEEDBACK हा फक्त शैली, रचना, लांबी, भर, सूर आणि मांडणी यांसाठी आहे; तो तथ्य-स्रोत नाही.',
    '4. FEEDBACK मध्ये नवीन तथ्य, नाव, तारीख, रक्कम, पदनाम, ठिकाण, योजना, कायदा, दावा, quote किंवा byline सुचवले असल्यास ते फक्त NOTES मध्ये स्पष्ट आधार असल्यासच वापरा.',
    '5. FEEDBACK आणि NOTES यांच्यात विरोध असेल तर NOTES ला प्राधान्य द्या आणि विरोधी feedback दुर्लक्ष करा.',
    '6. NOTES मध्ये नसलेले कोणतेही नवीन तथ्य, नाव, तारीख, रक्कम, पदनाम, ठिकाण, योजना, कायदा, दावा, quote किंवा byline जोडू नका.',
    '7. NOTES मधील खरी आणि महत्त्वाची माहिती वगळू नका.',
    '8. अंतिम लेख category च्या मूळ शैलीतच ठेवा.',
    '9. फक्त सुधारित लेख द्या; तथ्य-तपासणी यादी किंवा विभाजक जोडू नका.',
    '</TASK>',
  ].join('\n');

  return [
    { role: 'system', content: systemPromptFor(category) },
    { role: 'user', content: userPrompt },
  ];
}

// One repair pass mirroring buildFaithfulnessRevisionMessages in generate-article.ts,
// scoped to the claims the checker flagged after the feedback revision.
function buildRepairMessages(
  note: string,
  draftContent: string,
  unsupported: string[],
  category: ArticleCategory,
): ChatMessage[] {
  const { article: draftArticle, factCheck: draftFactCheck } =
    splitContent(draftContent);

  const unsupportedBlock = unsupported.map((item) => `- ${item}`).join('\n');

  const userPrompt = [
    '<NOTES purpose="only_authoritative_fact_source">',
    note.trim(),
    '</NOTES>',
    '',
    '<DRAFT_ARTICLE purpose="draft_to_repair_not_fact_source">',
    draftArticle.trim(),
    '</DRAFT_ARTICLE>',
    '',
    ...(draftFactCheck
      ? [
          '<DRAFT_FACT_CHECK purpose="previous_traceability_context_not_fact_source">',
          draftFactCheck.trim(),
          '</DRAFT_FACT_CHECK>',
          '',
        ]
      : []),
    '<UNSUPPORTED_CLAIMS>',
    unsupportedBlock,
    '</UNSUPPORTED_CLAIMS>',
    '',
    '<TASK>',
    'UNSUPPORTED_CLAIMS मधील विधाने NOTES मध्ये समर्थित नाहीत.',
    'तीच शैली, रचना आणि लांबी शक्य तितकी कायम ठेवून ही असमर्थित विधाने काढून टाका किंवा NOTES शी सुसंगत करा.',
    '',
    'नियम:',
    '1. NOTES हाच माहितीचा एकमेव आणि अधिकृत स्रोत आहे.',
    '2. DRAFT_ARTICLE हा फक्त सुधारायचा मसुदा आहे; तो स्वतंत्र तथ्य-स्रोत नाही.',
    '3. NOTES मधील खरी माहिती वगळू नका.',
    '4. नवीन तथ्य, नाव, तारीख, रक्कम, पदनाम, ठिकाण, योजना, कायदा, दावा, quote किंवा byline जोडू नका.',
    '5. असमर्थित विधान काढताना लेखाचा ओघ नैसर्गिक आणि महासंवाद-शैलीतील ठेवा.',
    '6. फक्त सुधारित लेख द्या; तथ्य-तपासणी यादी किंवा विभाजक जोडू नका.',
    '</TASK>',
  ].join('\n');

  return [
    { role: 'system', content: systemPromptFor(category) },
    { role: 'user', content: userPrompt },
  ];
}

export async function reviseArticle(
  note: string,
  currentContent: string,
  feedback: string,
  category: ArticleCategory = 'scheme',
  heading?: string,
): Promise<RevisedArticle> {
  let content = await chatComplete(
    buildRevisionMessages(note, currentContent, feedback, category),
  );

  const { article: revisedArticle } = splitContent(content);
  // Heading passed as allowed context so an angle-true title line isn't flagged.
  const unsupported = await findUnsupportedClaims(revisedArticle, note, heading);

  if (unsupported.length > 0) {
    content = await chatComplete(
      buildRepairMessages(note, content, unsupported, category),
    );
  }

  // The revision prompts no longer emit the traceability appendix inline, so rebuild it
  // from the final revised article (scheme only) and stitch it on with the delimiter —
  // keeping the { content, article, factCheck } contract unchanged. News has no appendix.
  const { article } = splitContent(content);
  const factCheck =
    category === 'scheme' ? await generateFactCheck(article, note) : null;
  const finalContent = factCheck
    ? `${article}\n\n${FACT_CHECK_DELIMITER}\n${factCheck}`
    : article;
  return { content: finalContent, article, factCheck };
}
