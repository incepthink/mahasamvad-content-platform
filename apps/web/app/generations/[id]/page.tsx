'use client';

import { use, useState } from 'react';
import { isArticleCategory, isSocialCategory } from '@dgipr/schemas';
import { useGeneration } from '../../../lib/useGeneration';
import { useGenerationThread } from '../../../lib/useGenerationThread';
import { retryGeneration } from '../../../lib/api';
import { useTasks } from '../../../lib/TasksProvider';
import { STR } from '../../../lib/strings';
import { GenerationThread } from '../../../components/GenerationThread';
import { ProgressSteps } from '../../../components/ProgressSteps';
import { TaskProgressBar } from '../../../components/TaskProgressBar';
import { StatusChip } from '../../../components/StatusChip';
import { ArticleView } from '../../../components/ArticleView';
import { FiveWOneHView } from '../../../components/FiveWOneHView';
import { NextActions } from '../../../components/NextActions';
import { PosterPanel } from '../../../components/PosterPanel';
import { PosterSkeleton } from '../../../components/PosterSkeleton';
import { SocialPostView } from '../../../components/SocialPostView';

export default function GenerationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { addTask, openPanel } = useTasks();
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  // The edit failure is dismissible: it is a notice about one attempt, not a state of the
  // run, and the run underneath it is fully usable while it is on screen.
  const [failureDismissed, setFailureDismissed] = useState(false);
  const { detail, error, refresh } = useGeneration(id);
  const { thread, refresh: refreshThread } = useGenerationThread(
    id,
    detail?.status ?? null,
  );

  // Retry on THIS run: re-run the step that failed, or — when its inputs are no longer
  // held (an API restart, or a row failed by an older build) — put the run back in working
  // order so its poster, versions and edit controls are usable again. It deliberately does
  // NOT start a new generation: that used to be this button's only behaviour, and it left
  // every earlier revision of the failed run stranded behind a page that showed nothing.
  // Starting afresh from the same note lives in पुढील पाऊल below, where it always has.
  const retry = async () => {
    if (!detail || retrying) return;
    setRetrying(true);
    setRetryError(null);
    try {
      const restarted = await retryGeneration(detail.id);
      // A restarted edit is a background render like any other, so it belongs in the tasks
      // panel; a plain recovery has nothing to watch.
      if (restarted && isSocialCategory(detail.category)) {
        addTask(detail.id);
        openPanel();
      }
      await refresh();
    } catch (e) {
      setRetryError(e instanceof Error ? e.message : STR.genericError);
    } finally {
      setRetrying(false);
    }
  };

  if (error && !detail) {
    return (
      <main className="page">
        <p className="form-error">{error}</p>
      </main>
    );
  }

  if (!detail) {
    return (
      <main className="page">
        <p className="hint">{STR.progressTitle}</p>
      </main>
    );
  }

  // A poster re-render (text/scene feedback, or a social redesign) keeps the finished
  // poster on screen with a spinner overlay instead of swapping to the step list.
  // Scoped to poster-affecting steps so an article-only revision still shows ProgressSteps.
  // The social-redesign steps (classify/copy/image) only count here when a poster already
  // exists — an INITIAL run has no posterUrl during them, so it still shows the step list.
  const posterBusy =
    !!detail.posterUrl &&
    (detail.status === 'queued' || detail.status === 'running') &&
    (detail.step === 'revise_copy' ||
      detail.step === 'revise_scene' ||
      detail.step === 'revise_image' ||
      detail.step === 'scene' ||
      detail.step === 'render' ||
      detail.step === 'classify' ||
      detail.step === 'copy' ||
      detail.step === 'image');

  // A translation no longer takes over the row's status/step (it can run beside the
  // poster render), so it needs no branch here: the article card stays mounted by
  // whichever state is already true — completed, or the poster phases below — and
  // ArticleView shows its own inline indicator from `detail.translating`.

  // First-run poster phase: the article is already persisted (runner saves it
  // before the poster steps), so show it early with a poster skeleton instead
  // of the step list. Step-scoped so a revise_article run keeps its existing
  // path; posterBusy can't overlap because it requires posterUrl.
  const posterPending =
    isArticleCategory(detail.category) &&
    detail.outputType !== 'article' &&
    (detail.status === 'queued' || detail.status === 'running') &&
    !!detail.article &&
    !detail.posterUrl &&
    (detail.step === 'faithfulness' || // tiny gap: article persisted before step flips to 'copy'
      detail.step === 'copy' ||
      detail.step === 'scene' ||
      detail.step === 'render');
  // /generations creates article-category poster runs with outputType='poster'. The article
  // stored on those rows is the poster's source, not the officer's primary requested output,
  // so keep it available without letting it lead the page.
  const posterFocused =
    isArticleCategory(detail.category) && detail.outputType === 'poster';

  // Whether this run produced anything that outlives a failed edit. A social poster run
  // created WITHOUT a caption has `article === null`, which is exactly the run that used to
  // vanish: the result view was gated on the article alone, so one failed marker round hid
  // the poster and every version behind it.
  const hasOutput = !!detail.posterUrl || !!detail.article;
  // An edit that did not land, over output that did. Either the API said so (`editFailure`,
  // the row already back to `completed`), or the row is `failed` from before that existed.
  const editFailed =
    !!detail.editFailure || (detail.status === 'failed' && hasOutput);

  return (
    <main className="page">
      <div
        className="btn-row"
        style={{ justifyContent: 'space-between', marginBottom: 20 }}
      >
        <h1 className="page-title" style={{ margin: 0 }}>
          {STR.newTitle}
        </h1>
        <div className="btn-row" style={{ gap: 10, alignItems: 'center' }}>
          <StatusChip status={detail.status} />
        </div>
      </div>

      {(detail.status === 'queued' || detail.status === 'running') &&
        !posterBusy &&
        !posterPending &&
        // A यूट्यूब थंबनेल run has no article stages to list, so it takes the compact
        // bar the social lane uses rather than ProgressSteps' news/scheme step list.
        (!isArticleCategory(detail.category) ? (
          <section className="card" aria-live="polite">
            <h2>{STR.progressTitle}</h2>
            <p className="hint">{STR.progressHint}</p>
            <div style={{ marginTop: 16 }}>
              <TaskProgressBar status={detail.status} step={detail.step} />
            </div>
          </section>
        ) : (
          <ProgressSteps detail={detail} />
        ))}

      {/* Two different situations, deliberately worded differently. A run that produced
          NOTHING is a failure and reads as one. A run whose earlier output survived — its
          poster, every immutable version, its article — had one EDIT fail, and saying "काम
          अपूर्ण राहिले" over a perfectly good poster is what made a run look lost. Newer
          rows never reach the second case as `failed` at all (the API recovers them and
          reports `editFailure`); rows failed by an older build land here and recover on the
          same button. */}
      {detail.status === 'failed' && !hasOutput && (
        <section className="card">
          <h2>{STR.failedTitle}</h2>
          <p className="hint">{detail.error ?? STR.failedHint}</p>
          <p className="hint">{STR.editFailedNewRunHint}</p>
        </section>
      )}

      {editFailed && !failureDismissed && (
        <section className="card warn-card" aria-live="polite">
          <h2>{STR.editFailedTitle}</h2>
          <p className="hint">{STR.editFailedHint}</p>
          {(detail.editFailure ?? detail.error) ? (
            <p className="form-error">{detail.editFailure ?? detail.error}</p>
          ) : null}
          <div className="btn-row" style={{ marginTop: 16, gap: 10 }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={retry}
              disabled={retrying}
            >
              {retrying
                ? STR.submitting
                : detail.editRetryable
                  ? STR.editRetry
                  : STR.editRecover}
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => setFailureDismissed(true)}
              disabled={retrying}
            >
              {STR.dismiss}
            </button>
          </div>
          {retryError ? <p className="form-error">{retryError}</p> : null}
        </section>
      )}

      {(detail.status === 'completed' ||
        posterBusy ||
        posterPending ||
        // A failure must not hide what the run already produced — the article, the poster,
        // or the poster's whole version history. The notice stays above; the result renders
        // below it and stays fully editable, which is what makes the run recoverable at all.
        (detail.status === 'failed' && hasOutput)) &&
        (isSocialCategory(detail.category) ? (
          <SocialPostView
            detail={detail}
            onChanged={refresh}
            busy={posterBusy}
          />
        ) : (
          <>
            {/* A poster request should open on the result it asked for. The skeleton occupies
                this same first position while the initial render is still in flight. */}
            {detail.posterUrl ? (
              <PosterPanel
                detail={detail}
                onChanged={refresh}
                busy={posterBusy}
              />
            ) : posterPending ? (
              <PosterSkeleton detail={detail} />
            ) : null}
            {detail.fiveWOneH ? <FiveWOneHView detail={detail} /> : null}
            {detail.article ? (
              posterFocused ? (
                <details className="card poster-source-article">
                  <summary>{STR.givenArticle}</summary>
                  <div className="poster-source-article-body">
                    <ArticleView
                      detail={detail}
                      onFeedbackSent={refresh}
                      embedded
                    />
                  </div>
                </details>
              ) : (
                <ArticleView detail={detail} onFeedbackSent={refresh} />
              )
            ) : null}
          </>
        ))}

      {/* Thread of runs spawned from this note lineage. Self-hides when this
          run has no follow-ups; updates live while any member is in flight. */}
      <GenerationThread items={thread} currentId={id} />

      {/* "Next step": cross-format generation from the same note + edit-note
          re-run. Renders nothing while the run (or a revision) is in flight. */}
      <NextActions
        detail={detail}
        onSpawned={() => void refreshThread()}
        onPosterStarted={() => void refresh()}
      />
    </main>
  );
}
