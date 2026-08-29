'use client';

/**
 * BOX 2 on /dlo — one box for everything the officer wants to SAY about the article,
 * directly under the box holding what it is made of. The pair reads the same way Creative
 * and Social does: this is the source, this is the direction.
 *
 * It replaces three cards — शीर्षक किंवा बातमीचा रोख, तुमची विनंती and
 * नमुना बातमी — शैलीसाठी — which between them asked the officer three separate questions
 * before they had seen a single line of the article. In practice all three are the same
 * request written three ways ("make it about X", "lead with Y", "read like this"), so they
 * are one free-text box, and the run stores it as `generations.instructions` (0041).
 *
 * NOTHING IS LOST BY REMOVING THEM HERE. All three still stand on the workspace this run
 * opens into (DloFileWorkspace), which is where they can actually be answered: by then the
 * sources are attached and the recordings transcribed, so a heading and a style exemplar
 * are judgements about material that exists rather than guesses about material that does
 * not. What IS typed here is carried over to that screen through the intake's saved review
 * state, so the officer never answers the same question twice.
 *
 * The counter appears only once something is typed, and only warns near the ceiling — a
 * live "0 / 2,000" on an optional box reads as a form to fill in rather than an offer.
 */

import { useId } from 'react';
import { ARTICLE_INSTRUCTIONS_MAX_CHARS } from '@dgipr/schemas';
import { FormCard } from '@/components/common/FormCard';
import { PromptTextarea } from '@/components/common/PromptTextarea';
import { STR } from '@/lib/strings';

export function DloAiPromptBox({
  value,
  onChange,
  disabled = false,
}: {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean | undefined;
}) {
  // Generated rather than fixed: /dlo's review step can mount a sibling of this box, and
  // a hard-coded id would make one step's label focus the other step's input — the bug
  // PageRangeSelector already hit.
  const id = useId();
  const typed = value.trim().length;
  const tooLong = typed > ARTICLE_INSTRUCTIONS_MAX_CHARS;

  return (
    <FormCard
      htmlFor={id}
      label={STR.dloAiPromptLabel}
      hint={STR.dloAiPromptHint}
    >
      <PromptTextarea
        id={id}
        value={value}
        onChange={onChange}
        disabled={disabled}
        placeholder={STR.dloAiPromptPlaceholder}
        className="mt-3 max-h-60 min-h-20 w-full"
      />
      {typed > 0 ? (
        <p
          className={tooLong ? 'form-error' : 'text-muted-foreground text-sm'}
          aria-live="polite"
        >
          {tooLong
            ? STR.aiInstructionsTooLong
            : `${typed.toLocaleString('mr-IN')} / ${ARTICLE_INSTRUCTIONS_MAX_CHARS.toLocaleString('mr-IN')} ${STR.dloCharsSuffix}`}
        </p>
      ) : null}
    </FormCard>
  );
}
