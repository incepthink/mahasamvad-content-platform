'use client';

// Vertical step list shown while a job runs. For the initial generation the full
// pipeline is listed with done/active/pending marks; for feedback (revise_*) jobs
// only the steps that job actually walks are shown.

import type { GenerationDetail, GenerationStep } from '@dgipr/schemas';
import { STEP_LABELS, STR } from '../lib/strings';

const ARTICLE_STEPS: GenerationStep[] = [
  'retrieve',
  'extract_5w1h',
  'draft',
  'coverage',
  'faithfulness',
];
const POSTER_STEPS: GenerationStep[] = ['copy', 'scene', 'render'];

function stepsFor(detail: GenerationDetail): GenerationStep[] {
  const { step, outputType } = detail;
  if (step === 'revise_article') return ['revise_article'];
  if (step === 'revise_copy') return ['revise_copy', 'render'];
  if (step === 'revise_scene') return ['revise_scene', 'scene', 'render'];
  // scene/render with a poster already published means a feedback job is
  // re-rendering (the first run only uploads its poster at the very end).
  if ((step === 'scene' || step === 'render') && detail.posterUrl) {
    return ['scene', 'render'];
  }
  return outputType === 'article'
    ? ARTICLE_STEPS
    : [...ARTICLE_STEPS, ...POSTER_STEPS];
}

export function ProgressSteps({ detail }: { detail: GenerationDetail }) {
  const steps = stepsFor(detail);
  const currentIndex = detail.step ? steps.indexOf(detail.step) : -1;

  return (
    <div className="card" aria-live="polite">
      <h2>{STR.progressTitle}</h2>
      <p className="hint">{STR.progressHint}</p>
      <ol className="progress-list">
        {steps.map((step, index) => {
          const state =
            currentIndex === -1
              ? index === 0
                ? 'active'
                : 'pending'
              : index < currentIndex
                ? 'done'
                : index === currentIndex
                  ? 'active'
                  : 'pending';
          return (
            <li key={step} className={`progress-step ${state}`}>
              <span className="mark" aria-hidden="true">
                {state === 'done' ? '✓' : state === 'active' ? (
                  <span className="spinner" />
                ) : (
                  index + 1
                )}
              </span>
              <span>{STEP_LABELS[step]}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
