// The post-name-review /dlo article prompt.
//
// This is deliberately separate from the ordinary simple/minimal article specifications. The
// officer chose the complete instruction here: one short system message plus the source and the
// fields reviewed for this run. RAG exemplars are the one optional addition: they demonstrate
// Mahasamvad style and structure, but are explicitly fenced off from the factual source.

import type { DesignationPair } from './category-prompt.js';
import type { ChatMessage } from './openai-chat.js';
import type { StyleReferenceArticle } from './select-style-reference.js';

export const DLO_ARTICLE_PROMPT_VERSION = 'dlo-rag-v2';

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
  return [
    {
      role: 'system',
      content: 'Write a DGIPR Maharashtra style article.',
    },
    { role: 'user', content: buildDloArticleUserPrompt(inputs) },
  ];
}
