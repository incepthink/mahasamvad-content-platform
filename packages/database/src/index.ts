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
  type ChunkRow,
  type MatchRow,
  type ArticleChunkRow,
} from './mahasamvad-chunks.js';
export {
  GENERATIONS_TABLE,
  GENERATION_REVISIONS_TABLE,
  insertGeneration,
  updateGeneration,
  getGeneration,
  listGenerations,
  insertRevision,
  listRevisions,
  type OutputType,
  type GenerationStatus,
  type GenerationRow,
  type GenerationPatch,
  type RevisionTarget,
  type RevisionRow,
  type NewRevision,
} from './generations.js';
export {
  POSTERS_BUCKET,
  uploadPng,
  publicUrl,
  downloadPng,
} from './storage.js';
