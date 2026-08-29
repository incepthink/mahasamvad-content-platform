'use client';

// One piece of work on the /new-dlo lane.
//
// The workspace itself is shared with /dlo/[id] (components/DloFileWorkspace) — both lanes
// now hand their documents to the article model as files, so there is exactly one screen
// between "the recordings are transcribed" and "write the article", and it belongs to
// neither route in particular.
//
// `params` is a Promise in Next 15 and is unwrapped with `use()` — the same shape /dlo/[id]
// uses. Typing it as a plain object compiles and then fails at runtime.

import { use } from 'react';
import { DloFileWorkspace } from '@/components/DloFileWorkspace';

export default function NewDloWorkspacePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <DloFileWorkspace intakeId={id} startOverHref="/new-dlo" />;
}
