'use client';

/**
 * BOX 1 — the composer. Everything that describes WHAT is being made lives in this
 * one card: the text, the file behind [+], which format, and the two Creative
 * opt-ins.
 *
 * THE SUBMIT LIVES IN THIS CARD, at the end of the tool row beside the two Creative
 * opt-ins. It used to be `GenerateBar`, pinned to the foot of the viewport, on the
 * reasoning that a button under a several-block form is off screen. Here it sits with
 * the controls it acts on instead — everything compulsory is in this one card, and the
 * blocks below it (the image brief, the template pin) are optional. Every complaint the
 * form can raise is rendered directly under it, so a refusal is never scrolled away from
 * the button that caused it.
 *
 * The [+] button sits in the tool row beside the format control and opens the shared
 * document intake INSIDE this card rather than as a card of its own: the file is a
 * source for the same box above it, and as a separate card it read as a separate form —
 * an officer could finish the page without noticing the two were related.
 *
 * WHAT IS ATTACHED IS A CARD IN THE STRIP under the tool row (`AttachmentStrip`), the
 * shape every chat assistant uses and the same one /dlo's composer shows. The upload
 * block below it is then folded away once the file is READ, and kept open while it still
 * has something to ask — a page selection, or a failure to report. That fold is what [+]
 * toggles for a finished document; it can never hide work still in progress, and the
 * strip's card opens the block again for a second look at the pages.
 */

import { FileText, Paperclip } from 'lucide-react';
import {
  POSTER_HEADING_MAX_CHARS,
  UPLOAD_FILE_MAX_BYTES,
} from '@dgipr/schemas';
import { Button } from '@/components/ui/button';
import {
  AttachmentStrip,
  type AttachmentItem,
} from '@/components/common/AttachmentStrip';
import { FormCard } from '@/components/common/FormCard';
import { PromptTextarea } from '@/components/common/PromptTextarea';
import { DocumentIntake } from '@/components/DocumentIntake';
import { ErrorNotice } from '@/components/ErrorNotice';
import { STR } from '@/lib/strings';
import { cn } from '@/lib/utils';
import { FormatMenu } from './FormatMenu';
import { DOC_STORAGE_KEY, type useCreateForm } from './useCreateForm';

type Form = ReturnType<typeof useCreateForm>;

export function NoteComposer({ form }: { form: Form }) {
  // The upload block stays open on its own while the document still needs the officer —
  // a scanned PDF waiting for its page selection, or a read that failed. Folding either
  // away would hide the question, and in the page-selection case the run would then be
  // submitted from a document nobody had paid to read.
  //
  // A document that is being READ, or is read and correct, is fully described by its card
  // in the strip; the block below it is a page list nobody has asked to see.
  const docNeedsBlock =
    form.docStatus === 'unread' || form.docStatus === 'failed';
  const docAttached = form.docStatus !== 'empty';
  const showDoc = form.docOpen || docNeedsBlock;

  const attachments: AttachmentItem[] = form.docInfo
    ? [
        {
          id: 'document',
          name: form.docInfo.fileName,
          icon: FileText,
          meta:
            form.docStatus === 'reading'
              ? STR.attachmentReading
              : form.docStatus === 'unread'
                ? STR.attachmentNeedsPages
                : form.docStatus === 'failed'
                  ? STR.attachmentFailed
                  : form.docInfo.pageCount !== null
                    ? `${form.docInfo.pageCount.toLocaleString('mr-IN')} ${STR.attachmentPagesSuffix}`
                    : STR.attachmentReady,
          busy: form.docStatus === 'reading',
          failed: form.docStatus === 'failed',
          removeLabel: `${STR.docRemove}: ${form.docInfo.fileName}`,
          // Throw the attached file away without starting a run. Its text is counted at
          // submit whether or not anyone is still looking at it, so an officer who decided
          // to generate from the typed text alone needs a way to detach it.
          onRemove: () => {
            form.clearDocument();
            form.setDocOpen(false);
          },
          // Only while the block is foldable: opening it is the point of the card, but a
          // block that is on screen asking a question must not be closable from here.
          ...(docNeedsBlock
            ? {}
            : {
                open: showDoc,
                openLabel: showDoc ? STR.attachmentClose : STR.attachmentOpen,
                onOpen: () => form.setDocOpen((open) => !open),
              }),
        },
      ]
    : [];

  return (
    <FormCard
      htmlFor="note"
      label={form.fromArticle ? STR.articleSourceLabel : STR.articlePasteLabel}
      hint={form.fromArticle ? STR.articleSourceHint : STR.articlePasteHint}
    >
      {/* Handoff from a finished run's cross-format link. The failure is stated rather
          than silent — an empty box with no explanation reads as the link not working. */}
      {form.prefill === 'loading' ? (
        <p className="text-muted-foreground mt-3 text-sm" aria-live="polite">
          {STR.prefillLoading}
        </p>
      ) : form.prefill === 'applied' ? (
        <p className="mt-3 text-sm text-emerald-700">{STR.prefillApplied}</p>
      ) : form.prefill === 'failed' ? (
        <div className="mt-3">
          <ErrorNotice message={STR.prefillFailed} />
        </div>
      ) : null}

      {/* The text has the full width of the card. The textarea grows with its content
          up to a cap and then scrolls, so a short poster line and a pasted article both
          look right in the same control. */}
      <div className="mt-4">
        <PromptTextarea
          id="note"
          value={form.note}
          onChange={(next) => {
            form.setNote(next);
            if (next.trim()) form.setError(null);
          }}
          placeholder={
            form.fromArticle
              ? STR.articleSourcePlaceholder
              : STR.articlePastePlaceholder
          }
        />
      </div>

      {/* Between the text and the tool row that carries the [+], so "attach" and
          "attached" are one place on the screen. */}
      <AttachmentStrip
        items={attachments}
        disabled={form.submitting}
        className="mt-3"
      />

      {/* A finished article often arrives as a file rather than in the clipboard — a Word
          document, or a scanned press note. The shared intake reads it here; a scanned
          PDF stops to ask which pages are worth OCR'ing before a single credit is spent.

          LIVE mode (onTextChange): the file's text is a SECOND source counted beside the
          box above, not something pushed into it — so pasting, uploading, or doing both
          all just work. It used to be appended by a button inside the card, which meant
          an upload that was never handed over was silently dropped and the submit
          complained the note was too short. */}
      {showDoc ? (
        <div id="note-document" className="mt-3">
          <DocumentIntake
            key={form.docKey}
            storageKey={DOC_STORAGE_KEY}
            embedded
            // Names this surface so a paid OCR read lands on this feature's service
            // card rather than being counted in the bill and attributed to nobody.
            feature="social"
            maxBytes={UPLOAD_FILE_MAX_BYTES}
            onTextChange={(text) => {
              form.setDocText(text);
              if (text.trim()) form.setError(null);
            }}
            onStatusChange={form.setDocState}
            readRequest={form.readRequest}
            // Throw the attached file away without starting a run. In live mode its text
            // is counted at submit whether or not anyone is still looking at it, so an
            // officer who decided to generate from the typed text alone needs a way to
            // detach it. Offered only once there IS a file — in the empty state there is
            // nothing to delete, and the [+] toggle already closes the card.
            {...(docAttached
              ? {
                  onRemove: () => {
                    form.clearDocument();
                    form.setDocOpen(false);
                  },
                }
              : {})}
          />
        </div>
      ) : null}

      {/* The format, then the two Creative opt-ins about the text above. Both opt-ins are
          OFF by default and are shown only where they can affect the run — a control
          that changes nothing would be a lie.

          जसाच्या तसा मजकूर — print the box unchanged instead of writing the poster's copy
            out of it. Available with or without a template ('fresh_verbatim'/'onbrand').
          कॅप्शनही तयार करा — the caption is a second paid call and can be added afterwards
            from the detail page, so off is a cheap default rather than a lossy one. */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {/* [+] sits with the format control rather than beside the text box: this row is
            the one band of controls on the card, and an icon floating next to the
            textarea read as part of the text field rather than as an action. It is the
            same h-9 as everything else in the row. */}
        <Button
          variant="outline"
          size="icon"
          type="button"
          aria-expanded={showDoc}
          aria-controls="note-document"
          title={STR.docUpload}
          aria-label={STR.docUpload}
          disabled={form.submitting}
          onClick={() => form.setDocOpen((open) => !open)}
          className={cn('shrink-0', showDoc && 'bg-accent')}
        >
          <Paperclip />
        </Button>

        <FormatMenu
          value={form.format}
          onSelect={form.chooseFormat}
          onNavigate={(href) => form.router.push(href)}
          disabled={form.submitting}
          socialBusy={form.hasActiveSocialTask}
          articleBusy={form.hasActiveArticleTask}
        />

        {form.isSocial ? (
          <>
            <CheckOption
              checked={form.verbatimText}
              disabled={form.submitting}
              onChange={(checked) =>
                form.setContentSource(checked ? 'verbatim' : 'ai')
              }
              label={STR.posterSourceVerbatim}
              title={STR.posterSourceVerbatimDesc}
            />
            <CheckOption
              checked={form.wantCaption}
              disabled={form.submitting}
              onChange={form.setWantCaption}
              label={STR.captionToggleLabel}
              title={STR.captionToggleHint}
            />
          </>
        ) : null}

        {/* The page's one action, pushed to the end of the same row. `ml-auto` is what
            keeps it at the right edge on a wide card and lets it wrap onto its own line
            with the rest when the row runs out of width. Enabled, it carries the slow
            warm sheen (`mr-submit-flow`, globals.css) — the only moving thing on the
            page, so "there is something to press now" reads without a label; disabled it
            is quiet and still. The condition is the form's, unchanged. */}
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

      {/* Why a press would be refused, stated under the button rather than beside the
          field that caused it — the officer presses here, so the answer belongs here. */}
      {form.hasActiveSocialTask ? (
        <p className="text-muted-foreground mt-2 text-sm">
          {STR.socialBusyInfo}
        </p>
      ) : null}
      {form.hasActiveArticleTask ? (
        <p className="text-muted-foreground mt-2 text-sm">
          {STR.articleBusyInfo}
        </p>
      ) : null}
      {form.error ? (
        <div className="mt-3">
          <ErrorNotice message={form.error} />
        </div>
      ) : null}

      {/* What a Banner SAYS is part of choosing what to make, so it sits with the format
          control rather than in a card of its own. Social posters do not have it — their
          headline is written into a multi-field copy object with no single line to lock.
          Left blank (the normal case) the run reads the scheme / award / campaign name
          out of the note itself. */}
      {form.isArticle ? <PosterHeadingField form={form} /> : null}
    </FormCard>
  );
}

/**
 * A checkbox that reads as a chip beside the format button, so the row is one band of
 * controls rather than a button and then a form. The description is a `title` rather
 * than a second line: at full height these two opt-ins were taller than the text box
 * they qualify, and almost every run wants both defaults.
 */
function CheckOption({
  checked,
  disabled,
  onChange,
  label,
  title,
}: {
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  title: string;
}) {
  return (
    <label
      title={title}
      className={cn(
        'inline-flex h-9 shrink-0 cursor-pointer select-none items-center gap-2 rounded-md border px-3 text-sm transition-colors',
        'bg-background hover:bg-accent hover:text-accent-foreground',
        checked && 'border-primary/40 bg-accent',
        disabled && 'pointer-events-none opacity-50',
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="accent-primary size-4"
      />
      {label}
    </label>
  );
}

function PosterHeadingField({ form }: { form: Form }) {
  return (
    <div className="mt-4 border-t pt-4">
      <label
        className="text-foreground block text-sm font-semibold"
        htmlFor="poster-heading"
      >
        {STR.posterHeadingLabel}
      </label>
      <p className="text-muted-foreground mt-1 text-sm">
        {STR.posterHeadingCreateHint}
      </p>
      <input
        id="poster-heading"
        type="text"
        maxLength={POSTER_HEADING_MAX_CHARS}
        placeholder={STR.posterHeadingPlaceholder}
        value={form.posterHeading}
        disabled={form.submitting}
        onChange={(event) => form.setPosterHeading(event.target.value)}
        // Restated rather than left to the legacy sheet, which styles every bare
        // `input[type=text]` with a heavier 1.5px field border, its own radius and a 3px
        // focus outline. Inside this card that read as a control borrowed from another
        // page; it now matches the text box above it exactly (see PromptTextarea).
        className={cn(
          'border-input mt-2 w-full rounded-lg border bg-transparent px-3 py-2.5 text-base',
          'outline-none focus:outline-none',
          'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-[3px]',
          'disabled:opacity-60',
        )}
      />
    </div>
  );
}
