'use client';

/**
 * The one card shape both create surfaces use.
 *
 * Creative and Social (app/page.tsx) and लेख / बातमी (app/dlo/page.tsx) are the same
 * kind of page — a short stack of boxes over a pinned action — so the box itself is
 * decided once, here, rather than by a class string copied between them. That copy is
 * what let the two pages drift apart in the first place.
 *
 * The optional label/hint pair is part of the card rather than left to each caller,
 * because the relationship between the three (label, then hint, then the control) is
 * exactly what a caller gets subtly wrong: a hint set as a sibling of the label reads
 * as a second label, and a label with no `htmlFor` is not a label at all.
 */

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function FormCard({
  label,
  htmlFor,
  hint,
  children,
  className,
}: {
  label?: ReactNode | undefined;
  // Omit only when the card holds no single control to point at (the template picker).
  htmlFor?: string | undefined;
  hint?: ReactNode | undefined;
  children: ReactNode;
  className?: string | undefined;
}) {
  return (
    <section
      className={cn(
        'bg-card rounded-2xl border p-4 shadow-sm sm:p-5',
        className,
      )}
    >
      {label ? (
        <label
          className="text-foreground block text-base font-semibold"
          htmlFor={htmlFor}
        >
          {label}
        </label>
      ) : null}
      {hint ? (
        <p className="text-muted-foreground mt-1 text-sm">{hint}</p>
      ) : null}
      {children}
    </section>
  );
}
