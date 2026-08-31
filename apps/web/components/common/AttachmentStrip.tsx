'use client';

/**
 * What is attached, as ONE horizontal row of file cards under the composer's tool
 * buttons — the shape officers already know from every chat assistant they use.
 *
 * It replaces three different representations of the same idea on /dlo: recordings
 * as a wrapped chip strip ABOVE the box, photographs as a thumbnail grid below it,
 * and documents as full-width blocks below that. Three answers to one question ("what
 * have I attached?") in three places is what made the composer read as three forms, so
 * a recording, a photograph and a document now differ only in their icon and in what
 * their second line says.
 *
 * Three things are decided here rather than by each caller:
 *
 * 1. IT SCROLLS SIDEWAYS AND NEVER WRAPS. A meeting can arrive as a dozen phone
 *    photographs; wrapped, that is a wall of tiles pushing the text box off screen, so
 *    the row keeps one line and takes a scrollbar. Each card is a fixed width for the
 *    same reason — a row of cards sized by their file names cannot be scanned.
 *
 * 2. PROGRESS BELONGS ON THE CARD. A document is read the moment it is attached (and a
 *    scan can take minutes), so the card carries the spinner and says what is happening
 *    on its second line. Without that, the only sign of a paid read in flight was a
 *    block further down the page.
 *
 * 3. THE FULL NAME IS NEVER THE LABEL. `FileName` trims what is SHOWN; the untrimmed
 *    name goes to the remove button's label, so a screen reader is still told which of
 *    three recordings the button drops.
 *
 * A card may be CLICKABLE (`onOpen`) for a source that has more to say — a document's
 * pages. Nothing else is: a recording is transcribed whole and has nothing to open.
 */

import { AlertTriangle, X, type LucideIcon } from 'lucide-react';
import { FileName } from '@/components/FileName';
import { cn } from '@/lib/utils';

export type AttachmentItem = Readonly<{
  // Stable across renders, and unique within one strip — a name alone is not, since two
  // phone photographs can arrive called IMG_0001.jpg.
  id: string;
  name: string;
  icon: LucideIcon;
  // A local object URL for a photograph, which is told apart by what it SHOWS and never
  // by IMG_20260811.jpg. Minted and revoked by the caller (see lib/useFilePreviews).
  previewUrl?: string | undefined;
  // The second line: a size, a page count, or what is happening to the file right now.
  meta?: string | undefined;
  busy?: boolean | undefined;
  failed?: boolean | undefined;
  // Marathi, and it names the thing being removed: "ध्वनिफीत काढा: baithak.mp3".
  removeLabel: string;
  onRemove?: (() => void) | undefined;
  // Only for a source with a block of its own below the strip (a document). Toggles it.
  onOpen?: (() => void) | undefined;
  openLabel?: string | undefined;
  // Its block is open, so the card reads as pressed.
  open?: boolean | undefined;
}>;

export function AttachmentStrip({
  items,
  disabled = false,
  className,
}: {
  items: readonly AttachmentItem[];
  disabled?: boolean | undefined;
  className?: string | undefined;
}) {
  if (items.length === 0) return null;

  return (
    <ul
      className={cn(
        // pb-1 leaves the scrollbar somewhere to sit without clipping the cards' shadow.
        // mb-0 drops the browser's own 1em bottom margin on a <ul> — 18px at this
        // product's 18px root, which read as a hole under the last card in a form.
        'attachment-strip -mx-1 mb-0 flex gap-2 overflow-x-auto px-1 pb-1',
        className,
      )}
    >
      {items.map((item) => (
        <AttachmentCard key={item.id} item={item} disabled={disabled} />
      ))}
    </ul>
  );
}

function AttachmentCard({
  item,
  disabled,
}: {
  item: AttachmentItem;
  disabled: boolean;
}) {
  const {
    name,
    icon: Icon,
    previewUrl,
    meta,
    busy = false,
    failed = false,
    removeLabel,
    onRemove,
    onOpen,
    openLabel,
    open = false,
  } = item;

  // The whole card is the button when there is something to open, so the click target is
  // the card rather than a control hidden inside it. Otherwise it is a plain <div>: a
  // button that does nothing is a promise the card cannot keep.
  const Body = onOpen ? 'button' : 'div';

  return (
    <li className="shrink-0">
      <div className="relative">
        <Body
          {...(onOpen
            ? {
                type: 'button' as const,
                onClick: onOpen,
                disabled,
                title: openLabel,
                'aria-expanded': open,
              }
            : {})}
          className={cn(
            'bg-card flex w-60 max-w-[72vw] items-center gap-2.5 rounded-xl border p-2 text-start shadow-sm transition-colors',
            // Room for the remove button in the top-right corner, so a long name can
            // never run under it.
            onRemove && 'pe-8',
            onOpen && 'hover:bg-accent cursor-pointer',
            open && 'border-primary/40 bg-accent',
            failed && 'border-destructive/50',
            disabled && 'opacity-60',
          )}
        >
          <span
            className={cn(
              'relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg',
              failed
                ? 'bg-destructive/10 text-destructive'
                : 'bg-accent text-accent-foreground',
            )}
          >
            {previewUrl ? (
              // A plain <img>: this is a local object URL of the officer's own pick,
              // which next/image can never optimise and would only wrap in a
              // build-time-configured loader.
              <img src={previewUrl} alt="" className="size-full object-cover" />
            ) : failed ? (
              <AlertTriangle className="size-5" aria-hidden="true" />
            ) : (
              <Icon className="size-5" aria-hidden="true" />
            )}
            {busy ? (
              <span className="bg-card/70 absolute inset-0 flex items-center justify-center">
                <span
                  className="border-primary size-4 animate-spin rounded-full border-2 border-t-transparent"
                  aria-hidden="true"
                />
              </span>
            ) : null}
          </span>

          <span className="flex min-w-0 flex-1 flex-col">
            <FileName
              name={name}
              className="truncate text-sm font-medium"
              max={28}
            />
            {meta ? (
              <span
                className={cn(
                  'truncate text-xs',
                  failed ? 'text-destructive' : 'text-muted-foreground',
                )}
                // The line changes while a read runs, so say so once rather than on
                // every card: only a busy card is a live region.
                {...(busy ? { 'aria-live': 'polite' as const } : {})}
              >
                {meta}
              </span>
            ) : null}
          </span>
        </Body>

        {/* Outside the card body, because the body is itself a button when the card
            opens something and a button inside a button is invalid markup. */}
        {onRemove ? (
          <button
            type="button"
            disabled={disabled}
            onClick={onRemove}
            aria-label={removeLabel}
            title={removeLabel}
            className="bg-card hover:bg-muted absolute end-1.5 top-1.5 rounded-full border p-0.5 disabled:opacity-50"
          >
            <X className="size-3.5" aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </li>
  );
}
