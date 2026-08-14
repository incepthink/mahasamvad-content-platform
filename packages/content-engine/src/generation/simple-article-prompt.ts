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
import {
  lengthRequirementBlock,
  parseLengthRequest,
} from './article-length.js';
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
// v13 (2026-08-11): the officer's two inputs OUTRANK this specification. A PRECEDENCE block
// states the order explicitly — never invent > HEADLINE/ANGLE + OFFICER REQUEST > everything
// here — because these models resolve a conflict by whatever is stated as ranking, and nothing
// was. The length sentence, previously an absolute ("the article's length does not matter"),
// is now conditional on the officer not having asked for one, and says HOW a requested length
// may be reached: by covering the supplied information more fully, never by padding. "Do not
// stretch" is gone with it — it read as a ban on legitimate elaboration too. The heading block
// drops its three hedges, is renamed off "OPTIONAL", and moves from near the top to sit beside
// the officer request at the END, the position these models weight most.
//
// v11 (2026-08-05): the free-text field is the officer's trusted request, not a style-only
// instruction. It may supply or correct facts as well as direct the writing. The compact block
// remains last; historical references remain style-only. Absent ⇒ byte-for-byte v9.
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
// v12 (2026-08-05): the DATELINE block says WHERE the dateline goes — the first body paragraph,
// never the headline, once. Unstated, a model that opens with a plain headline line reads "start
// the article with this" literally and datelines the headline (observed in production).
// v14 (2026-08-14): NEWS EDITORIAL FOCUS is unconditional for `news` and says which fact leads
// and which supplied details are worth printing — see the block's own header for the production
// article that forced it. The minister case survives as one branch of the lead rule.
export const SIMPLE_ARTICLE_PROMPT_VERSION = 'simple-v14';

// Marathi label for the category, matching CATEGORY_LABEL in category-prompt.ts. The prompt is
// English but the article is Marathi, and naming the category in Marathi is what keeps the voice
// anchored ("बातमी" and "योजना-लेख" are the newsroom's own words for these two shapes).
const CATEGORY_LABEL: Record<ArticleCategory, string> = {
  news: 'बातमी (news report)',
  scheme: 'योजना-लेख (scheme / feature article)',
};

// The editorial judgement the category label and the exemplars cannot safely be left to imply:
// WHICH fact leads, and WHICH supplied facts are worth printing at all.
//
// Until 2026-08-14 this block was scoped to a minister's meeting ("When SOURCE INFORMATION
// concerns a minister's meeting, visit, review or remarks…") and every selection instruction in
// it — factual pool not a checklist, omit routine detail, do not write minutes — hung off that
// opening condition. So an ordinary departmental note received NO selection guidance at all.
// Observed on intake 11961f50 (a note about a rebuilt state guest house): the model restated the
// note in the note's own order — plot area, built-up area and a floor-by-floor suite breakdown
// as a whole paragraph, then the full eligibility list of every service cadre — and put the
// actual news, the Chief Minister inaugurating it on 13 August, in the LAST paragraph. Nothing
// was invented and nothing was wrong; it simply was not a news article.
//
// So the two instructions are now unconditional for `news` and the minister case is one branch
// of the first. The second half names the categories of detail that a government note is full of
// and a news report is not, because "omit what does not serve the flow" is too abstract to act
// on when every supplied fact is true and official.
//
// This stays NEWS-only. A योजना-लेख legitimately prints amounts, eligibility and deadlines —
// those ARE the citizen-facing facts there, and the tiered-completeness principle is
// citizen-first, not short.
//
// Exported for minimal-article-prompt.ts so ARTICLE_PROMPT_VARIANT changes wording density, not
// the product's NEWS editorial goal.
export const NEWS_EDITORIAL_FOCUS = [
  'DECIDE WHAT THE NEWS IS BEFORE WRITING. Read all of SOURCE INFORMATION and identify the',
  'single most newsworthy development in it — the decision, announcement, launch, inauguration,',
  'event, direction or change a reader most needs to know. Build the headline and the first',
  'paragraph around that, and place everything else after it as supporting context.',
  '',
  "The source's ORDER is not the news order. An official note usually opens with background and",
  'states the event, the date or the decision at the very end. A news report does the opposite.',
  'Never lead with a fact merely because the source states it first.',
  '',
  "When SOURCE INFORMATION concerns a minister's meeting, visit, review or remarks, the news is",
  'what the principal minister is communicating to the public: build the headline and lead around',
  "that minister's strongest source-supported statement, decision, direction, assurance,",
  'announcement or next step, and attribute it clearly to that minister. If several ministers or',
  'topics appear, choose one principal public-facing angle; include the others only when they',
  'directly support it.',
  '',
  'TREAT SOURCE INFORMATION AS A FACTUAL POOL, NOT A COMPLETENESS CHECKLIST. A supplied fact',
  'earns its place by helping a reader understand the news — not by being present in the source.',
  'Compress or leave out administrative and technical material that does not serve it, unless',
  'that material IS the news or the HEADLINE / ANGLE or OFFICER REQUEST asks for it. Typically:',
  '',
  '- measurements and technical specifications: plot and built-up area, dimensions, capacities,',
  '  unit sizes, model and version numbers;',
  '- floor-by-floor, unit-by-unit, item-by-item or year-by-year breakdowns that add up to a total',
  '  the article already gives — print the total and the one split that matters, not the',
  '  enumeration;',
  '- exhaustive lists of eligible categories, cadres, designations or committee members — name',
  '  the few that matter and close with a summarising clause;',
  '- file, circular, reference and page numbers, internal procedure and routine agenda items;',
  '- the same fact restated in different words.',
  '',
  'Omitting such a detail is correct editing, not an error. But never invent or transfer a fact',
  'to cover what you left out, and never alter one you keep: every name, designation, date,',
  'amount and figure that stays in the article stays exactly as supplied.',
  '',
  'Do not write meeting minutes, a specification sheet, or a summary of every supplied fact.',
  'Write a publication-ready Mahasamvad news report.',
  '',
  'ONE LIST IS ALWAYS KEPT. Where SOURCE INFORMATION reports an event and says who else was',
  'present, the article ends with the Mahasamvad attendance line — "यावेळी <नावे, पदनामांसह>',
  'उपस्थित होते." That closing line is house convention rather than an inventory, so the rule',
  'above about long lists does not apply to it. Name the dignitaries the source names, in the',
  'source’s own spellings, and close the group with a summarising phrase where it is a long one.',
].join('\n');

export function newsEditorialFocusBlock(category: ArticleCategory): string[] {
  return category === 'news'
    ? ['### NEWS EDITORIAL FOCUS', '', NEWS_EDITORIAL_FOCUS, '']
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
  // The officer's शीर्षक किंवा बातमीचा रोख (generations.heading): either the headline to print
  // or the angle to build the article around. Rendered SECOND-LAST and named in PRECEDENCE_RULE
  // as one tier with the request below. Still not an independent factual source.
  editorialDirection?: string | undefined;
  // The officer's trusted request for THIS article (generations.instructions, 0041): writing
  // direction plus any facts or corrections supplied directly by the officer. Rendered LAST,
  // because this is the one input written specifically for this run.
  officerInstructions?: string | undefined;
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

// The order the model resolves a conflict in. It exists because nothing here ever stated one,
// so a conflict was settled by whichever rule sounded most absolute — and the specification is
// full of absolutes while the officer's own two inputs arrive as one line each of a user
// message. An officer writing "शासकीय शैलीत बातमी तयार करा" or asking for a specific length was
// being outranked by general guidance written for the runs where they say nothing at all.
//
// Rule 1 is the one thing the officer does NOT outrank, and it is stated first so that being
// told to follow the request is never read as licence to invent what the request implies.
//
// Exported so all three specifications state the same order: ARTICLE_PROMPT_VARIANT and
// ARTICLE_STYLE_REFERENCES_ENABLED change how the prompt is worded, never who wins.
export const PRECEDENCE_RULE = [
  'PRECEDENCE. Where anything below conflicts, resolve it in this order:',
  '1. Never state a fact — a name, designation, date, amount, place, scheme, law, quote or',
  '   claim — that is not in SOURCE INFORMATION, ADDITIONAL VERIFIED INFORMATION or the',
  '   OFFICER REQUEST. Nothing overrides this.',
  '2. The HEADLINE / ANGLE and the OFFICER REQUEST. The officer wrote these for this article.',
  '   Follow them exactly, including anything they say about length, tone, structure, ordering,',
  '   emphasis or what to leave out. They override every general instruction given',
  '   here, including what is said about length below.',
  '3. Everything else in these instructions.',
];

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
    'the same writing style and structure, use only the information provided in SOURCE',
    'INFORMATION, ADDITIONAL VERIFIED INFORMATION and OFFICER REQUEST.',
    '',
    ...PRECEDENCE_RULE,
    '',
    'Take style and structure from the reference, but do not treat its length as a target.',
    'Unless the HEADLINE / ANGLE or the OFFICER REQUEST asks for a particular length, the new',
    'article’s length does not matter: use your best editorial judgement to produce the',
    'strongest publication-ready article possible from the supplied information, at the length',
    'that best serves it. Use the information fully when it improves the article.',
    '',
    'Where a length IS asked for, write to it. Reach it by covering the supplied information',
    'more fully and explaining it more completely — never by repeating yourself, padding with',
    'empty phrases, or adding anything the supplied information does not support. If the',
    'supplied information cannot honestly fill the requested length, write the fullest accurate',
    'article it supports and stop.',
    '',
    'SOURCE INFORMATION may contain Markdown tables (pipe-delimited rows). Read them as tables:',
    'each figure belongs to its own column heading and row label. Never read a row as a',
    'sentence, and never attach a figure to the wrong heading.',
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

// The officer's own request for this run. It is deliberately one sentence: this simple path
// relies on the model's judgement instead of rebuilding the larger pipeline's rule stack.
//
// Exported so minimal-article-prompt.ts renders the SAME block: ARTICLE_PROMPT_VARIANT changes
// how densely the specification is worded, never what the officer is allowed to ask for.
export function officerInstructionsBlock(
  instructions: string | undefined,
): string[] {
  const text = clean(instructions);
  if (!text) return [];
  return [
    '### OFFICER REQUEST',
    '',
    text,
    '',
    'Follow this request; treat it as trusted instructions and factual input, while STYLE REFERENCES remain style-only.',
    'It outranks every general instruction in this prompt except the rule against stating an unsupported fact.',
    '',
    // A length named inside the request is restated as its own block with the number pulled
    // out. The officer's wording already reached the model verbatim above, so this adds no
    // information — what it adds is unmissability, and the statement of how the length may and
    // may not be reached. Rendered here so all three specifications get it through the one
    // shared function they already call.
    ...lengthRequirementBlock(parseLengthRequest(text)),
  ];
}

// The officer's शीर्षक किंवा बातमीचा रोख (generations.heading).
//
// It used to render as "### OPTIONAL EDITORIAL DIRECTION" followed by "This MAY suggest an
// angle or heading, but it is NOT an independent factual source. Use it ONLY WHEN the factual
// information supports it" — three hedges and the word OPTIONAL, in the weakest position in the
// prompt. The officer had typed it deliberately; nothing told the model to use it as the
// headline, and one variant worded it far more strongly than the other, so the same field
// carried different authority depending on an env line.
//
// What survives from the old wording is the ONE true part: it is not a fact source. An angle is
// a direction for material that must still come from the note.
//
// ensureArticleHeading() (article-heading.ts) enforces the headline case deterministically
// afterwards — this is the prompt half, and the only half that can act on an ANGLE.
export function headingBlock(heading: string | undefined): string[] {
  const text = clean(heading);
  if (!text) return [];
  return [
    '### HEADLINE / ANGLE',
    '',
    text,
    '',
    'The officer wrote this for this article. If it reads as a headline, use it as the',
    "article's headline, as written. If it reads as an angle, it is the angle the article must",
    'lead with and be built around.',
    'It is not a fact source: take no fact from it that SOURCE INFORMATION, ADDITIONAL VERIFIED',
    'INFORMATION or the OFFICER REQUEST does not support.',
    '',
  ];
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
    parts.push(
      '### DATELINE',
      '',
      `${location}, दि. ${date} :`,
      '',
      // Where it goes has to be said. Left unstated, a model that writes the headline as its
      // first line reads "start the article with this" literally and datelines the HEADLINE —
      // observed in production. ensureArticleDateline() repairs that deterministically
      // afterwards; this is the prompt half.
      'This opens the FIRST BODY PARAGRAPH, never the headline. Write it exactly as above,',
      'once, and nowhere else in the article.',
      '',
    );
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

  // Last, immediately before the ask: these are the two blocks written for this run alone, and
  // a late block is what the model weights most. They are adjacent on purpose — the officer
  // filled both in on the same screen, and the PRECEDENCE rule names them as one tier.
  parts.push(...headingBlock(direction));
  parts.push(...officerInstructionsBlock(inputs.officerInstructions));

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
    'it names the three admissible factual sections',
    sys.includes(
      'use only the information provided in SOURCE\nINFORMATION, ADDITIONAL VERIFIED INFORMATION and OFFICER REQUEST',
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
  // v13: irrelevant UNLESS the officer asked. Line breaks are wrapping, not meaning, so these
  // read the system message with its whitespace flattened.
  const flat = sys.replace(/\s+/gu, ' ');
  check(
    'length is irrelevant only while the officer has named none',
    flat.includes(
      'Unless the HEADLINE / ANGLE or the OFFICER REQUEST asks for a particular length, the new article’s length does not matter',
    ),
  );
  check(
    'editorial judgement and reasoning choose the best output',
    flat.includes('use your best editorial judgement') &&
      flat.includes('the strongest publication-ready article possible'),
  );
  check(
    'the material determines whatever length serves it',
    flat.includes('at the length that best serves it'),
  );
  check(
    'padding, repetition and unsupported additions are forbidden',
    flat.includes(
      'never by repeating yourself, padding with empty phrases, or adding anything the supplied information does not support',
    ),
  );
  // Still no word target: the only figures in the specification are the precedence numbering.
  check(
    'length is stated without any figure',
    !/\d[\d,]*\s*(?:words|characters|chars|अक्षर|शब्द)/u.test(sys),
  );

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
  // The v4 deletion of the numbered editorial rule stack still holds. The ONLY numbered lines
  // left are PRECEDENCE_RULE's three tiers, which are a conflict-resolution order rather than
  // editorial instructions — so this asserts the count exactly instead of banning digits.
  check(
    'no numbered rule headings survive',
    !/^#+\s*\d/mu.test(sys) &&
      (sys.match(/^\d+\.\s/gmu) ?? []).length ===
        PRECEDENCE_RULE.filter((line) => /^\d+\.\s/u.test(line)).length,
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
  // The HEADING, not the phrase: since v14 the news focus block names both officer inputs by
  // name (they are what may override its omission licence), so a bare substring test would fail
  // on a prompt that correctly renders neither block.
  check(
    'no HEADLINE / ANGLE heading',
    !bareUser.includes('### HEADLINE / ANGLE'),
  );
  check(
    'the retired hedged wording is gone for good',
    !bareUser.includes('OPTIONAL EDITORIAL DIRECTION') &&
      !fullUser.includes('OPTIONAL EDITORIAL DIRECTION') &&
      !fullUser.includes('This may suggest an angle or heading'),
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
    'news receives the editorial focus',
    bareUser.includes('### NEWS EDITORIAL FOCUS') &&
      bareUser.includes(
        'TREAT SOURCE INFORMATION AS A FACTUAL POOL, NOT A COMPLETENESS CHECKLIST',
      ) &&
      bareUser.includes('Do not write meeting minutes'),
  );
  check(
    'scheme receives no news editorial focus',
    !fullUser.includes('NEWS EDITORIAL FOCUS') &&
      !fullUser.includes('FACTUAL POOL, NOT A COMPLETENESS CHECKLIST'),
  );

  // v14. Every check below is the shape of a real failure: intake 11961f50 restated a
  // departmental note in the note's own order — spec sheet, then every eligible cadre — and put
  // the Chief Minister's inauguration last. If a news article ever reads as an inventory again,
  // start here.
  console.log('\n=== the news focus is UNCONDITIONAL, not minister-gated ===');
  check(
    'selection no longer hangs off a minister condition',
    !NEWS_EDITORIAL_FOCUS.startsWith('When SOURCE INFORMATION concerns') &&
      NEWS_EDITORIAL_FOCUS.indexOf('DECIDE WHAT THE NEWS IS BEFORE WRITING') <
        NEWS_EDITORIAL_FOCUS.indexOf(
          "When SOURCE INFORMATION concerns a minister's",
        ),
  );
  check(
    'the minister case survives as a branch of the lead rule',
    NEWS_EDITORIAL_FOCUS.includes(
      "When SOURCE INFORMATION concerns a minister's meeting, visit, review or remarks",
    ) && NEWS_EDITORIAL_FOCUS.includes('one principal public-facing angle'),
  );
  check(
    'the headline and lead are built on the most newsworthy development',
    NEWS_EDITORIAL_FOCUS.includes(
      'identify the\nsingle most newsworthy development',
    ) &&
      NEWS_EDITORIAL_FOCUS.includes(
        'Build the headline and the first\nparagraph around that',
      ),
  );
  check(
    "the source's order is explicitly not the news order",
    NEWS_EDITORIAL_FOCUS.includes("The source's ORDER is not the news order") &&
      NEWS_EDITORIAL_FOCUS.includes(
        'states the event, the date or the decision at the very end',
      ) &&
      NEWS_EDITORIAL_FOCUS.includes(
        'Never lead with a fact merely because the source states it first',
      ),
  );
  check(
    'a supplied fact must earn its place',
    NEWS_EDITORIAL_FOCUS.includes(
      'earns its place by helping a reader understand the news — not by being present in the source',
    ),
  );

  console.log('\n=== the compressible detail is named, not left abstract ===');
  for (const [label, needle] of [
    ['measurements / specifications', 'plot and built-up area, dimensions'],
    ['floor-by-floor breakdowns', 'floor-by-floor, unit-by-unit'],
    ['the total beats the enumeration', 'not the\n  enumeration'],
    ['exhaustive cadre lists', 'cadres, designations or committee members'],
    [
      'file and reference numbers',
      'file, circular, reference and page numbers',
    ],
    ['restated facts', 'the same fact restated in different words'],
  ] as const) {
    check(`${label} are named`, NEWS_EDITORIAL_FOCUS.includes(needle));
  }
  check(
    'omission is licensed only when it does not serve the news',
    NEWS_EDITORIAL_FOCUS.includes('Omitting such a detail is correct editing'),
  );
  // Measured regression: the first draft of the cadre bullet said "attendees", and a live run on
  // a real minister's-event transcript dropped the closing "यावेळी … उपस्थित होते" paragraph —
  // which is DGIPR house convention (restored to the prompt on purpose in 2026-07-27) and not an
  // inventory. Do not put "attendees" back in that bullet.
  check(
    'the Mahasamvad attendance line is carved out of the list rule',
    NEWS_EDITORIAL_FOCUS.includes('ONE LIST IS ALWAYS KEPT') &&
      NEWS_EDITORIAL_FOCUS.includes(
        'यावेळी <नावे, पदनामांसह>\nउपस्थित होते.',
      ) &&
      NEWS_EDITORIAL_FOCUS.includes(
        'the rule\nabove about long lists does not apply to it',
      ) &&
      !/designations, attendees/u.test(NEWS_EDITORIAL_FOCUS),
  );
  // Position is the point, and the first attempt proved it: as a sub-clause INSIDE the "compress
  // long lists" bullet the carve-out did not fire — the same live transcript still lost its
  // closing paragraph. It only held once it became its own block, stated positively, LAST. Do
  // not fold it back into the bullet.
  check(
    'and it is stated last, as its own block',
    NEWS_EDITORIAL_FOCUS.trimEnd().endsWith(
      'close the group with a summarising phrase where it is a long one.',
    ) &&
      NEWS_EDITORIAL_FOCUS.indexOf('ONE LIST IS ALWAYS KEPT') >
        NEWS_EDITORIAL_FOCUS.indexOf(
          '- exhaustive lists of eligible categories',
        ),
  );
  check(
    'the officer can always keep a detail the rule would drop',
    NEWS_EDITORIAL_FOCUS.includes(
      'unless\nthat material IS the news or the HEADLINE / ANGLE or OFFICER REQUEST asks for it',
    ),
  );
  // The one thing a licence to omit must never become: a licence to paper over the gap, or to
  // round a figure that survived the cut.
  check(
    'omitting never becomes inventing, and a kept figure is never altered',
    NEWS_EDITORIAL_FOCUS.includes(
      'never invent or transfer a fact\nto cover what you left out',
    ) &&
      NEWS_EDITORIAL_FOCUS.includes(
        'stays in the article stays exactly as supplied',
      ),
  );
  check(
    'the output is named as a news report, not minutes or a spec sheet',
    NEWS_EDITORIAL_FOCUS.includes(
      'Do not write meeting minutes, a specification sheet',
    ) &&
      NEWS_EDITORIAL_FOCUS.includes('publication-ready Mahasamvad news report'),
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
  check(
    'the dateline block says it opens the body, never the headline',
    fullUser.includes('opens the FIRST BODY PARAGRAPH, never the headline'),
  );
  check(
    'and that it appears exactly once',
    fullUser.includes('once, and nowhere else in the article'),
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

  console.log('\n=== the officer outranks the specification ===');
  check(
    'the system message states an explicit precedence order',
    sys.includes('PRECEDENCE. Where anything below conflicts'),
  );
  check(
    'never-invent is precedence rule 1 and is absolute',
    sys.includes('Nothing overrides this.') &&
      sys.indexOf('Nothing overrides this.') <
        sys.indexOf('2. The HEADLINE / ANGLE and the OFFICER REQUEST.'),
  );
  check(
    'the officer’s two inputs are named as one tier above the rest',
    sys.includes(
      'They override every general instruction given\n   here, including what is said about length below.',
    ),
  );
  check(
    'the length rule is CONDITIONAL on the officer not having asked for one',
    sys.includes(
      'Unless the HEADLINE / ANGLE or the OFFICER REQUEST asks for a particular length',
    ),
  );
  check(
    'a requested length is to be written to',
    sys.includes('Where a length IS asked for, write to it.'),
  );
  check(
    'a requested length is reached by covering the source more fully',
    sys.includes('covering the supplied information') &&
      sys.includes('explaining it more completely'),
  );
  check(
    'padding and invention are still forbidden as the way to reach it',
    sys.includes('never by repeating yourself, padding with') &&
      sys.includes('adding anything the supplied information does not support'),
  );
  check(
    'stopping short beats inventing when the source cannot fill the ask',
    sys.includes('write the fullest accurate') && sys.includes('and stop.'),
  );
  // "stretch" banned legitimate elaboration alongside padding, which is exactly what an
  // officer asking for a longer article needs the model to do.
  check(
    'the blanket "do not stretch" is gone',
    !sys.includes('do not pad, repeat, stretch'),
  );

  console.log('\n=== the officer heading / angle ===');
  const headline = 'कर्जमुक्तीमुळे ग्रामीण अर्थव्यवस्थेला नवी ऊर्जा';
  const withHeading = buildSimpleArticleUserPrompt({
    category: 'news',
    sourceInformation: baseNote,
    editorialDirection: headline,
    officerInstructions: 'भाषा सोपी ठेवा.',
  });
  check(
    'it is rendered verbatim under its own heading',
    withHeading.includes('### HEADLINE / ANGLE') &&
      withHeading.includes(headline),
  );
  check(
    'a headline is to be used as written',
    withHeading.includes("use it as the\narticle's headline, as written"),
  );
  check(
    'an angle is what the article leads with',
    withHeading.includes('the angle the article must'),
  );
  check(
    'it remains explicitly not a fact source',
    withHeading.includes('It is not a fact source'),
  );
  check(
    'it sits immediately before the officer request, both last',
    withHeading.indexOf('### HEADLINE / ANGLE') <
      withHeading.indexOf('### OFFICER REQUEST') &&
      withHeading.indexOf('### HEADLINE / ANGLE') >
        withHeading.indexOf('### SOURCE INFORMATION'),
  );

  console.log('\n=== a length named in the request becomes its own block ===');
  const withLength = buildSimpleArticleUserPrompt({
    category: 'news',
    sourceInformation: baseNote,
    officerInstructions: 'बातमी १२०० अक्षरांची हवी; भाषा सोपी ठेवा.',
  });
  check(
    'the number is pulled out and restated to the model',
    withLength.includes('### LENGTH REQUIREMENT') &&
      withLength.includes('about 1200 characters'),
  );
  check(
    'it is stated to outrank the general length guidance',
    withLength.includes('overrides any general guidance'),
  );
  check(
    'the officer’s own wording still reaches the model verbatim',
    withLength.includes('बातमी १२०० अक्षरांची हवी; भाषा सोपी ठेवा.'),
  );
  check(
    'a request naming no length adds no length block',
    !buildSimpleArticleUserPrompt({
      category: 'news',
      sourceInformation: baseNote,
      officerInstructions: 'शासकीय शैलीत बातमी तयार करा.',
    }).includes('LENGTH REQUIREMENT'),
  );

  console.log('\n=== the officer request for this run ===');
  const instruction =
    'पहिल्या परिच्छेदात निधीचा आकडा घ्या; समितीबद्दल थोडक्यात लिहा.';
  const withInstructions = buildSimpleArticleUserPrompt({
    category: 'news',
    sourceInformation: baseNote,
    officerInstructions: instruction,
  });
  check(
    'the request is rendered verbatim under its own heading',
    withInstructions.includes('### OFFICER REQUEST') &&
      withInstructions.includes(instruction),
  );
  check(
    'the request is trusted as instructions and factual input',
    withInstructions.includes(
      'treat it as trusted instructions and factual input',
    ),
  );
  // Last position is what the model weights most, and it is the one block written for this
  // run alone — so the ask must be the only thing after it.
  check(
    'they are the last block before "Write the article now."',
    withInstructions
      .trimEnd()
      .endsWith(
        'except the rule against stating an unsupported fact.\n\nWrite the article now.',
      ),
  );
  check(
    'the request is stated to outrank the specification',
    withInstructions.includes(
      'It outranks every general instruction in this prompt except the rule against stating an unsupported fact.',
    ),
  );
  check(
    'an absent instruction adds no heading at all',
    !buildSimpleArticleUserPrompt({
      category: 'news',
      sourceInformation: baseNote,
    }).includes('### OFFICER REQUEST'),
  );
  check(
    'a whitespace-only instruction is treated as absent',
    !buildSimpleArticleUserPrompt({
      category: 'news',
      sourceInformation: baseNote,
      officerInstructions: '   \n  ',
    }).includes('### OFFICER REQUEST'),
  );
  check(
    'omitting it leaves the prompt byte-for-byte as it was',
    buildSimpleArticleUserPrompt({
      category: 'news',
      sourceInformation: baseNote,
      officerInstructions: '',
    }) ===
      buildSimpleArticleUserPrompt({
        category: 'news',
        sourceInformation: baseNote,
      }),
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
