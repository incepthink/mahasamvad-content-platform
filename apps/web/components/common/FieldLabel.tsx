'use client';

/**
 * The label the create surfaces put at the top of a FormCard: the question itself, with
 * its explanation folded behind an ⓘ rather than printed as a second line under it.
 *
 * It began as `ComposerLabel` inside NoteComposer and is shared because the page's boxes
 * have to READ as one form: a card whose hint is a visible paragraph and a card whose
 * hint is a tooltip look like controls borrowed from two different products, and the
 * paragraph version also pushes the control it describes further down the page each time
 * the wording grows. The label stays short and the same size everywhere; the explanation
 * is one hover/focus away.
 *
 * `helpId` must be unique on the page — it is what ties the tooltip to the trigger for a
 * screen reader, so two cards sharing one id would describe the wrong control.
 */

import { Info } from 'lucide-react';
import type { ReactNode } from 'react';

export function FieldLabel({
  label,
  hint,
  helpId,
}: {
  label: ReactNode;
  hint: ReactNode;
  helpId: string;
}) {
  return (
    <span className="relative flex w-full min-w-0 items-center gap-1.5">
      <span className="min-w-0">{label}</span>
      <span
        tabIndex={0}
        aria-label="माहिती"
        aria-describedby={helpId}
        className="peer text-muted-foreground inline-flex shrink-0 cursor-help rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-current"
      >
        <Info className="size-4" aria-hidden="true" />
      </span>
      <span
        id={helpId}
        role="tooltip"
        className="invisible absolute top-full left-0 z-30 mt-2 w-[min(24rem,100%)] rounded-md bg-[#19171d] px-3 py-2 text-left text-xs leading-5 font-normal text-white opacity-0 shadow-lg transition-opacity peer-hover:visible peer-hover:opacity-100 peer-focus-visible:visible peer-focus-visible:opacity-100"
      >
        {hint}
      </span>
    </span>
  );
}
