// Map a scraped Mahasamvad post to a coarse style bucket ('news' | 'scheme') from its
// WordPress categories. Retrieval is scoped by this bucket (see retrieve-references.ts /
// match_mahasamvad_chunks), so it decides which pool a chunk joins at query time.
//
// The site is overwhelmingly straight news (reports, district वार्ता, assembly-session
// coverage, elections, interview programs). A small set of categories are instead
// feature / explainer / scheme writing — the style the 'scheme' generation path wants as
// reference. We treat those as 'scheme' and everything else as 'news'. Exact-name matching
// (not keyword/fuzzy) keeps this predictable and easy to extend as new campaigns appear.

import type { MahasamvadPost } from './mahasamvad-rest.js';
import type { ArticleCategory } from '../generation/category-prompt.js';

// WordPress category names whose posts read as feature/explainer/scheme articles rather
// than hard news. Kept deliberately high-precision; add names here as new scheme campaigns
// or feature sections are created on the site.
//   विशेष लेख     — feature / explainer articles (incl. many yojana explainers)
//   कर्जमुक्ती २०२६ — the loan-waiver scheme campaign (the original 'scheme' seed)
//   लोकराज्य       — Lokrajya, DGIPR's monthly magazine long-form features
export const SCHEME_CATEGORY_NAMES: ReadonlySet<string> = new Set([
  'विशेष लेख',
  'कर्जमुक्ती २०२६',
  'लोकराज्य',
]);

// A post belongs to the 'scheme' bucket if ANY of its categories is a scheme/feature
// category; otherwise it is 'news'. The feature nature dominates for style purposes even
// when the post is also cross-posted into a district/news category.
export function deriveStyleCategory(post: MahasamvadPost): ArticleCategory {
  for (const name of post.categories) {
    if (SCHEME_CATEGORY_NAMES.has(name)) return 'scheme';
  }
  return 'news';
}
