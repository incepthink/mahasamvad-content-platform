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
  interpretImageFeedback,
  type FeedbackAnnotationInput,
  type InterpretImageFeedbackInput,
  type InterpretedImageFeedback,
} from './generation/interpret-image-feedback.js';
export {
  translateArticleToEnglish,
  type GlossaryEntry,
  type TranslateOptions,
} from './generation/translate-article.js';
export {
  extractGlossaryCandidates,
  type GlossaryCandidate,
} from './generation/extract-entities.js';

// DLO intake — Sarvam batch STT + document digitization + DOCX extraction, and
// the combiner that builds the reviewable Marathi text from all sources.
export {
  transcribeAudioFiles,
  type AudioFileInput,
  type AudioTranscription,
} from './intake/sarvam-stt.js';
export { extractPdfText } from './intake/sarvam-doc.js';
export { extractDocxText } from './intake/docx.js';
export {
  combineIntakeSources,
  type IntakeSource,
} from './intake/combine.js';

// Cost metering — the runner opens a scope per job and reads the accumulator back.
export {
  createCostAccumulator,
  runInCostScope,
  recordImageCost,
  totalCostUsd,
  type CostAccumulator,
} from './cost/cost-meter.js';
export {
  priceText,
  estimateImageCostUsd,
  type ImageKind,
  type ImageQuality,
} from './cost/pricing.js';

// Reference-image library (enabled-rotation semantics) + type catalog.
export {
  ACCEPTED_UPLOAD_MIME_TYPES,
  MASTER_DIMENSIONS,
  deleteReferenceImage,
  listReferenceLibrary,
  normalizeReferenceImage,
  overrideReferenceImagePhotoZone,
  reanalyzeReferenceImage,
  setReferenceImageEnabled,
  uploadReferenceImage,
} from './references/reference-images.js';
// The master's layout, read off its pixels — what tells the n8n image prompt
// whether the template has a photo zone at all.
export {
  analyzeReferenceTemplate,
  type ReferenceLayoutSpec,
} from './references/analyze-template.js';
export {
  createReferenceType,
  deleteReferenceType,
  listReferenceTypes,
  updateReferenceType,
} from './references/reference-types.js';
// Per-generation catalog sent to the n8n workflows in the webhook payload.
export {
  buildTwitterCatalog,
  pickArticleReference,
  resolvePinnedReference,
  resolvePinnedTypeReference,
  type PinnedReference,
  type ReferenceCatalogEntry,
} from './references/catalog.js';
// Rotating color palette for the article poster's headline panel (Part 2 of the
// "stop always-orange posters" work); the picked theme is shipped to n8n.
export {
  ARTICLE_POSTER_THEMES,
  pickArticlePosterTheme,
  type ArticlePosterTheme,
} from './references/article-poster-theme.js';

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
