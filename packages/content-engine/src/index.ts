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
export {
  generateSocialCaption,
  type GenerateCaptionInput,
} from './generation/generate-caption.js';
export {
  reviseCaption,
  type ReviseCaptionInput,
} from './generation/revise-caption.js';
export { reviseCopy } from './generation/revise-copy.js';
export { reviseSceneBrief } from './generation/revise-scene.js';
export {
  interpretImageFeedback,
  type FeedbackAnnotationInput,
  type InterpretImageFeedbackInput,
  type InterpretedImageFeedback,
} from './generation/interpret-image-feedback.js';
export {
  translateArticle,
  type GlossaryEntry,
  type TranslateOptions,
  type TranslationResult,
} from './generation/translate-article.js';
// Page-wise translation of an uploaded PDF (/translate document path): keeps page
// boundaries, passes English pages through for an English target, and routes them
// en→hi for a Hindi one.
export {
  translateDocumentPages,
  joinTranslatedPages,
  detectPageLanguage,
  type DocumentPageInput,
  type TranslatedDocumentPage,
  type TranslateDocumentOptions,
} from './generation/translate-document.js';
export {
  interpretDocumentInstruction,
  parsePageInstruction,
  INSTRUCTION_MAX_CHARS,
  type DocumentPageSummary,
  type InterpretedDocumentInstruction,
} from './generation/interpret-document-instruction.js';
export {
  extractGlossaryCandidates,
  type GlossaryCandidate,
} from './generation/extract-entities.js';
export {
  proofreadText,
  detectProofreadLanguage,
  type ProofreadGlossaryTerm,
  type ProofreadResult,
} from './generation/proof-read.js';

// DLO intake — Sarvam batch STT + document digitization + DOCX extraction. The
// combiner that assembles the reviewable Marathi text is in @dgipr/schemas: the
// web rebuilds the same string from the officer's edits, and cannot import this
// package.
export {
  transcribeAudioFiles,
  type AudioFileInput,
  type AudioTranscription,
} from './intake/sarvam-stt.js';
export {
  extractPdfPages,
  extractPdfPagesDetailed,
  probePdf,
  type PdfExtraction,
  type PdfProbe,
} from './intake/pdf-pages.js';
export {
  type PdfPage,
  type PdfTextSource,
  type ExtractPdfOptions,
} from './intake/pdf-shared.js';
export { countPdfPages, OCR_MAX_TOTAL_PAGES } from './intake/pdf-split.js';
export { extractDocxText } from './intake/docx.js';
export { extractTextFile } from './intake/text-file.js';
// The kind-agnostic entry point every upload surface should use: probe for free, then
// read only what the user selected. Wraps the PDF policy above rather than replacing it.
export {
  documentKindOf,
  extractDocument,
  probeDocument,
  type DocumentExtraction,
  type DocumentKind,
  type DocumentPage,
  type DocumentProbe,
  type DocumentTextSource,
  type ExtractDocumentOptions,
} from './intake/document.js';

// Explainer-video pipeline: per-scene script (gate 1), keyframe/motion prompt
// builders, and the Veo clip client. ffmpeg assembly lives in
// @dgipr/poster-renderer; the SRT builder + tier pricing in @dgipr/schemas.
export {
  generateVideoScript,
  type GeneratedVideoScript,
  type VideoScriptScene,
  type VideoScriptOptions,
} from './video/generate-video-script.js';
export {
  planVideoScenes,
  type VideoScenePlan,
  type VideoScenePlanScene,
  type VideoScenePlanOptions,
} from './video/plan-video-scenes.js';
export {
  buildKeyframePrompt,
  buildVeoMotionPrompt,
  VEO_NEGATIVE_PROMPT,
} from './video/video-prompts.js';
export {
  generateVeoClip,
  type VeoClipInput,
  type VeoTier,
  type VeoAspectRatio,
  type VeoDurationSeconds,
} from './video/veo-client.js';
export {
  synthesizeMarathiNarration,
  ttsModel,
  ttsSpeaker,
  type NarrationOptions,
} from './video/sarvam-tts.js';

// Cost metering — the runner opens a scope per job and reads the accumulator back.
export {
  createCostAccumulator,
  runInCostScope,
  recordImageCost,
  recordVideoCost,
  recordTtsCost,
  totalCostUsd,
  type CostAccumulator,
} from './cost/cost-meter.js';
export {
  priceText,
  estimateImageCostUsd,
  estimateVideoCostUsd,
  estimateTtsCostUsd,
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
// Reference-template resolution for the social + article render paths. Classification, copy
// and prompt-building now run in the API (see below); the master is chosen content-aware.
export {
  listSocialTypes,
  pickArticleReference,
  resolveCmoReference,
  resolvePinnedImage,
  resolvePinnedType,
  masterUrl,
  type SocialTypeInfo,
  type ResolvedType,
  type ResolvedReference,
} from './references/catalog.js';
export {
  selectMaster,
  scoreMaster,
  type MasterNeed,
  type SelectedMaster,
} from './references/select-master.js';
// Social poster classify → copy → image-prompt, ported from the n8n workflow into code.
export {
  classifyPosterType,
  POSTER_COPY_MODEL,
  type PosterTypeOption,
  type PosterClassification,
} from './generation/classify-poster-type.js';
export {
  generatePosterCopy,
  type PosterCopy,
  type GeneratePosterCopyInput,
  type GeneratePosterCopyResult,
  type TemplateBrand as PosterTemplateBrand,
} from './generation/generate-poster-copy.js';
export {
  buildPosterPrompt,
  buildFeedbackPrompt,
  type DesignMode as PosterDesignMode,
  type BuildPosterPromptInput,
  type BuildFeedbackPromptInput,
} from './generation/build-poster-prompt.js';
// Per-run AI art direction: the colours/background/composition the fully-AI-generated poster
// uses, so every render looks different (the master is only a loose structural idea).
export {
  generateArtDirection,
  type ArtDirection,
  type GenerateArtDirectionInput,
} from './generation/art-direction.js';
// Curated palette library + seeded recency-aware picker: anchors each fully-AI-generated poster
// to a distinct colour family so consecutive renders don't converge on the saffron/cream default.
export {
  POSTER_PALETTES,
  PALETTE_FAMILIES,
  pickPalette,
  paletteById,
  type PosterPalette,
  type PaletteFamily,
  type PaletteAvoid,
} from './generation/poster-palettes.js';
// The second diversity axis: which COMPOSITION a poster is built to. Rotated independently of
// colour, because two posters in different palettes still read alike when both are a top band
// over a column of bullet rows.
export {
  POSTER_LAYOUTS,
  pickLayout,
  layoutById,
  type PosterLayout,
  type LayoutCoverage,
  type LayoutNeed,
  type LayoutAvoid,
} from './generation/poster-layouts.js';
// What one run was assigned + what its render measured (generations.poster_style, migration
// 0028), and the reader that turns the last few rows into the pickers' avoid sets.
export {
  buildPosterStyle,
  parsePosterStyle,
  toStyleHistory,
  describePosterStyle,
  posterStyleLabel,
  familyHonoured,
  FAMILY_HUES,
  EMPTY_STYLE_HISTORY,
  type PosterStyle,
  type StyleHistory,
  type MeasuredColours,
} from './generation/poster-style.js';
// Removes colour language from a master's layout description before it is used as structure
// inspiration, so the master library's saffron/cream house look cannot leak past the assigned
// palette. Deterministic — "structural, not instructed".
export { stripColourMentions } from './generation/strip-colour-words.js';
export {
  lockSchemeNames,
  validateDeclaredSchemeNames,
  type SchemeLockResult,
} from './generation/lock-scheme-names.js';
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
