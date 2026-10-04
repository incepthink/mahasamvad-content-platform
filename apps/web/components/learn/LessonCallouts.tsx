'use client';

// The two callouts every /learn lesson opens and closes with, shared so the lessons cannot
// drift apart: the intro (what you will do, "this is practice", सुरू करा) in the middle of the
// dimmed page before anything is lit, and the recap under the last step's instruction.

import Link from 'next/link';
import { Play } from 'lucide-react';
import { LEARN } from '../../lib/strings';

export function LessonIntro({
  title,
  lead,
  steps,
  onStart,
  onAutoplay,
}: {
  title: string;
  lead: string;
  steps: readonly string[];
  onStart: () => void;
  // Given by a lesson that has a spoken autoplay mode: the intro then offers it first.
  onAutoplay?: (() => void) | undefined;
}) {
  return (
    <div className="learn-coach learn-intro">
      <h2>{title}</h2>
      <p>{lead}</p>
      <ol className="learn-intro-steps">
        {steps.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ol>
      <p className="info-callout learn-intro-practice">{LEARN.introPractice}</p>
      {onAutoplay ? <p className="hint">{LEARN.autoplayIntroHint}</p> : null}
      <div className="btn-row">
        {onAutoplay ? (
          <button
            type="button"
            className="btn btn-primary"
            data-autoplay="start"
            onClick={onAutoplay}
          >
            <Play size={18} aria-hidden="true" />
            {LEARN.autoplayStart}
          </button>
        ) : null}
        <button
          type="button"
          className={onAutoplay ? 'btn' : 'btn btn-primary'}
          onClick={onStart}
        >
          {onAutoplay ? LEARN.selfStart : LEARN.introStart}
        </button>
        <Link href="/" className="btn">
          {LEARN.exitPractice}
        </Link>
      </div>
    </div>
  );
}

export function LessonRecap({
  lines,
  onRestart,
}: {
  lines: readonly string[];
  onRestart: () => void;
}) {
  return (
    <div className="learn-recap">
      <p className="field-label">{LEARN.recapTitle}</p>
      <ol>
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ol>
      <div className="learn-coach-actions">
        <button type="button" className="btn btn-small" onClick={onRestart}>
          {LEARN.practiceAgain}
        </button>
        <Link href="/learn" className="btn btn-primary btn-small">
          {LEARN.backToLessons}
        </Link>
      </div>
    </div>
  );
}
