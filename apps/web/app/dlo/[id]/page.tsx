'use client';

// One DLO intake's workspace. The id is in the URL and the state of record is the row, so a
// reload, a closed tab or a different machine all pick the work back up — and several officers
// can be at different intakes at the same time.

import { use } from 'react';
import DloWorkspace from '../../../components/DloWorkspace';

export default function DloIntakePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <DloWorkspace intakeId={id} />;
}
