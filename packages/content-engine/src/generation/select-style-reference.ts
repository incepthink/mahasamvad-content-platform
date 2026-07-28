// Which article the simplified generator studies for STYLE. One seam, three tiers:
//
//   1. an article the officer explicitly pasted for this run,
//   2. otherwise the closest historical Mahasamvad article from the vector store — but only
//      if it is actually close,
//   3. otherwise nothing: the runtime prompt's own DGIPR rules are the complete style guide.
//
// Two things here are deliberate and load-bearing.
//
// THE SIMILARITY FLOOR. Retrieval had no threshold anywhere: pickBestMatch returns the argmax
// unconditionally, so whenever the corpus held nothing relevant an unrelated article still
// became the exemplar. That is worse than no exemplar — the model is told to follow its
// structure and terminology, so an off-topic reference actively drags the article off shape.
// The floor is env-tunable BECAUSE it must be calibrated against the live corpus rather than
// guessed: `pnpm --filter @dgipr/content-engine retrieve:test` prints per-chunk similarity, and
// every run records what it used in generations.style_reference_meta, so the distribution is
// observable in production and the number can be tightened without a deploy.
//
// THE WHOLE ARTICLE, NOT A HEAD SLICE. The old pipeline passed `reference.text.slice(0, 1500)`.
// The specification asks the model to study paragraph sequencing and how the piece CONCLUDES —
// both of which a head truncation removes, leaving the reference able to demonstrate only an
// opening. Input tokens are cheap; the cap here exists to bound a pathological row, not to
// shape the reference.
//
// This function is also the extension point for the future learning loop: an "approved
// source → officer-final article" tier slots in between 1 and 2, matched on the SOURCE
// embedding, with no change to the generator that calls this.

import {
  ARTICLE_WORD_TARGETS,
  STYLE_REFERENCE_MAX_CHARS,
  STYLE_REFERENCE_MIN_CHARS,
} from '@dgipr/schemas';
import { pathToFileURL } from 'node:url';
import {
  retrieveReferenceArticles,
  type ReferenceArticle,
} from '../retrieval/retrieve-references.js';
import type { ArticleCategory } from './category-prompt.js';

export type StyleReferenceSource = 'officer' | 'retrieval' | 'none';

// One complete exemplar as the prompt receives it. `title` is the article's own HEADLINE and
// is load-bearing, not metadata: the specification tells the model to study "headline
// construction", and for a long time the reference text was the joined chunk BODIES only —
// so the pattern it was asked to learn (`… गैरसोय टाळावी – पालकमंत्री मंगलप्रभात लोढा`) was
// never actually visible to it. Null only for an officer paste, whose headline is inside the
// pasted text already.
export type StyleReferenceArticle = Readonly<{
  title: string | null;
  text: string;
}>;

export type StyleReference = Readonly<{
  source: StyleReferenceSource;
  // The PRIMARY reference — element 0 of `articles`. Retained as its own field because
  // style_reference_meta records one article per run, and because it is what the single-article
  // callers and the telemetry have always meant. Empty string when source === 'none'.
  text: string;
  title: string | null;
  url: string | null;
  articleId: number | null;
  // Cosine similarity of the retrieved article's best chunk. Null for 'officer' (nothing was
  // matched) and 'none'. Persisted, so the floor below can be calibrated from real runs.
  similarity: number | null;
  chars: number;
  // EVERY exemplar handed to the prompt, headline included: one for 'officer', up to
  // styleReferenceCount() for 'retrieval', none for 'none'.
  articles: readonly StyleReferenceArticle[];
}>;

export const NO_STYLE_REFERENCE: StyleReference = {
  source: 'none',
  text: '',
  title: null,
  url: null,
  articleId: null,
  similarity: null,
  chars: 0,
  articles: [],
};

// Cosine similarity (1 - cosine distance, so 0..1) that a retrieved article must reach before it
// is worth showing the model. Starting value, pending calibration against the live corpus — err
// permissive, because today's behaviour is "always use the top hit" and a floor that is too high
// silently removes the style reference from every run. Tune from style_reference_meta.
const DEFAULT_MIN_SIMILARITY = 0.35;

export function styleReferenceMinSimilarity(): number {
  const raw = Number(process.env.ARTICLE_STYLE_REFERENCE_MIN_SIMILARITY);
  return Number.isFinite(raw) && raw >= 0 && raw <= 1
    ? raw
    : DEFAULT_MIN_SIMILARITY;
}

// How many complete exemplars the retrieval tier hands the prompt. One article can only show
// the shape it happens to have; three make the house pattern legible AS a pattern. Env-tunable
// for the same reason the floor is — so 1 vs 3 can be A/B'd against real notes without a
// deploy. Input tokens are cheap here: three Mahasamvad articles are ~3-4k tokens on a run
// whose whole input was ~5k.
const DEFAULT_ARTICLE_COUNT = 3;

export function styleReferenceCount(): number {
  const raw = Number(process.env.ARTICLE_STYLE_REFERENCE_COUNT);
  return Number.isInteger(raw) && raw >= 1 && raw <= 5
    ? raw
    : DEFAULT_ARTICLE_COUNT;
}

// A paste shorter than this is a fragment, not an article: too little to demonstrate structure,
// and far more likely to be a stray line or an accidental keystroke than an intentional
// reference. Such input falls through to retrieval rather than being honoured as tier 1 —
// silently ignoring it would be worse, so the caller logs the fall-through.
export function acceptOfficerReference(
  raw: string | null | undefined,
): StyleReference | null {
  const text = (raw ?? '').trim();
  if (text.length < STYLE_REFERENCE_MIN_CHARS) return null;
  const clipped = text.slice(0, STYLE_REFERENCE_MAX_CHARS);
  return {
    source: 'officer',
    text: clipped,
    title: null,
    url: null,
    articleId: null,
    similarity: null,
    chars: clipped.length,
    // The officer pasted a whole article, headline and all, so there is no separate title to
    // carry — and no second exemplar: their explicit choice is the reference, not one vote in
    // a rotation.
    articles: [{ title: null, text: clipped }],
  };
}

// Apply the floor to retrieval hits. Split out from selectStyleReference so the decision is
// testable without a database or an embedding call.
//
// The floor is applied PER ARTICLE and the survivors are kept in rank order, so a run whose
// second and third candidates are weak degrades to one good exemplar rather than being padded
// with off-topic ones — an unrelated article actively drags the article off shape, which is
// the whole reason the floor exists.
export function acceptRetrievedReferences(
  references: readonly ReferenceArticle[] | null,
  minSimilarity: number,
  // Genre bound — see styleReferenceMaxChars. Omitted ⇒ length is not checked at all (an
  // over-long article is still CLIPPED to STYLE_REFERENCE_MAX_CHARS below, as it always was),
  // which is what the single-article back-compat wrapper and the offline harness want.
  maxChars = Number.POSITIVE_INFINITY,
): StyleReference | null {
  const usable = (references ?? [])
    .map((reference) => ({ reference, text: reference.text.trim() }))
    .filter(
      ({ reference, text }) =>
        text.length > 0 &&
        text.length <= maxChars &&
        reference.similarity >= minSimilarity,
    )
    .map(({ reference, text }) => ({
      reference,
      text: text.slice(0, STYLE_REFERENCE_MAX_CHARS),
    }));

  const primary = usable[0];
  if (!primary) return null;

  return {
    source: 'retrieval',
    text: primary.text,
    title: primary.reference.title,
    url: primary.reference.url,
    articleId: primary.reference.articleId,
    similarity: primary.reference.similarity,
    chars: primary.text.length,
    articles: usable.map(({ reference, text }) => ({
      title: reference.title,
      text,
    })),
  };
}

// Back-compat single-article wrapper, kept because the free harness and any future caller that
// genuinely has one candidate should not have to build an array to ask the same question.
export function acceptRetrievedReference(
  reference: ReferenceArticle | null,
  minSimilarity: number,
): StyleReference | null {
  return acceptRetrievedReferences(reference ? [reference] : [], minSimilarity);
}

// A style exemplar must be the same GENRE as the article being written, and length is the
// cheapest reliable proxy for genre in this corpus. A real retrieval for a Pune transport note
// ranked a 12,550-character "विधानसभा लक्षवेधी" — a legislative question-and-answer document,
// ~1,700 words — above the 835-character news report that actually demonstrated the house
// pattern. Telling the model to copy that document's "paragraph sequencing and how it concludes"
// is worse than giving it nothing, and it matters MORE now that the specification is short and
// the references carry the style.
//
// Marathi averages roughly 6.5 characters per word in this corpus; the ×2 tolerance keeps a
// legitimately detailed article while excluding a different kind of document altogether.
const CHARS_PER_WORD = 6.5;
const LENGTH_TOLERANCE = 2;

export function styleReferenceMaxChars(category: ArticleCategory): number {
  return Math.round(
    ARTICLE_WORD_TARGETS[category].max * CHARS_PER_WORD * LENGTH_TOLERANCE,
  );
}

export type SelectStyleReferenceInput = Readonly<{
  note: string;
  category: ArticleCategory;
  // The officer's pasted article (generations.style_reference). Tier 1.
  officerReference?: string | null | undefined;
  // The officer's editorial angle, which biases retrieval toward the intended shape.
  heading?: string | undefined;
  // Whether this run carries approved attributed statements, which biases retrieval toward
  // attribution-shaped exemplars. Same signal the full pipeline uses.
  preferAttribution?: boolean | undefined;
}>;

export async function selectStyleReference(
  input: SelectStyleReferenceInput,
): Promise<StyleReference> {
  // Tier 1 — the officer's own choice wins outright, and retrieval is not even called, so this
  // path spends nothing at all.
  const officer = acceptOfficerReference(input.officerReference);
  if (officer) {
    console.log(
      `[style-ref] tier 1: officer-supplied reference (${officer.chars} chars)`,
    );
    return officer;
  }
  if ((input.officerReference ?? '').trim().length > 0) {
    console.log(
      `[style-ref] officer reference too short (< ${STYLE_REFERENCE_MIN_CHARS} chars); falling through to retrieval`,
    );
  }

  // Tier 2 — the closest historical Mahasamvad article, if it is genuinely close. Retrieval
  // failure is not fatal: a missing style reference produces a DGIPR-styled article from the
  // prompt's own rules, which is tier 3 and a perfectly good outcome.
  const floor = styleReferenceMinSimilarity();
  let retrieved: ReferenceArticle[] = [];
  try {
    retrieved = await retrieveReferenceArticles(
      input.note,
      input.category,
      input.heading,
      input.preferAttribution ?? false,
      styleReferenceCount(),
    );
  } catch (error) {
    console.warn(
      '[style-ref] retrieval failed; continuing without a style reference:',
      error,
    );
    return NO_STYLE_REFERENCE;
  }

  const maxChars = styleReferenceMaxChars(input.category);
  const accepted = acceptRetrievedReferences(retrieved, floor, maxChars);
  if (accepted) {
    const dropped = retrieved.length - accepted.articles.length;
    console.log(
      `[style-ref] tier 2: ${accepted.articles.length} exemplar(s), primary "${accepted.title}" ` +
        `similarity=${accepted.similarity?.toFixed(3)} (floor ${floor}, max ${maxChars} chars` +
        `${dropped > 0 ? `, ${dropped} dropped` : ''}) ` +
        `${accepted.articles.reduce((sum, a) => sum + a.text.length, 0)} chars total`,
    );
    return accepted;
  }

  // Tier 3 — say WHY, so a corpus gap looks like a corpus gap rather than a silent behaviour
  // change. This log plus style_reference_meta is how the floor gets calibrated.
  const best = retrieved[0];
  if (best) {
    console.log(
      `[style-ref] tier 3: best match "${best.title}" similarity=${best.similarity.toFixed(3)} ` +
        `is below the floor ${floor}; generating with no style reference`,
    );
  } else {
    console.log(
      '[style-ref] tier 3: retrieval returned nothing; generating with no style reference',
    );
  }
  return NO_STYLE_REFERENCE;
}

// ---------------------------------------------------------------------------
// Free harness: `tsx src/generation/select-style-reference.ts`
// Pure tier logic only — no database, no embedding call, no spend.
// ---------------------------------------------------------------------------

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  let failures = 0;
  const check = (label: string, condition: boolean): void => {
    if (!condition) {
      failures += 1;
      console.error(`  FAIL  ${label}`);
    } else {
      console.log(`  ok    ${label}`);
    }
  };

  const article = (
    similarity: number,
    text = 'क'.repeat(3000),
    articleId = 42,
    title = 'नमुना महासंवाद लेख',
  ): ReferenceArticle => ({
    articleId,
    title,
    url: `https://example.test/article/${articleId}`,
    similarity,
    selectionScore: similarity,
    text,
  });

  console.log('\n=== tier 1: the officer paste ===');
  const longPaste = 'ल'.repeat(STYLE_REFERENCE_MIN_CHARS + 50);
  check(
    'a real paste is accepted',
    acceptOfficerReference(longPaste)?.source === 'officer',
  );
  check(
    'similarity is null for an officer reference (nothing was matched)',
    acceptOfficerReference(longPaste)?.similarity === null,
  );
  check('undefined falls through', acceptOfficerReference(undefined) === null);
  check('empty falls through', acceptOfficerReference('') === null);
  check(
    'whitespace-only falls through',
    acceptOfficerReference('   \n  ') === null,
  );
  check(
    'a fragment below the minimum falls through',
    acceptOfficerReference('ल'.repeat(STYLE_REFERENCE_MIN_CHARS - 1)) === null,
  );
  check(
    'an over-long paste is clipped to the cap',
    acceptOfficerReference('ल'.repeat(STYLE_REFERENCE_MAX_CHARS + 500))
      ?.chars === STYLE_REFERENCE_MAX_CHARS,
  );

  console.log('\n=== tier 2: the similarity floor ===');
  check(
    'null retrieval is rejected',
    acceptRetrievedReference(null, 0.35) === null,
  );
  check(
    'a match above the floor is accepted',
    acceptRetrievedReference(article(0.51), 0.35)?.source === 'retrieval',
  );
  check(
    'a match below the floor is rejected',
    acceptRetrievedReference(article(0.2), 0.35) === null,
  );
  check(
    'a match exactly at the floor is accepted',
    acceptRetrievedReference(article(0.35), 0.35)?.source === 'retrieval',
  );
  check(
    'an empty-text match is rejected even above the floor',
    acceptRetrievedReference(article(0.9, '   '), 0.35) === null,
  );
  check(
    'similarity, title, url and articleId are carried through for telemetry',
    (() => {
      const accepted = acceptRetrievedReference(article(0.61), 0.35);
      return (
        accepted?.similarity === 0.61 &&
        accepted.articleId === 42 &&
        accepted.title === 'नमुना महासंवाद लेख' &&
        accepted.url === 'https://example.test/article/42'
      );
    })(),
  );

  console.log(
    '\n=== the whole article reaches the prompt, not a 1500-char head ===',
  );
  check(
    'a 3000-char article is not truncated to 1500',
    acceptRetrievedReference(article(0.5), 0.35)?.chars === 3000,
  );
  check(
    'an absurdly long article is still bounded by the cap',
    acceptRetrievedReference(
      article(0.5, 'क'.repeat(STYLE_REFERENCE_MAX_CHARS + 1000)),
      0.35,
    )?.chars === STYLE_REFERENCE_MAX_CHARS,
  );

  console.log('\n=== every exemplar carries its HEADLINE ===');
  check(
    'an officer paste yields one titleless article',
    (() => {
      const accepted = acceptOfficerReference(longPaste);
      return (
        accepted?.articles.length === 1 &&
        accepted.articles[0]?.title === null &&
        accepted.articles[0]?.text === accepted.text
      );
    })(),
  );
  check(
    'a retrieved exemplar carries its title into articles[]',
    acceptRetrievedReference(article(0.5), 0.35)?.articles[0]?.title ===
      'नमुना महासंवाद लेख',
  );
  check(
    'the none sentinel carries no articles',
    NO_STYLE_REFERENCE.articles.length === 0,
  );

  console.log('\n=== several exemplars, filtered per article by the floor ===');
  const three = [
    article(0.61, 'एक', 1, 'पहिले'),
    article(0.48, 'दोन', 2, 'दुसरे'),
    article(0.41, 'तीन', 3, 'तिसरे'),
  ];
  check(
    'all three survive a floor they clear',
    acceptRetrievedReferences(three, 0.35)?.articles.length === 3,
  );
  check(
    'rank order is preserved',
    acceptRetrievedReferences(three, 0.35)
      ?.articles.map((a) => a.title)
      .join(',') === 'पहिले,दुसरे,तिसरे',
  );
  check(
    'weak candidates are dropped rather than padding the list',
    acceptRetrievedReferences(three, 0.5)?.articles.length === 1,
  );
  check(
    'the primary fields describe articles[0]',
    (() => {
      const accepted = acceptRetrievedReferences(three, 0.35);
      return (
        accepted?.articleId === 1 &&
        accepted.title === 'पहिले' &&
        accepted.similarity === 0.61 &&
        accepted.text === accepted.articles[0]?.text
      );
    })(),
  );
  check(
    'an all-weak list is rejected outright',
    acceptRetrievedReferences(three, 0.9) === null,
  );
  check('an empty list is rejected', acceptRetrievedReferences([], 0.35) === null);
  check('null is rejected', acceptRetrievedReferences(null, 0.35) === null);
  check(
    'a blank-text leader does not sink the whole list',
    (() => {
      const accepted = acceptRetrievedReferences(
        [article(0.8, '   ', 9, 'रिकामे'), article(0.5, 'खरा मजकूर', 2, 'दुसरे')],
        0.35,
      );
      return accepted?.articles.length === 1 && accepted.title === 'दुसरे';
    })(),
  );

  console.log('\n=== a wrong-GENRE exemplar is excluded by length ===');
  check(
    'news bounds an exemplar at 450 words x 6.5 x 2 chars',
    styleReferenceMaxChars('news') === 5850,
  );
  check(
    'scheme allows a longer exemplar than news',
    styleReferenceMaxChars('scheme') > styleReferenceMaxChars('news'),
  );
  check(
    'the real 12,550-char विधानसभा लक्षवेधी is rejected for a news run',
    acceptRetrievedReferences(
      [article(0.465, 'क'.repeat(12_550), 7, 'विधानसभा लक्षवेधी')],
      0.35,
      styleReferenceMaxChars('news'),
    ) === null,
  );
  check(
    'the real 835-char news report beside it is kept',
    (() => {
      const accepted = acceptRetrievedReferences(
        [
          article(0.465, 'क'.repeat(12_550), 7, 'विधानसभा लक्षवेधी'),
          article(0.442, 'क'.repeat(835), 8, 'पुणे रिंग रोडचे काम मुदतीत पूर्ण होणार –'),
        ],
        0.35,
        styleReferenceMaxChars('news'),
      );
      return (
        accepted?.articles.length === 1 &&
        accepted.title === 'पुणे रिंग रोडचे काम मुदतीत पूर्ण होणार –'
      );
    })(),
  );
  check(
    'an exemplar exactly at the bound is kept',
    acceptRetrievedReferences(
      [article(0.5, 'क'.repeat(5850), 9, 'सीमेवरचा')],
      0.35,
      styleReferenceMaxChars('news'),
    )?.articles.length === 1,
  );
  check(
    'omitting the bound checks no length (back-compat)',
    acceptRetrievedReference(article(0.5, 'क'.repeat(12_550)), 0.35)
      ?.articles.length === 1,
  );

  console.log('\n=== the exemplar count is env-tunable ===');
  const originalCount = process.env.ARTICLE_STYLE_REFERENCE_COUNT;
  const withCount = (value: string | undefined): number => {
    if (value === undefined) delete process.env.ARTICLE_STYLE_REFERENCE_COUNT;
    else process.env.ARTICLE_STYLE_REFERENCE_COUNT = value;
    return styleReferenceCount();
  };
  check(
    `unset defaults to ${DEFAULT_ARTICLE_COUNT}`,
    withCount(undefined) === DEFAULT_ARTICLE_COUNT,
  );
  check('1 is honoured (single-exemplar A/B)', withCount('1') === 1);
  check('5 is honoured', withCount('5') === 5);
  check('0 falls back to the default', withCount('0') === DEFAULT_ARTICLE_COUNT);
  check('6 falls back to the default', withCount('6') === DEFAULT_ARTICLE_COUNT);
  check(
    'junk falls back to the default',
    withCount('abc') === DEFAULT_ARTICLE_COUNT,
  );
  check(
    'a fractional value falls back to the default',
    withCount('2.5') === DEFAULT_ARTICLE_COUNT,
  );
  withCount(originalCount);

  console.log('\n=== the floor is env-tunable, with a sane fallback ===');
  const original = process.env.ARTICLE_STYLE_REFERENCE_MIN_SIMILARITY;
  const withEnv = (value: string | undefined): number => {
    if (value === undefined)
      delete process.env.ARTICLE_STYLE_REFERENCE_MIN_SIMILARITY;
    else process.env.ARTICLE_STYLE_REFERENCE_MIN_SIMILARITY = value;
    return styleReferenceMinSimilarity();
  };
  check(
    `unset defaults to ${DEFAULT_MIN_SIMILARITY}`,
    withEnv(undefined) === DEFAULT_MIN_SIMILARITY,
  );
  check('a valid value is honoured', withEnv('0.55') === 0.55);
  check('0 is honoured (accept everything)', withEnv('0') === 0);
  check(
    'junk falls back to the default',
    withEnv('abc') === DEFAULT_MIN_SIMILARITY,
  );
  check(
    'out-of-range falls back to the default',
    withEnv('1.7') === DEFAULT_MIN_SIMILARITY,
  );
  check(
    'negative falls back to the default',
    withEnv('-1') === DEFAULT_MIN_SIMILARITY,
  );
  withEnv(original);

  console.log('\n=== tier 3 ===');
  check(
    'the none sentinel carries an empty text',
    NO_STYLE_REFERENCE.text === '',
  );
  check(
    'the none sentinel reports source none',
    NO_STYLE_REFERENCE.source === 'none',
  );

  if (failures > 0) {
    console.error(`\n${failures} check(s) failed.`);
    process.exitCode = 1;
  } else {
    console.log('\nAll checks passed.');
  }
}
