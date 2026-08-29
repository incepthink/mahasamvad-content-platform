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
// The one difference from /new-dlo is the style reference: this lane's intake form stopped
// asking for one, so the question is offered here instead of being lost.

import { use } from 'react';
import { DloFileWorkspace } from '../../../components/DloFileWorkspace';

export default function DloIntakePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return (
    <DloFileWorkspace intakeId={id} startOverHref="/dlo" showStyleReference />
  );
}
