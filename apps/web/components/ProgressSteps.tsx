'use client';

// Vertical step list shown while a job runs. For the initial generation the full
// pipeline is listed with done/active/pending marks; for feedback (revise_*) jobs
// only the steps that job actually walks are shown.

import type { GenerationDetail, GenerationStep } from '@dgipr/schemas';
import { STEP_LABELS, STR } from '../lib/strings';

// The two article pipelines walk DIFFERENT phases, and listing the wrong one is what made a
// simple-mode run look frozen: the officer was shown six stages, only `draft` ever became
// active, and the multi-minute single model call sat under a spinner on step 1 (the row's
// `retrieve` is not in the full list at all, so `indexOf` returned -1 and the component fell
// back to marking the FIRST step active — a phase that was not running, under a label that did
// not describe it). `detail.articlePipeline` is the API telling us which list is true.
const SIMPLE_ARTICLE_STEPS: GenerationStep[] = ['retrieve', 'draft'];
const FULL_ARTICLE_STEPS: GenerationStep[] = [
  'extract_5w1h',
  'editorial_brief',
  'draft',
  'coverage',
  'faithfulness',
  'fact_check',
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
  const article =
    detail.articlePipeline === 'full'
      ? FULL_ARTICLE_STEPS
      : SIMPLE_ARTICLE_STEPS;
  return outputType === 'article' ? article : [...article, ...POSTER_STEPS];
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
                {state === 'done' ? (
                  '✓'
                ) : state === 'active' ? (
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
