// The new /dlo lane's API client.
//
// Four calls, and the shape of the list is the point: create, poll, names, generate. The old
// lane needs eleven — probe a document, list its pages, extract the chosen ones, re-extract
// with OCR, save the review state, fetch the heavy per-source text, and so on — because the
// officer is working on transcribed text there. Here the documents go to the model as files,
// so none of that exists to be called.
//
// It reuses `getDloIntake` for the poll rather than adding a route: the intake row is the
// same row, and the detail payload already carries everything this lane shows (the status,
// the per-file entries and their failures). It is fetched WITHOUT `?text=1`, because there is
// no per-source text to display — that flag exists for the old review step.

import { z } from 'zod';
import {
  PrepareDesignationsResponseSchema,
  type NameDesignation,
  type PrepareDesignationsResponse,
} from '@dgipr/schemas';
import { API_URL, ApiRequestError } from './api';

async function readJson(response: Response): Promise<unknown> {
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

/**
 * Step 1. Multipart, and no content-type header — the browser sets the boundary.
 *
 * Every file goes on the one `files` field, whatever it is: the route classifies by extension
 * and there is no longer a reason for the client to know which sources are read by the model
 * and which are transcribed. That is exactly the distinction the old lane made the officer
 * see, in the form of two separate pickers and a page-selection step.
 */
export async function createNewDloIntake(form: FormData): Promise<string> {
  const response = await fetch(`${API_URL}/api/new-dlo/intakes`, {
    method: 'POST',
    body: form,
  });
  return z.object({ id: z.string() }).parse(await readJson(response)).id;
}

/**
 * Step 2. PAID — one model call that reads the attached documents — which is why it is a POST
 * and why the caller must fire it once rather than on every render.
 */
export async function prepareNewDloNames(
  id: string,
): Promise<PrepareDesignationsResponse> {
  const response = await fetch(`${API_URL}/api/new-dlo/intakes/${id}/names`, {
    method: 'POST',
  });
  return PrepareDesignationsResponseSchema.parse(await readJson(response));
}

export type NewDloGenerateInput = Readonly<{
  heading?: string;
  instructions?: string;
  styleReference?: string;
  designations?: readonly NameDesignation[];
}>;

/**
 * Step 3. Returns the id of an ORDINARY generation row, so the caller navigates to the
 * existing detail page and every downstream feature — feedback, translation, the PDF export,
 * attaching a poster — works with no knowledge of which lane produced it.
 */
export async function generateFromNewDloIntake(
  id: string,
  input: NewDloGenerateInput = {},
): Promise<string> {
  const response = await fetch(
    `${API_URL}/api/new-dlo/intakes/${id}/generate`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    },
  );
  return z.object({ generationId: z.string() }).parse(await readJson(response))
    .generationId;
}

/** Drops one attached source, and the OpenAI upload behind it, before generating. */
export async function removeNewDloFile(
  id: string,
  index: number,
): Promise<void> {
  const response = await fetch(
    `${API_URL}/api/new-dlo/intakes/${id}/files/${index}`,
    { method: 'DELETE' },
  );
  if (!response.ok) await readJson(response);
}
