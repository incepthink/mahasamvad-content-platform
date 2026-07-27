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
  STYLE_REFERENCE_MAX_CHARS,
  STYLE_REFERENCE_MIN_CHARS,
} from '@dgipr/schemas';
import { pathToFileURL } from 'node:url';
import {
  retrieveReferenceArticle,
  type ReferenceArticle,
} from '../retrieval/retrieve-references.js';
import type { ArticleCategory } from './category-prompt.js';

export type StyleReferenceSource = 'officer' | 'retrieval' | 'none';

export type StyleReference = Readonly<{
  source: StyleReferenceSource;
  // What actually goes into the prompt. Empty string when source === 'none'.
  text: string;
  title: string | null;
  url: string | null;
  articleId: number | null;
  // Cosine similarity of the retrieved article's best chunk. Null for 'officer' (nothing was
  // matched) and 'none'. Persisted, so the floor below can be calibrated from real runs.
  similarity: number | null;
  chars: number;
}>;

export const NO_STYLE_REFERENCE: StyleReference = {
  source: 'none',
  text: '',
  title: null,
  url: null,
  articleId: null,
  similarity: null,
  chars: 0,
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
  };
}

// Apply the floor to a retrieval hit. Split out from selectStyleReference so the decision is
// testable without a database or an embedding call.
export function acceptRetrievedReference(
  reference: ReferenceArticle | null,
  minSimilarity: number,
): StyleReference | null {
  if (!reference) return null;
  const text = reference.text.trim();
  if (text.length === 0) return null;
  if (reference.similarity < minSimilarity) return null;
  const clipped = text.slice(0, STYLE_REFERENCE_MAX_CHARS);
  return {
    source: 'retrieval',
    text: clipped,
    title: reference.title,
    url: reference.url,
    articleId: reference.articleId,
    similarity: reference.similarity,
    chars: clipped.length,
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
  if ((input.officerReference ?? '').trim().length > 0) {
    console.log(
      `[style-ref] officer reference too short (< ${STYLE_REFERENCE_MIN_CHARS} chars); falling through to retrieval`,
    );
  }

  // Tier 2 — the closest historical Mahasamvad article, if it is genuinely close. Retrieval
  // failure is not fatal: a missing style reference produces a DGIPR-styled article from the
  // prompt's own rules, which is tier 3 and a perfectly good outcome.
  const floor = styleReferenceMinSimilarity();
  let retrieved: ReferenceArticle | null = null;
  try {
    retrieved = await retrieveReferenceArticle(
      input.note,
      input.category,
      input.heading,
      input.preferAttribution ?? false,
    );
  } catch (error) {
    console.warn(
      '[style-ref] retrieval failed; continuing without a style reference:',
      error,
    );
    return NO_STYLE_REFERENCE;
  }

  const accepted = acceptRetrievedReference(retrieved, floor);
  if (accepted) {
    console.log(
      `[style-ref] tier 2: "${accepted.title}" similarity=${accepted.similarity?.toFixed(3)} ` +
        `(floor ${floor}) ${accepted.chars} chars`,
    );
    return accepted;
  }

  // Tier 3 — say WHY, so a corpus gap looks like a corpus gap rather than a silent behaviour
  // change. This log plus style_reference_meta is how the floor gets calibrated.
  if (retrieved) {
    console.log(
      `[style-ref] tier 3: best match "${retrieved.title}" similarity=${retrieved.similarity.toFixed(3)} ` +
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
  ): ReferenceArticle => ({
    articleId: 42,
    title: 'नमुना महासंवाद लेख',
    url: 'https://example.test/article/42',
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
