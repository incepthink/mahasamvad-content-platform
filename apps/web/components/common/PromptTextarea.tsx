'use client';

/**
 * The chrome-less, self-growing text box both create surfaces type into.
 *
 * Two things are decided here so neither page can decide them differently:
 *
 * 1. IT IS COMPOSITION-SAFE. Officers type Marathi with an InScript keyboard, which
 *    assembles each character in stages; a controlled React box overwrites one of
 *    those stages and the character is lost. `ComposeSafeTextarea` renders it
 *    uncontrolled and only writes back when something other than the keyboard
 *    changed the value. See components/ComposeSafeInput for the full story.
 *
 * 2. IT GROWS WITH ITS CONTENT and then scrolls (`field-sizing:content` between a
 *    min and a max height), so a one-line poster caption and a pasted twelve-page
 *    note both look right in the same control without a resize handle.
 *
 * 3. IT CARRIES ITS OWN LIGHT BORDER. It deliberately had none — the card around it
 *    (FormCard) was meant to be the visible box — but in a card that also holds a tool
 *    row, an attachment strip and a set of opt-ins, a chrome-less textarea reads as
 *    prose rather than as the thing to type in: there was nothing marking where the
 *    typing area ended and the controls began. The border is the FAINT one
 *    (`border-input`), not the legacy sheet's 1.5px field border, so it separates the
 *    box from the card without turning it into a second card.
 */

import { ComposeSafeTextarea } from '@/components/ComposeSafeInput';
import { cn } from '@/lib/utils';

export function PromptTextarea({
  id,
  value,
  onChange,
  placeholder,
  disabled = false,
  maxLength,
  rows = 3,
  ariaLabel,
  className,
}: {
  id?: string | undefined;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string | undefined;
  disabled?: boolean | undefined;
  maxLength?: number | undefined;
  rows?: number | undefined;
  // Only where there is no visible <label> pointing at this box.
  ariaLabel?: string | undefined;
  // Callers override the height band with `min-h-*` / `max-h-*`; twMerge resolves the
  // conflict in the caller's favour.
  className?: string | undefined;
}) {
  return (
    <ComposeSafeTextarea
      id={id}
      rows={rows}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      disabled={disabled}
      maxLength={maxLength}
      aria-label={ariaLabel}
      className={cn(
        'placeholder:text-muted-foreground max-h-72 min-h-24 min-w-0 flex-1 resize-none',
        'overflow-y-auto bg-transparent px-3 py-2.5 text-base leading-7 shadow-none',
        // The legacy sheet styles every bare `textarea` (dgipr.css) with a heavier
        // border, its own radius and a 3px focus outline. Each of those is restated
        // here rather than left to win, or this box would look like a /translate field
        // dropped into a shadcn card.
        'border-input rounded-lg border',
        'outline-none [field-sizing:content]',
        'focus:outline-none',
        'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-[3px]',
        'disabled:opacity-60',
        className,
      )}
    />
  );
}
