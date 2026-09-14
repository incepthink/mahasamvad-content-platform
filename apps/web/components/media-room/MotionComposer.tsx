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
 *                        submitted. The create request names its storage PATH. The moving
 *                        region is drawn ON that preview rather than in a section of its
 *                        own — see DEFAULT_MOTION_REGION below.
 *   मोशन ब्रीफ          — OPTIONAL. The poster alone is a complete request; this is where
 *                        an officer says which part of it should move.
 *   क्लिपचा आकार         — the frame the clip is published into. Its own field rather than
 *                        a chip strip in the text box's foot, which is where it started:
 *                        it wrapped onto two rows over the officer's own text.
 */

import { useRef, useState, type ReactNode } from 'react';
import { Lasso, Maximize2, Ratio, SquareDashed } from 'lucide-react';
import {
  MOTION_DIRECTION_MAX_CHARS,
  isMotionPolygon,
  type MotionCrop,
} from '@dgipr/schemas';
import { FormCard } from '@/components/common/FormCard';
import { FieldLabel } from '@/components/common/FieldLabel';
import { PromptTextarea } from '@/components/common/PromptTextarea';
import { MotionSourcePicker } from '@/components/MotionSourcePicker';
import { MotionCropBox } from '@/components/MotionCropBox';
import { MotionLassoBox } from '@/components/MotionLassoBox';
import { ErrorNotice } from '@/components/ErrorNotice';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { STR } from '@/lib/strings';
import { cn } from '@/lib/utils';
import { FormatMenu } from './FormatMenu';
import { OFFERED_MOTION_ASPECTS, type useCreateForm } from './useCreateForm';

type Form = ReturnType<typeof useCreateForm>;

export function MotionComposer({ form }: { form: Form }) {
  // Which selection tool draws the region. Local rather than on the form: the request only
  // carries the SHAPE, and the shape already says which tool made it.
  const [tool, setTool] = useState<'box' | 'lasso'>('box');
  // The rectangle the officer last had, so trying the lasso and coming back does not throw
  // away a box they had already placed.
  const lastBox = useRef<MotionCrop>({ ...DEFAULT_MOTION_REGION });

  const chooseBox = () => {
    if (tool === 'box') return;
    setTool('box');
    form.setMotionRegion({ ...lastBox.current });
  };

  const chooseLasso = () => {
    if (tool === 'lasso') return;
    setTool('lasso');
    // Nothing is selected until an outline is drawn. Keeping the old rectangle live but
    // invisible under the lasso tool would submit a region the officer can no longer see.
    form.setMotionRegion(null);
  };

  // The maximise dialog: the same poster, much larger, with the same selection tools. Both
  // copies of the overlay read and write the one region on the form, so whatever is drawn in
  // the dialog is already on the inline preview when it closes.
  const [expanded, setExpanded] = useState(false);

  const renderOverlay = () =>
    !form.motionSource ? null : tool === 'lasso' ? (
      <MotionLassoBox
        value={
          form.motionRegion && isMotionPolygon(form.motionRegion)
            ? form.motionRegion
            : null
        }
        onChange={form.setMotionRegion}
        disabled={form.submitting}
      />
    ) : form.motionRegion && !isMotionPolygon(form.motionRegion) ? (
      <MotionCropBox
        value={form.motionRegion}
        onChange={(rect) => {
          lastBox.current = rect;
          form.setMotionRegion(rect);
        }}
        // A moving region is free-form: MotionCropBox's ratio lock exists for a
        // different job (getting a trim to an exact publishing frame). What differs
        // between a trim and a region is MEANING — a cut versus a hole — and that
        // lives in the copy, not in a second component.
        aspect={null}
        disabled={form.submitting}
      />
    ) : null;

  const renderTools = (withExpand: boolean) => (
    <div
      className="motion-region-tools"
      role="group"
      aria-label={STR.motionRegionToolsLabel}
    >
      <div role="radiogroup" className="contents">
        <RegionToolButton
          active={tool === 'box'}
          disabled={form.submitting}
          label={STR.motionRegionToolBox}
          onClick={chooseBox}
        >
          <SquareDashed size={18} aria-hidden="true" />
        </RegionToolButton>
        <RegionToolButton
          active={tool === 'lasso'}
          disabled={form.submitting}
          label={STR.motionRegionToolLasso}
          onClick={chooseLasso}
        >
          <Lasso size={18} aria-hidden="true" />
        </RegionToolButton>
      </div>
      {withExpand ? (
        <>
          <span className="motion-region-divider" aria-hidden="true" />
          <button
            type="button"
            className="motion-region-tool"
            aria-label={STR.motionSourceExpand}
            title={STR.motionSourceExpand}
            disabled={form.submitting}
            onClick={() => setExpanded(true)}
          >
            <Maximize2 size={18} aria-hidden="true" />
          </button>
        </>
      ) : null}
    </div>
  );

  return (
    <FormCard
      htmlFor="motion-direction"
      label={
        <FieldLabel
          helpId="motion-direction-help"
          label={STR.motionDirectionLabel}
          hint={STR.motionDirectionHint}
        />
      }
    >
      {/* The upload comes FIRST: without it there is no run, and the brief below is a
          question about a poster the officer should already be looking at. */}
      <MotionSourcePicker
        value={form.motionSource}
        disabled={form.submitting}
        onChange={(next) => {
          form.setMotionSource(next);
          if (next) form.setError(null);
          // THE RECTANGLE IS ARMED WITH THE POSTER, not by a button under it. A video model
          // repaints every pixel it returns — it redraws the officer's Devanagari rather than
          // preserving it — so marking the one part that may move is what this lane wants in
          // the overwhelming majority of runs, and an opt-in nobody presses protects nobody.
          // Dragging it out to the full frame is how they say "repaint everything"; removing
          // the poster clears it, or the rectangle would outlive the picture it names.
          form.setMotionRegion(next ? { ...DEFAULT_MOTION_REGION } : null);
          // A new poster starts on the box again; a lasso drawn round the old one would name
          // a shape on a picture that is no longer there.
          setTool('box');
          lastBox.current = { ...DEFAULT_MOTION_REGION };
        }}
        overlay={renderOverlay()}
        tools={renderTools(true)}
      />

      {/* The two halves of what the rectangle means, said once, under the picture it is
          drawn on. Without it the box reads as an optional crop. */}
      {form.motionSource ? (
        <p className="text-muted-foreground mt-2 text-sm">
          {tool === 'lasso'
            ? STR.motionLassoActiveNote
            : STR.motionRegionActiveNote}
        </p>
      ) : null}

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

      {form.motionSource ? (
        <Dialog open={expanded} onOpenChange={setExpanded}>
          <DialogContent className="max-w-[min(96vw,1400px)] items-center">
            <DialogHeader className="self-stretch">
              <DialogTitle>{STR.motionSourceExpandTitle}</DialogTitle>
              <DialogDescription>
                {tool === 'lasso'
                  ? STR.motionLassoActiveNote
                  : STR.motionRegionActiveNote}
              </DialogDescription>
            </DialogHeader>
            <div className="motion-expand-frame">
              <img
                className="motion-expand-preview"
                src={form.motionSource.url}
                alt={form.motionSource.name}
              />
              {renderOverlay()}
            </div>
            {renderTools(false)}
          </DialogContent>
        </Dialog>
      ) : null}
    </FormCard>
  );
}

/**
 * One of the two selection tools under the poster. Icon-only, so `aria-label` and `title`
 * carry the wording; a radio because exactly one tool draws the region at a time.
 */
function RegionToolButton({
  active,
  disabled,
  label,
  onClick,
  children,
}: {
  active: boolean;
  disabled: boolean;
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn('motion-region-tool', active && 'is-active')}
    >
      {children}
    </button>
  );
}

/**
 * THE PART OF THE POSTER THAT MAY MOVE — and the reason it is worth asking.
 *
 * A video model repaints every pixel of every frame it returns. It does not preserve the
 * officer's Devanagari; it redraws it, which is survivable on a headline and garbled on a
 * card line. Marking a rectangle is what stops that: everything outside it is composited
 * back from the poster they uploaded after the render, so the letterforms are their own
 * rather than the model's guess at them.
 *
 * IT USED TO BE A SECTION OF ITS OWN, under the shape control, behind a
 * "हलणारा भाग निवडा" button — and an opt-in nobody presses protects nobody. It is now drawn
 * straight onto the preview and armed the moment a poster is attached: the rectangle is a
 * gesture over a picture, so the picture is where it belongs, and the question the old
 * heading asked is answered by the box already being there.
 *
 * A centred starting rectangle rather than an empty frame, because somewhere to start
 * dragging from is the one thing a free-form box cannot offer as an empty state.
 */
const DEFAULT_MOTION_REGION = {
  x: 0.15,
  y: 0.3,
  width: 0.7,
  height: 0.4,
} as const;

/**
 * THE SHAPE OF THE CLIP. It earns its hint: "the poster is padded into the frame" is the
 * one thing an officer cannot see until the clip comes back, and bars nobody warned them
 * about read as a defect.
 *
 * All production shapes are available, including the poster's own ratio.
 */
function MotionAspectField({ form }: { form: Form }) {
  return (
    <div className="mt-4 border-t pt-4">
      <p className="text-foreground flex items-center gap-2 text-sm font-semibold">
        <Ratio size={16} aria-hidden="true" />
        <FieldLabel
          helpId="motion-aspect-help"
          label={STR.motionAspectLabel}
          hint={STR.motionAspectHint}
        />
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
              {value === 'source'
                ? STR.motionAspectSource
                : value === '9:16'
                  ? STR.motionAspectPortrait
                  : STR.motionAspectLandscape}
            </button>
          );
        })}
      </div>
    </div>
  );
}
