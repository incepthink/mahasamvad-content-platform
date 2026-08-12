// Which language the text in /translate's box is written in, decided in the browser so the
// page can pick the source itself instead of asking the officer to state a DIRECTION.
//
// Latin vs Devanagari is a script test and is reliable. मराठी vs हिंदी is not — they share a
// script, so this is a HEURISTIC and the page is built to say so: the detected language is
// shown, and it can be corrected in one tap (see `page.tsx`). Getting it wrong is not
// cosmetic — a Hindi text sent as `sourceLanguage: 'mr'` reaches a chat prompt that calls
// itself a "Marathi-to-English translator" — which is exactly why the override exists rather
// than the detector being trusted silently.
//
// It votes on three kinds of evidence, all deterministic and all free:
//   1. script ratio  — Devanagari letters vs Latin letters (the mr/hi-vs-en decision),
//   2. whole words   — function words that exist in only one of the two languages,
//   3. word endings  — Marathi's agglutinated case suffixes (…च्या, …ांनी) against Hindi's
//                      oblique plural (…ों), which is the single cleanest signal either way.
// Ties go to Marathi: this is a Marathi-first platform, and `detectProofreadLanguage` in
// content-engine defaults the same way.

import type { TextTranslationLanguage } from '@dgipr/schemas';

// Same threshold as content-engine's `detectProofreadLanguage`. Digits and punctuation are
// shared between the scripts, so only letters vote.
const DEVANAGARI_RATIO_FOR_INDIC = 0.3;

// Function words that occur in Marathi and not in Hindi. Matched as WHOLE Devanagari words
// only — several are substrings of ordinary words in the other language (के sits inside
// केले, ला inside लातूर), so a substring search would vote for whichever language was asked
// about first.
const MARATHI_WORDS: ReadonlySet<string> = new Set([
  'आहे',
  'आहेत',
  'नाही',
  'नाहीत',
  'आणि',
  'व',
  'तसेच',
  'असून',
  'मध्ये',
  'यांनी',
  'त्यांनी',
  'यांचा',
  'यांची',
  'यांचे',
  'यांच्या',
  'त्यांच्या',
  'केला',
  'केली',
  'केले',
  'झाला',
  'झाली',
  'झाले',
  'आला',
  'आली',
  'आले',
  'दिला',
  'दिली',
  'दिले',
  'म्हणाले',
  'म्हणून',
  'साठी',
  'पासून',
  'कडून',
  'करणार',
  'जाणार',
  'अशी',
  'असे',
  'असा',
  'त्यामुळे',
  'यावेळी',
  'यासाठी',
  'शासनाने',
  'सुद्धा',
]);

// The same, for Hindi. को/की/के/से are the load-bearing entries: they are Hindi's commonest
// postpositions and Marathi expresses all four as attached suffixes (ला, ची, चे, …ून)
// rather than as standalone words.
const HINDI_WORDS: ReadonlySet<string> = new Set([
  'है',
  'हैं',
  'था',
  'थी',
  'थे',
  'हुआ',
  'हुई',
  'हुए',
  'और',
  'में',
  'नहीं',
  'को',
  'की',
  'के',
  'से',
  'किया',
  'किए',
  'किये',
  'गया',
  'गई',
  'गए',
  'कहा',
  'रहा',
  'रही',
  'रहे',
  'यह',
  'वह',
  'इस',
  'उस',
  'उन्होंने',
  'उनके',
  'इसके',
  'तथा',
  'एवं',
  'लिए',
  'बाद',
  'तक',
  'करने',
  'करना',
  'होगा',
  'होगी',
  'दिया',
  'भी',
  'साथ',
]);

// Marathi attaches its cases to the noun, so the ENDING of an ordinary word is evidence even
// when the word itself is a proper noun the lists above can never contain
// (महाराष्ट्राच्या, अधिकाऱ्यांनी, विभागामध्ये).
const MARATHI_ENDINGS: readonly string[] = [
  'च्या',
  'ांनी',
  'ांना',
  'ांचा',
  'ांची',
  'ांचे',
  'मध्ये',
  'ण्यात',
  'साठी',
  'पासून',
  'कडून',
  'तील',
];

// Hindi's oblique plural. Marathi has no ों ending at all, which makes this the cleanest
// single discriminator in either direction.
const HINDI_ENDINGS: readonly string[] = ['ों', 'ियों', 'ाएं', 'ाएँ'];

// ळ is Marathi (and Konkani); Hindi does not use it. Devanagari-range letters only.
const MARATHI_ONLY_LETTERS = /[ळऱ]/g;

function endsWithAny(word: string, endings: readonly string[]): boolean {
  return endings.some(
    (ending) => word.length > ending.length && word.endsWith(ending),
  );
}

/**
 * The language `text` appears to be written in. Never null: an empty or signal-free box
 * reads as Marathi, which keeps the page's default stable and matches the platform's
 * Marathi-first stance.
 */
export function detectTranslationSource(text: string): TextTranslationLanguage {
  const devanagari = (text.match(/[ऀ-ॿ]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  if (devanagari + latin === 0) return 'mr';
  if (devanagari / (devanagari + latin) < DEVANAGARI_RATIO_FOR_INDIC) {
    return 'en';
  }

  let marathi = (text.match(MARATHI_ONLY_LETTERS) ?? []).length;
  let hindi = 0;

  for (const word of text.match(/[ऀ-ॿ]+/g) ?? []) {
    if (MARATHI_WORDS.has(word)) marathi += 1;
    else if (HINDI_WORDS.has(word)) hindi += 1;
    if (endsWithAny(word, MARATHI_ENDINGS)) marathi += 1;
    else if (endsWithAny(word, HINDI_ENDINGS)) hindi += 1;
  }

  return hindi > marathi ? 'hi' : 'mr';
}
