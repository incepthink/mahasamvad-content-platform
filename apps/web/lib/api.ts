// Typed fetch wrappers for the generation API. Responses are validated with the
// shared Zod schemas so the UI never renders shapes the API didn't promise.

import {
  GenerationDetailSchema,
  GenerationSummarySchema,
  type Copy,
  type CreateGenerationRequest,
  type GenerationDetail,
  type GenerationSummary,
  type PosterFeedbackRequest,
} from '@dgipr/schemas';
import { z } from 'zod';

export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:3001';

// Reads the API's { error: { message } } body when present so users see the
// server's reason, not just an HTTP status.
async function requestJson(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...init?.headers,
    },
  });
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
