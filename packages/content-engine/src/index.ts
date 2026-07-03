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
export { generateCopy } from './generation/generate-copy.js';
export {
  reviseArticle,
  type RevisedArticle,
} from './generation/revise-article.js';
export { reviseCopy } from './generation/revise-copy.js';
export { reviseSceneBrief } from './generation/revise-scene.js';

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
}>;

