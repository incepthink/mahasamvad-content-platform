// Revise a generated article according to free-text user feedback (the web UI's
// feedback loop), under the SAME guardrails as generation: the original notes and trusted
// officer request remain factual sources, while feedback can reshape tone/structure/emphasis.
// Flow: revise → completeness
// guard (weave back citizen facts the revision dropped; when the feedback asks to
// expand, also pull broader missing note info and let the article grow) → faithfulness
// check + repair. The guard exists because the feedback path has no coverage loop of its
// own, so a bare "make it bigger / use more info" request used to no-op under the
// compression-biased scheme system prompt. Faithfulness runs LAST — feedback + inject are
// the highest-risk paths for the model to "helpfully" invent supporting details.

import { pathToFileURL } from 'node:url';
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
import { ensureArticleHeading } from './article-heading.js';
import {
  LENGTH_TOLERANCE,
  fitArticleToLength,
  lengthRequirementBlock,
  measureArticleLength,
  parseLengthRequest,
  type LengthWarning,
} from './article-length.js';
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
//
// `currentArticle` makes a NUMERIC ask count too, and that was a real hole: an officer typing
// "बातमी १२०० अक्षरांची हवी" matched none of the keywords below, so `expand` stayed false, the
// expansion instruction was never emitted and findMissingInformation — the broad sweep that
// finds unused note material so the article can legitimately grow — was skipped entirely. The
// one shape of feedback that names a length exactly was the one shape that could not grow the
// article. Passing the current article is what makes the test directional: asking for 400
// characters when the draft is 1200 is a request to SHRINK, and must not turn on the machinery
// for pulling more facts in.
export function wantsExpansion(feedback: string, currentArticle = ''): boolean {
  const f = feedback.toLowerCase();
  const keyword =
    /\b(bigger|larger|longer|lengthen|expand|elaborate|detailed|comprehensive|in[- ]?depth)\b/.test(
      f,
    ) ||
    /\bmore (info|information|details?|content|points|facts)\b/.test(f) ||
    /\b(add|use|include|give|want) more\b/.test(f) ||
    /मोठ|बिगर|अधिक|सविस्तर|लांब|जास्त|विस्तृत|विस्तार|आणखी|भरपूर/.test(
      feedback,
    );
  if (keyword) return true;

  const request = parseLengthRequest(feedback);
  if (!request || !currentArticle.trim()) return false;
  return (
    measureArticleLength(currentArticle, request.unit) <
    request.value * (1 - LENGTH_TOLERANCE)
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
  // Set when the officer asked for a length the revision could not reach. Reported, never
  // fatal — the same contract as designationIssues, and the honest answer when the note does
  // not carry enough to fill the ask without inventing.
  lengthWarning: LengthWarning | null;
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
  officerRequest = '',
  heading = '',
): ChatMessage[] {
  const { article: currentArticle, factCheck: currentFactCheck } =
    splitContent(currentContent);
  // A length may be named in either officer input. The feedback is the more recent statement
  // of intent, so it wins; the stored request carries over when the feedback is silent.
  const lengthRequest =
    parseLengthRequest(feedback) ?? parseLengthRequest(officerRequest);
  const requiredRows = includedFactsBlock(includeFacts);
  const statementRows = statementBlock(statements);
  const excluded = excludeFacts.map((fact) => fact.trim()).filter(Boolean);

  const userPrompt = [
    '<NOTES purpose="only_authoritative_fact_source">',
    note.trim(),
    '</NOTES>',
    '',
    // The officer's शीर्षक किंवा बातमीचा रोख. It reached reviseArticle() as an argument from the
    // beginning, but ONLY as allowed context for the coverage and faithfulness CHECKERS — the
    // model doing the rewriting had never been shown it. So the heading survived a feedback
    // round by accident, if the previous draft happened to keep it, and an officer who set an
    // angle watched it drift away the first time they asked for any other change.
    ...(heading.trim()
      ? [
          '<HEADLINE_ANGLE purpose="officer_headline_or_angle_not_fact_source">',
          heading.trim(),
          '</HEADLINE_ANGLE>',
          '',
        ]
      : []),
    ...(officerRequest.trim()
      ? [
          '<OFFICER_REQUEST purpose="authoritative_instructions_and_facts">',
          officerRequest.trim(),
          '</OFFICER_REQUEST>',
          '',
        ]
      : []),
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
    ...(officerRequest.trim()
      ? ['FEEDBACK ने बदलले नसतील तर OFFICER_REQUEST मधील सूचना जपा.']
      : []),
    // The heading needs the same "carry it through" sentence the request already had, or the
    // block above is just more context for the model to weigh at its discretion.
    ...(heading.trim()
      ? [
          'HEADLINE_ANGLE हा अधिकाऱ्याने या बातमीसाठीच दिलेला आहे. तो शीर्षकासारखा असेल तर तेच शीर्षक जसेच्या तसे वापरा; रोखासारखा असेल तर लेख त्याच रोखाने लिहा. FEEDBACK ने तो स्पष्टपणे बदलला असेल तरच बदला.',
        ]
      : []),
    // Rule 6 below forbids adding a पदनाम absent from NOTES; without this carve-out the
    // revision reads that as licence to strip the designations it was just handed.
    ...(designationBlock(designations).length > 0
      ? [DESIGNATION_ALLOWED_RULE]
      : []),
    ...(requiredRows.length > 0
      ? ['REQUIRED_FACTS मधील प्रत्येक निवडलेले तथ्य अंतिम लेखात अर्थासह जपा.']
      : []),
    ...(statementRows.length > 0
      ? [
          STATEMENTS_ALLOWED_RULE,
          'प्रत्येक ATTRIBUTED_STATEMENT योग्य वक्त्याशी जोडून जपा.',
        ]
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
    // The number, pulled out of whichever officer input named it. The same English block the
    // generation prompts render, so a length asked for at intake and a length asked for in the
    // feedback box are put to the model in identical terms.
    ...(lengthRequest ? ['', ...lengthRequirementBlock(lengthRequest)] : []),
    '',
    'अत्यंत महत्त्वाचे नियम:',
    officerRequest.trim()
      ? '1. NOTES आणि OFFICER_REQUEST हे माहितीचे अधिकृत स्रोत आहेत.'
      : '1. NOTES हाच माहितीचा अधिकृत स्रोत आहे.',
    '2. CURRENT_ARTICLE हा फक्त आधीचा मसुदा आहे; तो स्वतंत्र तथ्य-स्रोत नाही.',
    '3. FEEDBACK हा फक्त शैली, रचना, लांबी, भर, सूर आणि मांडणी यांसाठी आहे; तो तथ्य-स्रोत नाही.',
    `4. FEEDBACK मध्ये नवीन तथ्य, नाव, तारीख, रक्कम, पदनाम, ठिकाण, योजना, कायदा, दावा, quote किंवा byline सुचवले असल्यास ते फक्त NOTES${officerRequest.trim() ? ' किंवा OFFICER_REQUEST' : ''} मध्ये स्पष्ट आधार असल्यासच वापरा.`,
    '5. FEEDBACK आणि NOTES यांच्यात विरोध असेल तर NOTES ला प्राधान्य द्या आणि विरोधी feedback दुर्लक्ष करा.',
    `6. NOTES${officerRequest.trim() ? ' किंवा OFFICER_REQUEST' : ''} मध्ये नसलेले कोणतेही नवीन तथ्य, नाव, तारीख, रक्कम, पदनाम, ठिकाण, योजना, कायदा, दावा, quote किंवा byline जोडू नका.`,
    '7. NOTES मधील खरी आणि महत्त्वाची माहिती वगळू नका.',
    '8. अंतिम लेख category च्या मूळ शैलीतच ठेवा.',
    // Rules 8 and 11 of the category system prompt tell the model to keep the house style and
    // register. An officer asking for simpler language, a different length or a different
    // structure is asking for exactly the thing those rules protect, so the exception has to be
    // stated — otherwise the general rule wins, which is what it is written to do.
    ...(officerRequest.trim() || heading.trim()
      ? [
          `${officerRequest.trim() ? 'OFFICER_REQUEST' : ''}${officerRequest.trim() && heading.trim() ? ' आणि ' : ''}${heading.trim() ? 'HEADLINE_ANGLE' : ''} मध्ये शैली, सूर, लांबी, रचना, क्रम, भर किंवा काय वगळायचे याबाबत काही सांगितले असेल, तर ते वरील सर्वसाधारण नियमांवर वरचढ आहे — फक्त "टिपणीत नसलेले तथ्य जोडू नका" हा नियम त्याहून वरचढ राहतो.`,
        ]
      : []),
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
  // The trusted request used for the original draft. Kept last for call-site compatibility.
  officerRequest?: string,
): Promise<RevisedArticle> {
  const { article: articleBeforeRevision } = splitContent(currentContent);
  const expand = wantsExpansion(feedback, articleBeforeRevision);
  const lengthRequest =
    parseLengthRequest(feedback) ?? parseLengthRequest(officerRequest);
  const authoritativeSource = officerRequest?.trim()
    ? `${note.trim()}\n\n=== OFFICER REQUEST ===\n${officerRequest.trim()}`
    : note;
  const includeFacts = selectedFacts
    .map((fact) => fact.text.trim())
    .filter(Boolean);
  const hasApprovedInventory = includeFacts.length > 0 || statements.length > 0;

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
      officerRequest,
      heading,
    ),
    { maxTokens: ARTICLE_BODY_MAX_TOKENS },
  );

  // Completeness guard, mirroring generateArticle's coverage step (which the feedback path
  // otherwise lacks): the brief-independent citizen-fact check always runs, and an explicit
  // expansion request additionally pulls broader missing note info. Run BEFORE faithfulness
  // so any drift the inject pass introduces is still stripped downstream.
  const { article: revisedArticle } = splitContent(content);
  const approvedCoverage = hasApprovedInventory
    ? await findMissingApprovedFacts(revisedArticle, includeFacts, statements)
    : null;
  const [citizenMissing, broadMissing] = approvedCoverage
    ? [approvedCoverage.missing, [] as string[]]
    : await Promise.all([
        findMissingNoteFacts(revisedArticle, authoritativeSource, excludeFacts),
        expand
          ? findMissingInformation(
              revisedArticle,
              authoritativeSource,
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
        authoritativeSource,
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
    authoritativeSource,
    heading,
    designations,
    statements,
  );

  if (unsupported.length > 0) {
    content = await chatComplete(
      buildRepairMessages(
        authoritativeSource,
        content,
        unsupported,
        category,
        designations,
        statements,
      ),
      { maxTokens: ARTICLE_BODY_MAX_TOKENS },
    );
  }

  // Measure the length the officer asked for and, on a miss, buy ONE rewrite. Placed after the
  // faithfulness repair (which can only ever shorten) and before the appendix, so the article
  // whose length is measured is the article that will be stored.
  const { article: repairedArticle } = splitContent(content);
  const fit = await fitArticleToLength(
    repairedArticle,
    authoritativeSource,
    lengthRequest,
    category,
  );
  if (fit.article !== repairedArticle) content = fit.article;

  // The revision prompts no longer emit the traceability appendix inline, so rebuild it
  // from the final revised article (scheme only) and stitch it on with the delimiter —
  // keeping the { content, article, factCheck } contract unchanged. News has no appendix.
  const { article: rawArticle } = splitContent(content);
  const factCheck =
    category === 'scheme' && withFactCheck
      ? await generateFactCheck(rawArticle, authoritativeSource)
      : null;

  // Same placement as generateArticle: after the appendix, so it never reports the officer's
  // designation as unsourced, and last of all, so no later pass can drop it.
  const designationResult = applyDesignations(rawArticle, designations, {
    knownDesignations,
  });
  // Both deterministic passes sit after the last model call, for the same reason: the officer
  // approved this exact text, so nothing downstream may reword it. A no-op unless `heading`
  // reads as a headline rather than an angle (article-heading.ts).
  const article = ensureArticleHeading(designationResult.text, heading);
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
    lengthWarning: fit.warning,
  };
}

// ---------------------------------------------------------------------------
// Free deterministic harness (no API key, no network, no spend):
//   tsx src/generation/revise-article.ts --check
//
// The feedback path is where the officer's request was being lost — the heading never reached
// the rewriting model at all, and a numeric length ask never turned on the expansion machinery
// — so both are pinned here.
// ---------------------------------------------------------------------------
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  let failures = 0;
  const check = (label: string, condition: boolean): void => {
    if (condition) console.log(`  ok    ${label}`);
    else {
      failures += 1;
      console.error(`  FAIL  ${label}`);
    }
  };

  const draft400 = 'क'.repeat(400);
  const draft1200 = 'क'.repeat(1200);

  console.log('\n=== a numeric length ask counts as an expansion request ===');
  check(
    '"१२०० अक्षरे" against a 400-character draft asks to grow',
    wantsExpansion('बातमी १२०० अक्षरांची हवी', draft400),
  );
  check(
    '"1200 characters" in English does too',
    wantsExpansion('make it 1200 characters', draft400),
  );
  // Directional: the same sentence against a LONGER draft is a request to shrink, and must not
  // turn on the machinery that pulls more note facts in.
  check(
    'the same ask against a 1200-character draft does NOT ask to grow',
    !wantsExpansion('बातमी ४०० अक्षरांची हवी', draft1200),
  );
  check(
    'a keyword ask still works with no article supplied',
    wantsExpansion('लेख अधिक सविस्तर करा'),
  );
  check(
    'an ordinary style request is not an expansion request',
    !wantsExpansion('शासकीय शैलीत बातमी तयार करा.', draft400),
  );

  console.log('\n=== the officer’s inputs reach the rewriting model ===');
  const heading = 'कर्जमुक्तीमुळे ग्रामीण अर्थव्यवस्थेला नवी ऊर्जा';
  const request = 'भाषा सोपी ठेवा; बातमी १२०० अक्षरांची हवी.';
  const messages = buildRevisionMessages(
    'टिपणी मजकूर.',
    '# मॉडेलचे शीर्षक\n\nपहिला परिच्छेद.',
    'सुरुवात आणखी आकर्षक करा',
    'news',
    false,
    [],
    [],
    [],
    [],
    request,
    heading,
  );
  const user = messages[1]?.content ?? '';
  check(
    'the heading is rendered in its own block',
    user.includes('<HEADLINE_ANGLE') && user.includes(heading),
  );
  check(
    'the heading is carried through unless the feedback changes it',
    user.includes('FEEDBACK ने तो स्पष्टपणे बदलला असेल तरच बदला'),
  );
  check(
    'the officer request is still rendered as an authoritative source',
    user.includes('<OFFICER_REQUEST') && user.includes(request),
  );
  check(
    'both are stated to outrank the general style rules',
    user.includes('वरील सर्वसाधारण नियमांवर वरचढ आहे'),
  );
  check(
    'never-invent still outranks them',
    user.includes('"टिपणीत नसलेले तथ्य जोडू नका" हा नियम त्याहून वरचढ राहतो'),
  );
  check(
    'a length named in the request becomes the shared LENGTH REQUIREMENT block',
    user.includes('### LENGTH REQUIREMENT') &&
      user.includes('about 1200 characters'),
  );

  console.log('\n=== the feedback box wins over the stored request ===');
  const overridden =
    buildRevisionMessages(
      'टिपणी मजकूर.',
      'लेख.',
      'बातमी ८०० अक्षरांची करा',
      'news',
      false,
      [],
      [],
      [],
      [],
      request,
      heading,
    )[1]?.content ?? '';
  check(
    'the feedback’s length is the one put to the model',
    overridden.includes('about 800 characters') &&
      !overridden.includes('about 1200 characters'),
  );

  console.log('\n=== nothing is added when the officer said nothing ===');
  const bare =
    buildRevisionMessages(
      'टिपणी मजकूर.',
      'लेख.',
      'सुरुवात बदला',
      'news',
      false,
    )[1]?.content ?? '';
  check('no heading block', !bare.includes('HEADLINE_ANGLE'));
  check('no officer request block', !bare.includes('OFFICER_REQUEST'));
  check('no length block', !bare.includes('LENGTH REQUIREMENT'));
  check('no precedence carve-out', !bare.includes('वरचढ आहे'));

  if (failures > 0) process.exitCode = 1;
  else console.log('\nAll revise-article checks passed.');
}
