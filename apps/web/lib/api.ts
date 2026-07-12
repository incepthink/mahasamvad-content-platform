// Typed fetch wrappers for the generation API. Responses are validated with the
// shared Zod schemas so the UI never renders shapes the API didn't promise.

import {
  GenerationDetailSchema,
  GenerationSummarySchema,
  GlossaryTermSchema,
  ReferenceImageSchema,
  ReferenceTypeSchema,
  TranslateTextResponseSchema,
  type Copy,
  type CreateGenerationRequest,
  type CreateGlossaryTermRequest,
  type CreateReferenceTypeRequest,
  type GenerationDetail,
  type GenerationSummary,
  type GlossaryTerm,
  type PosterFeedbackRequest,
  type ReferenceCategory,
  type ReferenceImage,
  type ReferenceType,
  type TermType,
  type TranslateTextRequest,
  type TranslateTextResponse,
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

export async function listGenerations(): Promise<GenerationSummary[]> {
  const body = await requestJson('/api/generations');
  return z.array(GenerationSummarySchema).parse(body);
}

export async function getGeneration(id: string): Promise<GenerationDetail> {
  const body = await requestJson(`/api/generations/${id}`);
  return GenerationDetailSchema.parse(body);
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

// Kicks off the on-demand English translation (Sarvam + glossary lockdict). The
// API flips the row to running/step 'translate' before returning, so the caller
// just needs to refresh to start polling.
export async function requestTranslation(id: string): Promise<void> {
  await requestJson(`/api/generations/${id}/translate`, {
    method: 'POST',
    body: JSON.stringify({}),
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

export async function deleteReferenceImage(id: string): Promise<void> {
  await requestJson(`/api/references/${id}`, { method: 'DELETE' });
}
