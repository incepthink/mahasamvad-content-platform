'use client';

/**
 * InfoHint — the small ⓘ beside a field label or a page title.
 *
 * Every create surface carries at least one control whose rules cannot be said in the one
 * line a `hint` has room for: what a box is FOR, what happens when it is left blank, what
 * it will never do (a style sample supplies no facts; an AI direction supplies no names).
 * Those sentences used to be either missing or pushed into the hint, where a paragraph on
 * an optional field reads as a form to fill in. They live behind this instead: the hint
 * stays one line, and the full explanation is one tap away.
 *
 * IT IS A POPOVER, NOT A `title` ATTRIBUTE, AND THAT IS THE WHOLE POINT. A native tooltip
 * needs a mouse — it never opens on a phone, is not reachable from the keyboard, and is
 * dismissed by the browser after a few seconds. These officers work on phones, so the
 * explanation has to survive a tap. Radix Popover supplies what a hand-rolled panel gets
 * wrong: focus is moved into the panel and returned to the button, Escape closes it,
 * outside clicks close it, and the button carries the right `aria-expanded`/`aria-controls`
 * pairing. `radix-ui` is already a dependency (dialog.tsx, button.tsx), so this adds none.
 *
 * Hover opens it too, for a mouse — but ONLY as a convenience laid over the click, never
 * instead of it: the click is what a touch device and a keyboard both have.
 *
 * Place it BESIDE the label, never inside it. A button nested in a `<label htmlFor=…>` also
 * focuses that label's control, so asking what a box is for would type into it.
 */

import { useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { Popover as PopoverPrimitive } from 'radix-ui';
import { Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { STR } from '@/lib/strings';

export function InfoHint({
  text,
  label,
  className,
}: {
  /** The explanation. Marathi prose — one short paragraph, or a few lines. */
  text: string;
  /** What the button announces. Defaults to a generic "more information". */
  label?: string | undefined;
  className?: string | undefined;
}) {
  const [open, setOpen] = useState(false);
  // Hover-open must not fight a tap: a touch also fires pointerenter on many browsers, so
  // only a real mouse is allowed to open on hover, and the close is delayed so the pointer
  // can cross the gap between the button and the panel without it vanishing.
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Radix RETURNS FOCUS TO THE TRIGGER when the panel closes. After a keyboard open that
  // is exactly right. After a HOVER open it is not: focus was never moved, so putting it
  // on the button fires Chrome's focus-visible heuristic and leaves the 3px ring painted
  // on an ⓘ the pointer has already left — a ring that follows the mouse around the card.
  // This records which way it was opened so the close can tell them apart.
  const openedByHover = useRef(false);

  const hoverOpen = (event: ReactPointerEvent) => {
    if (event.pointerType !== 'mouse') return;
    if (closeTimer.current) clearTimeout(closeTimer.current);
    if (!open) openedByHover.current = true;
    setOpen(true);
  };

  const hoverClose = (event: ReactPointerEvent) => {
    if (event.pointerType !== 'mouse') return;
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), 120);
  };

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          aria-label={label ?? STR.infoHintLabel}
          onPointerEnter={hoverOpen}
          onPointerLeave={hoverClose}
          onPointerDown={() => {
            openedByHover.current = false;
          }}
          onKeyDown={() => {
            openedByHover.current = false;
          }}
          className={cn(
            // 28px: comfortably tappable without becoming a second control in the row.
            // `align-middle` keeps it on the label's baseline band rather than riding above
            // a Devanagari line, whose glyphs sit lower than Latin ones.
            'text-muted-foreground inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full align-middle transition-colors',
            // BOTH OF THESE RESETS ARE REQUIRED, and neither is tidiness. A <button> with
            // nothing declared takes the UA's own chrome: `border: 2px outset black` and a
            // `buttonface` fill (measured: rgb(240,240,240)). Nothing in this project resets
            // them, so at rest the ⓘ drew a black ring on a grey disc on every card.
            'border-0 bg-transparent',
            // ONE FILL FOR BOTH STATES, and that is the fix rather than a preference.
            // Hovering OPENS the popover, so `open` is true the instant the pointer lands
            // and the two states cannot be told apart by eye. Giving them different fills
            // only decided which `hover:bg-*` won the cascade — the open branch did, so the
            // disc went to near-black (#172033) on hover however the hover rule was tuned.
            //
            // The fill is the page's own pale navy, not the rail's slate: this sits on a
            // glass card, so it reads as part of the card rather than as a chip of the
            // sidebar dropped onto it. Navy on pale navy measures 9.2:1.
            'hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]',
            'focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-[3px]',
            open && 'bg-[var(--accent-soft)] text-[var(--accent)]',
            className,
          )}
        >
          <Info className="size-4" aria-hidden="true" />
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          side="top"
          align="start"
          sideOffset={6}
          collisionPadding={12}
          onPointerEnter={hoverOpen}
          onPointerLeave={hoverClose}
          // Never steal focus from the field a mouse user is already in — the panel is
          // reachable by keyboard from the button, which is what actually needs it.
          onOpenAutoFocus={(event) => event.preventDefault()}
          // See `openedByHover`. Keyboard opens keep the return — that is the only way back
          // out of the panel — while a hover open leaves focus where the reader left it.
          onCloseAutoFocus={(event) => {
            if (openedByHover.current) event.preventDefault();
          }}
          className={cn(
            // `bg-card border` rather than `glass-card`: the panel is PORTALLED to
            // document.body, and theme.css scopes the glass rule to `.page .glass-card` —
            // so a glass panel here would render with no background at all. The dialog,
            // portalled for the same reason, is painted the same way.
            'bg-card text-foreground z-50 max-w-[min(20rem,calc(100vw-1.5rem))] rounded-xl border p-3 text-sm leading-relaxed shadow-lg',
            'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
          )}
        >
          {text}
          <PopoverPrimitive.Arrow className="fill-[var(--card)]" />
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
