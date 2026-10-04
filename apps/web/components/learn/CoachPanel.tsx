'use client';

// The coach's words, inside the callout Spotlight attaches to whatever the step is about:
// which of the lesson's stages the learner is in, ONE short instruction, and the step's own
// action (the sample-text button, पुढे, the recap) under it.
//
// It never lists options the lesson does not use. मला दाखवा scrolls the target back into view;
// पुन्हा सुरुवात and सराव सोडा are small icon buttons in the head so they do not compete with
// the task. The whole callout carries `data-learn-allow` (Spotlight), so it is the one place
// on the page besides the taught control that always works.

import type { ReactNode } from 'react';
import Link from 'next/link';
import { Eye, RotateCcw, X } from 'lucide-react';
import { LEARN } from '../../lib/strings';
import type { LessonStage, StageId } from '../../lib/learn/lesson';

export function CoachPanel({
  stages,
  stage,
  instruction,
  canShowMe,
  onShowMe,
  onRestart,
  tools,
  status,
  children,
}: {
  // The lesson's own stages (every lesson has four today, but the count is the lesson's).
  stages: readonly LessonStage[];
  stage: StageId;
  instruction: string;
  canShowMe: boolean;
  onShowMe: () => void;
  onRestart: (() => void) | null;
  // Extra head buttons (autoplay's ▶/⏸ and mute), placed before restart and exit.
  tools?: ReactNode;
  // A line above the instruction (autoplay's "running" / "paused" state).
  status?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="learn-coach" aria-label={LEARN.coachTitle}>
      <div className="learn-coach-head">
        <p className="learn-coach-stage">
          {LEARN.stageOf(stage, stages.length)} · {stages[stage - 1]?.label}
        </p>
        <div className="learn-coach-tools">
          {tools}
          {onRestart ? (
            <button
              type="button"
              className="icon-btn icon-btn-sm"
              title={LEARN.restart}
              aria-label={LEARN.restart}
              onClick={onRestart}
            >
              <RotateCcw size={15} aria-hidden="true" />
            </button>
          ) : null}
          <Link
            href="/"
            className="icon-btn icon-btn-sm"
            title={LEARN.exitPractice}
            aria-label={LEARN.exitPractice}
          >
            <X size={16} aria-hidden="true" />
          </Link>
        </div>
      </div>
      <ol className="learn-stages" aria-hidden="true">
        {stages.map((s) => (
          <li
            key={s.id}
            className={
              s.id < stage ? 'is-done' : s.id === stage ? 'is-current' : ''
            }
          />
        ))}
      </ol>

      <div className="learn-coach-body" aria-live="polite">
        {status}
        <p className="learn-coach-instruction">{instruction}</p>
        {children}
        {canShowMe ? (
          <div className="learn-coach-actions">
            <button
              type="button"
              className="btn btn-small btn-ghost"
              onClick={onShowMe}
            >
              <Eye size={16} aria-hidden="true" />
              {LEARN.showMe}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
