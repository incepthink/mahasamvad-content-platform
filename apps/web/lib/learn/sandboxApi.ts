// The `WebApi` /learn hands the real composer and poster card: every call they can make,
// answered locally. There is NO network in this file — `satisfies WebApi` makes typecheck
// demand a fake for every key, so a call added to those screens later cannot quietly fall
// through to the real API from a practice page.
//
// Three kinds of answer:
//   - the lesson's own calls (create, the marker edit, choosing a version) move the sandbox;
//   - downloads point at the bundled sample files;
//   - everything the lesson does not teach refuses, in Marathi, through the error slot the
//     real screen already has — "not in this lesson" rather than pretending to work.

import type { WebApi } from '../apiContext';
import { ApiRequestError } from '../api';
import { LEARN } from '../strings';
import {
  SAMPLE_ID,
  currentFile,
  posterFileUrl,
  sampleDetail,
  type CreativeSandbox,
} from './creativeSandbox';
import { matchScriptedEdit } from './matchScriptedEdit';

// 409: the request is well formed, it simply is not something this page does — so the
// notice never offers a retry that could not help.
function refuse(message: string): Promise<never> {
  return Promise.reject(new ApiRequestError(message, 409));
}

export function createSandboxApi(sandbox: CreativeSandbox): WebApi {
  const notInLesson = () => refuse(LEARN.notInLesson);

  return {
    createGeneration: async () => {
      sandbox.startCreate();
      return SAMPLE_ID;
    },
    getGeneration: async () => sampleDetail(sandbox.getState()),

    sendPosterImageFeedback: async (_id, request) => {
      const state = sandbox.getState();
      if (state.busy) return refuse(LEARN.waitForJob);
      if (request.clearRegions?.length || request.feedback)
        return notInLesson();
      if (currentFile(state) !== 'v1') return refuse(LEARN.editOriginalOnly);
      const edit = matchScriptedEdit(request.annotations?.[0]?.note ?? '');
      if (!edit || (request.annotations?.length ?? 0) !== 1)
        return refuse(LEARN.cannotSimulate);
      sandbox.startEdit(edit);
    },
    restorePosterVersion: async (_id, version) => {
      if (sandbox.getState().busy) return refuse(LEARN.waitForJob);
      sandbox.selectVersion(version);
      return sampleDetail(sandbox.getState()).posterUrl ?? '';
    },

    // The edit assistant answers, but only to point back at the lesson's own gesture.
    planEdit: async () => ({
      kind: 'reply' as const,
      message: LEARN.editChatReply,
      actions: [],
    }),

    regeneratePoster: notInLesson,
    sendCaptionFeedback: notInLesson,
    generateCaption: notInLesson,
    updateCaption: notInLesson,
    uploadPromptImage: notInLesson,
    // Never posts. The officer sees why rather than a button that silently does nothing.
    publishGeneration: notInLesson,

    // The DLO lesson's screens. Nothing on the Creative screens calls these; they are here
    // because `WebApi` is one type for every lesson, and each answer is a refusal or empty.
    createDloIntake: notInLesson,
    sendArticleFeedback: notInLesson,
    restoreArticleVersion: notInLesson,
    getArticleVersions: async () => [],
    getGenerationSourceFiles: async () => [],
    generationSourceFileUrl: () => '#',
    articlePdfDownloadUrl: () => '#',

    getCanvaAccounts: async () => [],
    posterCanvaUrl: () => null,
    posterDownloadUrl: () =>
      posterFileUrl(currentFile(sandbox.getState()) ?? 'v1'),
    plainPosterDownloadUrl: () =>
      posterFileUrl(currentFile(sandbox.getState()) ?? 'v1', true),
  } satisfies WebApi;
}
