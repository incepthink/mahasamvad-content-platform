'use client';

import { use } from 'react';
import { useRouter } from 'next/navigation';
import { useGeneration } from '../../../lib/useGeneration';
import { createGeneration } from '../../../lib/api';
import { useTasks } from '../../../lib/TasksProvider';
import { STR, formatCost } from '../../../lib/strings';
import { ProgressSteps } from '../../../components/ProgressSteps';
import { TaskProgressBar } from '../../../components/TaskProgressBar';
import { StatusChip } from '../../../components/StatusChip';
import { ArticleView } from '../../../components/ArticleView';
import { FiveWOneHView } from '../../../components/FiveWOneHView';
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

  // An on-demand English translation runs against a completed article; keep the
  // finished article on screen (ArticleView shows its own inline indicator)
  // instead of swapping to the step list, mirroring the poster-busy pattern.
  const articleBusy = !!detail.article && detail.step === 'translate';

  // First-run poster phase: the article is already persisted (runner saves it
  // before the poster steps), so show it early with a poster skeleton instead
  // of the step list. Step-scoped so revise_article/translate runs keep their
  // existing paths; posterBusy can't overlap because it requires posterUrl.
  const posterPending =
    detail.category !== 'twitter' &&
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
          {detail.costUsd !== null ? (
            <span className="cost-badge" title={STR.costLabel}>
              {STR.costLabel} {formatCost(detail.costUsd)}
            </span>
          ) : null}
          <StatusChip status={detail.status} />
        </div>
      </div>

      {(detail.status === 'queued' || detail.status === 'running') &&
        !posterBusy &&
        !articleBusy &&
        !posterPending &&
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

      {(detail.status === 'completed' ||
        posterBusy ||
        articleBusy ||
        posterPending ||
        // A poster-phase failure must not hide an already-good article: keep
        // the failed card above and the article content below it.
        (detail.status === 'failed' && !!detail.article)) &&
        (detail.category === 'twitter' ? (
          <SocialPostView detail={detail} onRegenerate={retry} />
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
    </main>
  );
}
