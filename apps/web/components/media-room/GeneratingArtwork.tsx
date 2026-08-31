'use client';

import React from 'react';
import { Sparkles } from 'lucide-react';
import type { GenerationStatus, GenerationStep } from '@dgipr/schemas';
import { STEP_LABELS } from '@/lib/strings';
import { cn } from '@/lib/utils';

/**
 * What a card shows while its render is being paid for.
 *
 * It holds the finished artwork's EXACT aspect ratio open, so the masonry column
 * does not reflow under the officer's cursor at the moment the image lands —
 * which is the one thing a placeholder on this page has to get right.
 *
 * The progress text is the run's own `step`, not a generic "Generating…": these
 * runs take tens of seconds and the step is the difference between "it is
 * writing the text" and "it is painting the image", which is what tells someone
 * whether it is worth waiting. It falls back to the status when a queued run has
 * no step yet.
 */
export function GeneratingArtwork({
  aspect,
  status,
  step,
}: {
  aspect: number;
  status: GenerationStatus;
  step: GenerationStep | null;
}) {
  const label = step
    ? STEP_LABELS[step]
    : status === 'queued'
      ? 'रांगेत…'
      : 'तयार करत आहोत…';

  return (
    <div
      className="relative isolate w-full overflow-hidden bg-accent"
      style={{ aspectRatio: aspect }}
      role="status"
      aria-live="polite"
      aria-label={label}
    >
      {/* Faint grid, so the tile reads as a surface being worked on rather than
          as an empty box the layout forgot to fill. */}
      <div
        className="absolute inset-0 opacity-60"
        style={{
          backgroundImage:
            'radial-gradient(circle at 1px 1px, rgba(140, 63, 32, 0.14) 1px, transparent 0)',
          backgroundSize: '14px 14px',
        }}
        aria-hidden
      />

      {/* The travelling highlight. `-z-0`/overflow-hidden on the parent keeps it
          inside the tile's rounded corners. */}
      <div className="absolute inset-0 overflow-hidden" aria-hidden>
        <div
          className="mr-sweep absolute inset-y-0 w-1/2"
          style={{
            background:
              'linear-gradient(90deg, transparent, rgba(255,255,255,0.75), transparent)',
          }}
        />
      </div>

      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-5 text-center">
        <span className="relative flex size-12 items-center justify-center">
          {/* A ring that turns, and a mark that breathes: two rates, so the
              motion does not read as a single stuck loop. */}
          <span
            className="absolute inset-0 animate-spin rounded-full border-2 border-primary/20 border-t-primary"
            style={{ animationDuration: '1.4s' }}
            aria-hidden
          />
          <Sparkles
            className="mr-breathe size-5 text-primary"
            aria-hidden
            strokeWidth={2.2}
          />
        </span>

        <span className="text-sm font-semibold text-accent-foreground">
          {label}
        </span>

        <span className="relative h-1 w-28 overflow-hidden rounded-full bg-primary/15">
          <span className="mr-track absolute inset-y-0 rounded-full bg-primary" />
        </span>
      </div>
    </div>
  );
}

/**
 * The same treatment at text scale, for the caption lane — which renders no
 * artwork at all, so a full-bleed image placeholder would promise a picture that
 * is never coming.
 */
export function GeneratingLines({ className }: { className?: string }) {
  return (
    <div className={cn('flex flex-col gap-2.5', className)} aria-hidden>
      {['92%', '100%', '78%'].map((width, index) => (
        <span
          key={width}
          className="relative h-3 overflow-hidden rounded-full bg-accent"
          style={{ width }}
        >
          <span
            className="mr-sweep absolute inset-y-0 w-1/2"
            style={{
              background:
                'linear-gradient(90deg, transparent, rgba(255,255,255,0.85), transparent)',
              animationDelay: `${index * 0.14}s`,
            }}
          />
        </span>
      ))}
    </div>
  );
}
