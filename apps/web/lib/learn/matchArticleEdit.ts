// Whether a practice feedback note asks for the one pre-made article revision.
//
// /learn's DLO lesson has exactly one result it can honestly show for «बातमीत बदल हवा आहे?»,
// made through the real article-feedback path from the sample article: the article made
// shorter — «आणखी थोडक्यात लिहा», the first of the real screen's own quick suggestions.
// Anything else is refused with that example to try instead, because showing an article that
// is not the result of what the learner asked for would be the practice pretending.
//
// There is deliberately no second one. «भाषा आणखी सोपी करा» was rendered too, and the real
// revision added two sentences the note never said; a lesson does not show an officer an
// article with invented facts as the result of a good request.
//
// Pure and synchronous, so the free harness (dlo.check.ts) can pin it.

export type ArticleEdit = 'short';

// A request about one PART of the article (the headline, the opening, a date, a name) or about
// another language. The rendered revision changes the whole article, so these are refused
// even when they also say "shorter": "शीर्षक लहान करा" is not "the article, shorter".
const OTHER_SUBJECT =
  /शीर्षक|मथळा|सुरुवात|परिच्छेद|तारीख|दिनांक|नाव|आकड|इंग्रजी|हिंदी|भाषांतर|headline|title|opening|paragraph|\bdate\b|\bname|number|english|hindi|translat/;

// Shorter. `थोडक्यात` is the chip's own word; लहान/छोटी/कमी शब्द/संक्षिप्त are how officers say it.
const SHORT =
  /थोडक्यात|लहान|छोट|संक्षिप्त|आटोपशीर|कमी\s*शब्द|short|concise|brief|trim|condense/;
// The opposite direction has no pre-made result. Not अधिक/आणखी: those are "more" in both
// directions («आणखी थोडक्यात», «अधिक सोपी»).
const LONGER = /सविस्तर|विस्तार|लांब|मोठी\s*कर|longer|expand|detail|elaborat/;

// Simpler language — a real request, but one the practice has no result for. `सोप` covers
// सोपी/सोपे/सोप्या.
const SIMPLE = /सोप|सरळ|सुलभ|साध्या|समजेल|simple|simpler|easy|easier|plain/;

function normalise(note: string): string {
  return note.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function matchArticleEdit(note: string): ArticleEdit | null {
  const text = normalise(note);
  if (text.length === 0) return null;
  if (OTHER_SUBJECT.test(text)) return null;

  // Simpler — alone, or together with shorter — is a result the practice does not have.
  if (SIMPLE.test(text)) return null;
  return SHORT.test(text) && !LONGER.test(text) ? 'short' : null;
}
