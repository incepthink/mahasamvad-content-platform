'use client';

/**
 * BOX 2 — the officer's own prompt for the image model (migration 0045), Creative only.
 *
 * Directly under the composer because the two are sent together and mean nothing
 * apart: this is the design brief, that is the words to put on it.
 *
 * IT REPLACES, IT DOES NOT ADD. Fill it and the platform's entire assembled poster
 * prompt is skipped — the image model gets the DGIPR designer line, this brief, the
 * text from Box 1, and the reserved-zone rule, which stays because the badge and
 * footer are composited in code afterwards and would otherwise land on top of the
 * officer's own poster. Nothing else: no palette, no arrangement anchor, no
 * reference-structure block, and no poster-copy call is made. The hint says so in as
 * many words, because an officer who types one extra instruction expecting it to be
 * ADDED to the usual rules would be reading this box exactly backwards.
 *
 * The template picker below still works with it: pinned, the master is the edit canvas
 * and this is the only instruction sent with it; unpinned, the poster is generated from
 * scratch. That question is answered by pinning, exactly as it is elsewhere.
 *
 * Banner, YouTube thumbnail and caption-only do not show it — the first two build their
 * image prompts on lanes this does not touch, and the third paints nothing at all.
 */

import { IMAGE_PROMPT_MAX_CHARS } from '@dgipr/schemas';
import { FormCard } from '@/components/common/FormCard';
import { PromptTextarea } from '@/components/common/PromptTextarea';
import { STR } from '@/lib/strings';
import type { useCreateForm } from './useCreateForm';

type Form = ReturnType<typeof useCreateForm>;

export function ImagePromptBox({ form }: { form: Form }) {
  return (
    <FormCard
      htmlFor="image-prompt"
      label={STR.imagePromptLabel}
      hint={STR.imagePromptHint}
    >
      <PromptTextarea
        id="image-prompt"
        maxLength={IMAGE_PROMPT_MAX_CHARS}
        placeholder={STR.imagePromptPlaceholder}
        value={form.imagePrompt}
        disabled={form.submitting}
        onChange={form.setImagePrompt}
        className="mt-3 max-h-60 min-h-20 w-full"
      />
    </FormCard>
  );
}
