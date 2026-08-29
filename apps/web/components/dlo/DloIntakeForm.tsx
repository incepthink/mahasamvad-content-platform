'use client';

/**
 * The /dlo input step: two boxes over one pinned action.
 *
 *   DloComposer    — WHAT THE NEWS IS MADE OF: the typed note, the recordings, the
 *                    photographs, the documents and the links, in one card.
 *   DloAiPromptBox — WHAT THE OFFICER WANTS: heading or angle, emphasis, what to leave
 *                    out, how it should read.
 *   GenerateBar    — the one action, pinned to the foot of the viewport.
 *
 * This page is DELIBERATELY thin, the way app/page.tsx is. Every rule about what a run
 * sends, drafts and refuses lives in `useDloIntakeForm`; the three blocks below are
 * markup, and the two boxes are built out of the same primitives the Creative and Social
 * form uses (components/common) so the two surfaces cannot drift apart again.
 *
 * There is no article-type question: this lane produces बातमी only, so the category is
 * fixed rather than asked for.
 *
 * The action is pinned rather than placed at the end of the flow because the form's second
 * box is optional — a button below it sits under material most runs never fill in. It is
 * DISABLED until at least one source exists (`hasInput`), so the "nothing was supplied"
 * refusal is expressed as a dead button instead of as an error after a press.
 */

import { GenerateBar } from '../common/GenerateBar';
import { STR } from '../../lib/strings';
import { DloAiPromptBox } from './DloAiPromptBox';
import { DloComposer } from './DloComposer';
import { useDloIntakeForm } from './useDloIntakeForm';

export function DloIntakeForm() {
  const form = useDloIntakeForm();

  return (
    <>
      <div className="flex flex-col gap-5">
        <DloComposer form={form} />
        <DloAiPromptBox
          value={form.instructions}
          onChange={form.setInstructions}
          disabled={form.submitting}
        />
      </div>

      <GenerateBar
        label={form.submitting ? STR.submitting : STR.dloSubmit}
        busy={form.submitting}
        canSubmit={form.hasInput}
        onSubmit={() => void form.submit()}
        error={form.error}
      />
    </>
  );
}
