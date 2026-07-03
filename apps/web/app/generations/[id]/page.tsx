'use client';

import { use } from 'react';
import { useRouter } from 'next/navigation';
import { useGeneration } from '../../../lib/useGeneration';
import { createGeneration } from '../../../lib/api';
import { STR } from '../../../lib/strings';
import { ProgressSteps } from '../../../components/ProgressSteps';
import { StatusChip } from '../../../components/StatusChip';
import { ArticleView } from '../../../components/ArticleView';
import { PosterPanel } from '../../../components/PosterPanel';

export default function GenerationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const { detail, error, refresh } = useGeneration(id);

  const retry = async () => {
    if (!detail) return;
    const newId = await createGeneration({
      note: detail.note,
      outputType: detail.outputType,
    });
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
        !posterBusy && <ProgressSteps detail={detail} />}

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

      {(detail.status === 'completed' || posterBusy) && (
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
      )}
    </main>
  );
}
