'use client';

// One collapsible section inside a card: a header row that names the question and states
// the answer it currently holds, and a body that folds away.
//
// It exists because a create form mixes questions the officer answers on every run with
// ones they answer on few, and showing both at full height makes the page read as far more
// work than it is. The rule that makes folding safe is that the collapsed row must never
// hide the ANSWER — that is what `summary` is for, so a shut "काय तयार करायचे?" still says
// क्रिएटिव्ह.
//
// The body stays MOUNTED while closed (`hidden`, not unrendered) on purpose: the controls
// inside carry state and, in the template picker's case, a fetched library — unmounting
// would throw both away every time the row was folded.
//
// ReferencePicker's own 'disclosure' variant predates this and is deliberately left alone:
// same shape, but its head is wired to that picker's own selection state.

import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export function Disclosure({
  title,
  summary,
  // Whether `summary` states a real answer (accented) rather than a default (muted).
  summarySet = false,
  defaultOpen = false,
  icon: Icon,
  children,
}: {
  title: string;
  summary?: string | undefined;
  summarySet?: boolean | undefined;
  defaultOpen?: boolean | undefined;
  // Matches the icon treatment of the card headings this sits among (see CardTitle), so a
  // folded question does not read as a different kind of thing from an open card.
  icon?: LucideIcon | undefined;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();

  return (
    <div className="disclosure">
      <button
        type="button"
        className="disclosure-head"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="disclosure-chevron" aria-hidden="true">
          {open ? (
            <ChevronDown size={18} strokeWidth={2} />
          ) : (
            <ChevronRight size={18} strokeWidth={2} />
          )}
        </span>
        {Icon ? (
          <span className="card-title-icon" aria-hidden="true">
            <Icon size={20} strokeWidth={2} />
          </span>
        ) : null}
        <span className="disclosure-label">{title}</span>
        {summary ? (
          <span
            className={
              summarySet
                ? 'disclosure-summary disclosure-summary-set'
                : 'disclosure-summary'
            }
          >
            {summary}
          </span>
        ) : null}
      </button>
      <div id={bodyId} className="disclosure-body" hidden={!open}>
        {children}
      </div>
    </div>
  );
}
