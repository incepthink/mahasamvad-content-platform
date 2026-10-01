'use client';

// The API calls the practice lessons' screens make — the Creative create form and social poster
// card, the /dlo intake form and the article view — behind a React context so a page can hand
// those screens a different implementation. Today that is exactly one page family: /learn,
// whose lessons render the REAL screens against sandboxes that make no request at all
// (lib/learn/sandboxApi.ts, lib/learn/dloSandboxApi.ts).
//
// NO PROVIDER MEANS PRODUCTION IS UNCHANGED: `useApi()` falls back to REAL_API, which is the
// lib/api functions themselves — the same calls, in the same order, as the direct imports
// these components used before. Only a page that deliberately wraps itself in <ApiProvider>
// gets anything else.
//
// `WebApi` is a Pick of lib/api rather than a hand-written interface, so a signature change
// there reaches every fake as a type error rather than as a silent drift.

import { createContext, useContext, type ReactNode } from 'react';
import * as api from './api';

export type WebApi = Pick<
  typeof api,
  | 'createGeneration'
  | 'uploadPromptImage'
  | 'getGeneration'
  | 'regeneratePoster'
  | 'sendPosterImageFeedback'
  | 'restorePosterVersion'
  | 'sendCaptionFeedback'
  | 'generateCaption'
  | 'updateCaption'
  | 'publishGeneration'
  | 'planEdit'
  | 'getCanvaAccounts'
  | 'posterDownloadUrl'
  | 'plainPosterDownloadUrl'
  // /dlo's intake form and the article view (the DLO lesson).
  | 'createDloIntake'
  | 'sendArticleFeedback'
  | 'getArticleVersions'
  | 'restoreArticleVersion'
  | 'getGenerationSourceFiles'
  | 'generationSourceFileUrl'
  | 'articlePdfDownloadUrl'
> & {
  // Null = this surface has no Canva handoff, and CanvaLink renders nothing.
  posterCanvaUrl: (id: string, account?: string) => string | null;
};

export const REAL_API: WebApi = {
  createGeneration: api.createGeneration,
  uploadPromptImage: api.uploadPromptImage,
  getGeneration: api.getGeneration,
  regeneratePoster: api.regeneratePoster,
  sendPosterImageFeedback: api.sendPosterImageFeedback,
  restorePosterVersion: api.restorePosterVersion,
  sendCaptionFeedback: api.sendCaptionFeedback,
  generateCaption: api.generateCaption,
  updateCaption: api.updateCaption,
  publishGeneration: api.publishGeneration,
  planEdit: api.planEdit,
  getCanvaAccounts: api.getCanvaAccounts,
  posterDownloadUrl: api.posterDownloadUrl,
  plainPosterDownloadUrl: api.plainPosterDownloadUrl,
  posterCanvaUrl: api.posterCanvaUrl,
  createDloIntake: api.createDloIntake,
  sendArticleFeedback: api.sendArticleFeedback,
  getArticleVersions: api.getArticleVersions,
  restoreArticleVersion: api.restoreArticleVersion,
  getGenerationSourceFiles: api.getGenerationSourceFiles,
  generationSourceFileUrl: api.generationSourceFileUrl,
  articlePdfDownloadUrl: api.articlePdfDownloadUrl,
};

const ApiContext = createContext<WebApi>(REAL_API);

export function ApiProvider({
  api: value,
  children,
}: {
  api: WebApi;
  children: ReactNode;
}) {
  return <ApiContext.Provider value={value}>{children}</ApiContext.Provider>;
}

export function useApi(): WebApi {
  return useContext(ApiContext);
}
