'use client';

// The two callouts every /learn lesson opens and closes with, shared so the lessons cannot
// drift apart: the intro (what you will do, "this is practice", सुरू करा) in the middle of the
// dimmed page before anything is lit, and the recap under the last step's instruction.

import Link from 'next/link';
import { LEARN } from '../../lib/strings';

export function LessonIntro({
  title,
  lead,
  steps,
  onStart,
}: {
  title: string;
  lead: string;
  steps: readonly string[];
  onStart: () => void;
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
      <div className="btn-row">
        <button type="button" className="btn btn-primary" onClick={onStart}>
          {LEARN.introStart}
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
