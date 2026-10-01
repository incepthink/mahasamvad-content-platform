// The `WebApi` /learn's DLO lesson hands the real /dlo intake form and the real article view:
// every call they can make, answered locally. There is NO network in this file — `satisfies
// WebApi` makes typecheck demand a fake for every key, so a call added to those screens later
// cannot quietly fall through to the real API from a practice page.
//
// The same three kinds of answer as the Creative lesson's (./sandboxApi.ts):
//   - the lesson's own calls (the intake, the article feedback, choosing a version) move the
//     sandbox;
//   - downloads point at the bundled sample files;
//   - everything the lesson does not teach refuses, in Marathi, through the error slot the
//     real screen already has.

import type { WebApi } from '../apiContext';
import { ApiRequestError } from '../api';
import { LEARN } from '../strings';
import {
  SAMPLE_INTAKE_ID,
  articlePdfUrl,
  currentFile,
  versionTexts,
  type DloSandbox,
} from './dloSandbox';
import { matchArticleEdit } from './matchArticleEdit';

// 409: the request is well formed, it simply is not something this page does — so the notice
// never offers a retry that could not help.
function refuse(message: string): Promise<never> {
  return Promise.reject(new ApiRequestError(message, 409));
}

export function createDloSandboxApi(sandbox: DloSandbox): WebApi {
  const notInLesson = () => refuse(LEARN.notInLesson);

  return {
    createDloIntake: async () => {
      sandbox.startCreate();
      return SAMPLE_INTAKE_ID;
    },

    sendArticleFeedback: async (_id, feedback) => {
      const state = sandbox.getState();
      if (state.busy) return refuse(LEARN.waitForJob);
      if (currentFile(state) !== 'v1') return refuse(LEARN.dloEditOriginalOnly);
      const edit = matchArticleEdit(feedback);
      if (!edit) return refuse(LEARN.dloCannotSimulate);
      sandbox.startEdit(edit, feedback);
    },
    getArticleVersions: async () => versionTexts(sandbox.getState()),
    restoreArticleVersion: async (_id, version) => {
      if (sandbox.getState().busy) return refuse(LEARN.waitForJob);
      sandbox.selectVersion(version);
      return '';
    },
    // The practice note is typed text alone: there are no uploaded files to list.
    getGenerationSourceFiles: async () => [],
    generationSourceFileUrl: () => '#',
    articlePdfDownloadUrl: () =>
      articlePdfUrl(currentFile(sandbox.getState()) ?? 'v1'),

    // The Creative lesson's screens. Nothing on the DLO screens calls these.
    createGeneration: notInLesson,
    getGeneration: notInLesson,
    uploadPromptImage: notInLesson,
    regeneratePoster: notInLesson,
    sendPosterImageFeedback: notInLesson,
    restorePosterVersion: notInLesson,
    sendCaptionFeedback: notInLesson,
    generateCaption: notInLesson,
    updateCaption: notInLesson,
    publishGeneration: notInLesson,
    planEdit: notInLesson,
    getCanvaAccounts: async () => [],
    posterCanvaUrl: () => null,
    posterDownloadUrl: () => '#',
    plainPosterDownloadUrl: () => '#',
  } satisfies WebApi;
}
