// Which of the two pre-rendered headline edits a practice note asks for — or neither.
//
// /learn's first lesson has exactly two results it can honestly show for a mark on the
// headline, both made through the real marker-edit route: the headline made bigger/bolder,
// and the headline turned red. Anything else is refused with the example to try instead,
// because showing a picture that is not the result of what the learner asked for would be
// the practice pretending.
//
// Pure and synchronous, so the free harness (creative.check.ts) can pin it.

export type ScriptedEdit = 'size' | 'colour';

// A request about some OTHER element of the poster. The mark is on the headline, but the
// words win: "फोटो बदला" with a mark on the headline is still a request about the photo.
// Not चित्र/प्रतिमा: officers say those for the poster itself ("चित्रात बदल करा" is the
// product's own label for this very gesture).
const OTHER_SUBJECT =
  /फोटो|छायाचित्र|पार्श्वभूमी|बॅकग्राउंड|तारीख|दिनांक|वेळ|लोगो|बोधचिन्ह|फूटर|डॉक्टर|माणस|व्यक्ती|photo|background|\bdate\b|\btime\b|logo|footer/;

// Bigger or bolder. `मोठ` covers मोठे/मोठा/मोठी/मोठ्या, `वाढव` covers वाढवा/वाढवून.
const SIZE =
  /मोठ|ठळक|वाढव|जाड|बोल्ड|आकार\s*वाढ|bigger|larger|\bbig\b|\blarge\b|bold|increase|enlarge/;
// The opposite direction has no pre-rendered result.
const SMALLER = /लहान|छोट|कमी|smaller|\bsmall\b|reduce|shrink/;

const COLOUR_WORD = /रंग|colou?r/;
const RED = /लाल|तांबड|\bred\b/;
// A named colour the practice cannot show. Only red was rendered.
const OTHER_COLOUR =
  /निळ|हिरव|पिवळ|काळ|पांढर|जांभळ|केशरी|भगव|गुलाबी|सोनेरी|blue|green|yellow|black|white|orange|pink|purple|gold/;

function normalise(note: string): string {
  return note.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function matchScriptedEdit(note: string): ScriptedEdit | null {
  const text = normalise(note);
  if (text.length === 0) return null;
  if (OTHER_SUBJECT.test(text)) return null;

  const wantsSize = SIZE.test(text) && !SMALLER.test(text);
  const namesOtherColour = OTHER_COLOUR.test(text) && !RED.test(text);
  const wantsColour =
    (RED.test(text) || COLOUR_WORD.test(text)) && !namesOtherColour;

  // Both at once is one request the practice cannot show: it has each change alone.
  if (wantsSize && wantsColour) return null;
  if (wantsSize) return 'size';
  if (wantsColour) return 'colour';
  return null;
}
