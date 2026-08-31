'use client';

import { cn } from '@/lib/utils';
import { STR } from '@/lib/strings';

/**
 * The compact primary action shared by both DLO steps.
 *
 * The entry form and the source-review workspace offer the action in different cards, but it
 * must still look and behave like one control. Keeping the ready/disabled treatment here also
 * prevents a later visual change from updating only one of those screens.
 */
export function DloSubmitButton({
  label,
  submitting,
  disabled = false,
  onClick,
  className,
}: {
  label: string;
  submitting: boolean;
  disabled?: boolean | undefined;
  onClick: () => void;
  className?: string | undefined;
}) {
  const unavailable = submitting || disabled;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={unavailable}
      className={cn(
        'text-primary-foreground inline-flex h-9 shrink-0 items-center rounded-md px-5 text-sm font-bold transition-[filter]',
        'focus-visible:ring-ring/50 outline-none focus-visible:ring-[3px]',
        'disabled:cursor-not-allowed disabled:opacity-60',
        unavailable
          ? 'bg-primary'
          : 'mr-submit-flow hover:saturate-110 hover:brightness-105',
        className,
      )}
    >
      {submitting ? STR.submitting : label}
    </button>
  );
}
