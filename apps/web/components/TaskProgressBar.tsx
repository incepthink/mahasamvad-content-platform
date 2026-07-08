'use client';

// Determinate staged progress bar for a Twitter/n8n task. The bar fills as the
// API records each n8n stage ping (step); it mirrors the ~25/50/75/90 → 100%
// staging the runner + progress endpoint drive.

import type { GenerationStatus, GenerationStep } from '@dgipr/schemas';
import { STEP_LABELS, STR } from '../lib/strings';

// step → % filled. `null` (job accepted, no stage yet) shows a small starter
// fill so the bar never looks stuck at 0.
const STEP_PERCENT: Partial<Record<GenerationStep, number>> = {
  classify: 25,
  copy: 50,
  image: 75,
  caption: 90,
  done: 100,
};

export function TaskProgressBar({
  status,
  step,
}: {
  status: GenerationStatus;
  step: GenerationStep | null;
}) {
  const failed = status === 'failed';
  const done = status === 'completed';

  const percent = failed
    ? 100
    : done
      ? 100
      : step
        ? (STEP_PERCENT[step] ?? 5)
        : 5;

  const label = failed
    ? STR.failedTitle
    : done
      ? STR.stepDone
      : step
        ? STEP_LABELS[step]
        : STR.progressTitle;

  const stateClass = failed ? 'is-failed' : done ? 'is-done' : 'is-running';

  return (
    <div className={`task-progress ${stateClass}`}>
      <div
        className="task-progress-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label={label}
      >
        <div className="task-progress-fill" style={{ width: `${percent}%` }} />
      </div>
      <span className="task-progress-label">{label}</span>
    </div>
  );
}
