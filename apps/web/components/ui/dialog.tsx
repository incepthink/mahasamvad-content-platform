'use client';

// The product's first modal, in the shadcn shape the rest of components/ui uses, over Radix's
// Dialog — which is what supplies the parts a hand-rolled overlay always gets wrong: the focus
// trap, the return of focus to whatever opened it, Escape, the scroll lock, `aria-modal` and
// the labelling that makes a screen reader announce the thing rather than the page behind it.
//
// `radix-ui` is already a dependency (button.tsx takes Slot from it), so this adds no package.

import * as React from 'react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { X } from 'lucide-react';

import { cn } from '@/lib/utils';

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogPortal = DialogPrimitive.Portal;
const DialogClose = DialogPrimitive.Close;

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        'fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px]',
        'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
        className,
      )}
      {...props}
    />
  );
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  closeLabel = 'बंद करा',
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean;
  closeLabel?: string;
}) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          'bg-card fixed top-1/2 left-1/2 z-50 flex w-[calc(100vw-1.5rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-2xl border p-5 shadow-lg',
          // A dialog can be taller than a phone once it holds a waveform, a ruler and a row
          // of controls, so it is capped and scrolls inside itself rather than pushing its
          // own actions off the bottom of the screen.
          'max-h-[calc(100dvh-1.5rem)] overflow-y-auto',
          'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton ? (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            className="ring-offset-background focus-visible:ring-ring hover:bg-muted absolute end-3.5 top-3.5 rounded-full p-1.5 opacity-70 transition-opacity hover:opacity-100 focus-visible:ring-2 focus-visible:outline-none disabled:pointer-events-none"
          >
            <X className="size-4" aria-hidden="true" />
            <span className="sr-only">{closeLabel}</span>
          </DialogPrimitive.Close>
        ) : null}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-header"
      // pe-8 keeps a long Devanagari title from running under the close button.
      className={cn('flex flex-col gap-1 pe-8 text-start', className)}
      {...props}
    />
  );
}

function DialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        'flex flex-col-reverse gap-2 sm:flex-row sm:justify-end',
        className,
      )}
      {...props}
    />
  );
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn('text-base leading-tight font-semibold', className)}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn('text-muted-foreground text-sm', className)}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
