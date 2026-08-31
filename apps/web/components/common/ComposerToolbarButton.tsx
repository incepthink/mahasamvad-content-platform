'use client';

/**
 * One tool in a composer's button row: attach a recording, attach a photograph,
 * attach a document, paste a link.
 *
 * Icon-only, because the row is scanned rather than read and four worded buttons
 * across a composer is a second form. That makes the label mandatory, not optional —
 * it is the `title` and the `aria-label`, so the meaning is never carried by the
 * glyph alone (globals.css states that rule for the whole product).
 *
 * `active` is for a tool that opens a panel below the composer rather than a file
 * dialog: the button stays lit while its panel is open, so the officer can see which
 * of them put it there.
 */

import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function ComposerToolbarButton({
  icon: Icon,
  label,
  onClick,
  disabled = false,
  active = false,
  controls,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  disabled?: boolean | undefined;
  active?: boolean | undefined;
  // The id of the panel this button opens, when it opens one.
  controls?: string | undefined;
}) {
  return (
    <Button
      variant="outline"
      size="icon"
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      {...(controls
        ? { 'aria-controls': controls, 'aria-expanded': active }
        : {})}
      className={cn('shrink-0', active && 'bg-accent')}
    >
      <Icon />
    </Button>
  );
}
