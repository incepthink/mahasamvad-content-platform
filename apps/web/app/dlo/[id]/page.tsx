'use client';

// One DLO intake's workspace. The id is in the URL and the state of record is the row, so a
// reload, a closed tab or a different machine all pick the work back up — and several officers
// can be at different intakes at the same time.
//
// It renders the SAME workspace /new-dlo/[id] does, because /dlo now takes its sources the
// same way: a document or a photograph is uploaded to OpenAI when it is attached and read by
// the article call itself, so there is no page selection, no OCR phase and no per-source
// transcript to review. The old page-by-page workspace is still in the tree
// (components/DloWorkspace.tsx) and is what to restore if that lane is ever wanted back.
//
// Two differences from /new-dlo. The direction UI: this lane keeps the same single
// "AI साठी सूचना" box on both screens instead of splitting heading, instructions and a style
// sample into three separate questions after upload. And `autoGenerate`: there is NO name-
// confirm step here — the intake form already asks for everything a run needs, so the article
// is written as soon as the sources are ready and the officer lands on /generations/[id],
// where the draft streams in. This screen is only ever the wait in between. See
// DloFileWorkspace's `autoGenerate` for the two costs that choice carries.

import { use } from 'react';
import { DloFileWorkspace } from '../../../components/DloFileWorkspace';

export default function DloIntakePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return (
    <DloFileWorkspace
      intakeId={id}
      startOverHref="/dlo"
      unifiedInstructions
      showBackdrop
      autoGenerate
    />
  );
}
