// Translate a generated Marathi article to English, with a LOCKED proper-noun glossary.
//
// This is the ONE deliberate exception to the Marathi-first rule: the English article is
// produced on demand. The reason this file exists is a quality bug — naive Marathi→English
// translation mistranslates proper nouns (a minister's surname once came out as "Donkey").
// The fix is deterministic: verified glossary entries (Marathi→English) are passed to the
// model as a LOCKED TERMS table and it must reuse those exact English forms, never
// "creatively" translating a known name. The caller passes the verified glossary subset
// that appears in the article (see findGlossaryTermsInText in @dgipr/database).
//
// Translation uses Sarvam (a strong Indic-language model). Its starter tier caps
// max_tokens (reasoning + reply) at 4096, so a long article MUST be translated in blocks,
// not in one call; reasoning is disabled so the whole budget goes to the reply.

import { pathToFileURL } from 'node:url';
import { sarvamChatComplete } from './sarvam-chat.js';
import type { ChatMessage } from './openai-chat.js';
import { splitNoteIntoSections } from './generate-article.js';

// One locked Marathi→English mapping — only the two fields the prompt needs. The caller
// supplies the verified glossary subset (typically GlossaryTerm rows narrowed to these).
export type GlossaryEntry = Readonly<{ marathi: string; english: string }>;

export type TranslateOptions = Readonly<{
  // Reports progress as blocks are translated (0-based index, total count). Called once
  // before each block and once more at completion (blockIndex === blockCount).
  onProgress?: (blockIndex: number, blockCount: number) => void;
  // Overrides the per-block character budget (defaults below).
  maxCharsPerBlock?: number;
}>;

// Keep each block well under Sarvam's 4096-token reply cap. Marathi (Devanagari) is
// token-heavy, so ~2500 chars per block leaves ample room for the English output.
const DEFAULT_MAX_CHARS_PER_BLOCK = 2500;

// Output budget (reasoning + reply). Reasoning is disabled per call, so the whole budget
// is available to the English reply; 4096 is the starter-tier ceiling.
const MAX_TOKENS_PER_BLOCK = 4096;

const SYSTEM_PROMPT = [
  'You are a professional Marathi-to-English translator for the Government of Maharashtra',
  '/ DGIPR (Directorate General of Information and Public Relations). You translate',
  'official press and feature articles faithfully and completely.',
  '',
  'Strict rules:',
  '1. Translate the Marathi text into natural, professional English. Convey every',
  '   sentence — do not summarize, shorten, paraphrase away, or omit anything.',
  '2. NEVER translate proper nouns (person names, designations, scheme names, places,',
  '   organizations) into common English words. A name is a name, not its literal meaning',
  '   (e.g. the surname "वाघ" is "Wagh", never "Tiger").',
  '3. For any term listed under LOCKED TERMS, use EXACTLY the provided English form,',
  '   verbatim. Those mappings are authoritative and must never be altered.',
  '4. Preserve all numbers, dates, amounts, percentages and units exactly as written.',
  '5. Output only the English translation as prose — no notes, no preamble, no Marathi,',
  '   no explanations.',
].join('\n');

// Render the LOCKED TERMS table for the prompt. The whole verified subset is passed (it is
// small) so the model has every mapping regardless of which terms fall in this block.
function lockedTermsBlock(glossary: readonly GlossaryEntry[]): string {
  const rows = glossary.map((t) => `${t.marathi} → ${t.english}`).join('\n');
  return [
    'LOCKED TERMS (use these exact English forms verbatim; never translate them differently):',
    rows,
  ].join('\n');
}

function buildMessages(
  block: string,
  glossary: readonly GlossaryEntry[],
): ChatMessage[] {
  const parts: string[] = [];
  if (glossary.length > 0) {
    parts.push(lockedTermsBlock(glossary), '');
  }
  parts.push('Translate the following Marathi text into English:', '', block);
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: parts.join('\n') },
  ];
}

// Translate a Marathi article to English block by block, honoring the locked glossary.
// Blocks are translated sequentially and rejoined with blank lines so paragraph breaks
// survive. Returns the assembled English article.
export async function translateArticleToEnglish(
  marathiArticle: string,
  glossary: readonly GlossaryEntry[],
  options?: TranslateOptions,
): Promise<string> {
  const maxChars = options?.maxCharsPerBlock ?? DEFAULT_MAX_CHARS_PER_BLOCK;
  const onProgress = options?.onProgress ?? (() => {});
  const blocks = splitNoteIntoSections(marathiArticle, maxChars);

  const translated: string[] = [];
  for (const [index, block] of blocks.entries()) {
    onProgress(index, blocks.length);
    const english = await sarvamChatComplete(buildMessages(block, glossary), {
      temperature: 0.2,
      // null disables Sarvam's reasoning so the entire token budget goes to the reply.
      // (The plan calls this "reasoningEffort: none"; null is the value that actually
      // disables thinking on these hybrid-reasoning models — see sarvam-chat.ts.)
      reasoningEffort: null,
      maxTokens: MAX_TOKENS_PER_BLOCK,
    });
    translated.push(english.trim());
  }
  onProgress(blocks.length, blocks.length);
  return translated.join('\n\n');
}

// Run directly to eyeball a translation in isolation (needs SARVAM_API_KEY):
//
//   tsx --env-file=../../.env src/generation/translate-article.ts
//
// The sample glossary demonstrates the core guarantee: a surname that literally means
// "Tiger" (वाघ) and a minister's name are locked to their correct English forms.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const SAMPLE_GLOSSARY: GlossaryEntry[] = [
    { marathi: 'एकनाथ शिंदे', english: 'Eknath Shinde' },
    { marathi: 'वाघ', english: 'Wagh' },
  ];

  const SAMPLE_ARTICLE = [
    'मुख्यमंत्री एकनाथ शिंदे यांच्या हस्ते आज मुंबईत नव्या योजनेचे उद्घाटन झाले.',
    'जिल्हाधिकारी श्री. वाघ यांनी कार्यक्रमाचे आयोजन केले होते. या योजनेतून ५०० कुटुंबांना',
    'थेट लाभ मिळणार असून एकूण २ कोटी रुपयांची तरतूद करण्यात आली आहे.',
  ].join('\n\n');

  translateArticleToEnglish(SAMPLE_ARTICLE, SAMPLE_GLOSSARY, {
    onProgress: (i, n) => console.log(`translating block ${i + 1}/${n}...`),
  })
    .then((english) => {
      console.log('\n=== English translation ===\n');
      console.log(english);
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
