'use client';

import { use } from 'react';
import { useRouter } from 'next/navigation';
import { isSocialCategory } from '@dgipr/schemas';
import { useGeneration } from '../../../lib/useGeneration';
import { useGenerationThread } from '../../../lib/useGenerationThread';
import { createGeneration } from '../../../lib/api';
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
  const router = useRouter();
  const { addTask, openPanel } = useTasks();
  const { detail, error, refresh } = useGeneration(id);
  const { thread, refresh: refreshThread } = useGenerationThread(
    id,
    detail?.status ?? null,
  );

  const retry = async () => {
    if (!detail) return;
    const newId = await createGeneration({
      note: detail.note,
      heading: detail.heading ?? undefined,
      category: detail.category,
      outputType: detail.outputType,
      designMode: detail.designMode ?? undefined,
      sourceGenerationId: detail.id,
    });
    // Social reruns are background tasks: track + surface them in the panel.
    if (isSocialCategory(detail.category)) {
      addTask(newId);
      openPanel();
    }
    router.push(`/generations/${newId}`);
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

  // A poster re-render (text/scene feedback) keeps the finished poster on screen
  // with a spinner overlay instead of swapping to the step list. Scoped to
  // poster-affecting steps so an article-only revision still shows ProgressSteps.
  const posterBusy =
    !!detail.posterUrl &&
    (detail.status === 'queued' || detail.status === 'running') &&
    (detail.step === 'revise_copy' ||
      detail.step === 'revise_scene' ||
      detail.step === 'revise_image' ||
      detail.step === 'scene' ||
      detail.step === 'render');

  // A translation no longer takes over the row's status/step (it can run beside the
  // poster render), so it needs no branch here: the article card stays mounted by
  // whichever state is already true — completed, or the poster phases below — and
  // ArticleView shows its own inline indicator from `detail.translating`.

  // First-run poster phase: the article is already persisted (runner saves it
  // before the poster steps), so show it early with a poster skeleton instead
  // of the step list. Step-scoped so a revise_article run keeps its existing
  // path; posterBusy can't overlap because it requires posterUrl.
  const posterPending =
    !isSocialCategory(detail.category) &&
    detail.outputType !== 'article' &&
    (detail.status === 'queued' || detail.status === 'running') &&
    !!detail.article &&
    !detail.posterUrl &&
    (detail.step === 'faithfulness' || // tiny gap: article persisted before step flips to 'copy'
      detail.step === 'copy' ||
      detail.step === 'scene' ||
      detail.step === 'render');

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
        (isSocialCategory(detail.category) ? (
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

      {detail.status === 'failed' && (
        <section className="card">
          <h2>{STR.failedTitle}</h2>
          <p className="hint">{detail.error ?? STR.failedHint}</p>
          <div className="btn-row" style={{ marginTop: 16 }}>
            <button type="button" className="btn btn-primary" onClick={retry}>
              {STR.retry}
            </button>
          </div>
        </section>
      )}

      {(detail.status === 'completed' ||
        posterBusy ||
        posterPending ||
        // A poster-phase failure must not hide an already-good article: keep
        // the failed card above and the article content below it.
        (detail.status === 'failed' && !!detail.article)) &&
        (isSocialCategory(detail.category) ? (
          <SocialPostView
            detail={detail}
            onRegenerate={retry}
            onChanged={refresh}
            busy={posterBusy}
          />
        ) : (
          <>
            {detail.fiveWOneH ? <FiveWOneHView detail={detail} /> : null}
            {detail.article ? (
              <ArticleView detail={detail} onFeedbackSent={refresh} />
            ) : null}
            {detail.posterUrl ? (
              <PosterPanel
                detail={detail}
                onChanged={refresh}
                busy={posterBusy}
              />
            ) : posterPending ? (
              <PosterSkeleton detail={detail} />
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
