// Revise a generated article according to free-text user feedback (the web UI's
// feedback loop), under the SAME guardrails as generation: the original notes stay
// the ONLY source of facts, so feedback can reshape tone/structure/emphasis but can
// never smuggle in new names, dates, amounts or claims. Flow: revise → completeness
// guard (weave back citizen facts the revision dropped; when the feedback asks to
// expand, also pull broader missing note info and let the article grow) → faithfulness
// check + repair. The guard exists because the feedback path has no coverage loop of its
// own, so a bare "make it bigger / use more info" request used to no-op under the
// compression-biased scheme system prompt. Faithfulness runs LAST — feedback + inject are
// the highest-risk paths for the model to "helpfully" invent supporting details.

import {
  ARTICLE_BODY_MAX_TOKENS,
  chatComplete,
  type ChatMessage,
} from './openai-chat.js';
import type { AttributedStatement, SelectedFact } from '@dgipr/schemas';
import {
  FACT_CHECK_DELIMITER,
  generateFactCheck,
  splitContent,
  systemPromptFor,
} from './generate-article.js';
import {
  DESIGNATION_ALLOWED_RULE,
  STATEMENTS_ALLOWED_RULE,
  designationBlock,
  includedFactsBlock,
  statementBlock,
  type ArticleCategory,
  type DesignationPair,
} from './category-prompt.js';
import {
  applyDesignations,
  type DesignationIssue,
} from './apply-designations.js';
import {
  findMissingInformation,
  findMissingApprovedFacts,
  findMissingNoteFacts,
  findUnsupportedClaims,
} from './verify-coverage.js';

// Does the feedback ask the article to grow (vs. a stylistic/structural tweak)? When it does,
// the revision must fight the compression-biased scheme system prompt: pull in broader
// supporting detail from the notes and let the article get longer instead of compressing.
// Matches common Marathi + English "make it bigger / more detailed / use more info" phrasings.
export function wantsExpansion(feedback: string): boolean {
  const f = feedback.toLowerCase();
  return (
    /\b(bigger|larger|longer|lengthen|expand|elaborate|detailed|comprehensive|in[- ]?depth)\b/.test(
      f,
    ) ||
    /\bmore (info|information|details?|content|points|facts)\b/.test(f) ||
    /\b(add|use|include|give|want) more\b/.test(f) ||
    /मोठ|बिगर|अधिक|सविस्तर|लांब|जास्त|विस्तृत|विस्तार|आणखी|भरपूर/.test(feedback)
  );
}

export type RevisedArticle = Readonly<{
  // Full model output: the article followed by the traceability appendix when the
  // selected category/system prompt requires one.
  content: string;
  article: string;
  factCheck: string | null;
  // Approved designations the revised article could not carry as-is. Reported, never fatal —
  // same contract as GeneratedArticle.designationIssues.
  designationIssues: readonly DesignationIssue[];
}>;

function buildRevisionMessages(
  note: string,
  currentContent: string,
  feedback: string,
  category: ArticleCategory,
  expand: boolean,
  designations: readonly DesignationPair[] = [],
  includeFacts: readonly string[] = [],
  statements: readonly AttributedStatement[] = [],
  excludeFacts: readonly string[] = [],
): ChatMessage[] {
  const { article: currentArticle, factCheck: currentFactCheck } =
    splitContent(currentContent);
  const requiredRows = includedFactsBlock(includeFacts);
  const statementRows = statementBlock(statements);
  const excluded = excludeFacts.map((fact) => fact.trim()).filter(Boolean);

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
    ...(designationBlock(designations).length > 0
      ? [...designationBlock(designations), '']
      : []),
    ...(requiredRows.length > 0 ? [...requiredRows, ''] : []),
    ...(statementRows.length > 0 ? [...statementRows, ''] : []),
    ...(excluded.length > 0
      ? [
          '<EXCLUDED_FACTS purpose="officer_rejected_never_reintroduce">',
          ...excluded.map((fact) => `- ${fact}`),
          '</EXCLUDED_FACTS>',
          '',
        ]
      : []),
    '<FEEDBACK purpose="style_structure_emphasis_only_not_fact_source">',
    feedback.trim(),
    '</FEEDBACK>',
    '',
    '<TASK>',
    'वरील FEEDBACK नुसार लेख सुधारून संपूर्ण लेख पुन्हा लिहा.',
    // Rule 6 below forbids adding a पदनाम absent from NOTES; without this carve-out the
    // revision reads that as licence to strip the designations it was just handed.
    ...(designationBlock(designations).length > 0
      ? [DESIGNATION_ALLOWED_RULE]
      : []),
    ...(requiredRows.length > 0
      ? [
          'REQUIRED_FACTS मधील प्रत्येक निवडलेले तथ्य अंतिम लेखात अर्थासह जपा.',
        ]
      : []),
    ...(statementRows.length > 0
      ? [STATEMENTS_ALLOWED_RULE, 'प्रत्येक ATTRIBUTED_STATEMENT योग्य वक्त्याशी जोडून जपा.']
      : []),
    ...(excluded.length > 0
      ? [
          'EXCLUDED_FACTS मधील तथ्ये अधिकाऱ्याने वगळली आहेत; feedback काहीही असला तरी ती पुन्हा आणू नका.',
        ]
      : []),
    ...(expand
      ? [
          'वापरकर्त्याने लेख अधिक मोठा व सविस्तर करण्यास सांगितले आहे. त्यामुळे NOTES मधील आजवर',
          'लेखात न आलेली आधारभूत व नागरिकाभिमुख तथ्ये (लाभ, रक्कम, पात्रता, अंतिम तारखा, नागरिकाच्या',
          'कृती, OTS, DBT, नवीन कर्ज, तक्रार निवारण, याद्यांची प्रसिद्धी) समाविष्ट करून लेख विस्तृत करा.',
          'माहिती संक्षिप्त करू नका किंवा वगळू नका; लेख आवश्यकतेनुसार मोठा होऊ द्या. मात्र समिती-सदस्य',
          'याद्या किंवा लेखाशीर्ष यांसारखा प्रशासकीय तपशील भरून लांबी वाढवू नका.',
        ]
      : []),
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
  designations: readonly DesignationPair[] = [],
  statements: readonly AttributedStatement[] = [],
): ChatMessage[] {
  const { article: draftArticle, factCheck: draftFactCheck } =
    splitContent(draftContent);

  const unsupportedBlock = unsupported.map((item) => `- ${item}`).join('\n');
  const designationRows = designationBlock(designations);
  const statementRows = statementBlock(statements);

  const userPrompt = [
    '<NOTES purpose="only_authoritative_fact_source">',
    note.trim(),
    '</NOTES>',
    '',
    ...(designationRows.length > 0 ? [...designationRows, ''] : []),
    ...(statementRows.length > 0 ? [...statementRows, ''] : []),
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
    // Appended after the list rather than numbered into it: rule 4 says "no new पदनाम", and
    // this is the one carve-out. It must read as an exception to that rule, not compete with it.
    ...(designationRows.length > 0 ? ['', DESIGNATION_ALLOWED_RULE] : []),
    ...(statementRows.length > 0 ? ['', STATEMENTS_ALLOWED_RULE] : []),
    '</TASK>',
  ].join('\n');

  return [
    { role: 'system', content: systemPromptFor(category) },
    { role: 'user', content: userPrompt },
  ];
}

// Weave note facts the revised draft still omits back into the article. The feedback path
// has no coverage loop of its own, so a revision that reshaped/compressed the article can
// silently drop citizen facts, and a bare "make it bigger" request otherwise no-ops under
// the compression-biased scheme system prompt. `missing` are note-derived restatements, so
// the pass adds only supported facts; the faithfulness pass still runs afterwards.
function buildInjectMessages(
  note: string,
  draftContent: string,
  missing: string[],
  category: ArticleCategory,
  expand: boolean,
  designations: readonly DesignationPair[] = [],
  statements: readonly AttributedStatement[] = [],
): ChatMessage[] {
  const { article: draftArticle } = splitContent(draftContent);
  const missingBlock = missing.map((item) => `- ${item}`).join('\n');
  const designationRows = designationBlock(designations);
  const statementRows = statementBlock(statements);

  const userPrompt = [
    '<NOTES purpose="only_authoritative_fact_source">',
    note.trim(),
    '</NOTES>',
    '',
    ...(designationRows.length > 0 ? [...designationRows, ''] : []),
    ...(statementRows.length > 0 ? [...statementRows, ''] : []),
    '<CURRENT_ARTICLE purpose="draft_to_expand_not_fact_source">',
    draftArticle.trim(),
    '</CURRENT_ARTICLE>',
    '',
    '<MISSING_FACTS purpose="notes_facts_absent_from_article_to_weave_in">',
    missingBlock,
    '</MISSING_FACTS>',
    '',
    '<TASK>',
    'CURRENT_ARTICLE मध्ये वरील MISSING_FACTS मधील प्रत्येक तथ्य त्याच्या योग्य नागरिकाभिमुख',
    'परिच्छेदात नैसर्गिकपणे विणून संपूर्ण लेख पुन्हा लिहा.',
    ...(expand
      ? [
          'वापरकर्त्याने लेख अधिक सविस्तर करण्यास सांगितले आहे — ही तथ्ये पुरेशा विस्ताराने मांडा',
          'आणि लेख आवश्यकतेनुसार मोठा होऊ द्या; संक्षिप्त करण्याचा प्रयत्न करू नका.',
        ]
      : []),
    '',
    'नियम:',
    '1. NOTES हाच माहितीचा एकमेव आणि अधिकृत स्रोत आहे; वरील तथ्ये NOTES मध्ये आहेत.',
    '2. NOTES मध्ये नसलेले कोणतेही नवीन तथ्य, नाव, तारीख, रक्कम, पदनाम, ठिकाण, योजना, कायदा, दावा, quote किंवा byline जोडू नका.',
    '3. आधीच्या लेखातील खरी व महत्त्वाची माहिती वगळू नका.',
    '4. समिती-सदस्य याद्या, अधिकाऱ्यांची नावे/पदनामे किंवा लेखाशीर्ष यांसारखा प्रशासकीय तपशील विनाकारण जोडू नका.',
    '5. अंतिम लेख category च्या मूळ महासंवाद-शैलीतच व देवनागरीत ठेवा.',
    '6. फक्त सुधारित लेख द्या; तथ्य-तपासणी यादी किंवा विभाजक जोडू नका.',
    // Rules 2 and 4 both push against a designation — 2 as "no पदनाम absent from NOTES",
    // 4 as "do not add officials' designations". This is the exception to both.
    ...(designationRows.length > 0 ? ['', DESIGNATION_ALLOWED_RULE] : []),
    ...(statementRows.length > 0 ? ['', STATEMENTS_ALLOWED_RULE] : []),
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
  // The run's approved person → पदनाम pairs, read back off the generation row. The feedback
  // path needs these MORE than the first draft does: `currentContent` already carries the
  // designations, so without them findUnsupportedClaims below flags each one as an unsourced
  // पदनाम and buys a repair call to delete it. Re-applied deterministically at the end, so a
  // revision can never ship an article that lost a designation.
  designations: readonly DesignationPair[] = [],
  knownDesignations: readonly string[] = [],
  selectedFacts: readonly SelectedFact[] = [],
  statements: readonly AttributedStatement[] = [],
  excludeFacts: readonly string[] = [],
  // Whether this run's article carries a traceability appendix. Defaults to true, which is the
  // full pipeline's behaviour byte-for-byte. The caller passes false for an article produced by
  // the SIMPLIFIED generator, which deliberately has no appendix — without this, the first
  // feedback round on such an article would silently grow a तथ्य-तपासणी fold that the run never
  // had, and buy an extra model pass to do it. Scheme-only either way; news never had one.
  withFactCheck = true,
): Promise<RevisedArticle> {
  const expand = wantsExpansion(feedback);
  const includeFacts = selectedFacts
    .map((fact) => fact.text.trim())
    .filter(Boolean);
  const hasApprovedInventory =
    includeFacts.length > 0 || statements.length > 0;

  let content = await chatComplete(
    buildRevisionMessages(
      note,
      currentContent,
      feedback,
      category,
      expand,
      designations,
      includeFacts,
      statements,
      excludeFacts,
    ),
    { maxTokens: ARTICLE_BODY_MAX_TOKENS },
  );

  // Completeness guard, mirroring generateArticle's coverage step (which the feedback path
  // otherwise lacks): the brief-independent citizen-fact check always runs, and an explicit
  // expansion request additionally pulls broader missing note info. Run BEFORE faithfulness
  // so any drift the inject pass introduces is still stripped downstream.
  const { article: revisedArticle } = splitContent(content);
  const approvedCoverage = hasApprovedInventory
    ? await findMissingApprovedFacts(
        revisedArticle,
        includeFacts,
        statements,
      )
    : null;
  const [citizenMissing, broadMissing] = approvedCoverage
    ? [approvedCoverage.missing, [] as string[]]
    : await Promise.all([
        findMissingNoteFacts(revisedArticle, note, excludeFacts),
        expand
          ? findMissingInformation(
              revisedArticle,
              note,
              heading,
              undefined,
              excludeFacts,
            )
          : Promise.resolve<string[]>([]),
      ]);
  const seen = new Set<string>();
  const missing = [...citizenMissing, ...broadMissing].filter((item) => {
    const key = item.trim();
    if (key.length === 0 || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (missing.length > 0) {
    console.log(
      `[revise] ${missing.length} तथ्ये लेखात न आलेली (${citizenMissing.length} नागरिकाभिमुख)` +
        `${expand ? ', विस्तार-विनंती' : ''}; समाविष्ट करत आहे...`,
    );
    content = await chatComplete(
      buildInjectMessages(
        note,
        content,
        missing,
        category,
        expand,
        designations,
        statements,
      ),
      { maxTokens: ARTICLE_BODY_MAX_TOKENS },
    );
  }

  const { article: injectedArticle } = splitContent(content);
  // Heading passed as allowed context so an angle-true title line isn't flagged; designations
  // for the same reason — the article already carries them and they are not in the note.
  const unsupported = await findUnsupportedClaims(
    injectedArticle,
    note,
    heading,
    designations,
    statements,
  );

  if (unsupported.length > 0) {
    content = await chatComplete(
      buildRepairMessages(
        note,
        content,
        unsupported,
        category,
        designations,
        statements,
      ),
      { maxTokens: ARTICLE_BODY_MAX_TOKENS },
    );
  }

  // The revision prompts no longer emit the traceability appendix inline, so rebuild it
  // from the final revised article (scheme only) and stitch it on with the delimiter —
  // keeping the { content, article, factCheck } contract unchanged. News has no appendix.
  const { article: rawArticle } = splitContent(content);
  const factCheck =
    category === 'scheme' && withFactCheck
      ? await generateFactCheck(rawArticle, note)
      : null;

  // Same placement as generateArticle: after the appendix, so it never reports the officer's
  // designation as unsourced, and last of all, so no later pass can drop it.
  const designationResult = applyDesignations(rawArticle, designations, {
    knownDesignations,
  });
  const article = designationResult.text;
  if (designationResult.issues.length > 0) {
    console.warn(
      `[designations] ${designationResult.issues.length} पदनाम सुधारित लेखात लागू करता आले नाही:`,
      designationResult.issues,
    );
  }

  const finalContent = factCheck
    ? `${article}\n\n${FACT_CHECK_DELIMITER}\n${factCheck}`
    : article;
  return {
    content: finalContent,
    article,
    factCheck,
    designationIssues: designationResult.issues,
  };
}
