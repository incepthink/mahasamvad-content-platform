'use client';

/**
 * The /dlo input step: TWO boxes, and the first one carries the action.
 *
 *   DloComposer    — WHAT THE NEWS IS MADE OF: the typed note, the recordings, the
 *                    photographs, the documents and the links, in one card — and, at the
 *                    end of its tool row, the run's one submit.
 *   DloAiPromptBox — WHAT THE OFFICER WANTS SAID ABOUT IT: one free-text direction.
 *
 * IT WAS FOUR. A heading field (शीर्षक किंवा बातमीचा रोख), the direction box and a style
 * sample (नमुना बातमी — शैलीसाठी) each asked their own question, before the officer had
 * seen a single line of the article. In practice all three are the same request written
 * three ways — "make it about X", "lead with Y", "read like this" — so they are one box,
 * and what is typed in it travels as `generations.instructions` (0041) alone: no heading
 * and no style reference are sent from this form any more. The prompt renders that block
 * LAST and ranks it above every general instruction (PRECEDENCE_RULE), which is what makes
 * one box able to carry what three fields used to.
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
import { DloComposer } from './DloComposer';
import { useDloIntakeForm } from './useDloIntakeForm';

export function DloIntakeForm() {
  const form = useDloIntakeForm();

  return (
    <div className="flex flex-col gap-5">
      <DloComposer form={form} />
      <DloAiPromptBox
        value={form.instructions}
        onChange={form.setInstructions}
        disabled={form.submitting}
      />
    </div>
  );
}
