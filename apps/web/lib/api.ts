// Typed fetch wrappers for the generation API. Responses are validated with the
// shared Zod schemas so the UI never renders shapes the API didn't promise.

import {
  DloIntakeDetailSchema,
  GenerationDetailSchema,
  GenerationSummarySchema,
  GlossaryTermSchema,
  PrepareTranslationResponseSchema,
  ProofreadResponseSchema,
  PublishGenerationResponseSchema,
  ReferenceImageSchema,
  ReferenceTypeSchema,
  ThreadItemSchema,
  CreateTranslateDocumentResponseSchema,
  InterpretDocumentInstructionResponseSchema,
  TranslateDocumentDetailSchema,
  TranslateTextResponseSchema,
  UpdateCaptionResponseSchema,
  type Copy,
  type CreateGenerationRequest,
  type DloGenerateRequest,
  type DloIntakeDetail,
  type CreateGlossaryTermRequest,
  type CreateReferenceTypeRequest,
  type GenerationDetail,
  type GenerationSummary,
  type GlossaryTerm,
  type PosterFeedbackRequest,
  type PosterImageFeedbackRequest,
  type PrepareTranslationResponse,
  type ProofreadRequest,
  type ProofreadResponse,
  type ReferenceCategory,
  type ReferenceImage,
  type ReferenceType,
  type TermType,
  type ThreadItem,
  type CreateTranslateDocumentResponse,
  type InterpretDocumentInstructionResponse,
  type PrepareDocumentTranslationRequest,
  type TranslateDocumentDetail,
  type TranslateDocumentRequest,
  type TranslateTextRequest,
  type TranslateTextResponse,
  type TranslationLanguage,
  type TranslationTermInput,
  type UpdateGlossaryTermRequest,
  type UpdateReferenceTypeRequest,
  VideoProjectDetailSchema,
  VideoProjectSummarySchema,
  type CreateVideoProjectRequest,
  type RegenerateStillRequest,
  type UpdateVideoScriptRequest,
  type VideoProjectDetail,
  type VideoProjectSummary,
} from '@dgipr/schemas';
import { z } from 'zod';

export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:3001';

// Reads the API's { error: { message } } body when present so users see the
// server's reason, not just an HTTP status.
async function readJsonResponse(response: Response): Promise<unknown> {
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      typeof body === 'object' &&
      body !== null &&
      'error' in body &&
      typeof (body as { error: { message?: unknown } }).error?.message ===
        'string'
        ? (body as { error: { message: string } }).error.message
        : `HTTP ${response.status}`;
    throw new ApiRequestError(message, response.status);
  }
  return body;
}

async function requestJson(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      // Only declare a JSON content-type when we actually send a body.
      // Fastify's JSON parser rejects an empty body when content-type is
      // application/json ("Body cannot be empty..."), which broke bodyless
      // POST/DELETE calls (e.g. reference enable/disable, deletes).
      ...(init?.body != null ? { 'content-type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  return readJsonResponse(response);
}

export class ApiRequestError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function createGeneration(
  input: CreateGenerationRequest,
): Promise<string> {
  const body = await requestJson('/api/generations', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return z.object({ id: z.string() }).parse(body).id;
}

// DLO intake: multipart create (notes/category/heading fields + the uploaded
// files). No content-type header — the browser sets the multipart boundary.
export async function createDloIntake(form: FormData): Promise<string> {
  const response = await fetch(`${API_URL}/api/dlo/intakes`, {
    method: 'POST',
    body: form,
  });
  const body = await readJsonResponse(response);
  return z.object({ id: z.string() }).parse(body).id;
}

// `includeText` is opt-in for the same reason as getTranslateDocument: the payload
// then carries every transcript and PDF page, which the review step needs once and
// the poll behind it does not.
export async function getDloIntake(
  id: string,
  includeText = false,
): Promise<DloIntakeDetail> {
  const body = await requestJson(
    `/api/dlo/intakes/${id}${includeText ? '?text=1' : ''}`,
  );
  return DloIntakeDetailSchema.parse(body);
}

// "Read these pages." The officer's page choice for every scanned PDF in this intake —
// the call that spends OCR credits, bounded to exactly the pages listed. Puts the intake
// back into running so the review step's existing poll picks up the new pages.
export async function extractDloPages(
  id: string,
  selections: Array<{ index: number; pages: number[] }>,
): Promise<void> {
  await requestJson(`/api/dlo/intakes/${id}/extract`, {
    method: 'POST',
    body: JSON.stringify({ selections }),
  });
}

// "The text came out wrong — read this PDF with OCR instead." Puts the intake back
// into running; the existing poll shows the progress and the new pages. Carries the page
// selection for the same reason /translate's override does: re-reading is not a reason to
// re-bill pages the officer excluded.
export async function reextractDloFile(
  id: string,
  index: number,
  pages: number[],
): Promise<void> {
  await requestJson(`/api/dlo/intakes/${id}/files/${index}/reextract`, {
    method: 'POST',
    body: JSON.stringify({ source: 'ocr', pages }),
  });
}

// The review step's submit: the (edited) combined text becomes a normal
// generation on the existing pipeline; returns its id for polling.
export async function generateFromDloIntake(
  id: string,
  input: DloGenerateRequest,
): Promise<string> {
  const body = await requestJson(`/api/dlo/intakes/${id}/generate`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return z.object({ generationId: z.string() }).parse(body).generationId;
}

export async function listGenerations(): Promise<GenerationSummary[]> {
  const body = await requestJson('/api/generations');
  return z.array(GenerationSummarySchema).parse(body);
}

export async function getGeneration(id: string): Promise<GenerationDetail> {
  const body = await requestJson(`/api/generations/${id}`);
  return GenerationDetailSchema.parse(body);
}

// All runs in this generation's thread (root + follow-ups spawned from any
// member's detail page), oldest first. Length 1 = no thread.
export async function getGenerationThread(id: string): Promise<ThreadItem[]> {
  const body = await requestJson(`/api/generations/${id}/thread`);
  return z.array(ThreadItemSchema).parse(body);
}

export async function sendArticleFeedback(
  id: string,
  feedback: string,
): Promise<void> {
  await requestJson(`/api/generations/${id}/article/feedback`, {
    method: 'POST',
    body: JSON.stringify({ feedback }),
  });
}

// AI revision of a social run's caption. The job runs beside anything already in
// flight and reports itself through the detail payload's `captionRevising`, so the
// caller just refreshes to start polling (the row never leaves 'completed').
export async function sendCaptionFeedback(
  id: string,
  feedback: string,
): Promise<void> {
  await requestJson(`/api/generations/${id}/caption/feedback`, {
    method: 'POST',
    body: JSON.stringify({ feedback }),
  });
}

// Hand edit of a social run's caption — stored verbatim, no model call, returns once
// saved.
export async function updateCaption(
  id: string,
  caption: string,
): Promise<string> {
  const body = await requestJson(`/api/generations/${id}/caption`, {
    method: 'PUT',
    body: JSON.stringify({ caption }),
  });
  return UpdateCaptionResponseSchema.parse(body).caption;
}

// Pre-translation name check: the API extracts the article's proper nouns (merged
// with glossary matches) for the user to confirm/correct before translating.
// Synchronous — one OpenAI call, a few seconds.
export async function prepareGenerationTranslation(
  id: string,
): Promise<PrepareTranslationResponse> {
  const body = await requestJson(`/api/generations/${id}/translate/prepare`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
  return PrepareTranslationResponseSchema.parse(body);
}

// Kicks off the on-demand translation into `language` (Sarvam + glossary lockdict).
// `terms` is the user-confirmed name list from the review step — saved as verified
// glossary rows and locked into this run. The job runs beside any job already in flight
// and reports itself through the detail payload's `translating` /
// `translatingLanguage` fields, so the caller just needs to refresh to start polling.
export async function requestTranslation(
  id: string,
  language: TranslationLanguage,
  terms?: readonly TranslationTermInput[],
): Promise<void> {
  await requestJson(`/api/generations/${id}/translate`, {
    method: 'POST',
    body: JSON.stringify(terms ? { language, terms } : { language }),
  });
}

// Attach a poster to an existing article run (same generation row — no new
// run). The route flips the row back to running, so the caller must refresh()
// to restart polling.
export async function requestArticlePoster(
  id: string,
  referenceImageId?: string,
): Promise<void> {
  await requestJson(`/api/generations/${id}/poster`, {
    method: 'POST',
    body: JSON.stringify(referenceImageId ? { referenceImageId } : {}),
  });
}

export async function sendPosterFeedback(
  id: string,
  input: PosterFeedbackRequest,
): Promise<void> {
  await requestJson(`/api/generations/${id}/poster/feedback`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

// Pixel-level edit of the latest complete poster (n8n path). `input` carries
// free text, numbered marker annotations, or both — empty keys must be omitted.
export async function sendPosterImageFeedback(
  id: string,
  input: PosterImageFeedbackRequest,
): Promise<void> {
  await requestJson(`/api/generations/${id}/poster/image-feedback`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updatePosterCopy(
  id: string,
  copy: Copy,
): Promise<string> {
  const body = await requestJson(`/api/generations/${id}/poster/copy`, {
    method: 'PUT',
    body: JSON.stringify(copy),
  });
  return z.object({ posterUrl: z.string() }).parse(body).posterUrl;
}

export function posterDownloadUrl(id: string): string {
  return `${API_URL}/api/generations/${id}/poster.png`;
}

// Posts the poster + caption to the official account of the run's own platform
// (twitter → X, facebook → the Facebook Page). Synchronous (~3-10s); returns the
// live post's URL, which is also persisted on the row as `publishedUrl`.
export async function publishGeneration(id: string): Promise<string> {
  const body = await requestJson(`/api/generations/${id}/publish`, {
    method: 'POST',
  });
  return PublishGenerationResponseSchema.parse(body).postUrl;
}

// Name check for ad-hoc pasted text (same review flow as a generation's article).
export async function prepareTextTranslation(
  text: string,
): Promise<PrepareTranslationResponse> {
  const body = await requestJson('/api/translate/prepare', {
    method: 'POST',
    body: JSON.stringify({ text }),
  });
  return PrepareTranslationResponseSchema.parse(body);
}

// Standalone Marathi->English/Hindi translation of arbitrary pasted text (the target is
// `input.language`). Unlike requestTranslation(), this is synchronous and is not tied to
// a generation.
export async function translateText(
  input: TranslateTextRequest,
): Promise<TranslateTextResponse> {
  const body = await requestJson('/api/translate', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return TranslateTextResponseSchema.parse(body);
}

// ---------- PDF translation (/translate document path) ----------
//
// The job lives in the API's memory only, so every call here can legitimately 404 once
// its TTL passes or the API restarts; the server's Marathi message says so and the UI
// sends the user back to the upload step.

// Uploads one PDF and returns the job id plus what the free probe learned: how many pages
// it has, and whether reading them will cost OCR credits. Nothing has been read yet — the
// page selection at extractDocumentPages decides what gets paid for. No content-type
// header — the browser sets the multipart boundary (same as createDloIntake).
export async function createTranslateDocument(
  form: FormData,
): Promise<CreateTranslateDocumentResponse> {
  const response = await fetch(`${API_URL}/api/translate/documents`, {
    method: 'POST',
    body: form,
  });
  const body = await readJsonResponse(response);
  return CreateTranslateDocumentResponseSchema.parse(body);
}

// "Read these pages." The request that actually spends OCR credits on a scanned document,
// and it spends them only on the pages listed here.
export async function extractDocumentPages(
  id: string,
  pages: number[],
): Promise<void> {
  await requestJson(`/api/translate/documents/${id}/extract`, {
    method: 'POST',
    body: JSON.stringify({ pages }),
  });
}

// `includeText` is opt-in because the payload carries the whole document: poll without it
// and fetch once with it when a phase finishes.
export async function getTranslateDocument(
  id: string,
  includeText = false,
): Promise<TranslateDocumentDetail> {
  const body = await requestJson(
    `/api/translate/documents/${id}${includeText ? '?text=1' : ''}`,
  );
  return TranslateDocumentDetailSchema.parse(body);
}

// "The text came out wrong — read it with OCR instead." Puts the job back into
// extracting; the existing poll shows the progress and the new pages. Carries the page
// selection because overruling the QUALITY gate is not a reason to re-OCR pages the user
// already excluded.
export async function reextractDocument(
  id: string,
  pages: number[],
): Promise<void> {
  await requestJson(`/api/translate/documents/${id}/reextract`, {
    method: 'POST',
    body: JSON.stringify({ source: 'ocr', pages }),
  });
}

// Resolves a free-text instruction ("फक्त पृष्ठ १ ते ९") to page numbers. Structural
// only — it never reaches the translator.
export async function interpretDocumentInstruction(
  id: string,
  instruction: string,
): Promise<InterpretDocumentInstructionResponse> {
  const body = await requestJson(`/api/translate/documents/${id}/interpret`, {
    method: 'POST',
    body: JSON.stringify({ instruction }),
  });
  return InterpretDocumentInstructionResponseSchema.parse(body);
}

// Name check over the selected pages (runs against the job's own text server-side).
export async function prepareDocumentTranslation(
  id: string,
  input: PrepareDocumentTranslationRequest,
): Promise<PrepareTranslationResponse> {
  const body = await requestJson(`/api/translate/documents/${id}/prepare`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return PrepareTranslationResponseSchema.parse(body);
}

// Starts the background translation; the caller keeps polling the job for progress.
export async function startDocumentTranslation(
  id: string,
  input: TranslateDocumentRequest,
): Promise<void> {
  await requestJson(`/api/translate/documents/${id}/translate`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

// Ad-hoc proofread of pasted Marathi/English text. Synchronous (at most two chat
// calls server-side, ~15-45s); nothing is stored.
export async function proofreadText(
  input: ProofreadRequest,
): Promise<ProofreadResponse> {
  const body = await requestJson('/api/proofread', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return ProofreadResponseSchema.parse(body);
}

// ---------- Glossary (Marathi->English name lock dictionary) ----------

export async function listGlossaryTerms(
  params: { verifiedOnly?: boolean; type?: TermType; search?: string } = {},
): Promise<GlossaryTerm[]> {
  const qs = new URLSearchParams();
  if (params.verifiedOnly) qs.set('verifiedOnly', 'true');
  if (params.type) qs.set('type', params.type);
  if (params.search) qs.set('search', params.search);
  const query = qs.toString();
  const body = await requestJson(`/api/glossary${query ? `?${query}` : ''}`);
  return z.array(GlossaryTermSchema).parse(body);
}

export async function createGlossaryTerm(
  input: CreateGlossaryTermRequest,
): Promise<GlossaryTerm> {
  const body = await requestJson('/api/glossary', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return GlossaryTermSchema.parse(body);
}

export async function updateGlossaryTerm(
  id: string,
  patch: UpdateGlossaryTermRequest,
): Promise<GlossaryTerm> {
  const body = await requestJson(`/api/glossary/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  return GlossaryTermSchema.parse(body);
}

export async function deleteGlossaryTerm(id: string): Promise<void> {
  await requestJson(`/api/glossary/${id}`, { method: 'DELETE' });
}

// ---------- Reference type catalog + master-template library ----------

export async function listReferenceTypes(): Promise<ReferenceType[]> {
  const body = await requestJson('/api/reference-types');
  return z.array(ReferenceTypeSchema).parse(body);
}

export async function createReferenceType(
  input: CreateReferenceTypeRequest,
): Promise<ReferenceType> {
  const body = await requestJson('/api/reference-types', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return ReferenceTypeSchema.parse(body);
}

export async function updateReferenceType(
  id: string,
  patch: UpdateReferenceTypeRequest,
): Promise<ReferenceType> {
  const body = await requestJson(`/api/reference-types/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  return ReferenceTypeSchema.parse(body);
}

export async function deleteReferenceType(id: string): Promise<void> {
  await requestJson(`/api/reference-types/${id}`, { method: 'DELETE' });
}

export async function listReferenceImages(): Promise<ReferenceImage[]> {
  const body = await requestJson('/api/references');
  return z.array(ReferenceImageSchema).parse(body);
}

export async function uploadReferenceImage(
  category: ReferenceCategory,
  subtype: string,
  file: File,
): Promise<ReferenceImage> {
  const query = new URLSearchParams({ category, subtype });
  const form = new FormData();
  form.set('file', file);
  const response = await fetch(`${API_URL}/api/references?${query}`, {
    method: 'POST',
    body: form,
  });
  return ReferenceImageSchema.parse(await readJsonResponse(response));
}

// Toggle an image in the per-generation random rotation (many images per type
// may be enabled at once).
export async function setReferenceImageEnabled(
  id: string,
  enabled: boolean,
): Promise<ReferenceImage> {
  const body = await requestJson(
    `/api/references/${id}/${enabled ? 'enable' : 'disable'}`,
    { method: 'POST' },
  );
  return ReferenceImageSchema.parse(body);
}

// Re-read the master's layout from its pixels. The cached spec decides whether the
// poster may contain photography at all, so this is the fix for a stale/wrong read.
export async function analyzeReferenceImage(
  id: string,
): Promise<ReferenceImage> {
  const body = await requestJson(`/api/references/${id}/analyze`, {
    method: 'POST',
  });
  return ReferenceImageSchema.parse(body);
}

// Manual override when the vision pass called the photo zone wrong.
export async function setReferenceImagePhotoZone(
  id: string,
  hasPhotoZone: boolean,
): Promise<ReferenceImage> {
  const body = await requestJson(`/api/references/${id}/layout-spec`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ hasPhotoZone }),
  });
  return ReferenceImageSchema.parse(body);
}

export async function deleteReferenceImage(id: string): Promise<void> {
  await requestJson(`/api/references/${id}`, { method: 'DELETE' });
}

// ---------- explainer videos (/video) ----------

export async function createVideoProject(
  input: CreateVideoProjectRequest,
): Promise<string> {
  const body = await requestJson('/api/video/projects', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return z.object({ id: z.string() }).parse(body).id;
}

export async function listVideoProjects(): Promise<VideoProjectSummary[]> {
  const body = await requestJson('/api/video/projects');
  return z.array(VideoProjectSummarySchema).parse(body);
}

export async function getVideoProject(id: string): Promise<VideoProjectDetail> {
  const body = await requestJson(`/api/video/projects/${id}`);
  return VideoProjectDetailSchema.parse(body);
}

// Gate 1's save: the reviewed scene list, synchronous. A scene whose visual
// brief changed goes back to pending (its still no longer matches the ask).
export async function saveVideoScript(
  id: string,
  input: UpdateVideoScriptRequest,
): Promise<VideoProjectDetail> {
  const body = await requestJson(`/api/video/projects/${id}/script`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
  return VideoProjectDetailSchema.parse(body);
}

// Renders keyframe stills for every scene that lacks a current one (cents, not
// dollars — the cheap preview gate before any Veo spend).
export async function startVideoStoryboard(id: string): Promise<void> {
  await requestJson(`/api/video/projects/${id}/storyboard`, {
    method: 'POST',
  });
}

// One scene's still, re-drawn; an edited brief rides along.
export async function regenerateVideoStill(
  id: string,
  index: number,
  input: RegenerateStillRequest = {},
): Promise<void> {
  await requestJson(`/api/video/projects/${id}/scenes/${index}/still`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

// THE spend call: Veo-animates every scene from its approved still. On a retry
// after a partial failure only the missing scenes render again.
export async function startVideoAnimation(id: string): Promise<void> {
  await requestJson(`/api/video/projects/${id}/animate`, { method: 'POST' });
}

// Post-render fix: re-animate ONE scene and restitch; the previous video stays
// playable throughout.
export async function reanimateVideoScene(
  id: string,
  index: number,
): Promise<void> {
  await requestJson(`/api/video/projects/${id}/scenes/${index}/animate`, {
    method: 'POST',
  });
}

// Add (or refresh) the Marathi TTS narration on a completed video and re-stitch.
export async function narrateVideo(id: string): Promise<void> {
  await requestJson(`/api/video/projects/${id}/narrate`, { method: 'POST' });
}
