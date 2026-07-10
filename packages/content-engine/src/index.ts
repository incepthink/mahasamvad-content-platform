import type { ArticleCategory } from './generation/category-prompt.js';

export const CONTENT_ENGINE_PACKAGE = '@dgipr/content-engine';

// Generation pipeline — the entry points the backend API imports.
export {
  generateArticle,
  FACT_CHECK_DELIMITER,
  splitContent,
  type GeneratedArticle,
  type GenerateArticlePhase,
  type GenerateArticleOptions,
} from './generation/generate-article.js';
export { polishArticleWithSarvam } from './generation/polish-article.js';
export { generateCopy } from './generation/generate-copy.js';
export { extractFiveWOneH } from './generation/extract-5w1h.js';
export {
  deriveEditorialBrief,
  type EditorialBrief,
} from './generation/editorial-brief.js';
export {
  reviseArticle,
  type RevisedArticle,
} from './generation/revise-article.js';
export { reviseCopy } from './generation/revise-copy.js';
export { reviseSceneBrief } from './generation/revise-scene.js';
export {
  translateArticleToEnglish,
  type GlossaryEntry,
  type TranslateOptions,
} from './generation/translate-article.js';
export {
  extractGlossaryCandidates,
  type GlossaryCandidate,
} from './generation/extract-entities.js';

export type ContentChunk = Readonly<{
  id: string; // `${articleId}-${chunkIndex}`
  articleId: number;
  chunkIndex: number;
  text: string;
  title: string;
  url: string;
  publishedTime: string | null;
  categories: readonly string[];
  tags: readonly string[];
  // Coarse style bucket (news vs scheme) this chunk is a reference for; scopes retrieval.
  styleCategory: ArticleCategory;
}>;

