// Step 2 of the new /dlo flow: which people do the attached sources name?
//
// The old lane could answer this for free — the documents had already been transcribed, so
// `prepareDesignations` had a string to scan. The new lane has no such string, and the point
// of the redesign is that it never pays to make one. So this asks the model for the SMALLEST
// piece of text that answers the name question and nothing more: the sentences in which a
// person is named, copied out verbatim.
//
// WHY A TEXT DIGEST RATHER THAN A LIST OF NAMES. `prepareDesignations` does far more than
// collect names — it matches them against the verified glossary, finds a पदनाम standing
// beside a name in the source, resolves a bare surname to the office-holder the dictionary
// knows, and suppresses a one-word person row that only occurs inside a longer name. Every
// one of those reads the surrounding TEXT. Handing it a digest means the entire existing name
// pipeline, the review card and the "यापुढेही हेच वापरा" write-back keep working with no
// change at all; handing it a bare list would mean rewriting all of it for this lane.
//
// VERBATIM IS THE WHOLE CONTRACT, and it is why the prompt says so four different ways. A
// paraphrased sentence still contains the name, so the digest would look fine — and then
// `designationsFromText` would fail to find the title beside it, silently, and the officer
// would be shown a name with a blank पदनाम. The failure mode of this call is not an error; it
// is a review card that is quietly less useful, so the prompt is worded against it.

import { respondWithSources } from './responses-with-sources.js';
import type { SourceFileRef } from '../intake/openai-source-files.js';

// Must be a model that accepts file input, which is why this defaults to the vision tier —
// the same reasoning, and the same default, as `openai-doc.ts`'s OCR_MODEL. It is a separate
// env from the article's so the name scan can be traded down for cost without touching the
// model that writes the published text.
const NAME_SCAN_MODEL = process.env.OPENAI_NAME_SCAN_MODEL ?? 'gpt-5.6-terra';

// Reading names off a page is recognition, not deliberation — the same judgement
// `openai-doc.ts` records for OCR reasoning effort. The budget is generous because it is
// shared with the reasoning stage and because a long meeting note can genuinely name twenty
// people; unused output tokens are free.
const NAME_SCAN_MAX_TOKENS = Number.parseInt(
  process.env.OPENAI_NAME_SCAN_MAX_TOKENS ?? '16000',
  10,
);

const SYSTEM_PROMPT = [
  'तुम्ही महाराष्ट्र शासनाच्या माहिती व जनसंपर्क महासंचालनालयासाठी काम करता.',
  '',
  'तुमचे एकच काम आहे: दिलेल्या कागदपत्रांत आणि मजकुरात ज्या ज्या ठिकाणी एखाद्या व्यक्तीचे नाव आले आहे,',
  'ती वाक्ये जशीच्या तशी उतरवून काढणे.',
  '',
  'नियम:',
  '1. वाक्य जसेच्या तसे कॉपी करा. एकही शब्द बदलू नका, गाळू नका, जोडू नका किंवा सोपा करू नका.',
  '2. सारांश लिहू नका. भाषांतर करू नका. पुनर्लेखन करू नका.',
  '3. ज्या वाक्यात व्यक्तीचे नाव आहे तेच वाक्य घ्या. नाव नसलेली वाक्ये वगळा.',
  '4. व्यक्तीच्या नावाबरोबर तिचे पदनाम (उदा. मुख्यमंत्री, जिल्हाधिकारी, मंत्री) त्याच वाक्यात असेल',
  '   तर ते पदनामही त्याच वाक्यात राहू द्या — तेच सर्वात महत्त्वाचे आहे.',
  '5. एकच नाव अनेक ठिकाणी आले असेल, तर पदनाम असलेले वाक्य आधी घ्या; नंतर इतर वेगळी वाक्ये घ्या.',
  '6. स्वतःहून कोणतेही नाव, पदनाम किंवा वाक्य तयार करू नका. कागदपत्रात नसलेले काहीही लिहू नका.',
  '7. कोणत्याही व्यक्तीचे नाव कुठेही नसेल, तर काहीही उत्तर देऊ नका (रिकामे उत्तर द्या).',
  '',
  'उत्तराचा आकार: प्रत्येक ओळीवर एक वाक्य. मथळे नाहीत, क्रमांक नाहीत, टिप्पणी नाही, फुल्या नाहीत.',
].join('\n');

/**
 * Returns the verbatim sentences from the sources in which a person is named, one per line —
 * the text `prepareDesignations` then scans.
 *
 * BEST-EFFORT BY DESIGN: an empty string is a legitimate answer (a scheme circular naming
 * nobody), and a failed call returns one too rather than throwing. The name step is a review
 * card the officer can add rows to by hand, so a failure here costs suggestions, never the
 * run. That mirrors `prepareDesignations`'s own treatment of its reverse-lookup failures.
 */
export async function extractNameContextFromSources(
  note: string,
  files: readonly SourceFileRef[],
): Promise<string> {
  if (files.length === 0) return note;

  const typed = note.trim();
  const userText =
    typed === ''
      ? 'खालील कागदपत्रांतून व्यक्तींची नावे असलेली वाक्ये जशीच्या तशी काढा.'
      : [
          'अधिकाऱ्याने लिहिलेला मजकूर:',
          typed,
          '',
          'हा मजकूर आणि सोबतची कागदपत्रे — दोन्हींतून व्यक्तींची नावे असलेली वाक्ये जशीच्या तशी काढा.',
        ].join('\n');

  try {
    const raw = await respondWithSources({
      label: 'name scan',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userText },
      ],
      files,
      model: NAME_SCAN_MODEL,
      maxOutputTokens: NAME_SCAN_MAX_TOKENS,
      reasoningEffort: 'low',
    });
    // The officer's own typed text is prepended rather than left to the model to echo: it is
    // already exact, and a name that appears only there must still reach the review card.
    return typed === '' ? raw : `${typed}\n\n${raw}`;
  } catch (error) {
    console.warn(
      '[name-scan] could not read names off the sources; falling back to the typed note:',
      error,
    );
    return note;
  }
}
