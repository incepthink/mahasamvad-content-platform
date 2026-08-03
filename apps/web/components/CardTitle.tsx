'use client';

// A card heading with a small icon in front of it.
//
// It exists so the icon treatment is decided once rather than at each of the ~15 call sites
// on /dlo — size, stroke, the tinted tile and the gap are all here, which is what keeps the
// cards on the intake form and the ones in the workspace looking like the same product.
//
// The icon is aria-hidden ON PURPOSE. It is a scanning aid, never information: the heading
// text beside it already says what the card is, so a screen reader announcing a glyph name
// would only repeat it. That is the same stance globals.css takes at the top of the file —
// nothing may be carried by colour (or a pictogram) alone.

import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

export function CardTitle({
  icon: Icon,
  children,
  // A few cards sit inside a larger section and title themselves with an <h3> (the names
  // review). The look is identical; only the document outline differs.
  level = 2,
  className,
}: {
  icon: LucideIcon;
  children: ReactNode;
  level?: 2 | 3 | undefined;
  className?: string | undefined;
}) {
  const Heading = level === 3 ? 'h3' : 'h2';
  return (
    <Heading className={className ? `card-title ${className}` : 'card-title'}>
      <span className="card-title-icon" aria-hidden="true">
        <Icon size={20} strokeWidth={2} />
      </span>
      <span>{children}</span>
    </Heading>
  );
}
