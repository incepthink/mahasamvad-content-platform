'use client';

// /dlo — the entry point for article work: a resume card for whatever this browser already has
// running, the new-intake form, and the shared list of recent work.
//
// Each intake lives at its own address (/dlo/[id]) rather than inside one always-mounted
// workspace, which is what lets several officers work at the same time and what makes a reload
// survivable — the intake row is the state of record, so it can be picked up again from any
// tab, any machine, by anyone. The order of the three blocks is deliberate: the person
// resuming is served first, but the form stays on the same screen so the person starting a
// second piece of work never has to navigate away to reach it.

import { DloIntakeForm } from '../../components/DloIntakeForm';
import { DloIntakeList } from '../../components/DloIntakeList';
import { DloResumeCard } from '../../components/DloResumeCard';
import { useDloIntakeList } from '../../lib/useDloIntakeList';
import { STR } from '../../lib/strings';

export default function DloPage() {
  const { mine, others, active, loading, error } = useDloIntakeList();

  return (
    // .dlo-page only reserves room at the foot of the page (and of the site footer below it)
    // for the intake form's pinned action bar — nothing else about the page depends on it.
    <main className="page dlo-page">
      <header className="page-head">
        <div className="page-head-text">
          <h1 className="page-title">{STR.dloTitle}</h1>
          <p className="page-sub">{STR.dloPageIntro}</p>
        </div>
      </header>

      {active ? <DloResumeCard intake={active} /> : null}

      <DloIntakeForm />

      <DloIntakeList
        mine={mine}
        others={others}
        loading={loading}
        error={error}
      />

      <style jsx global>{`
        .dlo-page .file-row .file-name {
          flex: 1;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      `}</style>
    </main>
  );
}
