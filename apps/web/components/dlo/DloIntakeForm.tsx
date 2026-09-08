'use client';

/**
 * The /dlo input step: the source composer carries the action; direction fields follow.
 *
 *   DloComposer    — WHAT THE NEWS IS MADE OF: the typed note, the recordings, the
 *                    photographs, the documents and the links, in one card — and, at the
 *                    end of its tool row, the run's one submit.
 *   Heading, DloAiPromptBox and StyleReferenceField keep the officer's production inputs.
 *
 * This page is DELIBERATELY thin, the way app/page.tsx is. Every rule about what a run
 * sends, drafts and refuses lives in `useDloIntakeForm`; the two blocks below are markup,
 * and both are built out of the same primitives the Creative and Social form uses
 * (components/common) so the two surfaces cannot drift apart again.
 *
 * There is no article-type question: this lane produces बातमी only, so the category is
 * fixed rather than asked for.
 *
 * THE ACTION IS NO LONGER PINNED. It was `GenerateBar` at the foot of the viewport, on the
 * reasoning that a button at the end of a several-block form sits below optional material;
 * it now sits inside the composer with the controls it acts on, which is the shape Creative
 * and Social moved to first and the reason everything compulsory is in that one card. The
 * submit condition is unchanged and lives with the button.
 */

import { DloAiPromptBox } from './DloAiPromptBox';
import { FormCard } from '../common/FormCard';
import { PromptInput } from '../common/PromptInput';
import { StyleReferenceField } from '../StyleReferenceField';
import { STR } from '@/lib/strings';
import { DloComposer } from './DloComposer';
import { useDloIntakeForm } from './useDloIntakeForm';

export function DloIntakeForm() {
  const form = useDloIntakeForm();

  return (
    <div className="flex flex-col gap-5">
      <DloComposer form={form} />
      <FormCard
        htmlFor="dlo-heading"
        label={STR.headingLabel}
        hint={STR.headingHint}
      >
        <PromptInput
          id="dlo-heading"
          value={form.heading}
          onChange={form.setHeading}
          placeholder={STR.headingPlaceholder}
          disabled={form.submitting}
          className="mt-3"
        />
      </FormCard>
      <DloAiPromptBox
        value={form.instructions}
        onChange={form.setInstructions}
        disabled={form.submitting}
      />
      <StyleReferenceField
        value={form.styleReference}
        onChange={form.setStyleReference}
        disabled={form.submitting}
        className=""
      />
    </div>
  );
}
