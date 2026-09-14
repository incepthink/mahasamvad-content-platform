'use client';

/**
 * The one card shape both create surfaces use.
 *
 * Creative and Social (app/page.tsx) and लेख / बातमी (app/dlo/page.tsx) are the same
 * kind of page — a short stack of boxes over a pinned action — so the box itself is
 * decided once, here, rather than by a class string copied between them. That copy is
 * what let the two pages drift apart in the first place.
 *
 * IT RENDERS `glass-card`, NOT `bg-card border shadow-sm`, AND THAT IS A CASCADE
 * DECISION rather than a naming one. Those three are genuine Tailwind utilities, and
 * utilities are the LAST cascade layer — so a theme rule trying to give the card a
 * translucent background would lose to `bg-card` regardless of specificity, and the
 * card would render opaque with no error anywhere. `.glass-card` in app/theme.css
 * owns background, border and shadow instead, so no theme rule ever has to fight a
 * utility it cannot beat.
 *
 * The optional label/hint pair is part of the card rather than left to each caller,
 * because the relationship between the three (label, then hint, then the control) is
 * exactly what a caller gets subtly wrong: a hint set as a sibling of the label reads
 * as a second label, and a label with no `htmlFor` is not a label at all.
 *
 * `info` is the ⓘ that opens the field's full explanation. It is rendered BESIDE the
 * label rather than inside it, because a button nested in a `<label htmlFor=…>` also
 * focuses that label's control — so asking what a box is for would type into it.
 */

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function FormCard({
  label,
  htmlFor,
  hint,
  info,
  children,
  className,
}: {
  label?: ReactNode | undefined;
  // Omit only when the card holds no single control to point at (the template picker).
  htmlFor?: string | undefined;
  hint?: ReactNode | undefined;
  /** An `<InfoHint>` for this card's one question. */
  info?: ReactNode | undefined;
  children: ReactNode;
  className?: string | undefined;
}) {
  return (
    <section className={cn('glass-card rounded-2xl p-4 sm:p-5', className)}>
      {label ? (
        // -my-1 keeps the 28px button from adding height to the label row: the icon is
        // taller than the text it sits beside, and without this every card with one grew
        // by a few pixels against every card without.
        <div className="-my-1 flex items-center gap-1">
          <label
            className="text-foreground block text-base font-semibold"
            htmlFor={htmlFor}
          >
            {label}
          </label>
          {info}
        </div>
      ) : null}
      {hint ? (
        <p className="text-muted-foreground mt-1 text-sm">{hint}</p>
      ) : null}
      {children}
    </section>
  );
}
