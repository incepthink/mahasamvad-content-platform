// Typed fetch wrappers for the generation API. Responses are validated with the
// shared Zod schemas so the UI never renders shapes the API didn't promise.

import {
  AnalyticsResponseSchema,
  type AnalyticsRange,
  type AnalyticsResponse,
  DloIntakeDetailSchema,
  DloIntakeListResponseSchema,
  DloReviewPatchResponseSchema,
  GenerationDetailSchema,
  GenerationSummarySchema,
  GlossaryListResponseSchema,
  GlossaryTermSchema,
  PrepareDesignationsResponseSchema,
  PrepareTranslationResponseSchema,
  ProofreadResponseSchema,
  PublishGenerationResponseSchema,
  ReferenceImageSchema,
  VerifyNameResponseSchema,
  ReferenceTypeSchema,
  ThreadItemSchema,
  CreateDocumentResponseSchema,
  DocumentDetailSchema,
  type CreateDocumentResponse,
  type DocumentDetail,
  CreateTranslateDocumentResponseSchema,
  InterpretDocumentInstructionResponseSchema,
  TranslateDocumentDetailSchema,
  TranslateTextResponseSchema,
  UpdateCaptionResponseSchema,
  type Copy,
  type CreateGenerationRequest,
  type DloGenerateRequest,
  type DloIntakeDetail,
  type DloIntakeSummary,
  type DloReviewPatchRequest,
  type DloReviewPatchResponse,
  type CreateGlossaryTermRequest,
  type CreateReferenceTypeRequest,
  type GenerationDetail,
  type GenerationSummary,
  type GlossaryListResponse,
  type GlossaryTerm,
  type PrepareDesignationsRequest,
  type PrepareDesignationsResponse,
  type PosterFeedbackRequest,
  type PosterImageFeedbackRequest,
  type PrepareTranslationResponse,
  type VerifyNameRequest,
  type VerifyNameResponse,
  type ProofreadRequest,
  type ProofreadResponse,
  type ReferenceCategory,
  type ReferenceShapeBand,
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
  TranscriptionDetailSchema,
  TranscriptionListResponseSchema,
  type TranscriptionDetail,
  type TranscriptionSummary,
  YouTubeVideoSchema,
  type YouTubeVideo,
  ChatDocumentUploadResponseSchema,
  ChatImageUploadResponseSchema,
  ChatStreamEventSchema,
  ChatThreadDetailSchema,
  ChatThreadListSchema,
  CreateChatThreadResponseSchema,
  type ChatDocumentUploadResponse,
  type ChatImageUploadResponse,
  type ChatStreamEvent,
  type ChatThreadDetail,
  type ChatThreadSummary,
  type SendChatMessageRequest,
  VideoProjectDetailSchema,
  VideoProjectSummarySchema,
  VideoReferenceImageUploadResponseSchema,
  type VideoReferenceImageUploadResponse,
  type CreateVideoProjectInput,
  type RegenerateStillRequest,
  type UpdateSceneMotionRequest,
  type ReplanVideoScriptRequest,
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

// The shared recent-intake list behind /dlo. Carries no text — the summary omits both the
// combined text and the review state, so this stays cheap enough to poll while work runs.
export async function listDloIntakes(): Promise<DloIntakeSummary[]> {
  const body = await requestJson('/api/dlo/intakes');
  return DloIntakeListResponseSchema.parse(body);
}

// "What is this YouTube link?" — the title/channel/thumbnail behind the source cards on
// /dlo and /transcribe. Stores nothing and spends nothing; the route answers 400 only when
// the URL is not a YouTube video at all, and otherwise degrades to the id alone.
export async function probeYouTubeVideo(url: string): Promise<YouTubeVideo> {
  const body = await requestJson('/api/youtube/probe', {
    method: 'POST',
    body: JSON.stringify({ url }),
  });
  return YouTubeVideoSchema.parse(body);
}

// Transcription: multipart create (recordings only). No content-type header — the browser
// sets the multipart boundary (same as createDloIntake).
export async function createTranscription(form: FormData): Promise<string> {
  const response = await fetch(`${API_URL}/api/transcriptions`, {
    method: 'POST',
    body: form,
  });
  const body = await readJsonResponse(response);
  return z.object({ id: z.string() }).parse(body).id;
}

// `includeText` is opt-in for the same reason as getDloIntake: the payload then carries
// every transcript, which the result card needs once and the progress poll does not.
export async function getTranscription(
  id: string,
  includeText = false,
): Promise<TranscriptionDetail> {
  const body = await requestJson(
    `/api/transcriptions/${id}${includeText ? '?text=1' : ''}`,
  );
  return TranscriptionDetailSchema.parse(body);
}

// The recent-run list behind /transcribe. Carries no text — the summary omits both the
// per-file transcripts and the combined text, so this stays cheap enough to poll.
export async function listTranscriptions(): Promise<TranscriptionSummary[]> {
  const body = await requestJson('/api/transcriptions');
  return TranscriptionListResponseSchema.parse(body);
}

// Department usage analytics. ONE request serves the landing page and every feature
// drill-down, so the totals on one screen can never disagree with the detail on another.
export async function getAnalytics(
  range: AnalyticsRange,
): Promise<AnalyticsResponse> {
  const body = await requestJson(`/api/analytics?range=${range}`);
  return AnalyticsResponseSchema.parse(body);
}

// Persist the review step's state so a reload — or a colleague opening the same intake —
// costs nothing already paid for. See useDloReviewAutosave for the debounce and the
// conflict warning; this is only the transport.
export async function saveDloReview(
  id: string,
  input: DloReviewPatchRequest,
): Promise<DloReviewPatchResponse> {
  const body = await requestJson(`/api/dlo/intakes/${id}/review`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
  return DloReviewPatchResponseSchema.parse(body);
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

// Which people does this text name, and what पदनाम should the article print before each?
// Synchronous + ad-hoc — nothing is stored. A text naming nobody comes back
// with `names: []`, and the caller submits straight through: the check is invisible when there
// is nothing to check.
export async function prepareDesignations(
  input: PrepareDesignationsRequest,
): Promise<PrepareDesignationsResponse> {
  const body = await requestJson('/api/designations/prepare', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return PrepareDesignationsResponseSchema.parse(body);
}

// "तपासले म्हणून खूण करा" from the review card: confirm this person's नाव-शब्दकोश row without
// leaving the review step. Writes `verified` and nothing else — the English/Hindi spellings stay
// the pre-translation name check's business.
export async function verifyPersonName(
  input: VerifyNameRequest,
): Promise<VerifyNameResponse> {
  const body = await requestJson('/api/designations/verify', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return VerifyNameResponseSchema.parse(body);
}

// The review step's submit: the (edited) combined text becomes a normal
// generation and enters the shared article runner (simple mode by default);
// returns its id for polling.
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

// Write the first caption for a social run created poster-only. 202 — the job reports
// through the detail payload's captionRevising, like the feedback path.
export async function generateCaption(id: string): Promise<void> {
  await requestJson(`/api/generations/${id}/caption/generate`, {
    method: 'POST',
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

// Regenerate a social run's poster as a brand-new, differently-designed version (the
// fully-AI path re-designs from scratch). The escape hatch for a garbled-text render; the
// row flips to running and the caller just refreshes to start polling the new poster.
//
// `recolour` is the "different colours" redo: it additionally bars the run's current palette
// family, so the new version cannot come back in the colours just rejected. It is still a full
// re-render, not a recolour of the existing pixels — the copy is rewritten too.
//
// `posterHeading` (article runs only) re-renders with EXACTLY that text on the poster and
// remembers it on the run, so later redos keep it; '' clears it back to automatic. Omit the
// key entirely to leave whatever the run already has alone — `undefined` and `''` mean
// different things here.
export async function regeneratePoster(
  id: string,
  options: { recolour?: boolean; posterHeading?: string } = {},
): Promise<void> {
  await requestJson(`/api/generations/${id}/poster/regenerate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      recolour: options.recolour === true,
      ...(options.posterHeading === undefined
        ? {}
        : { posterHeading: options.posterHeading }),
    }),
  });
}

// Bring an older poster render back as the current one (1-based index into
// detail.posterVersions, oldest→newest), so the next feedback/redesign/publish acts on it.
// Synchronous and near-instant — it repoints the row at an existing immutable object, so
// there is no copy, no new version, and switching back is the same move again.
// Retry the edit that failed, on the same run. `retried` distinguishes the two outcomes:
// true = that exact step is running again (poll for it), false = there was nothing to re-run
// and the run was simply put back in working order (its poster and versions are untouched
// either way). Neither shape starts a new generation.
export async function retryGeneration(id: string): Promise<boolean> {
  const body = await requestJson(`/api/generations/${id}/retry`, {
    method: 'POST',
  });
  return z.object({ retried: z.boolean() }).parse(body).retried;
}

export async function restorePosterVersion(
  id: string,
  version: number,
): Promise<string> {
  const body = await requestJson(`/api/generations/${id}/poster/restore`, {
    method: 'POST',
    body: JSON.stringify({ version }),
  });
  return z.object({ posterUrl: z.string() }).parse(body).posterUrl;
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

// One uploaded photograph from a /dlo intake, for the review card to show beside its
// transcript. A URL rather than a fetch because it is an <img src>; it is a PROXY route
// because `dlo-uploads` is private — see the route in apps/api/src/routes/dlo.ts.
export function dloFileImageUrl(intakeId: string, index: number): string {
  return `${API_URL}/api/dlo/intakes/${intakeId}/files/${index}/image`;
}

export function posterDownloadUrl(id: string): string {
  return `${API_URL}/api/generations/${id}/poster.png`;
}

// A normal navigation rather than fetch: the API redirects through Canva OAuth and finally
// into the new Canva design, all in the tab opened by the user's click.
export function posterCanvaUrl(id: string): string {
  return `${API_URL}/api/canva/generations/${id}`;
}

// The article as a printable A4 PDF (DGIPR letterhead, Chromium-typeset Devanagari — a
// browser-side PDF library cannot shape Marathi conjuncts, so the API renders it).
// A URL rather than a fetch for the same reason posterDownloadUrl is one: only the server
// can force a cross-origin download, and a plain <a href> gets the browser's native
// download for free.
export function articlePdfDownloadUrl(
  id: string,
  language: 'mr' | TranslationLanguage = 'mr',
): string {
  return `${API_URL}/api/generations/${id}/article.pdf?lang=${language}`;
}

// Posts the poster + caption to an official account — X or the Facebook Page. `platform`
// is which one: the caller names it because one क्रिएटिव्ह poster is used on both, so the
// run's category no longer says where it should go. Omitted, the API falls back to that
// category. Synchronous (~3-10s); returns the live post's URL, which is also persisted on
// the row as `publishedUrl`.
export async function publishGeneration(
  id: string,
  platform?: 'twitter' | 'facebook',
): Promise<string> {
  const body = await requestJson(`/api/generations/${id}/publish`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(platform ? { platform } : {}),
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

// ---------- generic document intake (/api/documents) ----------
//
// Upload a PDF/DOCX/TXT and get its pages back. Used by every surface that takes a file
// but does not persist one (the media room, /proofread). The job lives in the API's memory
// only, so every call here can legitimately 404 once its TTL passes or the API restarts;
// the server's Marathi message says so and the UI sends the user back to the upload step.

// Uploads one file and returns the job id plus what the free probe learned: its kind, how
// many pages it has, and whether reading them will cost OCR credits. NOTHING has been read
// yet on a scanned PDF — extractDocumentIntakePages decides what gets paid for. No
// content-type header: the browser sets the multipart boundary.
export async function createDocumentIntake(
  form: FormData,
): Promise<CreateDocumentResponse> {
  const response = await fetch(`${API_URL}/api/documents`, {
    method: 'POST',
    body: form,
  });
  const body = await readJsonResponse(response);
  return CreateDocumentResponseSchema.parse(body);
}

// `includeText` is opt-in because the payload carries the whole document: poll without it
// and fetch once with it when a phase finishes.
export async function getDocumentIntake(
  id: string,
  includeText = false,
): Promise<DocumentDetail> {
  const body = await requestJson(
    `/api/documents/${id}${includeText ? '?text=1' : ''}`,
  );
  return DocumentDetailSchema.parse(body);
}

// "Read these pages." The request that actually spends OCR credits on a scanned document,
// and it spends them only on the pages listed here.
export async function extractDocumentIntakePages(
  id: string,
  pages: number[],
): Promise<void> {
  await requestJson(`/api/documents/${id}/extract`, {
    method: 'POST',
    body: JSON.stringify({ pages }),
  });
}

// "The text came out wrong — read it with OCR instead." Carries the page selection because
// overruling the QUALITY gate is not a reason to re-OCR pages the user already excluded.
export async function reextractDocumentIntake(
  id: string,
  pages: number[],
): Promise<void> {
  await requestJson(`/api/documents/${id}/reextract`, {
    method: 'POST',
    body: JSON.stringify({ source: 'ocr', pages }),
  });
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
  params: {
    verifiedOnly?: boolean;
    verified?: boolean;
    type?: TermType;
    search?: string;
    limit?: number;
    offset?: number;
  } = {},
): Promise<GlossaryListResponse> {
  const qs = new URLSearchParams();
  if (params.verifiedOnly) qs.set('verifiedOnly', 'true');
  if (params.verified !== undefined)
    qs.set('verified', String(params.verified));
  if (params.type) qs.set('type', params.type);
  if (params.search) qs.set('search', params.search);
  if (params.limit !== undefined) qs.set('limit', String(params.limit));
  if (params.offset !== undefined) qs.set('offset', String(params.offset));
  const query = qs.toString();
  const body = await requestJson(`/api/glossary${query ? `?${query}` : ''}`);
  // Tolerate the pre-envelope bare-array response: an older API just means no
  // true total and no paging, not a crashed page.
  if (Array.isArray(body)) {
    const items = z.array(GlossaryTermSchema).parse(body);
    return { items, total: items.length };
  }
  return GlossaryListResponseSchema.parse(body);
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
  // The size band the operator filed it under. It becomes the master's `bulletSlots`
  // and is marked as theirs, so a later re-check refreshes the summaries without
  // re-filing the image.
  band?: ReferenceShapeBand,
): Promise<ReferenceImage> {
  const query = new URLSearchParams({ category, subtype });
  if (band) query.set('band', band);
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
// Patches the cached vision reading. Fields are independent: send only what the
// operator changed, so correcting the subject line can never flip the photo-zone
// verdict (or the reverse) as a side effect.
export async function updateReferenceImageLayoutSpec(
  id: string,
  patch: Readonly<{ hasPhotoZone?: boolean; contentSummary?: string }>,
): Promise<ReferenceImage> {
  const body = await requestJson(`/api/references/${id}/layout-spec`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
  return ReferenceImageSchema.parse(body);
}

export async function setReferenceImagePhotoZone(
  id: string,
  hasPhotoZone: boolean,
): Promise<ReferenceImage> {
  return updateReferenceImageLayoutSpec(id, { hasPhotoZone });
}

export async function deleteReferenceImage(id: string): Promise<void> {
  await requestJson(`/api/references/${id}`, { method: 'DELETE' });
}

// ---------- explainer videos (/video) ----------

// JSON normally; multipart when the officer supplied their own narration
// recording (ready-script mode), because that file has to travel with the same
// request that creates the project — the script job measures it to decide the
// scene count. No content-type header on that branch: the browser sets the
// multipart boundary (the createDloIntake rule).
export async function createVideoProject(
  input: CreateVideoProjectInput,
  narrationAudio?: File | null,
): Promise<string> {
  if (narrationAudio) {
    const form = new FormData();
    for (const [key, value] of Object.entries(input)) {
      if (value === undefined) continue;
      form.append(key, String(value));
    }
    form.append('narration', narrationAudio, narrationAudio.name);
    const response = await fetch(`${API_URL}/api/video/projects`, {
      method: 'POST',
      body: form,
    });
    const body = await readJsonResponse(response);
    return z.object({ id: z.string() }).parse(body).id;
  }
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

// Gate 1's re-plan, synchronous: persists the officer's scene split exactly as
// typed, then re-derives every field the pipeline owns (visual brief, end
// brief, shot hint, beat, key point) and the clip windows. One text call — no
// frame is drawn and no narration is re-synthesized. The narration itself and
// the style paragraph are never touched.
export async function replanVideoScript(
  id: string,
  input: ReplanVideoScriptRequest,
): Promise<VideoProjectDetail> {
  const body = await requestJson(`/api/video/projects/${id}/script/replan`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return VideoProjectDetailSchema.parse(body);
}

// One scene's reference picture, uploaded at gate 1 while the officer is still
// writing the scene. It ATTACHES NOTHING on its own: the returned `path` is
// what a later save carries, so the picture lands with the rest of the card's
// edits rather than behind the officer's back. Free — nothing is rendered.
export async function uploadVideoSceneReferenceImage(
  id: string,
  file: File,
): Promise<VideoReferenceImageUploadResponse> {
  const form = new FormData();
  form.append('file', file);
  const response = await fetch(
    `${API_URL}/api/video/projects/${id}/reference-image`,
    { method: 'POST', body: form },
  );
  return VideoReferenceImageUploadResponseSchema.parse(
    await readJsonResponse(response),
  );
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

// One scene's END frame, removed. Free and synchronous: nothing is rendered
// and the scene returns to the single-frame shape (it animates from its start
// frame only). A clip already rendered from that ending is marked stale rather
// than discarded, so re-animating it stays the officer's call.
export async function deleteVideoSceneEndFrame(
  id: string,
  index: number,
): Promise<void> {
  await requestJson(`/api/video/projects/${id}/scenes/${index}/end-frame`, {
    method: 'DELETE',
  });
}

// One scene's END frame, taken from its own START frame. Free, synchronous and
// instant: no image is generated, the scene is simply pointed at the frame it
// already has, so the clip holds on that composition instead of ending
// somewhere else. A clip already animated from a different ending is reported
// stale rather than discarded, so re-animating it stays the officer's call.
export async function useStartFrameAsEndFrame(
  id: string,
  index: number,
): Promise<void> {
  await requestJson(
    `/api/video/projects/${id}/scenes/${index}/end-frame/from-start`,
    { method: 'POST' },
  );
}

// One scene's motion direction, hand-edited. Free and synchronous — it is an
// input to the clip prompt only, so no frame is discarded; it applies to the
// next animation of that scene.
export async function saveVideoSceneMotion(
  id: string,
  index: number,
  input: UpdateSceneMotionRequest,
): Promise<void> {
  await requestJson(`/api/video/projects/${id}/scenes/${index}/motion`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

// THE spend call: animates every scene whose clip is missing or outdated, from
// its approved still. On a retry after a partial failure only those render
// again. `scenes` names EXTRA scenes the officer chose to re-shoot even though
// their clip is current — it only ever adds to that set, never narrows it.
// `captions` is the officer's gate-2 choice about the burned-in Marathi key
// points; the route stores it on the row, so every later stitch (a per-scene
// re-animate, the free restitch) follows the same answer.
export async function startVideoAnimation(
  id: string,
  scenes: readonly number[] = [],
  captions = false,
): Promise<void> {
  await requestJson(`/api/video/projects/${id}/animate`, {
    method: 'POST',
    body: JSON.stringify({ scenes, captions }),
  });
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

// Reopen gate 2 on a failed project so the frames and motion direction can be
// edited before animating again. Preserves every clip already rendered.
export async function reopenVideoStoryboard(id: string): Promise<void> {
  await requestJson(`/api/video/projects/${id}/reopen-storyboard`, {
    method: 'POST',
  });
}

// Step back from gate 2 to gate 1 so the script (narration split, briefs, key
// points, style) can be edited again. Free: every rendered frame stays on the
// row, and only a scene an edit invalidates is redrawn afterwards.
export async function reopenVideoScript(id: string): Promise<void> {
  await requestJson(`/api/video/projects/${id}/reopen-script`, {
    method: 'POST',
  });
}

// Re-run only the local joining/muxing step from already-generated clips.
// This never re-buys a scene render or narration.
export async function restitchVideo(id: string): Promise<void> {
  await requestJson(`/api/video/projects/${id}/stitch`, { method: 'POST' });
}

// ---------------------------------------------------------------------------
// /chat — the general assistant
// ---------------------------------------------------------------------------

export async function createChatThread(): Promise<string> {
  const body = await requestJson('/api/chat/threads', { method: 'POST' });
  return CreateChatThreadResponseSchema.parse(body).id;
}

// The rail. Carries no message bodies — that is what the thread's counters are for — so it
// stays cheap enough to refresh whenever a chat is opened or a turn finishes.
export async function listChatThreads(): Promise<ChatThreadSummary[]> {
  const body = await requestJson('/api/chat/threads');
  return ChatThreadListSchema.parse(body);
}

export async function getChatThread(id: string): Promise<ChatThreadDetail> {
  const body = await requestJson(`/api/chat/threads/${id}`);
  return ChatThreadDetailSchema.parse(body);
}

export async function deleteChatThread(id: string): Promise<void> {
  const response = await fetch(`${API_URL}/api/chat/threads/${id}`, {
    method: 'DELETE',
  });
  // 204, so there is no body to read — but a failure still carries one.
  if (!response.ok) await readJsonResponse(response);
}

// One photograph, uploaded while the officer is still typing. By send time the attachment is
// already a URL, so the turn itself is an ordinary JSON request.
export async function uploadChatImage(
  file: File,
): Promise<ChatImageUploadResponse> {
  const form = new FormData();
  form.append('file', file);
  const response = await fetch(`${API_URL}/api/chat/attachments/image`, {
    method: 'POST',
    body: form,
  });
  return ChatImageUploadResponseSchema.parse(await readJsonResponse(response));
}

// A native PDF, uploaded while the officer is still typing. The returned id names our durable
// copy and its short-lived Gemini Files handle; no provider URI is exposed to the browser.
export async function uploadChatDocument(
  file: File,
): Promise<ChatDocumentUploadResponse> {
  const form = new FormData();
  form.append('file', file);
  const response = await fetch(`${API_URL}/api/chat/attachments/document`, {
    method: 'POST',
    body: form,
  });
  return ChatDocumentUploadResponseSchema.parse(
    await readJsonResponse(response),
  );
}

// Send a turn and read the answer as it is written.
//
// `fetch` + a ReadableStream rather than EventSource, which can only GET — the turn carries a
// body. The events are the same SSE framing either way (`data: {json}\n\n`), parsed here by
// splitting on the blank line; a chunk boundary can fall anywhere, so the tail is buffered
// rather than assumed to be a whole event. Mirrors chatCompleteStream's own reader.
//
// `signal` is the थांबवा button. Aborting stops the reading, not the server: the API finishes
// the turn and stores whatever arrived, so a reload shows the partial answer rather than
// losing paid tokens.
export async function sendChatMessage(
  threadId: string,
  input: SendChatMessageRequest,
  onEvent: (event: ChatStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(
    `${API_URL}/api/chat/threads/${threadId}/messages`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
      ...(signal ? { signal } : {}),
    },
  );
  // A refusal (empty message, oversized attachment, unknown thread) is ordinary JSON with an
  // error body; only an accepted turn becomes an event stream.
  if (!response.ok || !response.body) {
    await readJsonResponse(response);
    throw new ApiRequestError('चॅट सुरू करता आली नाही.', response.status);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      // Bare CR is never meaningful in this framing (a newline inside JSON is escaped), so
      // dropping it makes the separator exactly "\n\n" however the server framed its lines.
      buffer = (buffer + decoder.decode(value, { stream: true })).replace(
        /\r/g,
        '',
      );
      let separator = buffer.indexOf('\n\n');
      while (separator !== -1) {
        const frame = buffer.slice(0, separator);
        buffer = buffer.slice(separator + 2);
        for (const line of frame.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data === '') continue;
          const parsed = ChatStreamEventSchema.safeParse(
            JSON.parse(data) as unknown,
          );
          // An unrecognised frame is skipped rather than thrown: a future event type must not
          // break a client mid-answer.
          if (parsed.success) onEvent(parsed.data);
        }
        separator = buffer.indexOf('\n\n');
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}
