// Typed fetch wrappers for the generation API. Responses are validated with the
// shared Zod schemas so the UI never renders shapes the API didn't promise.

import {
  DloIntakeDetailSchema,
  GenerationDetailSchema,
  GenerationSummarySchema,
  GlossaryTermSchema,
  PrepareTranslationResponseSchema,
  ReferenceImageSchema,
  ReferenceTypeSchema,
  ThreadItemSchema,
  TranslateTextResponseSchema,
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
  type ReferenceCategory,
  type ReferenceImage,
  type ReferenceType,
  type TermType,
  type ThreadItem,
  type TranslateTextRequest,
  type TranslateTextResponse,
  type TranslationTermInput,
  type UpdateGlossaryTermRequest,
  type UpdateReferenceTypeRequest,
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

export async function getDloIntake(id: string): Promise<DloIntakeDetail> {
  const body = await requestJson(`/api/dlo/intakes/${id}`);
  return DloIntakeDetailSchema.parse(body);
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

// Kicks off the on-demand English translation (Sarvam + glossary lockdict). `terms`
// is the user-confirmed name list from the review step — saved as verified glossary
// rows and locked into this run. The job runs beside any job already in flight and
// reports itself through the detail payload's `translating` flag, so the caller just
// needs to refresh to start polling.
export async function requestTranslation(
  id: string,
  terms?: readonly TranslationTermInput[],
): Promise<void> {
  await requestJson(`/api/generations/${id}/translate`, {
    method: 'POST',
    body: JSON.stringify(terms ? { terms } : {}),
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

// Standalone Marathi->English translation of arbitrary pasted text. Unlike
// requestTranslation(), this is synchronous and is not tied to a generation.
export async function translateText(
  input: TranslateTextRequest,
): Promise<TranslateTextResponse> {
  const body = await requestJson('/api/translate', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return TranslateTextResponseSchema.parse(body);
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
