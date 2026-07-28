'use client';

// "सुरू असलेले काम" — shown at the top of /dlo only while one of this browser's own intakes is
// still queued or running.
//
// Deliberately a CARD and not a redirect. An officer whose first intake is transcribing very
// often came back to /dlo precisely to start a SECOND one, and auto-opening the running
// workspace would take the form away from them. The card serves the person resuming without
// penalising the person starting.

import Link from 'next/link';
import type { DloIntakeSummary } from '@dgipr/schemas';
import { DLO_INTAKE_STEP_LABELS, STR } from '../lib/strings';
import { DloStatusChip } from './DloStatusChip';

export function DloResumeCard({ intake }: { intake: DloIntakeSummary }) {
  return (
    <section className="card dlo-resume">
      <div className="dlo-resume-head">
        <span className="spinner" aria-hidden="true" />
        <h2>{STR.dloResumeTitle}</h2>
        <DloStatusChip status={intake.status} />
      </div>
      <p className="dlo-resume-title">{intake.title}</p>
      <p className="hint">
        {intake.step
          ? DLO_INTAKE_STEP_LABELS[intake.step]
          : STR.dloProcessingTitle}
      </p>
      <div className="btn-row" style={{ marginTop: 14 }}>
        <Link className="btn btn-primary" href={`/dlo/${intake.id}`}>
          {STR.dloResumeAction}
        </Link>
      </div>
    </section>
  );
}
