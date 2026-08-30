'use client';

import { ComposeSafeInput } from '@/components/ComposeSafeInput';
import { cn } from '@/lib/utils';

/** A composition-safe single-line companion to PromptTextarea. */
export function PromptInput({
  id,
  value,
  onChange,
  placeholder,
  disabled = false,
  list,
  className,
}: {
  id?: string | undefined;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string | undefined;
  disabled?: boolean | undefined;
  list?: string | undefined;
  className?: string | undefined;
}) {
  return (
    <ComposeSafeInput
      id={id}
      type="text"
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      disabled={disabled}
      list={list}
      className={cn(
        'border-input placeholder:text-muted-foreground h-10 w-full min-w-0 rounded-lg border bg-transparent px-3 py-2 text-base shadow-none outline-none',
        'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
        'disabled:cursor-not-allowed disabled:opacity-60',
        className,
      )}
    />
  );
}
