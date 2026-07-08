'use client';

import { use } from 'react';
import { useRouter } from 'next/navigation';
import { useGeneration } from '../../../lib/useGeneration';
import { createGeneration } from '../../../lib/api';
import { useTasks } from '../../../lib/TasksProvider';
import { STR } from '../../../lib/strings';
import { ProgressSteps } from '../../../components/ProgressSteps';
import { TaskProgressBar } from '../../../components/TaskProgressBar';
import { StatusChip } from '../../../components/StatusChip';
import { ArticleView } from '../../../components/ArticleView';
import { PosterPanel } from '../../../components/PosterPanel';
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

  const retry = async () => {
    if (!detail) return;
    const newId = await createGeneration({
      note: detail.note,
      heading: detail.heading ?? undefined,
      category: detail.category,
      outputType: detail.outputType,
      designMode: detail.designMode ?? undefined,
    });
    // Twitter reruns are background tasks: track + surface them in the panel.
    if (detail.category === 'twitter') {
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
    (detail.step === 'revise_copy' ||
      detail.step === 'revise_scene' ||
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
        <StatusChip status={detail.status} />
      </div>

      {(detail.status === 'queued' || detail.status === 'running') &&
        !posterBusy &&
        (detail.category === 'twitter' ? (
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

      {(detail.status === 'completed' || posterBusy) &&
        (detail.category === 'twitter' ? (
          <SocialPostView detail={detail} onRegenerate={retry} />
        ) : (
          <>
            {detail.article ? (
              <ArticleView detail={detail} onFeedbackSent={refresh} />
            ) : null}
            {detail.posterUrl ? (
              <PosterPanel
                detail={detail}
                onChanged={refresh}
                busy={posterBusy}
              />
            ) : null}
          </>
        ))}
    </main>
  );
}
