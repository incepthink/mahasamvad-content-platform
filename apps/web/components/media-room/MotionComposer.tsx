'use client';

/**
 * BOX 1, डायनॅमिक पोस्टर LANE — the composer for the one format whose SOURCE is a
 * picture rather than text (migration 0052).
 *
 * It stands in for `NoteComposer` rather than sitting beside it: the box that would ask
 * for text is replaced outright rather than left there to be ignored. What it keeps from
 * that card is everything that is not about the text — the format control, the submit at
 * the end of the same tool row, and the complaints rendered under the button that caused
 * them — so switching lanes is one press and lands in the same place on the page.
 *
 * What it deliberately does NOT render, because none of it can affect a run that animates
 * a finished poster: the [+] document upload (the source is the uploaded picture), the two
 * Creative opt-ins (there is no copy to write and no caption to add), the image brief, and
 * the template pin. `page.tsx` hides the last two by asking `form.isDynamicPoster`.
 *
 * The three fields are the officer's whole input:
 *
 *   MotionSourcePicker — the finished poster, uploaded and normalised before the form is
 *                        submitted. The create request names its storage PATH.
 *   मोशन ब्रीफ          — OPTIONAL. The poster alone is a complete request; this is where
 *                        an officer says which part of it should move.
 *   क्लिपचा आकार         — the frame the clip is published into. Its own field rather than
 *                        a chip strip in the text box's foot, which is where it started:
 *                        it wrapped onto two rows over the officer's own text.
 */

import { Ratio } from 'lucide-react';
import { MOTION_DIRECTION_MAX_CHARS } from '@dgipr/schemas';
import { FormCard } from '@/components/common/FormCard';
import { PromptTextarea } from '@/components/common/PromptTextarea';
import { MotionSourcePicker } from '@/components/MotionSourcePicker';
import { ErrorNotice } from '@/components/ErrorNotice';
import { STR } from '@/lib/strings';
import { cn } from '@/lib/utils';
import { FormatMenu } from './FormatMenu';
import { OFFERED_MOTION_ASPECTS, type useCreateForm } from './useCreateForm';

type Form = ReturnType<typeof useCreateForm>;

export function MotionComposer({ form }: { form: Form }) {
  return (
    <FormCard
      htmlFor="motion-direction"
      label={STR.motionDirectionLabel}
      hint={STR.motionDirectionHint}
    >
      {/* The upload comes FIRST: without it there is no run, and the brief below is a
          question about a poster the officer should already be looking at. */}
      <MotionSourcePicker
        value={form.motionSource}
        disabled={form.submitting}
        onChange={(next) => {
          form.setMotionSource(next);
          if (next) form.setError(null);
        }}
      />

      <div className="mt-4">
        <PromptTextarea
          id="motion-direction"
          value={form.motionDirection}
          onChange={form.setMotionDirection}
          placeholder={STR.motionDirectionPlaceholder}
          disabled={form.submitting}
          maxLength={MOTION_DIRECTION_MAX_CHARS}
          ariaLabel={STR.motionDirectionLabel}
        />
      </div>

      {/* The same tool row NoteComposer carries, minus everything that is about text.
          Keeping the format control here is what lets an officer leave this lane again —
          the picker is not rendered anywhere else on the page. */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <FormatMenu
          value={form.format}
          onSelect={form.chooseFormat}
          onNavigate={(href) => form.router.push(href)}
          disabled={form.submitting}
          socialBusy={form.hasActiveSocialTask}
          articleBusy={form.hasActiveArticleTask}
        />

        {/* `form.startSubmit()` rather than a direct submit: on this lane it falls straight
            through to it, since the read-the-attached-document step it exists for cannot
            apply where no document can be attached. Asking the form keeps one entry point. */}
        <button
          type="button"
          onClick={() => void form.startSubmit()}
          disabled={form.submitBusy || !form.canSubmit}
          className={cn(
            'text-primary-foreground ml-auto inline-flex h-9 shrink-0 items-center rounded-md px-5 text-sm font-bold transition-[filter]',
            'focus-visible:ring-ring/50 outline-none focus-visible:ring-[3px]',
            'disabled:cursor-not-allowed disabled:opacity-60',
            form.submitBusy || !form.canSubmit
              ? 'bg-primary'
              : 'mr-submit-flow hover:saturate-110 hover:brightness-105',
          )}
        >
          {form.submitLabel}
        </button>
      </div>

      {/* Why a press would be refused, stated under the button rather than beside the field
          that caused it. This lane takes NEITHER busy gate — it runs its own job — so the
          two notices NoteComposer shows have nothing to say here. */}
      {form.error ? (
        <div className="mt-3">
          <ErrorNotice message={form.error} />
        </div>
      ) : null}

      <MotionAspectField form={form} />
    </FormCard>
  );
}

/**
 * THE SHAPE OF THE CLIP. It earns its hint: "the poster is padded into the frame" is the
 * one thing an officer cannot see until the clip comes back, and bars nobody warned them
 * about read as a defect.
 *
 * The poster's own ratio is not on offer — see OFFERED_MOTION_ASPECTS in useCreateForm for
 * why, and why it is filtered off the shared list rather than written out a second time.
 */
function MotionAspectField({ form }: { form: Form }) {
  return (
    <div className="mt-4 border-t pt-4">
      <label
        className="text-foreground flex items-center gap-2 text-sm font-semibold"
        htmlFor="motion-aspect-9-16"
      >
        <Ratio size={16} aria-hidden="true" />
        {STR.motionAspectLabel}
      </label>
      <p className="text-muted-foreground mt-1 text-sm">
        {STR.motionAspectHint}
      </p>
      <div
        className="mt-2 flex flex-wrap gap-2"
        role="radiogroup"
        aria-label={STR.motionAspectLabel}
      >
        {OFFERED_MOTION_ASPECTS.map((value) => {
          const active = form.motionAspect === value;
          return (
            <button
              key={value}
              id={`motion-aspect-${value.replace(':', '-')}`}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={form.submitting}
              onClick={() => form.setMotionAspect(value)}
              className={cn(
                'inline-flex h-9 shrink-0 items-center rounded-md border px-3 text-sm transition-colors',
                'bg-background hover:bg-accent hover:text-accent-foreground',
                active && 'border-primary/40 bg-accent font-medium',
                form.submitting && 'pointer-events-none opacity-50',
              )}
            >
              {value === '9:16'
                ? STR.motionAspectPortrait
                : STR.motionAspectLandscape}
            </button>
          );
        })}
      </div>
    </div>
  );
}
