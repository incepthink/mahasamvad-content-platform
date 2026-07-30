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
// The simplified single-call generator (ARTICLE_GENERATION_MODE=simple, the default) and the
// style-reference resolver it is built on. The full pipeline above is untouched and stays
// reachable through the same env var.
export {
  generateArticleSimple,
  articlePromptVariant,
  type ArticlePromptVariant,
  type SimpleGeneratedArticle,
  type SimpleGenerateArticleOptions,
  type SimpleArticlePhase,
  type StyleReferenceMeta,
} from './generation/generate-article-simple.js';
export {
  selectStyleReference,
  styleReferenceMinSimilarity,
  type StyleReference,
  type StyleReferenceSource,
} from './generation/select-style-reference.js';
export {
  SIMPLE_ARTICLE_PROMPT_VERSION,
  type ArticleNameEntry,
} from './generation/simple-article-prompt.js';
export { MINIMAL_ARTICLE_PROMPT_VERSION } from './generation/minimal-article-prompt.js';
export {
  currentArticleDateline,
  ensureArticleDateline,
  DEFAULT_NEWS_DATELINE_LOCATION,
  NEWS_DATELINE_TIME_ZONE,
  type ArticleDateline,
} from './generation/article-dateline.js';
export { polishArticleWithSarvam } from './generation/polish-article.js';
export { generateCopy } from './generation/generate-copy.js';
export { extractFiveWOneH } from './generation/extract-5w1h.js';
export { extractPointers } from './generation/extract-pointers.js';
// Person → पदनाम: the deterministic pass that guarantees an officer-approved designation
// reaches the published article, plus its result/issue shapes.
export {
  applyDesignations,
  type NameDesignation,
  type DesignationIssue,
  type DesignationResult,
} from './generation/apply-designations.js';
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
// builders, and the clip clients (Veo and Kling, behind clip-provider).
// ffmpeg assembly lives in @dgipr/poster-renderer; the SRT builder + tier
// pricing in @dgipr/schemas.
export {
  generateVideoScript,
  type GeneratedVideoScript,
  type VideoScriptScene,
  type VideoScriptOptions,
} from './video/generate-video-script.js';
export {
  planReadyVideoScript,
  splitReadyVideoScript,
} from './video/plan-ready-video-script.js';
export {
  planVideoScenes,
  type VideoScenePlan,
  type VideoScenePlanScene,
  type VideoScenePlanOptions,
} from './video/plan-video-scenes.js';
export {
  directVideoMotion,
  type DirectVideoMotionInput,
  type VideoMotionDirection,
  type VideoMotionSceneInput,
} from './video/direct-video-motion.js';
export {
  buildKeyframePrompt,
  buildEndFramePrompt,
  buildClipMotionPrompt,
  buildAvoidClause,
  fitClipPrompt,
  CLIP_NEGATIVE_PROMPT,
} from './video/video-prompts.js';
export {
  generateVeoClip,
  type VeoClipInput,
  type VeoTier,
  type VeoAspectRatio,
  type VeoDurationSeconds,
} from './video/veo-client.js';
export {
  generateKlingClip,
  klingModel,
  klingResolution,
  type KlingClipInput,
  type KlingTier,
  type KlingAspectRatio,
  type KlingResolution,
} from './video/kling-client.js';
export {
  renderClip,
  clipProviderName,
  clipProviderApiKeyEnv,
  type ClipRenderInput,
} from './video/clip-provider.js';
export {
  generateGeminiImage,
  geminiImageModel,
  type GeminiImageInput,
  type GeminiImageAspect,
} from './video/gemini-image-client.js';
export {
  renderFrame,
  frameProviderApiKeyEnv,
  type FrameRenderInput,
  type FrameAspect,
} from './video/frame-provider.js';
export {
  synthesizeMarathiNarration,
  ttsModel,
  ttsSpeaker,
  type NarrationOptions,
} from './video/sarvam-tts.js';
export {
  shortenContinuousNarration,
  shortenNarration,
  type ContinuousNarrationScene,
  type ShortenNarrationOptions,
} from './video/shorten-narration.js';

// Cost metering — the runner opens a scope per job and reads the accumulator back.
export {
  createCostAccumulator,
  runInCostScope,
  recordImageCost,
  recordGeminiImageCost,
  recordVideoCost,
  recordTtsCost,
  totalCostUsd,
  type CostAccumulator,
} from './cost/cost-meter.js';
export {
  priceText,
  estimateImageCostUsd,
  estimateGeminiImageCostUsd,
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
  overrideReferenceImageLayoutSpec,
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
  resolveSocialReferenceByInformation,
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
// Information-first reference selection: the raw note is matched against the whole enabled
// library before anything about the note is predicted (see the module header).
export {
  rankReferenceByInformation,
  selectReferenceByInformation,
  type InformationCandidate,
  type InformationRanking,
  type SelectedByInformation,
} from './references/select-by-information.js';
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
// The LANDSCAPE composition rotation for article posters — the article twin of POSTER_LAYOUTS.
// A separate library because the canvas, the copy shape (one headline, no body list) and the
// reserved zones all differ; the colour palettes above are shared verbatim.
export {
  ARTICLE_POSTER_LAYOUTS,
  pickArticleLayout,
  articleLayoutById,
  type ArticlePosterLayout,
  type ArticleLayoutNeed,
  type ArticleLayoutAvoid,
} from './generation/article-poster-layouts.js';
// The article poster's image prompts, moved out of the n8n `Build Prompt` Code node so the
// reserved-zone geometry lives beside the chrome overlay it must stay in sync with.
export {
  buildArticlePosterPrompt,
  buildArticleFeedbackPrompt,
  type ArticleDesignMode,
  type BuildArticlePosterPromptInput,
  type BuildArticleFeedbackPromptInput,
} from './generation/build-article-poster-prompt.js';
// Does the news have a NAMED SUBJECT — a scheme, award, campaign, service, portal or project?
// If so the poster's entire text is that name, in full. The model only nominates and must cite
// the sentence it read it from; a deterministic verbatim check decides.
export {
  resolvePosterSubject,
  validatePosterSubject,
  isProminent,
  stripEdgePunctuation,
  SUBJECT_KINDS,
  type PosterSubject,
  type SubjectKind,
} from './generation/resolve-poster-subject.js';

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
