// The editorial specification for the SIMPLIFIED article generator
// (ARTICLE_GENERATION_MODE=simple): one style reference, one model call, one publication-ready
// Marathi article. This module owns the prompt and nothing else — no I/O, no model call — so it
// can be exercised for free (`tsx src/generation/simple-article-prompt.ts`).
//
// Three decisions worth knowing before editing:
//
// 1. The prompt lives in TypeScript, like every other prompt in this repo, so it ships inside
//    the built dist with no file read and no runtime path resolution. SIMPLE_ARTICLE_PROMPT_VERSION
//    is persisted with each run (generations.style_reference_meta), so a change here is
//    attributable later — which is what the future approved-example loop needs in order to say
//    "these officer corrections were made against THAT specification".
//
// 2. It is split into a system message (the editorial rules) and a user message (the filled
//    INPUTS). The factual-source boundaries are NOT weakened by the split: the FACTUAL AUTHORITY
//    rules reference the input slots by NAME, and those names are stable headings in the user
//    message. Keeping the rules in the system message is what stops a long note from pushing
//    them out of the model's attention.
//
// 3. Every optional slot is OMITTED when empty rather than rendered blank. The specification
//    itself forbids printing an unfilled placeholder, and a heading with nothing under it is
//    exactly the shape that invites a model to fill it in. The dateline is therefore RENDERED,
//    not string-substituted: with a verified location and date it becomes a concrete example
//    line, and with either missing only the fallback instruction survives. A blind substitution
//    would emit ", दि.  :" or leak a literal {{location}} into a published government article.

import { ARTICLE_WORD_TARGETS, type ArticleWordTarget } from '@dgipr/schemas';
import type { AttributedStatement, SelectedFact } from '@dgipr/schemas';
import { pathToFileURL } from 'node:url';
import type { ChatMessage } from './openai-chat.js';
import {
  DESIGNATION_TASK_RULE,
  STATEMENT_TASK_RULE,
  designationBlock,
  includedFactsBlock,
  statementBlock,
  type ArticleCategory,
  type DesignationPair,
} from './category-prompt.js';

// Bumped whenever the editorial specification below changes in substance. Persisted per run.
export const SIMPLE_ARTICLE_PROMPT_VERSION = 'simple-v1';

// Marathi label for the category, matching CATEGORY_LABEL in category-prompt.ts. The prompt is
// English but the article is Marathi, and naming the category in Marathi is what keeps the voice
// anchored ("बातमी" and "योजना-लेख" are the newsroom's own words for these two shapes).
const CATEGORY_LABEL: Record<ArticleCategory, string> = {
  news: 'बातमी (news report)',
  scheme: 'योजना-लेख (scheme / feature article)',
};

export type SimpleArticleInputs = Readonly<{
  category: ArticleCategory;
  // The principal factual source: the officer's note, the assembled DLO review text, or the
  // extracted document text. Never empty.
  sourceInformation: string;
  // Tier-1/2 style reference (select-style-reference.ts). Style, structure and voice ONLY.
  styleReference?: string | undefined;
  // The officer's optional heading / angle. Not an independent factual source.
  editorialDirection?: string | undefined;
  // Officer-approved supporting information. All three are things a person confirmed inside the
  // product, which is what makes them admissible beside the note. Retrieval output NEVER
  // appears here — a historical article is a style model, not a fact.
  designations?: readonly DesignationPair[] | undefined;
  statements?: readonly AttributedStatement[] | undefined;
  includeFacts?: readonly SelectedFact[] | undefined;
  // Facts the officer deselected in the /dlo Pointers step. An instruction, not a fact.
  excludeFacts?: readonly string[] | undefined;
  // Used only when they arrive from trusted input. Nothing infers them, and no model call is
  // added to guess them — an invented dateline on a government article is a factual error.
  location?: string | undefined;
  date?: string | undefined;
}>;

function clean(value: string | undefined | null): string {
  return (value ?? '').trim();
}

export function articleWordTarget(
  category: ArticleCategory,
): ArticleWordTarget {
  return ARTICLE_WORD_TARGETS[category];
}

// The ARTICLE STRUCTURE dateline rule. Rendered rather than substituted — see the header note.
function datelineRule(location: string, date: string): string[] {
  if (location && date) {
    return [
      'Both a verified location and a verified date are available for this article. Open the',
      'lead with the dateline in exactly this form:',
      '',
      `${location}, दि. ${date} :`,
      '',
      'Do not alter the location or the date, and do not add any other place or date to the',
      'dateline.',
    ];
  }
  return [
    'A verified location and date are NOT both available for this article. Do not invent either',
    'one, do not print a placeholder for them, and do not construct a dateline. Open the lead',
    'naturally instead, with no artificial dateline.',
  ];
}

export function buildSimpleArticleSystemPrompt(
  category: ArticleCategory,
  options?: Readonly<{
    location?: string | undefined;
    date?: string | undefined;
  }>,
): string {
  const words = articleWordTarget(category);
  const location = clean(options?.location);
  const date = clean(options?.date);

  return [
    'You are a senior Marathi government news editor writing publication-ready articles in the',
    "editorial style of Maharashtra's Directorate General of Information and Public Relations",
    '(DGIPR/Mahasamvad).',
    '',
    'Transform the supplied factual information into one complete Marathi news article.',
    '',
    'The article inputs are supplied in the user message under the headings ARTICLE CATEGORY,',
    'OPTIONAL EDITORIAL DIRECTION, SOURCE INFORMATION, ADDITIONAL VERIFIED INFORMATION,',
    'SELECTED STYLE REFERENCE, VERIFIED LOCATION, VERIFIED DATE and TARGET LENGTH. An input',
    'whose heading is absent from the user message is unavailable for this article.',
    '',
    '# FACTUAL AUTHORITY',
    '',
    'SOURCE INFORMATION and ADDITIONAL VERIFIED INFORMATION are the only factual sources for the',
    'new article.',
    '',
    'When the same fact appears in both and conflicts, prefer ADDITIONAL VERIFIED INFORMATION',
    'only when it is clearly marked as verified or corrected.',
    '',
    'SELECTED STYLE REFERENCE is not a factual source. It may only demonstrate:',
    '',
    '- editorial structure,',
    '- headline construction,',
    '- lead-writing style,',
    '- paragraph sequencing,',
    '- attribution style,',
    '- sentence rhythm,',
    '- official terminology,',
    '- information prioritisation,',
    '- level of detail,',
    '- and the overall DGIPR/Mahasamvad voice.',
    '',
    'Never copy a name, designation, quotation, location, date, amount, statistic, scheme,',
    'department, event or factual claim from the style reference unless it is also present in',
    'SOURCE INFORMATION or ADDITIONAL VERIFIED INFORMATION.',
    '',
    'Do not search the internet.',
    '',
    'Do not use general knowledge to fill gaps.',
    '',
    'Do not invent, assume, estimate or infer missing facts.',
    '',
    'Do not print an unfilled template placeholder. If optional information is unavailable, omit',
    'it gracefully.',
    '',
    '# USING THE STYLE REFERENCE',
    '',
    'When a style reference is provided, study it silently and identify:',
    '',
    '- how it presents the main news in the headline,',
    '- how it constructs the lead,',
    '- how it attributes statements,',
    '- how it introduces the official context,',
    '- how it organises figures and administrative details,',
    '- how it compresses supporting information,',
    '- how paragraphs progress from decision to implementation,',
    '- and how it concludes.',
    '',
    'Follow its editorial behaviour, not its wording or facts.',
    '',
    'Do not mention the reference in the output.',
    '',
    'When no style reference is provided, use the DGIPR/Mahasamvad rules in this prompt as the',
    'complete style guide.',
    '',
    '# EDITORIAL OBJECTIVE',
    '',
    'Write as an experienced government news editor — not as a summariser, transcription tool or',
    'meeting-minutes generator.',
    '',
    'Do not preserve the original order of the notes merely because that is how they were',
    'supplied.',
    '',
    'Silently identify the strongest supported:',
    '',
    '- decision,',
    '- announcement,',
    '- direction,',
    '- action,',
    '- public benefit,',
    '- financial provision,',
    '- deadline,',
    '- completed outcome,',
    '- or next step.',
    '',
    'Use that as the primary news angle.',
    '',
    'Prioritise:',
    '',
    '1. Final government decisions',
    '2. New announcements',
    '3. Direct public benefits',
    '4. Financial allocations',
    '5. Deadlines and implementation timelines',
    '6. Completed actions',
    '7. Legal or administrative actions',
    '8. Measurable outcomes',
    '9. Future proposals or assurances',
    '10. General background',
    '',
    'Do not make a routine meeting the headline when the meeting produced a stronger decision or',
    'direction.',
    '',
    'Avoid vague headlines such as:',
    '',
    '- बैठकीत विविध विषयांवर चर्चा',
    '- अधिकाऱ्यांना सूचना',
    '- विकासकामांचा आढावा',
    '- विविध मुद्द्यांवर विचारविनिमय',
    '',
    'Identify the specific outcome instead.',
    '',
    'Produce exactly one article. When the source contains several related details, organise them',
    'under the strongest common angle. Do not force clearly unrelated information into the article',
    'merely to preserve every sentence.',
    '',
    '# ARTICLE STRUCTURE',
    '',
    '## Headline',
    '',
    'Write a concise, factual and news-oriented Marathi headline.',
    '',
    'The headline must communicate the strongest supported decision, announcement, action,',
    'deadline or public impact.',
    '',
    'Accurately distinguish between:',
    '',
    '- निर्णय घेण्यात आला,',
    '- मान्यता देण्यात आली,',
    '- प्रस्ताव पाठविण्यात येणार,',
    '- सकारात्मक विचार करण्यात येणार,',
    '- निर्देश देण्यात आले,',
    '- कार्यवाही सुरू आहे,',
    '- काम पूर्ण झाले,',
    '- and घोषणा करण्यात आली.',
    '',
    'Do not upgrade a discussion or proposal into a final decision.',
    '',
    'Avoid promotional, emotional, vague or essay-like headlines.',
    '',
    '## Attribution line',
    '',
    'When the article is principally based on a statement by a minister, public representative or',
    'senior official, add an attribution line below the headline:',
    '',
    '– पदनाम नाव',
    '',
    'Use only the name and designation supplied in the factual inputs.',
    '',
    'Never assign a designation from general knowledge.',
    '',
    '## Highlight bullets',
    '',
    'Use zero to two short highlight bullets only when the factual inputs contain strong secondary',
    'announcements, figures, deadlines or outcomes.',
    '',
    'Do not repeat the headline in the bullets.',
    '',
    'Do not create bullets merely to imitate formatting.',
    '',
    '## Dateline and lead',
    '',
    ...datelineRule(location, date),
    '',
    'The opening paragraph should communicate as many of the following as the source supports:',
    '',
    '- the principal announcement or outcome,',
    '- the affected group or public impact,',
    '- an important amount, scale or deadline,',
    '- the responsible speaker or authority,',
    '- and the official context.',
    '',
    'The reader should understand the central news from the opening paragraph.',
    '',
    'Do not begin with greetings, ceremonial details, a long attendee list or general background',
    'when a stronger outcome is available.',
    '',
    '## Context and body',
    '',
    'Briefly explain where and why the matter was discussed.',
    '',
    'Arrange the remaining information in descending order of importance.',
    '',
    'Use separate, natural paragraphs for relevant matters such as beneficiaries, financial',
    'provisions, completed work, work in progress, pending work, implementation, departmental',
    'responsibility, legal or administrative action, investigation, infrastructure, technical',
    'information, deadlines, future planning, and supported assurances.',
    '',
    'Group related figures logically. Do not place every number into one overloaded paragraph.',
    '',
    '## Conclusion',
    '',
    'End with the strongest supported next step, deadline, implementation direction, review',
    'mechanism, administrative responsibility, public objective, or expected outcome.',
    '',
    'Do not add generic promotional conclusions such as:',
    '',
    '- हा उपक्रम नक्कीच यशस्वी ठरेल.',
    '- यामुळे नागरिकांचे जीवनमान उंचावेल.',
    '- राज्याच्या विकासाला नवी दिशा मिळेल.',
    '- शासनाचा हा ऐतिहासिक निर्णय आहे.',
    '',
    'Use such language only when it is an attributed statement in the factual input.',
    '',
    '# MEETING NOTES',
    '',
    'When SOURCE INFORMATION contains meeting notes:',
    '',
    '- extract actual decisions, directions and outcomes,',
    '- distinguish decisions from discussions,',
    '- distinguish completed actions from proposed actions,',
    '- distinguish deadlines from general intentions,',
    '- identify assigned departments or officers,',
    '- remove greetings and conversational exchanges,',
    '- remove repetition,',
    '- compress procedural discussion,',
    '- avoid opening with an attendee list,',
    '- and do not write meeting minutes.',
    '',
    'Mention attendees only when they made a relevant statement, received responsibility, or their',
    'presence is institutionally important.',
    '',
    '# FACTUAL PRECISION',
    '',
    'Preserve accurately: personal names, official designations, department names, scheme names,',
    'organisation and institution names, village, district and city names, dates, amounts,',
    'quantities, percentages, deadlines, legal provisions, technical terms, and project names.',
    '',
    'Do not silently resolve conflicting information unless one value is explicitly marked as',
    'corrected, final or verified.',
    '',
    'Do not combine conflicting figures into a new figure.',
    '',
    'Do not convert approximate figures into exact figures.',
    '',
    'Preserve distinctions such as: सुमारे, एकूण, आतापर्यंत, प्रस्तावित, मंजूर, वितरित, उपलब्ध,',
    'खर्च करण्यात आला, and खर्च करण्यात येणार.',
    '',
    'If a disputed detail is not essential, omit it. Do not expose internal analysis or',
    'factual-warning commentary in the article.',
    '',
    '# QUOTATIONS',
    '',
    'Use quotation marks only when the factual input contains an exact quotation.',
    '',
    'Do not manufacture a polished direct quotation from notes or paraphrased speech.',
    '',
    'For example, do not convert:',
    '',
    'मंत्री म्हणाले की काम लवकर पूर्ण करावे',
    '',
    'into an invented quotation. Instead write:',
    '',
    'मंत्री यांनी काम लवकर पूर्ण करण्याचे निर्देश दिले.',
    '',
    'Use attributed paraphrasing for non-verbatim statements.',
    '',
    '# LANGUAGE AND STYLE',
    '',
    'Write entirely in formal, fluent, natural and publication-ready Marathi.',
    '',
    'Use a restrained, factual and administrative tone.',
    '',
    'The article must not sound like an advertisement, a political speech, a blog, an essay,',
    'meeting minutes, a literal translation, or an AI-generated summary.',
    '',
    'Use standard Marathi administrative terminology.',
    '',
    'Keep sentences clear and moderately sized.',
    '',
    'Avoid excessive adjectives, decorative language and unnecessary repetition.',
    '',
    'Avoid repeatedly using: त्यांनी सांगितले, यावेळी, तसेच, यासंदर्भात, याबाबत, या माध्यमातून,',
    'महत्त्वपूर्ण, प्रभावी, and विविध.',
    '',
    'On first mention, use the complete verified designation and name. On later mentions, use a',
    'natural shorter form.',
    '',
    'Do not repeat the full designation in every paragraph.',
    '',
    '# EDITORIAL COMPRESSION',
    '',
    'Include the material facts needed to understand the principal decision or announcement, its',
    'impact, its scale, its implementation, and its next steps.',
    '',
    'Do not preserve every source sentence.',
    '',
    'Compress or omit repeated explanations, conversational statements, procedural detail, long',
    'attendee lists, irrelevant background, and minor details that do not change the public',
    'meaning.',
    '',
    'Do not remove important administrative information explaining who is responsible, how',
    'implementation will happen, when it will happen, how much funding is involved, or who will',
    'benefit.',
    '',
    '# LENGTH',
    '',
    `Aim for approximately ${words.target} words when the source contains enough factual material.`,
    `The acceptable range for this article is ${words.min} to ${words.max} words.`,
    '',
    'These are soft targets. When the source is limited, produce a shorter article. You may exceed',
    'the target slightly when that is necessary to preserve material administrative detail.',
    '',
    'Never add unsupported background or generic claims to reach the target length.',
    '',
    '# SILENT FINAL CHECK',
    '',
    'Before answering, silently verify:',
    '',
    '1. The headline reflects the strongest supported news.',
    '2. The status of every decision or proposal is accurate.',
    '3. The lead communicates the central outcome.',
    '4. Names, designations, dates, locations and figures match the factual inputs.',
    '5. No fact came only from the style reference.',
    '6. No quotation was invented.',
    '7. Repetitive and irrelevant material was compressed.',
    '8. The article reads like edited DGIPR/Mahasamvad news rather than reformatted notes.',
    '9. The Marathi is natural and grammatically correct.',
    '10. The article remains grounded exclusively in the supplied factual information.',
    '',
    'Correct any problem silently.',
    '',
    '# OUTPUT',
    '',
    'Return only the final Marathi article, beginning with its headline on the first line.',
    '',
    'Do not return analysis, planning, extracted facts, 5W1H notes, explanations, warnings, an',
    'English translation, reference discussion, or a description of the editorial process.',
  ].join('\n');
}

// The officer-approved supporting information. Everything here was confirmed by a person inside
// the product, which is what makes it admissible beside the note — a retrieved historical
// article never enters this block.
function additionalVerifiedBlocks(inputs: SimpleArticleInputs): string[] {
  const facts = (inputs.includeFacts ?? [])
    .map((fact) => fact.text)
    .filter((text) => clean(text).length > 0);
  const blocks = [
    ...designationBlock(inputs.designations),
    ...statementBlock(inputs.statements),
    ...includedFactsBlock(facts),
  ];
  return blocks;
}

export function buildSimpleArticleUserPrompt(
  inputs: SimpleArticleInputs,
): string {
  const words = articleWordTarget(inputs.category);
  const styleReference = clean(inputs.styleReference);
  const direction = clean(inputs.editorialDirection);
  const location = clean(inputs.location);
  const date = clean(inputs.date);
  const verified = additionalVerifiedBlocks(inputs);
  const excluded = (inputs.excludeFacts ?? [])
    .map((fact) => clean(fact))
    .filter(Boolean);

  const parts: string[] = [
    '### ARTICLE CATEGORY',
    '',
    CATEGORY_LABEL[inputs.category],
    '',
  ];

  // Omitted entirely when absent — a bare heading is what invites the model to fill it in.
  if (direction) {
    parts.push(
      '### OPTIONAL EDITORIAL DIRECTION',
      '',
      direction,
      '',
      'This may suggest an angle or heading, but it is not an independent factual source. Use it',
      'only when the factual information supports it.',
      '',
    );
  }

  parts.push('### SOURCE INFORMATION', '', clean(inputs.sourceInformation), '');

  if (verified.length > 0) {
    parts.push(
      '### ADDITIONAL VERIFIED INFORMATION',
      '',
      'Each block below was reviewed and approved by the officer inside the system. It is a',
      'factual source alongside SOURCE INFORMATION.',
      '',
      ...verified,
      '',
    );
    if ((inputs.designations ?? []).length > 0) {
      parts.push(DESIGNATION_TASK_RULE, '');
    }
    if ((inputs.statements ?? []).length > 0) {
      parts.push(STATEMENT_TASK_RULE, '');
    }
  }

  if (styleReference) {
    parts.push(
      '### SELECTED STYLE REFERENCE',
      '',
      styleReference,
      '',
      'This is a previously published article supplied as the style model. It is NOT a factual',
      'source. Take only its editorial behaviour — structure, headline construction, lead,',
      'attribution style, paragraph sequencing, terminology and voice. Take no fact from it.',
      '',
    );
  }

  if (location) parts.push('### VERIFIED LOCATION', '', location, '');
  if (date) parts.push('### VERIFIED DATE', '', date, '');

  parts.push(
    '### TARGET LENGTH',
    '',
    `${words.target} words (acceptable range ${words.min}–${words.max}).`,
    'The target is a guideline. Never invent content to reach it.',
    '',
  );

  // An instruction, not a fact: the officer looked at these and deliberately dropped them.
  // Without this the simplified path would silently undo a considered editorial decision.
  if (excluded.length > 0) {
    parts.push(
      '### EXCLUDED BY THE OFFICER',
      '',
      'The officer reviewed the following points and deliberately left them out. Do not include',
      'them, and do not restate them in other words.',
      '',
      ...excluded.map((fact) => `- ${fact}`),
      '',
    );
  }

  parts.push('Write the article now.');
  return parts.join('\n');
}

export function buildSimpleArticleMessages(
  inputs: SimpleArticleInputs,
): ChatMessage[] {
  return [
    {
      role: 'system',
      content: buildSimpleArticleSystemPrompt(inputs.category, {
        location: inputs.location,
        date: inputs.date,
      }),
    },
    { role: 'user', content: buildSimpleArticleUserPrompt(inputs) },
  ];
}

// ---------------------------------------------------------------------------
// Free harness: `tsx src/generation/simple-article-prompt.ts`
// No API key, no network, no spend. This is the loop for editing the specification above.
// ---------------------------------------------------------------------------

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  let failures = 0;
  const check = (label: string, condition: boolean): void => {
    if (!condition) {
      failures += 1;
      console.error(`  FAIL  ${label}`);
    } else {
      console.log(`  ok    ${label}`);
    }
  };

  const baseNote =
    'मुंबई महापालिकेच्या चार रुग्णालयांत नवीन एमआरआय केंद्रे सुरू होणार आहेत.';

  console.log('\n=== system prompt: rules present ===');
  const sys = buildSimpleArticleSystemPrompt('scheme');
  for (const block of [
    '# FACTUAL AUTHORITY',
    '# USING THE STYLE REFERENCE',
    '# EDITORIAL OBJECTIVE',
    '# ARTICLE STRUCTURE',
    '# MEETING NOTES',
    '# FACTUAL PRECISION',
    '# QUOTATIONS',
    '# LANGUAGE AND STYLE',
    '# EDITORIAL COMPRESSION',
    '# LENGTH',
    '# SILENT FINAL CHECK',
    '# OUTPUT',
  ]) {
    check(`system carries ${block}`, sys.includes(block));
  }
  check(
    'system forbids using general knowledge',
    sys.includes('Do not use general knowledge to fill gaps.'),
  );
  check(
    'system forbids taking facts from the style reference',
    sys.includes('Never copy a name, designation, quotation'),
  );
  check(
    'system asks for the article only',
    sys.includes('Return only the final Marathi article'),
  );

  console.log('\n=== word targets per category ===');
  const newsSys = buildSimpleArticleSystemPrompt('news');
  check('news target is 350', newsSys.includes('approximately 350 words'));
  check('news range is 250 to 450', newsSys.includes('250 to 450 words'));
  check('scheme target is 600', sys.includes('approximately 600 words'));
  check('scheme range is 450 to 750', sys.includes('450 to 750 words'));
  check(
    'length is stated as a soft target',
    sys.includes('These are soft targets.'),
  );

  console.log('\n=== dateline is rendered, never substituted ===');
  const withDateline = buildSimpleArticleSystemPrompt('news', {
    location: 'पुणे',
    date: '२७ जुलै २०२६',
  });
  check(
    'concrete dateline emitted when both are present',
    withDateline.includes('पुणे, दि. २७ जुलै २०२६ :'),
  );
  const halfDateline = buildSimpleArticleSystemPrompt('news', {
    location: 'पुणे',
  });
  check(
    'no dateline constructed when the date is missing',
    !halfDateline.includes('दि.  :') &&
      halfDateline.includes('do not construct a dateline'),
  );
  check(
    'no dateline constructed when both are missing',
    newsSys.includes('do not construct a dateline'),
  );

  console.log('\n=== no unfilled placeholder survives anywhere ===');
  const fullUser = buildSimpleArticleUserPrompt({
    category: 'scheme',
    sourceInformation: baseNote,
    styleReference: 'शीर्षक: नमुना लेख\n\nमजकूर.',
    editorialDirection: 'शेतकऱ्यांचा फायदा',
    designations: [{ name: 'देवेंद्र फडणवीस', designation: 'मुख्यमंत्री' }],
    statements: [
      {
        speaker: 'देवेंद्र फडणवीस',
        designation: 'मुख्यमंत्री',
        venue: 'मुंबई',
        claim: 'काम वेळेत पूर्ण करावे',
      },
    ],
    includeFacts: [{ dimension: 'what', text: 'चार रुग्णालयांत एमआरआय' }],
    excludeFacts: ['समितीची सदस्य यादी'],
    location: 'मुंबई',
    date: '२७ जुलै २०२६',
  });
  for (const [label, text] of [
    ['system', withDateline],
    ['user (all slots filled)', fullUser],
    [
      'user (all optional slots empty)',
      buildSimpleArticleUserPrompt({
        category: 'news',
        sourceInformation: baseNote,
      }),
    ],
  ] as const) {
    check(`${label} contains no {{ placeholder`, !text.includes('{{'));
    check(`${label} contains no }} placeholder`, !text.includes('}}'));
  }

  console.log('\n=== empty optionals are omitted, not rendered blank ===');
  const bareUser = buildSimpleArticleUserPrompt({
    category: 'news',
    sourceInformation: baseNote,
    styleReference: '   ',
    editorialDirection: '',
    designations: [],
    statements: [],
    includeFacts: [],
    excludeFacts: ['   '],
  });
  check(
    'no SELECTED STYLE REFERENCE heading',
    !bareUser.includes('SELECTED STYLE REFERENCE'),
  );
  check(
    'no OPTIONAL EDITORIAL DIRECTION heading',
    !bareUser.includes('OPTIONAL EDITORIAL DIRECTION'),
  );
  check(
    'no ADDITIONAL VERIFIED INFORMATION heading',
    !bareUser.includes('ADDITIONAL VERIFIED INFORMATION'),
  );
  check(
    'no VERIFIED LOCATION heading',
    !bareUser.includes('VERIFIED LOCATION'),
  );
  check('no VERIFIED DATE heading', !bareUser.includes('VERIFIED DATE'));
  check(
    'whitespace-only exclusion emits no block',
    !bareUser.includes('EXCLUDED BY THE OFFICER'),
  );
  check(
    'source information is always present',
    bareUser.includes('### SOURCE INFORMATION') && bareUser.includes(baseNote),
  );
  check(
    'target length is always present',
    bareUser.includes('### TARGET LENGTH'),
  );

  console.log('\n=== officer-approved information reaches the prompt ===');
  check(
    'designations block present',
    fullUser.includes('<DESIGNATIONS') &&
      fullUser.includes('मुख्यमंत्री देवेंद्र फडणवीस'),
  );
  check(
    'designation task rule present',
    fullUser.includes(DESIGNATION_TASK_RULE),
  );
  check(
    'statements block present',
    fullUser.includes('<ATTRIBUTED_STATEMENTS') &&
      fullUser.includes('काम वेळेत पूर्ण करावे'),
  );
  check('statement task rule present', fullUser.includes(STATEMENT_TASK_RULE));
  check(
    'required facts block present',
    fullUser.includes('<REQUIRED_FACTS') &&
      fullUser.includes('चार रुग्णालयांत एमआरआय'),
  );
  check(
    'excluded facts reach the prompt as an instruction',
    fullUser.includes('EXCLUDED BY THE OFFICER') &&
      fullUser.includes('समितीची सदस्य यादी'),
  );
  check(
    'style reference is labelled as not a factual source',
    fullUser.includes('It is NOT a factual'),
  );

  console.log('\n=== retrieval output never lands in the verified block ===');
  const refOnly = buildSimpleArticleUserPrompt({
    category: 'news',
    sourceInformation: baseNote,
    styleReference: 'ऐतिहासिक लेखाचा मजकूर',
  });
  check(
    'a style reference alone does not open ADDITIONAL VERIFIED INFORMATION',
    !refOnly.includes('ADDITIONAL VERIFIED INFORMATION'),
  );

  console.log('\n=== message shape ===');
  const messages = buildSimpleArticleMessages({
    category: 'scheme',
    sourceInformation: baseNote,
  });
  check('exactly two messages', messages.length === 2);
  check('first is system', messages[0]?.role === 'system');
  check('second is user', messages[1]?.role === 'user');

  console.log(
    `\nprompt version: ${SIMPLE_ARTICLE_PROMPT_VERSION} | system ${sys.length} chars\n`,
  );
  if (failures > 0) {
    console.error(`${failures} check(s) failed.`);
    process.exitCode = 1;
  } else {
    console.log('All checks passed.');
  }
}
