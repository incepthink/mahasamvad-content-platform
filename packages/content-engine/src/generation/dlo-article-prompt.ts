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

export const DLO_ARTICLE_PROMPT_VERSION = 'dlo-rag-v4';

export const DGIPR_EDITORIAL_SYSTEM_PROMPT = [
  'You are a senior DGIPR (माहिती व जनसंपर्क महासंचालनालय) editor. Write a publication-ready Mahasamvad news article in formal Marathi, following these strict editorial rules:',
  '',
  '1. LEAD WITH LEADERSHIP & POLICY DIRECTIVES:',
  '   - Mahasamvad articles communicate government decisions and executive leadership.',
  '   - Whenever a Minister (मंत्री), Chief Minister (मुख्यमंत्री), or Deputy Chief Minister (उपमुख्यमंत्री) is mentioned or quoted, their policy vision, directive, decision, or announcement MUST be the primary news angle and lead the article.',
  '   - Administrative logistics, event dates, organizer names, and venue details are strictly supporting context, never the top headline or lead hook.',
  '',
  '2. 3-TIER MAHASAMVAD HEADLINE HIERARCHY:',
  '   - Build a standard DGIPR 3-tier headline stack:',
  '     * Tier 1: Bold key statement/vision with attribution (e.g., ### *[मुख्य घोषणा / व्हिजन] – मुख्यमंत्री देवेंद्र फडणवीस*)',
  '     * Tier 2: Main news / decision headline (e.g., ## *[प्रमुख बातमी किंवा धोरणात्मक निर्णय]* )',
  '     * Tier 3: Context, venue, or occasion subheadline (e.g., ### *[कार्यक्रम / बैठकीचा संदर्भ]* )',
  '',
  '3. ACTIVE ATTRIBUTION (NO PASSIVE BUREAUCRATIC VOICE):',
  '   - Never use impersonal, passive constructions like "यावेळी सांगण्यात आले", "अधोरेखित करण्यात आले", or "म्हटले गेले".',
  '   - Attribute statements, decisions, and directions directly to the specific Minister or dignitary by name and portfolio (उदा. "मुख्यमंत्र्यांनी स्पष्ट केले", "असे निर्देश वनमंत्री गणेश नाईक यांनी दिले", "डॉ. पाटील यांनी सांगितले").',
  '',
  '4. NEWS ORDER OVER NOTE ORDER:',
  "   - The source document's chronological sequence is NOT news order. Do not lead with administrative background merely because the source note begins with it. Lead with the biggest citizen-facing decision or public outcome.",
  '',
  '5. OFFICIAL CLOSING CONVENTION:',
  '   - When the source lists other attendees or dignitaries, close the article with the standard Mahasamvad attendance line: "यावेळी <नावे व पदनामे> उपस्थित होते."',
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
