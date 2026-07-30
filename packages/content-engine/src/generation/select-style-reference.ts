// Which article the simplified generator studies for STYLE. One seam, three tiers:
//
//   1. an article the officer explicitly pasted for this run,
//   2. otherwise close historical Mahasamvad articles from the vector store,
//   3. otherwise any non-empty article from the requested style category.
//
// Two things here are deliberate and load-bearing.
//
// THE SIMILARITY FLOOR still separates a semantic match from a category fallback, so telemetry
// can tell which path actually worked. It no longer means "no exemplar": if matching times out,
// returns nothing or yields only weak candidates, a cheap non-vector query supplies real
// Mahasamvad articles from the requested style bucket.
//
// THE WHOLE ARTICLE, NOT A HEAD SLICE. The old pipeline passed `reference.text.slice(0, 1500)`.
// The specification asks the model to study paragraph sequencing and how the piece CONCLUDES —
// both of which a head truncation removes, leaving the reference able to demonstrate only an
// opening. There is no application-imposed character limit or category-length bound.
//
// This function is also the extension point for the future learning loop: an "approved
// source → officer-final article" tier slots in between 1 and 2, matched on the SOURCE
// embedding, with no change to the generator that calls this.

import { pathToFileURL } from 'node:url';
import {
  retrieveCategoryReferenceArticles,
  retrieveReferenceArticles,
  type CategoryReferenceArticle,
  type ReferenceArticle,
} from '../retrieval/retrieve-references.js';
import type { ArticleCategory } from './category-prompt.js';

export type StyleReferenceSource =
  'officer' | 'retrieval' | 'category_fallback' | 'none';

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

export function acceptOfficerReference(
  raw: string | null | undefined,
): StyleReference | null {
  const text = (raw ?? '').trim();
  if (!text) return null;
  return {
    source: 'officer',
    text,
    title: null,
    url: null,
    articleId: null,
    similarity: null,
    chars: text.length,
    // The officer pasted a whole article, headline and all, so there is no separate title to
    // carry — and no second exemplar: their explicit choice is the reference, not one vote in
    // a rotation.
    articles: [{ title: null, text }],
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
): StyleReference | null {
  const usable = (references ?? [])
    .map((reference) => ({ reference, text: reference.text.trim() }))
    .filter(
      ({ reference, text }) =>
        text.length > 0 && reference.similarity >= minSimilarity,
    );

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

type CategoryFallbackCandidate = Readonly<{
  articleId: number;
  title: string;
  url: string;
  text: string;
  similarity?: number | null;
}>;

// Turn weak semantic candidates or non-vector category candidates into prompt exemplars.
// Similarity is retained only when it was genuinely measured; direct category picks report
// null instead of fabricating a score.
export function acceptCategoryFallbackReferences(
  references: readonly (ReferenceArticle | CategoryReferenceArticle)[] | null,
  count = DEFAULT_ARTICLE_COUNT,
): StyleReference | null {
  const usable = (references ?? [])
    .map((reference) => ({
      reference: reference as CategoryFallbackCandidate,
      text: reference.text.trim(),
    }))
    .filter(({ text }) => text.length > 0)
    .slice(0, count);

  const primary = usable[0];
  if (!primary) return null;

  return {
    source: 'category_fallback',
    text: primary.text,
    title: primary.reference.title,
    url: primary.reference.url,
    articleId: primary.reference.articleId,
    similarity: primary.reference.similarity ?? null,
    chars: primary.text.length,
    articles: usable.map(({ reference, text }) => ({
      title: reference.title,
      text,
    })),
  };
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
  // Tier 2 — the closest historical Mahasamvad articles, if they are genuinely close.
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
      '[style-ref] semantic retrieval failed; trying category fallback:',
      error,
    );
  }

  const accepted = acceptRetrievedReferences(retrieved, floor);
  if (accepted) {
    const dropped = retrieved.length - accepted.articles.length;
    console.log(
      `[style-ref] tier 2: ${accepted.articles.length} exemplar(s), primary "${accepted.title}" ` +
        `similarity=${accepted.similarity?.toFixed(3)} (floor ${floor}` +
        `${dropped > 0 ? `, ${dropped} dropped` : ''}) ` +
        `${accepted.articles.reduce((sum, a) => sum + a.text.length, 0)} chars total`,
    );
    return accepted;
  }

  // Tier 3 — the vector RPC timed out/returned nothing, or every semantic candidate missed the
  // floor. Do NOT promote those weak candidates merely because they exist: the larger indexed
  // fallback pool is ranked by meeting/proposal/directive shape and is safer than an off-topic
  // low-similarity article.
  let categoryCandidates: CategoryReferenceArticle[] = [];
  try {
    categoryCandidates = await retrieveCategoryReferenceArticles(
      input.category,
      Math.max(styleReferenceCount() * 2, 6),
      input.note,
      input.preferAttribution ?? false,
    );
  } catch (error) {
    console.warn('[style-ref] category fallback lookup failed:', error);
    return NO_STYLE_REFERENCE;
  }

  const categoryFallback = acceptCategoryFallbackReferences(
    categoryCandidates,
    styleReferenceCount(),
  );
  if (categoryFallback) {
    console.log(
      `[style-ref] tier 3: using ${categoryFallback.articles.length} available ` +
        `${input.category} category fallback(s), primary "${categoryFallback.title}"`,
    );
    return categoryFallback;
  }

  console.warn(
    `[style-ref] no non-empty ${input.category} reference exists; generating without one`,
  );
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
  const longPaste = 'ल'.repeat(25_000);
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
    'a one-character reference is accepted',
    acceptOfficerReference('ल')?.chars === 1,
  );
  check(
    'a long pasted reference is preserved without clipping',
    acceptOfficerReference(longPaste)?.chars === 25_000,
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
    'a long retrieved article is preserved without clipping',
    acceptRetrievedReference(article(0.5, 'क'.repeat(25_000)), 0.35)?.chars ===
      25_000,
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
  check(
    'an empty list is rejected',
    acceptRetrievedReferences([], 0.35) === null,
  );
  check('null is rejected', acceptRetrievedReferences(null, 0.35) === null);
  check(
    'a blank-text leader does not sink the whole list',
    (() => {
      const accepted = acceptRetrievedReferences(
        [
          article(0.8, '   ', 9, 'रिकामे'),
          article(0.5, 'खरा मजकूर', 2, 'दुसरे'),
        ],
        0.35,
      );
      return accepted?.articles.length === 1 && accepted.title === 'दुसरे';
    })(),
  );

  console.log(
    '\n=== weak/category candidates fall back instead of disappearing ===',
  );
  check(
    'weak semantic candidates become a category fallback',
    (() => {
      const accepted = acceptCategoryFallbackReferences(three, 3);
      return (
        accepted?.source === 'category_fallback' &&
        accepted.articles.length === 3 &&
        accepted.title === 'पहिले' &&
        accepted.similarity === 0.61
      );
    })(),
  );
  const categoryOnly: CategoryReferenceArticle[] = [
    {
      articleId: 21,
      title: 'श्रेणीतील पहिले',
      url: 'https://example.test/article/21',
      text: 'क'.repeat(900),
    },
    {
      articleId: 22,
      title: 'श्रेणीतील दुसरे',
      url: 'https://example.test/article/22',
      text: 'ख'.repeat(1200),
    },
  ];
  check(
    'a direct category fallback carries no fabricated similarity',
    (() => {
      const accepted = acceptCategoryFallbackReferences(categoryOnly, 1);
      return (
        accepted?.source === 'category_fallback' &&
        accepted.articles.length === 1 &&
        accepted.title === 'श्रेणीतील पहिले' &&
        accepted.similarity === null
      );
    })(),
  );
  check(
    'a long category fallback is accepted without clipping',
    acceptCategoryFallbackReferences(
      [
        {
          articleId: 23,
          title: 'लांब पण उपलब्ध',
          url: 'https://example.test/article/23',
          text: 'ग'.repeat(25_000),
        },
      ],
      1,
    )?.chars === 25_000,
  );

  console.log(
    '\n=== references have no application-imposed character bound ===',
  );
  check(
    'a 12,550-character news reference is accepted',
    acceptRetrievedReferences(
      [article(0.465, 'क'.repeat(12_550), 7, 'विधानसभा लक्षवेधी')],
      0.35,
    )?.chars === 12_550,
  );
  check(
    'several references are retained regardless of their relative lengths',
    (() => {
      const accepted = acceptRetrievedReferences(
        [
          article(0.465, 'क'.repeat(12_550), 7, 'विधानसभा लक्षवेधी'),
          article(
            0.442,
            'क'.repeat(835),
            8,
            'पुणे रिंग रोडचे काम मुदतीत पूर्ण होणार –',
          ),
        ],
        0.35,
      );
      return accepted?.articles.length === 2;
    })(),
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
  check(
    '0 falls back to the default',
    withCount('0') === DEFAULT_ARTICLE_COUNT,
  );
  check(
    '6 falls back to the default',
    withCount('6') === DEFAULT_ARTICLE_COUNT,
  );
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
