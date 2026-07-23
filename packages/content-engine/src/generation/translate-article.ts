// Translate a generated Marathi article to English or Hindi, with a LOCKED proper-noun
// glossary.
//
// This is the ONE deliberate exception to the Marathi-first rule: the translated article is
// produced on demand. The reason this file exists is a quality bug — naive Marathi→English
// translation mistranslates proper nouns (a minister's surname once came out as "Donkey").
// The fix is deterministic: verified glossary entries (Marathi→English) are passed to the
// model as a LOCKED TERMS table and it must reuse those exact English forms, never
// "creatively" translating a known name. The caller passes the verified glossary subset
// that appears in the article (see findGlossaryTermsInText in @dgipr/database).
//
// HINDI takes a different route, for a hard reason: the Sarvam CHAT model cannot do
// Marathi→Hindi. Asked to, it returns the Marathi unchanged and calls it Hindi (verified
// with three prompt shapes; see sarvam-translate.ts). So Hindi goes through Sarvam's
// purpose-built translation endpoint, which has no prompt and therefore no way to be
// handed a glossary table.
//
// The dictionary still governs the names — as ENFORCEMENT rather than instruction. Hindi
// shares Devanagari with Marathi, so a name's correct Hindi form is USUALLY its Marathi
// form unchanged; the enforced target is the glossary row's `hindi` spelling, which
// defaults to the Marathi form and is overridden only where Hindi legitimately differs
// (कोल्हापूर → कोल्हापुर). The failure to block is a name being semantically translated
// (वाघ → बाघ) or re-spelt away from that target. After each block is translated, every
// glossary proper noun that was in the source is checked for in the output and a near-miss
// is repaired deterministically to the exact target form.
//
// A name that CANNOT be accounted for is reported, not fatal — `unpreservedNames` on the
// result. That is a deliberate reversal: this check used to throw, discarding a completed
// (and billed) translation. It fired on translations that were correct — Hindi legitimately
// re-renders a multi-word organisation's generic components (नागपूर महानगर प्रदेश प्राधिकरण
// → नागपुर महानगर क्षेत्र प्राधिकरण) and re-transliterates acronyms (व्हीएनआयटी → वीएनआईटी),
// neither of which a verbatim check can ever pass. Since the glossary also collects common
// nouns mis-typed as proper ones (विधानसभा as `org`), throwing meant a routine document
// could not be translated at all. Delivering the translation with the doubtful names named
// puts the judgement where it belongs — with the officer reading the output — and never
// spends credits twice for the same page. The one condition still fatal is an output that
// is not a translation at all (see isUntranslated).
//
// Both paths translate in blocks, for different reasons: the chat tier caps max_tokens
// (reasoning + reply) at 4096, and the translate endpoint rejects input over 2000 chars.

import { pathToFileURL } from 'node:url';
import type { TranslationLanguage } from '@dgipr/schemas';
import type { TermType } from '@dgipr/database';
import { sarvamChatComplete } from './sarvam-chat.js';
import {
  sarvamTranslate,
  SARVAM_TRANSLATE_MAX_INPUT_CHARS,
} from './sarvam-translate.js';
import { editDistance } from './edit-distance.js';
import type { ChatMessage } from './openai-chat.js';
import { splitNoteIntoSections } from './generate-article.js';

// One locked glossary entry. `english` is the authoritative English spelling (the English
// path's LOCKED TERMS table); `hindi` is the target the Hindi path freezes the name to
// (optional — defaults to the Marathi form when absent); `termType` tells the Hindi path
// whether this is a true proper noun to freeze or a common noun that SHOULD be translated —
// see HINDI_LOCKED_TERM_TYPES. The caller supplies the verified glossary subset present in
// the text (typically GlossaryTerm rows narrowed to these fields).
export type GlossaryEntry = Readonly<{
  marathi: string;
  english: string;
  hindi?: string | undefined;
  termType?: TermType | undefined;
}>;

// What a translation run produced. `unpreservedNames` lists locked glossary names the
// Hindi output could not be made to carry — the translation is still delivered, and the
// caller is expected to surface the list so a human checks those names. Always empty for
// English, whose names are locked in the prompt with no post-hoc check to report on.
export type TranslationResult = Readonly<{
  text: string;
  unpreservedNames: readonly string[];
}>;

export type TranslateOptions = Readonly<{
  // Reports progress as blocks are translated (0-based index, total count). Called once
  // before each block and once more at completion (blockIndex === blockCount).
  onProgress?: (blockIndex: number, blockCount: number) => void;
  // Overrides the per-block character budget (defaults below).
  maxCharsPerBlock?: number;
  // Language of the SOURCE text; defaults to Marathi, which is what every article path
  // sends. 'en' exists for the /translate PDF path: a Marathi document can contain an
  // English page, and that page still has to become Hindi. It only affects the Hindi
  // branch (the endpoint's source_language_code) — an English source with target 'en'
  // is a passthrough the caller handles, never a translation.
  sourceLanguage?: 'mr' | 'en';
}>;

// Keep each block well under Sarvam's 4096-token reply cap. Marathi (Devanagari) is
// token-heavy, so ~2500 chars per block leaves ample room for the English output.
const DEFAULT_MAX_CHARS_PER_BLOCK = 2500;

// Output budget (reasoning + reply). Reasoning is disabled per call, so the whole budget
// is available to the English reply; 4096 is the starter-tier ceiling.
const MAX_TOKENS_PER_BLOCK = 4096;

// Anti-repetition sampling. Without a frequency penalty, the near-greedy default
// (temperature 0.2, no top_p) can collapse into a repetition loop at a proper-noun boundary
// (a scheme name once looped "Shahu Maharaj" until it burned the whole token budget). A
// positive frequency_penalty progressively suppresses any token the model keeps re-emitting,
// which is the direct fix; presence_penalty and a modest top_p add headroom. These stay well
// within the free-tier 4096 cap — the point is to STOP looping to the cap, not raise it.
const TRANSLATE_SAMPLING = {
  temperature: 0.3,
  topP: 0.9,
  frequencyPenalty: 0.5,
  presencePenalty: 0.3,
} as const;

// Stronger settings for the one retry after a block still degenerates.
const TRANSLATE_SAMPLING_RETRY = {
  temperature: 0.5,
  topP: 0.9,
  frequencyPenalty: 1.0,
  presencePenalty: 0.5,
} as const;

// A loop-collapsed reply is non-empty garbage (so the empty-content guard in sarvam-chat.ts
// never fires) but has a tiny vocabulary: "Shahu Maharaj Shahu Maharaj…" is ~2 unique words
// over hundreds. Flag output that is long yet overwhelmingly repetitive so it is retried and,
// if still bad, never persisted. Short replies are exempt (a legitimately terse line can have
// a low ratio by chance).
function isDegenerate(text: string): boolean {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  if (words.length < 60) return false;
  const unique = new Set(words.map((w) => w.toLowerCase())).size;
  return unique / words.length < 0.25;
}

// The Hindi-specific failure: because Marathi and Hindi share Devanagari, a model can
// "translate" by handing the input straight back — output that looks perfectly fine and
// is completely wrong (exactly what the chat model does, which is why Hindi uses the
// dedicated endpoint). English can never fail this way (a Devanagari reply is obviously
// not English), so this check only runs for Hindi.
//
// A genuine Hindi rendering of Marathi prose overlaps its source only in names, numbers
// and tatsama words — well under half the tokens in practice — so the 0.85 threshold has
// wide clearance. It is gated on length because a short line that is legitimately near
// identical (a lone name, a figure) would otherwise trip it; an exact match is rejected
// at any length.
function isUntranslated(source: string, output: string): boolean {
  const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();
  if (normalize(source) === normalize(output)) return true;

  const sourceWords = new Set(normalize(source).split(' '));
  const outputWords = normalize(output)
    .split(' ')
    .filter((w) => w.length > 0);
  if (outputWords.length < 20) return false;
  const shared = outputWords.filter((w) => sourceWords.has(w)).length;
  return shared / outputWords.length >= 0.85;
}

const SYSTEM_PROMPT_EN = [
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
// English only — the Hindi endpoint takes no prompt.
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
    { role: 'system', content: SYSTEM_PROMPT_EN },
    { role: 'user', content: parts.join('\n') },
  ];
}

// ---------- Hindi name fidelity (deterministic, post-translation) ----------

// Which glossary rows are frozen in the Hindi output. Person/place/org/scheme names are
// proper nouns and must survive character-for-character. 'designation' and 'other' are
// deliberately excluded: they are common nouns that SHOULD become Hindi (जिल्हाधिकारी →
// जिला कलेक्टर), and enforcing them would fail every translation. An entry with no
// termType is not enforced either — a missing type is not evidence of a proper noun.
const HINDI_LOCKED_TERM_TYPES = new Set<TermType>([
  'person',
  'place',
  'org',
  'scheme',
]);

// A repair may only nudge spelling (कोल्हापुर → कोल्हापूर), never swap one name for
// another — the same rule the proofreader's name gate enforces. Applied PER WORD, so a
// four-word organisation name is not held to the budget of a single surname.
const NAME_REPAIR_MAX_DISTANCE = 2;

// How far one word of a name may drift and still count as the same word. Short words get a
// tighter budget: a three-character word within two edits of another is barely related to it.
function repairBudget(word: string): number {
  return Math.min(NAME_REPAIR_MAX_DISTANCE, Math.floor(word.length / 3));
}

// The Devanagari form the Hindi output must carry: the row's `hindi` override, or the
// Marathi source form when none is set (the common case — most names are spelt identically
// in both scripts).
function hindiTargetForm(term: GlossaryEntry): string {
  const hindi = term.hindi?.trim();
  return hindi && hindi.length > 0 ? hindi : term.marathi;
}

// Presence in the block is keyed on the SOURCE (Marathi) form — the block being scanned is
// the Marathi source, so that is what tells us the name is in play for this block.
function lockedNamesFor(
  block: string,
  glossary: readonly GlossaryEntry[],
): GlossaryEntry[] {
  return glossary.filter(
    (term) =>
      term.termType !== undefined &&
      HINDI_LOCKED_TERM_TYPES.has(term.termType) &&
      block.includes(term.marathi),
  );
}

// Try to make one locked name present in the translated text.
//
// A one-word name is handled exactly as it always was: find the closest same-length word
// and snap it to the target if it is within the budget.
//
// A MULTI-WORD name is compared word by word instead of as one phrase, because a phrase
// budget is unmeetable for the names this actually has to handle. Hindi properly renders
// नागपूर महानगर प्रदेश प्राधिकरण as नागपुर महानगर क्षेत्र प्राधिकरण: one word is a spelling
// drift that must be fixed (नागपुर → नागपूर), one is a real translation that must be left
// alone (प्रदेश → क्षेत्र), and the whole-phrase distance between them is far past any
// budget that could still tell a name from a different name. So each word is judged on its
// own, and a word too far from its counterpart is kept exactly as the translator wrote it —
// rewriting क्षेत्र back to प्रदेश would corrupt the Hindi.
//
// The multi-word path additionally requires an ANCHOR: at least one word of the window must
// match the target exactly. Without it, independent per-word nudges compound into an
// invented name (वंदन करात is two small nudges away from वंदना थोरात and is not that
// person). Anchoring costs the occasional auto-fix — a two-word name misspelt in BOTH words
// is reported rather than repaired — which is the right trade now that a report is cheap
// and a wrong repair silently rewrites an official document.
function applyNameLock(
  text: string,
  target: string,
): { text: string; preserved: boolean } {
  if (text.includes(target)) return { text, preserved: true };

  const targetWords = target.split(/\s+/).filter((w) => w.length > 0);
  if (targetWords.length === 0) return { text, preserved: true };

  const words = text.split(/(\s+)/); // keep separators so joins are lossless
  // The split alternates word, separator, word, ... so a window of N words spans 2N-1 parts.
  const span = targetWords.length * 2 - 1;

  let bestSlice: string[] | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < words.length; i += 2) {
    const slice = words.slice(i, i + span);
    if (slice.length < span) continue;
    const window = slice.join('');
    if (window.length === 0) continue;
    const distance = editDistance(target, window);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestSlice = slice;
    }
  }
  if (bestSlice === null) return { text, preserved: false };
  const slice = bestSlice;

  const anchored =
    targetWords.length === 1 ||
    targetWords.some((word, j) => slice[j * 2] === word);
  if (!anchored) return { text, preserved: false };

  const repaired = [...slice];
  let preserved = true;
  for (const [j, targetWord] of targetWords.entries()) {
    const actual = slice[j * 2] ?? '';
    if (actual === targetWord) continue;
    if (editDistance(targetWord, actual) <= repairBudget(targetWord)) {
      repaired[j * 2] = targetWord;
    } else {
      preserved = false;
    }
  }

  const before = slice.join('');
  const after = repaired.join('');
  if (after !== before) {
    console.warn(
      `[translate] repaired locked name in Hindi output: "${before}" → "${after}".`,
    );
    text = text.split(before).join(after);
  }
  return { text, preserved };
}

// Repair near-miss renderings of locked names in a translated block, returning the fixed
// text plus the names that could not be accounted for. Everything in the translation other
// than a repaired name is left byte-for-byte alone.
function repairLockedNames(
  translated: string,
  lockedNames: readonly GlossaryEntry[],
): { text: string; unpreserved: string[] } {
  let text = translated;
  const unpreserved: string[] = [];

  for (const term of lockedNames) {
    // The output must carry the Hindi target form (the row's `hindi`, or the Marathi form
    // by default). When they differ, the endpoint often leaves the Marathi spelling in
    // place — that is exactly the near-miss applyNameLock repairs to the target.
    const target = hindiTargetForm(term);
    const result = applyNameLock(text, target);
    text = result.text;
    if (!result.preserved) unpreserved.push(target);
  }

  return { text, unpreserved };
}

// Split a block that still exceeds the endpoint's hard input cap. splitNoteIntoSections
// packs whole paragraphs and never breaks one up, so a single long paragraph can come back
// over budget — fine for the chat path, a 4xx on the translate endpoint. Sentence
// boundaries (।/./!/?) keep the pieces translatable; a sentence longer than the cap is
// passed through and left for the API to reject loudly.
function splitToLimit(block: string, limit: number): string[] {
  if (block.length <= limit) return [block];
  const sentences = block.split(/(?<=[।.!?])\s+/);
  const pieces: string[] = [];
  let buffer = '';
  for (const sentence of sentences) {
    if (buffer.length > 0 && buffer.length + sentence.length + 1 > limit) {
      pieces.push(buffer);
      buffer = '';
    }
    buffer = buffer.length > 0 ? `${buffer} ${sentence}` : sentence;
  }
  if (buffer.length > 0) pieces.push(buffer);
  return pieces;
}

// Translate a Marathi article into `language` block by block, honoring the locked
// glossary. Blocks are translated sequentially and rejoined with blank lines so paragraph
// breaks survive. Returns the assembled article plus the union of every block's
// unpreserved locked names (Hindi only; see TranslationResult).
export async function translateArticle(
  marathiArticle: string,
  glossary: readonly GlossaryEntry[],
  language: TranslationLanguage,
  options?: TranslateOptions,
): Promise<TranslationResult> {
  const maxChars =
    options?.maxCharsPerBlock ??
    (language === 'hi'
      ? SARVAM_TRANSLATE_MAX_INPUT_CHARS
      : DEFAULT_MAX_CHARS_PER_BLOCK);
  const onProgress = options?.onProgress ?? (() => {});
  const packed = splitNoteIntoSections(marathiArticle, maxChars);
  // The chat path tolerates an overlong block (it only costs tokens); the translate
  // endpoint rejects one outright, so enforce the cap there.
  const blocks =
    language === 'hi'
      ? packed.flatMap((block) => splitToLimit(block, maxChars))
      : packed;

  const sourceLanguage = options?.sourceLanguage ?? 'mr';

  const translated: string[] = [];
  // Union across blocks: the same name can be locked in several blocks, and the caller
  // wants one list to show, not one per block.
  const unpreserved = new Set<string>();
  for (const [index, block] of blocks.entries()) {
    onProgress(index, blocks.length);
    if (language === 'hi') {
      const result = await translateBlockToHindi(
        block,
        glossary,
        index,
        blocks.length,
        sourceLanguage,
      );
      translated.push(result.text.trim());
      for (const name of result.unpreserved) unpreserved.add(name);
    } else {
      const text = await translateBlockToEnglish(
        block,
        glossary,
        index,
        blocks.length,
      );
      translated.push(text.trim());
    }
  }
  onProgress(blocks.length, blocks.length);
  return {
    text: translated.join('\n\n'),
    unpreservedNames: [...unpreserved],
  };
}

// Hindi: the dedicated endpoint, then the glossary check. Names that drifted slightly are
// repaired in place; a locked name that cannot be accounted for is REPORTED, and the
// translation is delivered anyway (see the header — a verbatim check cannot distinguish a
// mistranslated name from a correctly translated one, so it must not have the casting vote
// over work the user already paid for).
//
// Only ONE failure retries: an output that is the Marathi original handed back. That is
// worth a second call because the endpoint is sampled, so a repeat request can genuinely
// differ, and because the alternative is shipping untranslated text. Name drift is
// deliberately NOT retried — the request is byte-identical and the endpoint takes no
// prompt, so a second call buys the same output at full price. That retry is what made a
// failing document cost twice.
//
// An ENGLISH source block (a stray English page of an otherwise Marathi PDF) takes the
// same route with a different source code. The glossary check simply finds nothing to
// lock there — its keys are Devanagari surface forms — which is the honest outcome:
// those names are in Latin script and there is no verified Hindi spelling to enforce.
async function translateBlockToHindi(
  block: string,
  glossary: readonly GlossaryEntry[],
  index: number,
  blockCount: number,
  sourceLanguage: 'mr' | 'en' = 'mr',
): Promise<{ text: string; unpreserved: string[] }> {
  const label = `block ${index + 1}/${blockCount}`;
  const lockedNames = lockedNamesFor(block, glossary);

  const attempt = async (): Promise<string> =>
    sarvamTranslate(block, {
      sourceLanguageCode: sourceLanguage === 'en' ? 'en-IN' : 'mr-IN',
      targetLanguageCode: 'hi-IN',
    });

  // Belt and braces: the chat model's copy-back failure should be impossible here, but it
  // is invisible to the eye in Devanagari, so it stays checked.
  let raw = await attempt();
  if (isUntranslated(block, raw)) {
    console.warn(
      `[translate] ${label}: Hindi output came back as the Marathi original; retrying.`,
    );
    raw = await attempt();
    if (isUntranslated(block, raw)) {
      throw new Error(
        `The Hindi translation of ${label} came back as the Marathi original, even after ` +
          `a retry. Nothing was saved; try again.`,
      );
    }
  }

  const { text, unpreserved } = repairLockedNames(raw, lockedNames);
  if (unpreserved.length > 0) {
    console.warn(
      `[translate] ${label}: Hindi output does not carry ${unpreserved.join(', ')}; ` +
        `delivering the translation with a warning.`,
    );
  }
  return { text, unpreserved };
}

// English: the chat path, unchanged. Guards against repetition collapse — if the first
// attempt degenerates into a repeat loop, retry once with stronger anti-repetition
// settings; if it still does, throw so the job fails loudly and the garbage is never
// persisted (mirroring the empty-content guard in sarvam-chat.ts). null disables Sarvam's
// reasoning so the whole token budget goes to the reply (null — not 'none' — is what
// actually disables thinking on these hybrid models).
async function translateBlockToEnglish(
  block: string,
  glossary: readonly GlossaryEntry[],
  index: number,
  blockCount: number,
): Promise<string> {
  const label = `block ${index + 1}/${blockCount}`;
  const messages = buildMessages(block, glossary);
  const first = await sarvamChatComplete(messages, {
    ...TRANSLATE_SAMPLING,
    reasoningEffort: null,
    maxTokens: MAX_TOKENS_PER_BLOCK,
  });

  if (isDegenerate(first)) {
    console.warn(
      `[translate] ${label} degenerated into a repetition loop; retrying with stronger anti-repetition settings.`,
    );
    const retry = await sarvamChatComplete(messages, {
      ...TRANSLATE_SAMPLING_RETRY,
      reasoningEffort: null,
      maxTokens: MAX_TOKENS_PER_BLOCK,
    });
    if (isDegenerate(retry)) {
      throw new Error(
        `Translation degenerated into a repetition loop for ${label}, ` +
          `even after a retry. The translation was not saved; try again.`,
      );
    }
    return retry;
  }

  return first;
}

// Run directly to eyeball a translation in isolation (needs SARVAM_API_KEY); pass 'hi'
// for the Hindi path, otherwise English:
//
//   tsx --env-file=../../.env src/generation/translate-article.ts [en|hi]
//
// The sample glossary demonstrates the core guarantee in both directions: a surname that
// literally means "Tiger" (वाघ) must come out as "Wagh" in English and stay "वाघ" — not
// "बाघ" — in Hindi, and the amounts must survive untouched either way. कोल्हापूर carries a
// `hindi` override (कोल्हापुर) to exercise the dictionary: the Hindi output must land on
// the override, not the Marathi spelling.
//
// It also carries the two shapes that used to abort a run: a multi-word organisation whose
// generic components are legitimately re-rendered in Hindi, and a common noun mis-typed as
// `org` (which is how विधानसभा ends up locked). Both must now finish the run and appear
// under "unpreserved names" instead of throwing.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const language: TranslationLanguage =
    process.argv[2]?.toLowerCase() === 'hi' ? 'hi' : 'en';

  const SAMPLE_GLOSSARY: GlossaryEntry[] = [
    { marathi: 'एकनाथ शिंदे', english: 'Eknath Shinde', termType: 'person' },
    { marathi: 'वाघ', english: 'Wagh', termType: 'person' },
    { marathi: 'संवाद वारी', english: 'Samvad Wari', termType: 'scheme' },
    // A place whose correct Hindi spelling differs from Marathi (ऱ्हस्व/दीर्घ उकार): the
    // Hindi lock must land on the override कोल्हापुर, while English uses "Kolhapur".
    {
      marathi: 'कोल्हापूर',
      english: 'Kolhapur',
      hindi: 'कोल्हापुर',
      termType: 'place',
    },
    // A designation: deliberately NOT locked for Hindi — it should become जिला कलेक्टर.
    {
      marathi: 'जिल्हाधिकारी',
      english: 'District Collector',
      termType: 'designation',
    },
    // A multi-word organisation. Hindi renders प्रदेश as क्षेत्र, so the phrase can never
    // appear verbatim — the run must still finish, naming this under unpreserved names.
    {
      marathi: 'नागपूर महानगर प्रदेश प्राधिकरण',
      english: 'Nagpur Metropolitan Region Authority',
      termType: 'org',
    },
    // A common noun the extractor mis-typed as `org` and a reviewer then confirmed. It is
    // the reason this used to be unrunnable; the review card's lock toggle is the cure.
    { marathi: 'विधानसभा', english: 'Legislative Assembly', termType: 'org' },
  ];

  const SAMPLE_ARTICLE = [
    'मुख्यमंत्री एकनाथ शिंदे यांच्या हस्ते आज कोल्हापूर येथे नव्या योजनेचे उद्घाटन झाले.',
    'जिल्हाधिकारी श्री. वाघ यांनी कार्यक्रमाचे आयोजन केले होते. या योजनेतून ५०० कुटुंबांना',
    'थेट लाभ मिळणार असून एकूण २ कोटी रुपयांची तरतूद करण्यात आली आहे. संवाद वारी हा उपक्रम',
    'राज्यभर राबविण्यात येणार आहे.',
    'नागपूर महानगर प्रदेश प्राधिकरण यांच्यामार्फत ही योजना राबविली जाईल, अशी माहिती',
    'विधानसभा अधिवेशनात देण्यात आली.',
  ].join('\n\n');

  translateArticle(SAMPLE_ARTICLE, SAMPLE_GLOSSARY, language, {
    // onProgress also fires once at completion with i === n; don't log that as a block.
    onProgress: (i, n) => {
      if (i < n) console.log(`translating block ${i + 1}/${n}...`);
    },
  })
    .then((result) => {
      console.log(
        `\n=== ${language === 'hi' ? 'Hindi' : 'English'} translation ===\n`,
      );
      console.log(result.text);
      if (result.unpreservedNames.length > 0) {
        console.log(
          `\n=== unpreserved names (delivered anyway, for review) ===\n` +
            result.unpreservedNames.join(', '),
        );
      }
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
