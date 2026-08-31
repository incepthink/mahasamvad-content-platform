'use client';

/**
 * The format dropdown that sits inside the composer, in place of the folded card of
 * five icon tiles this page used to carry.
 *
 * The tiles asked the question at full height on every visit, and the answer is
 * chosen once and then usually left alone — Creative is the default and by far the
 * most-used. A closed dropdown states the ANSWER in one line, which is what a
 * control the officer rarely changes should cost.
 *
 * व्हिडिओ is in the list but is not a format this form can submit: /video runs its
 * own two-gate flow, so selecting it navigates rather than setting state. That is why
 * `onNavigate` is a separate prop from `onSelect` — a caller cannot accidentally put
 * 'video' into the form's state.
 */

import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { FORMATS, formatName, type SelectableFormat } from './formats';

export function FormatMenu({
  value,
  onSelect,
  onNavigate,
  disabled = false,
  socialBusy,
  articleBusy,
}: {
  value: SelectableFormat;
  onSelect: (format: SelectableFormat) => void;
  onNavigate: (href: string) => void;
  disabled?: boolean;
  // One active task per lane: the Creative and caption entries are gated by an
  // in-flight social run (one n8n workflow, serial renders), Banner and the YouTube
  // thumbnail by an in-flight article-lane run. A selected entry that becomes disabled
  // is LEFT selected — submit() re-checks both flags, and moving the officer's choice
  // under their cursor would be worse than a refusal they can read.
  socialBusy: boolean;
  articleBusy: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          type="button"
          disabled={disabled}
          className="justify-between font-normal"
        >
          {formatName(value)}
          <ChevronDown aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuGroup>
          {FORMATS.map((option) => {
            const isLink = option.value === 'video';
            const busy =
              !isLink &&
              (option.value === 'caption' ||
              option.value === 'twitter' ||
              option.value === 'facebook'
                ? socialBusy
                : articleBusy);
            return (
              <DropdownMenuItem
                key={option.value}
                disabled={busy}
                className="flex-col items-start gap-0.5 py-2"
                onSelect={() => {
                  if (isLink) onNavigate('/video');
                  else onSelect(option.value as SelectableFormat);
                }}
              >
                <span className="font-medium">{option.name}</span>
                <span className="text-muted-foreground text-xs">
                  {option.desc}
                </span>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
