export const DATABASE_PACKAGE = '@dgipr/database';

export type DatabaseIdentifier = Readonly<{
  id: string;
}>;

export { createServiceRoleClient } from './client.js';
// Re-exported so dependents can type client parameters without depending on
// @supabase/supabase-js directly.
export type { SupabaseClient } from '@supabase/supabase-js';
export {
  MAHASAMVAD_CHUNKS_TABLE,
  upsertChunks,
  matchChunks,
  fetchArticleChunks,
  fetchExistingArticleIds,
  type ChunkRow,
  type MatchRow,
  type ArticleChunkRow,
} from './mahasamvad-chunks.js';
export {
  GENERATIONS_TABLE,
  GENERATION_REVISIONS_TABLE,
  insertGeneration,
  updateGeneration,
  addGenerationCost,
  getGeneration,
  listGenerations,
  insertRevision,
  listRevisions,
  type Category,
  type DesignMode,
  type OutputType,
  type GenerationStatus,
  type GenerationRow,
  type GenerationPatch,
  type GenerationCostBreakdown,
  type GenerationCostIncrement,
  type RevisionTarget,
  type RevisionRow,
  type NewRevision,
} from './generations.js';
export {
  GLOSSARY_TERMS_TABLE,
  listGlossaryTerms,
  findGlossaryTermsInText,
  insertGlossaryCandidates,
  upsertGlossaryTerm,
  updateGlossaryTerm,
  deleteGlossaryTerm,
  type TermType,
  type TermSource,
  type GlossaryTerm,
  type NewGlossaryTerm,
  type GlossaryTermPatch,
} from './glossary.js';
export {
  POSTERS_BUCKET,
  uploadPng,
  publicUrl,
  downloadPng,
  removeObjects,
} from './storage.js';
export {
  REFERENCE_IMAGES_TABLE,
  listReferenceImageRows,
  getReferenceImageRow,
  insertReferenceImageRow,
  setReferenceImageActive,
  deleteReferenceImageRow,
  type ReferenceCategory,
  type ReferenceSubtype,
  type ReferenceImageRow,
} from './reference-images.js';
export {
  REFERENCE_TYPES_TABLE,
  listReferenceTypeRows,
  getReferenceTypeRow,
  findReferenceTypeRow,
  insertReferenceTypeRow,
  updateReferenceTypeRow,
  deleteReferenceTypeRow,
  type CopyStyle,
  type ReferenceTypeRow,
  type ReferenceTypePatch,
} from './reference-types.js';
