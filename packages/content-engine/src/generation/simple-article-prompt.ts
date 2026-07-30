// The editorial specification for the SIMPLIFIED article generator
// (ARTICLE_GENERATION_MODE=simple): style references, one model call, one publication-ready
// Marathi article. This module owns the prompt and nothing else — no I/O, no model call — so it
// can be exercised for free (`tsx src/generation/simple-article-prompt.ts`).
//
// THE SPECIFICATION IS THE REFERENCE ARTICLE. As of simple-v4 the system message says two
// things and nothing else: follow the reference's writing style and structure, and use only the
// supplied information — plus the one piece of DATA the model cannot derive from either, the
// officer's verified NAME DICTIONARY. Everything a previous version stated as a rule (paragraph
// shape, headline pattern, dateline form, register, priority ordering) is deleted, because the
// exemplars demonstrate all of it and a long rule block out-instructs them.
//
// LENGTH is the ONE deliberate exception to that (simple-v7), because imitating an exemplar's
// length is actively wrong. The instruction is now fully length-neutral: use editorial
// judgement to produce the best publication-ready article the supplied information supports,
// at whatever length serves that material. It explicitly rejects optimization for either
// longer or shorter output, as well as padding, repetition and unsupported invention.
//
// Three decisions worth knowing before editing:
//
// 1. The prompt lives in TypeScript, like every other prompt in this repo, so it ships inside
//    the built dist with no file read and no runtime path resolution. SIMPLE_ARTICLE_PROMPT_VERSION
//    is persisted with each run (generations.style_reference_meta), so a change here is
//    attributable later — which is what the future approved-example loop needs in order to say
//    "these officer corrections were made against THAT specification".
//
// 2. It is split into a system message (the two instructions) and a user message (the filled
//    INPUTS). The factual-source boundary is NOT weakened by the split: the system message names
//    the admissible slots, and those names are stable headings in the user message.
//
// 3. Every optional slot is OMITTED when empty rather than rendered blank — a heading with
//    nothing under it is exactly the shape that invites a model to fill it in. The dateline is
//    therefore RENDERED, not string-substituted, and only when BOTH halves are present: a blind
//    substitution would emit ", दि.  :" or leak a literal {{location}} into a published
//    government article.
//
// 4. The dictionary is DATA, not style guidance. The officer's verified spellings are the whole
//    reason the glossary exists, and a model cannot guess that मुख्यमंत्री is देवेंद्र फडणवीस.
//    It is the one block that survived the cut. applyDesignations() still runs deterministically
//    after the call — this block is the prompt half, never the guarantee.

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
//
// v9 (2026-07-29): NEWS only — a minister's meeting/visit/review is written around the
// minister's strongest public-facing, source-supported statement, decision, direction,
// assurance, announcement or next step. SOURCE INFORMATION is explicitly a factual pool, not a
// completeness checklist; meeting-minutes detail that does not serve that central message may
// be omitted. Scheme articles are byte-for-byte unchanged.
//
// v8 (2026-07-29): when the source names a portfolio department and DESIGNATIONS carries its
// verified minister, preserve the department as the institutional target while replacing an
// agentless human decision with "पदनाम + पूर्ण नाव".
//
// v7 (2026-07-29): the length paragraph is fully neutral. "A longer article is good when..."
// still made length sound like a quality signal. It now says length does not matter, asks for
// the best publication-ready article possible using editorial judgement, and lets the supplied
// information determine the necessary detail without padding, repetition or invention.
//
// v6 (2026-07-28): the NAME DICTIONARY sentence says the title goes before the person's name on
// first mention AND before the bare surname on every later mention ("मुख्यमंत्री फडणवीस यांनी"),
// including where the source only ever has the surname. Officer's call: a government article
// names an official with their office each time it names them. applyDesignations() enforces the
// same rule deterministically afterwards, so this is the prompt half, not the guarantee.
//
// v5 (2026-07-28): one paragraph back, about LENGTH only — do not inherit the reference's
// length, write the most detailed article the supplied information supports, longer is good
// when the extra length explains something and shorter when it would only repeat. This is NOT
// the v3 word target returning: no count, no range, and the trade is stated in both directions
// with "never add unsupplied information to make it longer" attached, because the failure mode
// of a one-sided "be detailed" is padding. Everything else in v4 stands.
//
// v4 (2026-07-28): every editorial RULE is gone. The system message is now two sentences —
// follow the reference article's writing style and structure, and take facts only from the
// supplied sections — plus one sentence about the NAME DICTIONARY, which is newly wired into
// this variant (it previously reached only ARTICLE_PROMPT_VARIANT=minimal). The `location`/
// `date` dateline instruction went with the rest: a dateline is now rendered in the USER
// message as data when both halves are present, and simply absent otherwise. That also makes
// buildSimpleArticleSystemPrompt() argument-free.
//
// v3 (2026-07-28): the word target is GONE — no `approximately N words`, no acceptable range,
// no TARGET LENGTH block. A stated count is an instruction the model obeys against the material,
// which pads a thin note and truncates a rich one; length is now the source's business, bounded
// only by what the exemplars show. The anti-padding half of the old rule survives as a rule
// about invention, not about length. With that gone the system prompt no longer varies by
// category, so it takes no `category` argument (the category still reaches the model as the
// user message's ARTICLE CATEGORY heading).
//
// v2 (2026-07-27): the references now arrive WITH their headlines and there may be several of
// them; the DGIPR house idiom (यावेळी / … यांनी सांगितले) is no longer on the avoid-list — the
// exemplars use it and banning it drove the model into a flat agentless register; the invented
// "zero to two highlight bullets" rule is gone; and the ten-rung priority ladder that re-sorted
// the officer's notes is replaced by "lead on the strongest outcome, then follow the source".
export const SIMPLE_ARTICLE_PROMPT_VERSION = 'simple-v9';

// Marathi label for the category, matching CATEGORY_LABEL in category-prompt.ts. The prompt is
// English but the article is Marathi, and naming the category in Marathi is what keeps the voice
// anchored ("बातमी" and "योजना-लेख" are the newsroom's own words for these two shapes).
const CATEGORY_LABEL: Record<ArticleCategory, string> = {
  news: 'बातमी (news report)',
  scheme: 'योजना-लेख (scheme / feature article)',
};

// The editorial distinction the category label and exemplars cannot safely be left to imply.
// Real Mahasamvad meeting reports are not minutes: their headline and lead communicate what the
// minister said, decided, directed or promised, while the meeting supplies context. Conditional
// on the source actually being minister-shaped so an agency notice or non-minister news item is
// never forced to invent a minister.
//
// Exported for minimal-article-prompt.ts so ARTICLE_PROMPT_VARIANT changes wording density, not
// the product's NEWS editorial goal.
export const NEWS_MINISTER_EDITORIAL_FOCUS = [
  "When SOURCE INFORMATION concerns a minister's meeting, visit, review or remarks, first",
  'identify what the principal minister is actually communicating to the public. Build the',
  "headline, lead and article around that minister's strongest source-supported statement,",
  'decision, direction, assurance, announcement or next step, and attribute it clearly to that',
  'minister. If several ministers or topics appear, choose one principal public-facing angle;',
  'include the others only when they directly support it.',
  '',
  'Treat SOURCE INFORMATION as a factual pool, not a completeness checklist. Use only the',
  'context and supporting facts that help readers understand the central ministerial message.',
  'You may omit unrelated agenda items, routine procedure, attendee lists, repetition and any',
  'other supplied detail that does not serve the editorial flow. Do not write meeting minutes',
  'or a summary of every supplied fact. Never invent or transfer a statement, decision or',
  'attribution.',
].join('\n');

export function newsEditorialFocusBlock(category: ArticleCategory): string[] {
  return category === 'news'
    ? ['### NEWS EDITORIAL FOCUS', '', NEWS_MINISTER_EDITORIAL_FOCUS, '']
    : [];
}

// One complete exemplar as the prompt renders it. `title` is the article's own HEADLINE, and
// passing it is not cosmetic: the specification asks the model to study "headline
// construction", and until this field existed the reference was the joined chunk BODIES only,
// so the pattern it was told to learn was never visible to it.
export type SimpleArticleReference = Readonly<{
  title?: string | null | undefined;
  text: string;
}>;

// One verified dictionary entry as the prompt renders it. Deliberately a local shape rather
// than @dgipr/database's GlossaryTerm: content-engine does not depend on the database package,
// and the caller (apps/api) already holds a Supabase client.
//
// Defined here rather than in minimal-article-prompt.ts because BOTH variants now render it;
// minimal re-exports this type so its own imports and the package barrel keep working.
export type ArticleNameEntry = Readonly<{
  marathi: string;
  // 'person' | 'place' | 'org' | 'scheme' | 'designation' | 'other' — carried through verbatim
  // so the prompt can label the entry without this module knowing the enum.
  termType?: string | null | undefined;
  // The Marathi title for a person row (glossary_terms.designation, migration 0032).
  designation?: string | null | undefined;
}>;

export type SimpleArticleInputs = Readonly<{
  category: ArticleCategory;
  // The principal factual source: the officer's note, the assembled DLO review text, or the
  // extracted document text. Never empty.
  sourceInformation: string;
  // Tier-1/2 style reference (select-style-reference.ts). Style, structure and voice ONLY.
  // Prefer `styleReferences`; this single-string form is kept for callers that have one
  // headline-less article and is treated as a one-element list.
  styleReference?: string | undefined;
  // Every exemplar, headline included. Wins over `styleReference` when non-empty.
  styleReferences?: readonly SimpleArticleReference[] | undefined;
  // The officer's optional heading / angle. Not an independent factual source.
  editorialDirection?: string | undefined;
  // Officer-approved supporting information. All three are things a person confirmed inside the
  // product, which is what makes them admissible beside the note. Retrieval output NEVER
  // appears here — a historical article is a style model, not a fact.
  designations?: readonly DesignationPair[] | undefined;
  statements?: readonly AttributedStatement[] | undefined;
  includeFacts?: readonly SelectedFact[] | undefined;
  // The officer's verified glossary rows whose Marathi form occurs in the note. Style-neutral
  // DATA: the spellings themselves, plus each person's approved title. The caller fetches them
  // (findGlossaryTermsInText); content-engine does not depend on @dgipr/database.
  names?: readonly ArticleNameEntry[] | undefined;
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

// Three instructions and one piece of data. Still no arguments: nothing in here varies by
// category, by word target or by whether a dateline is available — the category reaches the
// model as the user message's ARTICLE CATEGORY heading, the length instruction is a policy and
// not a number, and a dateline is rendered as data in the user message when one exists.
//
// Before adding a sentence here, check whether a style reference already demonstrates it. If it
// does, the reference is the better teacher and the sentence is what makes the model stop
// listening to it — that regression is the whole reason for v4. The length sentence earns its
// place by the opposite test: the exemplar demonstrates a length, and demonstrating it is
// precisely the problem.
export function buildSimpleArticleSystemPrompt(): string {
  return [
    'Look at the provided reference article and generate a new article in Marathi that follows',
    'the same writing style and structure, use only the information provided in the SOURCE',
    'INFORMATION and ADDITIONAL VERIFIED INFORMATION sections.',
    '',
    'Take style and structure from the reference, but do not treat its length as a target.',
    'The new article’s length does not matter. Use your best editorial judgement to produce',
    'the strongest publication-ready article possible from the supplied information, at the',
    'length that best serves it. Use the information fully when it improves the article, but',
    'do not pad, repeat, stretch, or add unsupported information.',
    '',
    'Where the NAME DICTIONARY gives a spelling, use it exactly. Where a title is given after a',
    "name, use it before that person's full name on first mention and before their bare surname",
    'every time after that ("मुख्यमंत्री फडणवीस यांनी"). Where the source has only the surname,',
    'still write the title before it; never add a first name the source does not have.',
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

// Normalise the two accepted reference shapes into one list, dropping empties. The plural form
// wins when present; the legacy single string is treated as one headline-less article.
function referenceList(
  inputs: SimpleArticleInputs,
): readonly SimpleArticleReference[] {
  const plural = (inputs.styleReferences ?? [])
    .map((reference) => ({
      title: clean(reference.title),
      text: clean(reference.text),
    }))
    .filter((reference) => reference.text.length > 0);
  if (plural.length > 0) return plural;

  const single = clean(inputs.styleReference);
  return single ? [{ title: '', text: single }] : [];
}

// Render the exemplars. The headline is emitted as its own `शीर्षक:` line above the body —
// the whole point of this block is that the model can see how a Mahasamvad headline is built.
function referenceBlock(
  references: readonly SimpleArticleReference[],
): string[] {
  if (references.length === 0) return [];

  const many = references.length > 1;
  const parts: string[] = [
    many
      ? `### SELECTED STYLE REFERENCES (${references.length})`
      : '### SELECTED STYLE REFERENCE',
    '',
  ];

  references.forEach((reference, index) => {
    const title = clean(reference.title);
    parts.push(many ? `--- संदर्भ ${index + 1} ---` : '--- संदर्भ ---', '');
    if (title) parts.push(`शीर्षक: ${title}`, '');
    parts.push(reference.text, '');
  });

  // One descriptive line, not a rule list. What to take from them is already the system
  // message's first sentence; what NOT to take is its second. The only thing left worth saying
  // is what these texts ARE — and that a writer credit belongs to their author, not to us.
  parts.push(
    many
      ? 'These are previously published DGIPR/Mahasamvad articles supplied as the style model.'
      : 'This is a previously published DGIPR/Mahasamvad article supplied as the style model.',
    "Do not reproduce a reference's sign-off or writer credit.",
    '',
  );
  return parts;
}

// The dictionary. Person rows carry their approved title, which is what makes a transcript
// saying "देवेंद्र फडणवीस" publish as "मुख्यमंत्री देवेंद्र फडणवीस".
//
// Officer-approved pairs are emitted FIRST and win on a name collision: those were confirmed
// for THIS run, whereas a dictionary row can be stale (office-holders change). applyDesignations()
// still runs deterministically after the model call — this block is the prompt half, not the
// guarantee.
function nameBlock(
  names: readonly ArticleNameEntry[],
  designations: readonly DesignationPair[],
): string[] {
  const lines: string[] = [];
  const seen = new Set<string>();

  for (const pair of designations) {
    const name = clean(pair.name);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const title = clean(pair.designation);
    lines.push(title ? `- ${name} — ${title}` : `- ${name}`);
  }

  for (const entry of names) {
    const name = clean(entry.marathi);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const title = clean(entry.designation);
    lines.push(title ? `- ${name} — ${title}` : `- ${name}`);
  }

  if (lines.length === 0) return [];
  return ['### NAME DICTIONARY', '', 'Verified spellings.', '', ...lines, ''];
}

export function buildSimpleArticleUserPrompt(
  inputs: SimpleArticleInputs,
): string {
  const references = referenceList(inputs);
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
  parts.push(...newsEditorialFocusBlock(inputs.category));

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

  parts.push(...referenceBlock(references));
  parts.push(...nameBlock(inputs.names ?? [], inputs.designations ?? []));

  // Rendered, never substituted, and only when BOTH halves are present — half a dateline is
  // worse than none, since the missing half is exactly what a model fills in by inventing it.
  if (location && date) {
    parts.push('### DATELINE', '', `${location}, दि. ${date} :`, '');
  }

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
    { role: 'system', content: buildSimpleArticleSystemPrompt() },
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

  console.log('\n=== the specification is the REFERENCE, not a rule block ===');
  const sys = buildSimpleArticleSystemPrompt();
  check(
    'it asks for the reference article to be followed',
    sys.includes('Look at the provided reference article') &&
      sys.includes('follows') &&
      sys.includes('the same writing style and structure'),
  );
  check(
    'it names the two admissible factual sections',
    sys.includes(
      'use only the information provided in the SOURCE\nINFORMATION and ADDITIONAL VERIFIED INFORMATION sections',
    ),
  );
  check(
    'the article is asked for in Marathi',
    sys.includes('a new article in Marathi'),
  );
  check('the system prompt takes no arguments', sys.length > 0);

  console.log('\n=== the NAME DICTIONARY is the one thing beyond that ===');
  check(
    'the dictionary is authoritative for spelling',
    sys.includes('Where the NAME DICTIONARY gives a spelling, use it exactly.'),
  );
  check(
    'a title is used before the full name on first mention',
    sys.includes("use it before that person's full name on first mention"),
  );
  check(
    'and before the bare surname on every later mention',
    sys.includes('before their bare surname') &&
      sys.includes('every time after that') &&
      sys.includes('मुख्यमंत्री फडणवीस यांनी'),
  );
  check(
    'a surname-only source still gets the title, without an invented first name',
    sys.includes('has only the surname') &&
      sys.includes('never add a first name the source does not have'),
  );

  console.log('\n=== length is the one thing NOT taken from the reference ===');
  check(
    "the reference's length is explicitly excluded",
    sys.includes('do not treat its length as a target'),
  );
  check(
    'length is explicitly irrelevant',
    sys.includes('The new article’s length does not matter.'),
  );
  check(
    'editorial judgement and reasoning choose the best output',
    sys.includes('Use your best editorial judgement') &&
      sys.includes('the strongest publication-ready article possible'),
  );
  check(
    'the material determines whatever length serves it',
    sys.includes('at the\nlength that best serves it'),
  );
  check(
    'padding, repetition and unsupported additions are forbidden',
    sys.includes('do not pad, repeat, stretch, or add unsupported information'),
  );
  // The whole point of v7 over v3/v5: quality is the target; length is not.
  check('length is stated without any figure', !/\d/u.test(sys));

  console.log('\n=== every editorial RULE is gone ===');
  check('no word count is stated', !/\d[\d,]*\s*words/u.test(sys));
  check(
    'no numeric range survives',
    !/\d+\s*(to|–|-)\s*\d+\s*words/u.test(sys),
  );
  for (const gone of [
    'TARGET LENGTH',
    'There is no word target.',
    'Never pad.',
    'paragraph',
    'bullet',
    'Lead with',
    'FOLLOW THE ORDER OF THE SOURCE',
    'Preserve STATUS exactly.',
    'meeting minutes',
    'general knowledge',
    'Devanagari digits',
    'शासन निर्णय',
    '– पदनाम नाव',
    'THEY DEFINE THE TARGET STYLE',
    'Highlight bullets',
    'Avoid repeatedly using',
    '# 1. FACTS',
    '# OUTPUT',
  ]) {
    check(`system no longer says "${gone}"`, !sys.includes(gone));
  }
  check(
    'no numbered rule headings survive',
    !/^#+\s*\d/mu.test(sys) && !/^\d+\.\s/mu.test(sys),
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
    names: [{ marathi: 'कोल्हापूर', termType: 'place' }],
    location: 'मुंबई',
    date: '२७ जुलै २०२६',
  });
  for (const [label, text] of [
    ['system', sys],
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
    names: [],
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
  check('no DATELINE heading', !bareUser.includes('DATELINE'));
  check(
    'an empty dictionary emits no NAME DICTIONARY heading',
    !bareUser.includes('NAME DICTIONARY'),
  );
  check(
    'whitespace-only exclusion emits no block',
    !bareUser.includes('EXCLUDED BY THE OFFICER'),
  );
  check(
    'source information is always present',
    bareUser.includes('### SOURCE INFORMATION') && bareUser.includes(baseNote),
  );
  check(
    'news receives the minister-centred editorial focus',
    bareUser.includes('### NEWS EDITORIAL FOCUS') &&
      bareUser.includes('factual pool, not a completeness checklist') &&
      bareUser.includes('Do not write meeting minutes'),
  );
  check(
    'scheme receives no news editorial focus',
    !fullUser.includes('NEWS EDITORIAL FOCUS') &&
      !fullUser.includes('factual pool, not a completeness checklist'),
  );
  check(
    'the user prompt states no length at all',
    !bareUser.includes('TARGET LENGTH') && !/\d[\d,]*\s*words/u.test(bareUser),
  );
  check(
    'a filled user prompt states no length either',
    !fullUser.includes('TARGET LENGTH') && !/\d[\d,]*\s*words/u.test(fullUser),
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
    'the department target is preserved and the agentless decision is attributed',
    fullUser.includes(
      'प्रस्ताव उच्च व तंत्रशिक्षण विभागाकडे सादर करण्याचे निर्देश उच्च व तंत्रशिक्षण मंत्री चंद्रकांत पाटील यांनी दिले',
    ),
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
    "a reference's sign-off must not be copied",
    fullUser.includes(
      "Do not reproduce a reference's sign-off or writer credit.",
    ),
  );
  check(
    'a complete dateline is rendered, never substituted',
    fullUser.includes('### DATELINE') &&
      fullUser.includes('मुंबई, दि. २७ जुलै २०२६ :'),
  );
  for (const half of [
    { location: 'मुंबई' },
    { date: '२७ जुलै २०२६' },
  ] as const) {
    const partial = buildSimpleArticleUserPrompt({
      category: 'news',
      sourceInformation: baseNote,
      ...half,
    });
    check(
      `half a dateline (${Object.keys(half)[0]} only) produces none`,
      !partial.includes('DATELINE') && !partial.includes('दि.  :'),
    );
  }

  console.log('\n=== the NAME DICTIONARY reaches the prompt ===');
  const named = buildSimpleArticleUserPrompt({
    category: 'news',
    sourceInformation: baseNote,
    names: [
      { marathi: 'कोल्हापूर', termType: 'place' },
      { marathi: 'अमित देशमुख', termType: 'person', designation: 'मंत्री' },
    ],
    designations: [{ name: 'देवेंद्र फडणवीस', designation: 'मुख्यमंत्री' }],
  });
  check('the block appears', named.includes('### NAME DICTIONARY'));
  check(
    'an officer-approved pair carries its title',
    named.includes('- देवेंद्र फडणवीस — मुख्यमंत्री'),
  );
  check(
    'a dictionary person carries its title',
    named.includes('- अमित देशमुख — मंत्री'),
  );
  check(
    'a titleless entry is a bare name',
    named.includes('- कोल्हापूर') && !named.includes('- कोल्हापूर —'),
  );
  check(
    'the approved pair wins over a stale dictionary row for the same name',
    (() => {
      const clash = buildSimpleArticleUserPrompt({
        category: 'news',
        sourceInformation: baseNote,
        names: [
          {
            marathi: 'देवेंद्र फडणवीस',
            termType: 'person',
            designation: 'उपमुख्यमंत्री',
          },
        ],
        designations: [{ name: 'देवेंद्र फडणवीस', designation: 'मुख्यमंत्री' }],
      });
      return (
        clash.includes('- देवेंद्र फडणवीस — मुख्यमंत्री') &&
        !clash.includes('उपमुख्यमंत्री')
      );
    })(),
  );
  check(
    'a dictionary entry reaches a prompt that has no approved designations',
    fullUser.includes('- कोल्हापूर'),
  );
  check(
    'a whitespace-only entry is dropped',
    !buildSimpleArticleUserPrompt({
      category: 'news',
      sourceInformation: baseNote,
      names: [{ marathi: '   ' }],
    }).includes('NAME DICTIONARY'),
  );

  console.log('\n=== the exemplar HEADLINE reaches the prompt ===');
  const titled = buildSimpleArticleUserPrompt({
    category: 'news',
    sourceInformation: baseNote,
    styleReferences: [
      {
        title: 'नागरिकांची गैरसोय टाळावी – पालकमंत्री मंगलप्रभात लोढा',
        text: 'मुंबई, दि. ६ : ... असे निर्देश पालकमंत्री यांनी दिले.',
      },
    ],
  });
  check(
    'the title is emitted as its own शीर्षक line',
    titled.includes(
      'शीर्षक: नागरिकांची गैरसोय टाळावी – पालकमंत्री मंगलप्रभात लोढा',
    ),
  );
  check(
    'the body follows the title',
    titled.includes('मुंबई, दि. ६ : ... असे निर्देश पालकमंत्री यांनी दिले.'),
  );
  check(
    'a single reference uses the singular heading',
    titled.includes('### SELECTED STYLE REFERENCE') &&
      !titled.includes('### SELECTED STYLE REFERENCES'),
  );

  console.log('\n=== several exemplars are numbered ===');
  const multi = buildSimpleArticleUserPrompt({
    category: 'news',
    sourceInformation: baseNote,
    styleReferences: [
      { title: 'पहिले शीर्षक', text: 'पहिला मजकूर.' },
      { title: 'दुसरे शीर्षक', text: 'दुसरा मजकूर.' },
      { title: 'तिसरे शीर्षक', text: 'तिसरा मजकूर.' },
    ],
  });
  check(
    'plural heading carries the count',
    multi.includes('### SELECTED STYLE REFERENCES (3)'),
  );
  for (const n of [1, 2, 3]) {
    check(`संदर्भ ${n} is labelled`, multi.includes(`--- संदर्भ ${n} ---`));
  }
  check(
    'every headline is present',
    ['पहिले शीर्षक', 'दुसरे शीर्षक', 'तिसरे शीर्षक'].every((t) =>
      multi.includes(`शीर्षक: ${t}`),
    ),
  );
  check(
    'every body is present',
    ['पहिला मजकूर.', 'दुसरा मजकूर.', 'तिसरा मजकूर.'].every((t) =>
      multi.includes(t),
    ),
  );
  console.log('\n=== reference shapes: plural wins, empties are dropped ===');
  check(
    'the legacy single string still renders',
    buildSimpleArticleUserPrompt({
      category: 'news',
      sourceInformation: baseNote,
      styleReference: 'एकच संदर्भ मजकूर.',
    }).includes('एकच संदर्भ मजकूर.'),
  );
  check(
    'a titleless reference emits no शीर्षक line',
    !buildSimpleArticleUserPrompt({
      category: 'news',
      sourceInformation: baseNote,
      styleReference: 'एकच संदर्भ मजकूर.',
    }).includes('शीर्षक:'),
  );
  check(
    'styleReferences wins over styleReference',
    (() => {
      const both = buildSimpleArticleUserPrompt({
        category: 'news',
        sourceInformation: baseNote,
        styleReference: 'जुना मजकूर.',
        styleReferences: [{ title: 'नवे', text: 'नवा मजकूर.' }],
      });
      return both.includes('नवा मजकूर.') && !both.includes('जुना मजकूर.');
    })(),
  );
  check(
    'blank-text references are dropped entirely',
    !buildSimpleArticleUserPrompt({
      category: 'news',
      sourceInformation: baseNote,
      styleReferences: [{ title: 'शीर्षक आहे', text: '   ' }],
    }).includes('SELECTED STYLE REFERENCE'),
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
