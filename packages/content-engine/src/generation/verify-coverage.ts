// Completeness + faithfulness verification for article generation.
//
// The notes are the single source and the completeness spec: the article must convey
// EVERY piece of information in them (facts AND responsibilities/objectives/purposes)
// and INVENT nothing that is not in them. After drafting we run two LLM checks against
// the notes themselves — not against a pre-extracted checklist, so nothing is filtered
// out before verification. generate-article.ts uses the results to re-prompt.

import { chatComplete, type ChatMessage } from './openai-chat.js';

// Marker the checkers print when there is nothing to report. Kept out of the item text
// so it can never collide with a real reported line.
const NONE_MARKER = 'काही-नाही';

const MISSING_SYSTEM_PROMPT = [
  'तुम्ही एक काटेकोर तपासनीस आहात. तुम्हाला मूळ "टिपणी" (NOTES) आणि त्यावरून लिहिलेला',
  '"लेख" (ARTICLE) दिला आहे. टिपणीतील कोणती माहिती लेखात आलेली नाही ते शोधा.',
  '',
  'नियम:',
  '1. टिपणीतील प्रत्येक स्वतंत्र माहिती-घटक तपासा — फक्त नावे, तारखा, रक्कम, पदनामे,',
  '   योजना व ठिकाणेच नव्हे, तर प्रत्येक समितीची कार्ये, जबाबदाऱ्या, उद्दिष्टे, उद्देश,',
  '   प्रक्रिया व अटी हेही माहिती-घटक आहेत.',
  '2. लेख वेगळ्या शब्दांत (paraphrase) किंवा वेगळ्या मांडणीत तीच माहिती सांगत असेल, तर',
  '   ती "समाविष्ट" माना.',
  '3. लेखात न आलेलीच माहिती यादीत द्या — प्रत्येक ओळ "- " ने सुरू करा, मूळ माहिती जशीच्या',
  '   तशी. काहीही नवीन जोडू नका, स्पष्टीकरण देऊ नका.',
  `4. जर टिपणीतील सर्व माहिती लेखात आली असेल, तर फक्त "${NONE_MARKER}" एवढेच लिहा.`,
].join('\n');

// Returns the information units from `note` that are NOT covered by `article` (verbatim
// bullet lines), or [] when everything is present.
export async function findMissingInformation(
  article: string,
  note: string,
): Promise<string[]> {
  if (note.trim().length === 0) return [];

  const messages: ChatMessage[] = [
    { role: 'system', content: MISSING_SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        '## टिपणी (NOTES — संपूर्ण माहिती):',
        note,
        '',
        '## लेख (ARTICLE):',
        article,
        '',
        '## लेखात न आलेली माहिती:',
      ].join('\n'),
    },
  ];

  return parseItems(await chatComplete(messages, { temperature: 0 }));
}

const UNSUPPORTED_SYSTEM_PROMPT = [
  'तुम्ही एक काटेकोर तथ्य-तपासनीस आहात. तुम्हाला मूळ "टिपणी" (NOTES) आणि त्यावरून',
  'लिहिलेला "लेख" (ARTICLE) दिला आहे. लेखात असे कोणते तथ्य, अट, जबाबदारी किंवा विधान',
  'आहे जे टिपणीत नाही, ते शोधा.',
  '',
  'नियम:',
  '1. टिपणी हाच माहितीचा एकमेव स्रोत आहे. लेखातील प्रत्येक ठोस विधान टिपणीतून पडताळा.',
  '2. टिपणीत नसलेले किंवा टिपणीच्या पलीकडे जाणारे (नवीन नावे, तारखा, रक्कम, पदनामे,',
  '   अटी, आकडे, दावे) असे प्रत्येक विधान यादीत द्या — प्रत्येक ओळ "- " ने सुरू करा.',
  '3. केवळ शैलीदार जोडणी, प्रस्तावना किंवा समारोपाची सर्वसाधारण वाक्ये (ज्यात नवीन तथ्य',
  '   नाही) यांना "असमर्थित" मानू नका.',
  `4. जर लेखातील सर्व तथ्ये टिपणीतून समर्थित असतील, तर फक्त "${NONE_MARKER}" एवढेच लिहा.`,
].join('\n');

// Returns statements/requirements asserted by `article` that are NOT supported by `note`
// (verbatim bullet lines), or [] when everything is grounded in the notes.
export async function findUnsupportedClaims(
  article: string,
  note: string,
): Promise<string[]> {
  if (note.trim().length === 0) return [];

  const messages: ChatMessage[] = [
    { role: 'system', content: UNSUPPORTED_SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        '## टिपणी (NOTES — एकमेव स्रोत):',
        note,
        '',
        '## लेख (ARTICLE):',
        article,
        '',
        '## टिपणीत नसलेली (असमर्थित) विधाने:',
      ].join('\n'),
    },
  ];

  return parseItems(await chatComplete(messages, { temperature: 0 }));
}

// Parse a checker's bullet-list reply into trimmed items, treating the "none" marker (or
// an empty reply) as an empty list.
function parseItems(result: string): string[] {
  const trimmed = result.trim();
  if (trimmed.length === 0 || trimmed.includes(NONE_MARKER)) return [];
  return trimmed
    .split('\n')
    .map((line) => line.replace(/^[-*]\s*/, '').trim())
    .filter((line) => line.length > 0);
}
