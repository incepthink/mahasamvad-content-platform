// The post-name-review /dlo article prompt.
//
// This is deliberately separate from the ordinary simple/minimal article specifications. The
// officer chose the complete instruction here: one short system message plus the source and the
// fields reviewed for this run. RAG exemplars are the one optional addition: they demonstrate
// Mahasamvad style and structure, but are explicitly fenced off from the factual source.

import type { DesignationPair } from './category-prompt.js';
import {
  editorialPreferencePlacement,
  editorialPreferencesSystemSection,
  editorialPreferencesUserBlock,
} from './editorial-preferences-block.js';
import type { ChatMessage } from './openai-chat.js';
import type { StyleReferenceArticle } from './select-style-reference.js';

export const DLO_ARTICLE_PROMPT_VERSION = 'dlo-rag-v5';

// v5 (2026-09-24) — DOCUMENT-TYPE AWARE. v4's rules 1/2/3/5 were written for a meeting: they
// REQUIRED an attributed Tier-1 statement, attribution to a Minister and a
// `यावेळी … उपस्थित होते` close. Three of the five /dlo sources of 2026-09-23 were GRs with no
// speaker at all, and a 31B model at temperature 0 complied by INVENTING one
// (`…हेच मुख्य ध्येय – आदिवासी विकास मंत्री`, attendee lines on a GR) — exactly what the officer's
// feedback then forbade. The rules now branch on what SOURCE INFORMATION actually contains, and
// the durable parts of that feedback (angle-first lead, background before procedure, condensed
// annexures, no filler, no repeated "शासन निर्णयात नमूद") are stated as what TO do.
//
// Still exactly FIVE numbered rules: editorial-preferences-block.ts appends a learned section
// numbered 6, and its harness asserts that number.
//
// And no dateline: ensureArticleDateline owns it on this path (runner.ts), and a model-written
// one only ever competed with it — the source of the duplicated datelines in four of those five
// outputs.
export const DGIPR_EDITORIAL_SYSTEM_PROMPT = [
  'You are a senior DGIPR (माहिती व जनसंपर्क महासंचालनालय) editor. Write a publication-ready Mahasamvad news article in formal Marathi from SOURCE INFORMATION, following these editorial rules.',
  '',
  'FIRST DECIDE WHAT KIND OF SOURCE THIS IS — rules 1, 2, 3 and 5 depend on it:',
  '   - MEETING / EVENT: SOURCE INFORMATION records a named Minister, Chief Minister, Deputy Chief Minister or other named official speaking, directing, reviewing, inaugurating or attending.',
  '   - DOCUMENT: a Government Resolution (शासन निर्णय), circular, notification, order, scheme guideline, report or press clarification with no such named speaker.',
  '   Only SOURCE INFORMATION decides this. Never add a speaker, a Minister, a quotation, a meeting or attendees that it does not contain.',
  '',
  '1. LEAD WITH THE NEWS:',
  '   - MEETING / EVENT: the directive, decision or announcement of the Minister or official is the primary news angle and leads the article. Logistics, dates, organisers and venues are supporting context.',
  '   - DOCUMENT: open with the decision itself and what it means for citizens — what is being done, for whom, from when, and at what scale. Give the reason or background in the next paragraph, then how it will be implemented.',
  '',
  '2. HEADLINES:',
  '   - MEETING / EVENT: the DGIPR 3-tier stack —',
  '     * Tier 1: key statement with attribution (e.g., ### *[मुख्य घोषणा / व्हिजन] – मुख्यमंत्री देवेंद्र फडणवीस*), attributed only to a person SOURCE INFORMATION names as saying it',
  '     * Tier 2: main news / decision headline (e.g., ## *[प्रमुख बातमी किंवा धोरणात्मक निर्णय]*)',
  '     * Tier 3: context, venue or occasion subheadline (e.g., ### *[कार्यक्रम / बैठकीचा संदर्भ]*)',
  '   - DOCUMENT: a decision headline (## *[निर्णय आणि त्याचा लाभ]*), optionally followed by one subheadline (### *[कोणाला, केव्हापासून, किती]*). No attributed statement line.',
  '',
  '3. ACTIVE VOICE:',
  '   - Attribute statements and directions to the named person who made them, by name and portfolio (उदा. "मुख्यमंत्र्यांनी स्पष्ट केले", "असे निर्देश वनमंत्री गणेश नाईक यांनी दिले", "डॉ. पाटील यांनी सांगितले").',
  '   - For a DOCUMENT, make the government or the issuing department the subject (उदा. "राज्य शासनाने … निर्णय घेतला आहे", "महसूल विभागाने … मोहीम जाहीर केली आहे"). Name the document once; after that state its provisions directly instead of repeating "शासन निर्णयात नमूद करण्यात आले आहे".',
  '   - Avoid impersonal passive constructions like "यावेळी सांगण्यात आले", "अधोरेखित करण्यात आले" or "म्हटले गेले".',
  '',
  '4. NEWS ORDER AND SELECTION:',
  "   - The source's sequence is NOT news order. Lead with the biggest citizen-facing decision or public outcome, then background, then procedure.",
  '   - Condense annexures, application-form fields, checklists, lists of officers and step-by-step procedure into one or two sentences that tell a citizen what to do. Leave out file, reference and outward numbers.',
  '   - State facts plainly: every sentence carries information from SOURCE INFORMATION, and the decision, its beneficiaries and its figures speak for themselves.',
  '   - Do not write a dateline (स्थळ, दिनांक) line; the platform adds it to the first paragraph.',
  '',
  '5. CLOSING:',
  '   - MEETING / EVENT: when the source lists other attendees or dignitaries, close with the standard attendance line: "यावेळी <नावे व पदनामे> उपस्थित होते."',
  '   - DOCUMENT: end on the last source-supported provision a reader can act on — a deadline, where or how to apply, a helpline, or the date the decision takes effect.',
  '   - Conclude with the official DGIPR release terminator: ०००००',
].join('\n');

// An internal transport marker, replaced by the actual Responses input_file/input_image parts.
// It never reaches the model as text. Keeping it here places attachments inside SOURCE
// INFORMATION instead of silently moving them below the reviewed-name and officer-request data.
export const DLO_SOURCE_FILES_MARKER = '\u0000DLO_SOURCE_FILES\u0000';

export type DloArticlePromptInputs = Readonly<{
  sourceInformation: string;
  styleReferences?: readonly StyleReferenceArticle[] | undefined;
  designations?: readonly DesignationPair[] | undefined;
  heading?: string | null | undefined;
  officerInstructions?: string | null | undefined;
  attachedSourceFiles?: boolean | undefined;
  // The department's learned editorial preferences (migration 0057), already ranked and
  // scoped by the caller. WHERE they land is EDITORIAL_PREFERENCE_PLACEMENT's decision, not
  // this type's — see editorial-preferences-block.ts. Absent or empty leaves both messages
  // byte-identical to what this builder produced before they existed, which is what keeps
  // capture-dlo-distillation.ts able to reconstruct a historical prompt.
  editorialPreferences?: readonly string[] | undefined;
}>;

function clean(value: string | null | undefined): string {
  return (value ?? '').trim();
}

export function buildDloArticleUserPrompt(
  inputs: DloArticlePromptInputs,
): string {
  const parts = ['### SOURCE INFORMATION', '', clean(inputs.sourceInformation)];
  if (inputs.attachedSourceFiles) {
    parts.push('', DLO_SOURCE_FILES_MARKER);
  }

  const styleReferences = (inputs.styleReferences ?? []).filter(
    (reference) => clean(reference.text).length > 0,
  );
  if (styleReferences.length > 0) {
    parts.push(
      '',
      '### MAHASAMVAD STYLE REFERENCES',
      '',
      'Use these only for writing style and structure. Never take facts, names, dates, figures, quotes, or claims from them.',
    );
    for (const [index, reference] of styleReferences.entries()) {
      const title = clean(reference.title);
      parts.push(
        '',
        `#### STYLE REFERENCE ${index + 1}${title ? `: ${title}` : ''}`,
        '',
        clean(reference.text),
      );
    }
  }
  const designations = (inputs.designations ?? [])
    .map((pair) => ({
      name: clean(pair.name),
      designation: clean(pair.designation),
    }))
    .filter((pair) => pair.name.length > 0 && pair.designation.length > 0);

  if (designations.length > 0) {
    parts.push(
      '',
      '### REVIEWED NAMES AND DESIGNATIONS',
      '',
      ...designations.map((pair) => `- ${pair.name} — ${pair.designation}`),
    );
  }

  // AFTER the reviewed names and BEFORE the officer's own two blocks, so those stay last —
  // this repo's standing belief that a late block weighs most, and the officer wrote theirs
  // for this one article. Empty under the default `system` placement, where the rules travel
  // in the system message instead.
  if (editorialPreferencePlacement() === 'user') {
    parts.push(
      ...editorialPreferencesUserBlock(inputs.editorialPreferences ?? []),
    );
  }

  const heading = clean(inputs.heading);
  if (heading) parts.push('', '### HEADLINE / ANGLE', '', heading);

  const officerInstructions = clean(inputs.officerInstructions);
  if (officerInstructions) {
    parts.push('', '### OFFICER REQUEST', '', officerInstructions);
  }

  return parts.join('\n');
}

export function buildDloArticleMessages(
  inputs: DloArticlePromptInputs,
): ChatMessage[] {
  // The base five rules are NEVER mutated — a learned section is appended after them, and
  // only under the `system` placement. `editorialPreferencesSystemSection` returns '' when
  // there is nothing to append, so the common case is the constant itself, unchanged.
  const learned =
    editorialPreferencePlacement() === 'system'
      ? editorialPreferencesSystemSection(inputs.editorialPreferences ?? [])
      : '';
  return [
    {
      role: 'system',
      content: `${DGIPR_EDITORIAL_SYSTEM_PROMPT}${learned}`,
    },
    { role: 'user', content: buildDloArticleUserPrompt(inputs) },
  ];
}
