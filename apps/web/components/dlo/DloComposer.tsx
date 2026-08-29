'use client';

/**
 * BOX 1 on /dlo — the one input. Everything the news is MADE OF goes in here: what the
 * officer types, the recordings, the photographs, the documents and the links.
 *
 * It was three cards. A notes box, a "स्रोत जोडा" card and a "यूट्युब व्हिडिओ" card, each
 * with its own heading and hint, all three scrolled past on every visit even when only one
 * of them was being used. They ask a single question — "what is this news made of?" — so
 * they are one card with one text box and a row of tools, which is the shape the officer
 * already knows from Creative and Social (components/media-room/NoteComposer).
 *
 * EVERY ATTACHED SOURCE READS THE SAME WAY: one horizontal row of file cards under the
 * tool buttons (`AttachmentStrip`), the shape every chat assistant uses. It used to be
 * three: recordings as a wrapped chip strip ABOVE the box, photographs as a thumbnail grid
 * below it, and documents as full-width blocks below that — three answers to one question
 * in three places, which is what made one card read as three forms again.
 *
 * THE DOCUMENT BLOCK IS GONE TOO, and so is the reader behind it. The block survived that
 * merge for one reason — a scanned PDF stopped to ask which pages were worth OCR'ing before
 * a credit was spent — and /dlo does not ask that any more: a document is uploaded with the
 * run and read by the article call itself. With no question left and nothing read here,
 * every source is a picked file and a card, and the only difference between them is what
 * each card's second line says:
 *
 *   recording    transcribed whole during प्रक्रिया — nothing to report yet, so a size.
 *   document     read by the article model, so likewise nothing to report yet: a size.
 *   photograph   the same, except its card carries a THUMBNAIL, because half a dozen phone
 *                snaps of a GR are told apart by what they SHOW, never by IMG_0001.jpg.
 *   link         fetched by the transcriber, not by us. Its own panel, because it is a
 *                field to paste into rather than a file to attach.
 *
 * THE SUBMIT IS IN THIS CARD, at the end of the tool row — see the button below for why
 * it is no longer pinned to the foot of the viewport.
 *
 * The composer owns no state except whether the link panel is open — every list belongs to
 * `useDloIntakeForm`, which will submit it. This only decides which picks are allowed to
 * join them, through `lib/filePicks`, shared with the standalone recording picker on
 * /transcribe so the two can never disagree about what a valid file is.
 */

import { useRef, useState } from 'react';
import { CirclePlay, FileText, Image as ImageIcon, Mic } from 'lucide-react';
import {
  AUDIO_FILE_ACCEPT,
  DOCUMENT_MAX_BYTES,
  IMAGE_FILE_ACCEPT,
  isAudioFileName,
  isImageFileName,
} from '@dgipr/schemas';
import { formatFileSize } from '@/lib/fileSize';
import {
  AttachmentStrip,
  type AttachmentItem,
} from '@/components/common/AttachmentStrip';
import { ComposerToolbarButton } from '@/components/common/ComposerToolbarButton';
import { ErrorNotice } from '@/components/ErrorNotice';
import {
  DOCUMENT_FILE_ACCEPT,
  isDocumentFileName,
} from '@/components/DocumentIntake';
import { FormCard } from '@/components/common/FormCard';
import { PromptTextarea } from '@/components/common/PromptTextarea';
import {
  YouTubeLinkInput,
  YOUTUBE_INPUT_OFF,
} from '@/components/YouTubeLinkInput';
import { acceptFilePicks } from '@/lib/filePicks';
import { cn } from '@/lib/utils';
import { useFilePreviews } from '@/lib/useFilePreviews';
import { STR } from '@/lib/strings';
import { DloLostFilesNotice } from './DloLostFilesNotice';
import type { DloIntakeFormState } from './useDloIntakeForm';

const YOUTUBE_PANEL_ID = 'dlo-youtube-panel';

export function DloComposer({ form }: { form: DloIntakeFormState }) {
  const audioInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const documentInput = useRef<HTMLInputElement>(null);
  // The link panel is opened by its tool button — but a link already added keeps it open
  // on its own, exactly as an unfinished document keeps its block open: folding a source
  // away would leave it counted at submit with no sign of it on screen.
  const [linkOpen, setLinkOpen] = useState(false);
  const showLinks = linkOpen || form.youtube.length > 0;
  const previews = useFilePreviews(form.images);

  const addAudio = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    const {
      files: next,
      added,
      error,
    } = acceptFilePicks({
      current: form.files,
      picked: Array.from(list),
      isAllowedName: isAudioFileName,
      typeError: STR.dloFileTypeError,
    });
    form.setError(error);
    if (added > 0) form.changeFiles(next);
  };

  const addImages = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    const {
      files: next,
      added,
      error,
    } = acceptFilePicks({
      current: form.images,
      picked: Array.from(list),
      isAllowedName: isImageFileName,
      typeError: STR.dloImageTypeError,
    });
    form.setError(error);
    if (added > 0) form.changeImages(next);
  };

  // The ceiling is OpenAI's own per-file limit, checked here so an oversized scan is
  // refused before the upload starts rather than several minutes into it; `current` is
  // what is already attached, so picking the same file twice adds it once.
  const addDocuments = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    const {
      files: next,
      added,
      error,
    } = acceptFilePicks({
      current: form.documents,
      picked: Array.from(list),
      isAllowedName: isDocumentFileName,
      typeError: STR.docUnsupported,
      maxBytes: DOCUMENT_MAX_BYTES,
    });
    form.setError(error);
    if (added > 0) form.changeDocuments(next);
  };

  // The one row, in the order the tools that produce them appear above it. Recordings and
  // photographs are keyed by name AND size: two takes of the same meeting, and two phone
  // snaps, can arrive under one name.
  const attachments: AttachmentItem[] = [
    ...form.files.map((file, index) => ({
      id: `audio-${file.name}-${file.size}-${index}`,
      name: file.name,
      icon: Mic,
      meta: formatFileSize(file.size),
      removeLabel: `${STR.dloRemoveAudio}: ${file.name}`,
      onRemove: () =>
        form.changeFiles(form.files.filter((_, i) => i !== index)),
    })),
    ...form.images.map((file, index) => ({
      id: `image-${file.name}-${file.size}-${index}`,
      name: file.name,
      icon: ImageIcon,
      ...(previews.get(file) ? { previewUrl: previews.get(file) } : {}),
      meta: formatFileSize(file.size),
      removeLabel: `${STR.dloRemoveFile}: ${file.name}`,
      onRemove: () =>
        form.changeImages(form.images.filter((_, i) => i !== index)),
    })),
    ...form.documents.map((file, index) => ({
      id: `doc-${file.name}-${file.size}-${index}`,
      name: file.name,
      icon: FileText,
      meta: formatFileSize(file.size),
      removeLabel: `${STR.docRemove}: ${file.name}`,
      onRemove: () =>
        form.changeDocuments(form.documents.filter((_, i) => i !== index)),
    })),
  ];

  return (
    <FormCard
      htmlFor="dlo-notes"
      label={STR.dloNotesLabel}
      hint={STR.dloComposerHint}
    >
      <div className="mt-4">
        <PromptTextarea
          id="dlo-notes"
          value={form.notes}
          onChange={(next) => {
            form.setNotes(next);
            if (next.trim()) form.setError(null);
          }}
          placeholder={STR.dloNotesPlaceholder}
          disabled={form.submitting}
          className="w-full"
        />

        {/* The tools, in the order the sources are listed below the box. Each is icon-only
            and carries its Marathi label as title + aria-label — the row is scanned rather
            than read, and four worded buttons across a composer is a second form. */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <ComposerToolbarButton
            icon={Mic}
            label={STR.dloAudioUpload}
            disabled={form.submitting}
            onClick={() => audioInput.current?.click()}
          />
          <ComposerToolbarButton
            icon={ImageIcon}
            label={STR.dloImagesUpload}
            disabled={form.submitting}
            onClick={() => imageInput.current?.click()}
          />
          {/* Opens the file dialog directly, exactly as the two tools above it do. It used
              to add an empty document block below instead, because that block owned the
              file control and then asked which pages to read; the pages question is gone
              and the block went with it, so the dialog is this button's own. */}
          <ComposerToolbarButton
            icon={FileText}
            label={STR.dloDocsUpload}
            disabled={form.submitting}
            onClick={() => documentInput.current?.click()}
          />
          {/* Dimmed rather than hidden while the link source is switched off product-wide:
              an officer who has used it should see that the capability exists and is
              unavailable, not find it silently missing. */}
          <ComposerToolbarButton
            icon={CirclePlay}
            label={STR.ytTitle}
            disabled={form.submitting || YOUTUBE_INPUT_OFF}
            active={showLinks}
            controls={YOUTUBE_PANEL_ID}
            onClick={() => setLinkOpen((open) => !open)}
          />

          {/* The count and the page's one action, held together and pushed to the end of
              the same row — so they wrap onto a line of their own rather than the button
              being stranded under a lone tool button on a narrow card. */}
          <div className="ms-auto flex items-center gap-3">
            {/* A meeting's worth of typed notes is long enough that "how much have I
                written?" is a real question; an empty box does not need the answer. */}
            {form.notes.length > 0 ? (
              <span className="text-muted-foreground text-sm">
                {form.notes.length.toLocaleString('mr-IN')} {STR.dloCharsSuffix}
              </span>
            ) : null}

            {/* THE SUBMIT LIVES IN THIS CARD, at the end of the tool row, exactly as it
                does on Creative and Social (components/media-room/NoteComposer). It used
                to be `GenerateBar`, pinned to the foot of the viewport, on the reasoning
                that a button under a several-block form is off screen — but everything
                compulsory is in this one card and the box below it is optional, so the
                button now sits with the controls it acts on.

                The condition is unchanged: DISABLED until at least one source exists, so
                "nothing was supplied" is a dead button rather than an error after a press.
                Enabled it carries the slow warm sheen (`mr-submit-flow`, globals.css) —
                the only moving thing on the page, so "there is something to press now"
                reads without a label; disabled it is quiet and still. */}
            <button
              type="button"
              onClick={() => void form.submit()}
              disabled={form.submitting || !form.hasInput}
              className={cn(
                'text-primary-foreground inline-flex h-9 shrink-0 items-center rounded-md px-5 text-sm font-bold transition-[filter]',
                'focus-visible:ring-ring/50 outline-none focus-visible:ring-[3px]',
                'disabled:cursor-not-allowed disabled:opacity-60',
                form.submitting || !form.hasInput
                  ? 'bg-primary'
                  : 'mr-submit-flow hover:saturate-110 hover:brightness-105',
              )}
            >
              {form.submitting ? STR.submitting : STR.dloSubmit}
            </button>
          </div>

          <input
            ref={audioInput}
            type="file"
            accept={AUDIO_FILE_ACCEPT}
            multiple
            hidden
            onChange={(event) => {
              addAudio(event.target.files);
              // Clearing lets the same file be re-picked after it was removed.
              event.target.value = '';
            }}
          />
          <input
            ref={imageInput}
            type="file"
            accept={IMAGE_FILE_ACCEPT}
            multiple
            hidden
            onChange={(event) => {
              addImages(event.target.files);
              event.target.value = '';
            }}
          />
          <input
            ref={documentInput}
            type="file"
            accept={DOCUMENT_FILE_ACCEPT}
            multiple
            hidden
            onChange={(event) => {
              addDocuments(event.target.files);
              event.target.value = '';
            }}
          />
        </div>

        {/* Every complaint the form can raise — a refused file, a bad link, an empty
            submit — is rendered directly under the row, which is where both the pick
            buttons and the submit are. It used to be in the pinned bar; with the button
            in the card, a message left down there would be a refusal the officer never
            sees. */}
        {form.error ? (
          <div className="mt-3">
            <ErrorNotice message={form.error} />
          </div>
        ) : null}

        {/* Directly under the buttons that produced them, so "attach" and "attached" are
            one place on the screen. */}
        <AttachmentStrip
          items={attachments}
          disabled={form.submitting}
          className="mt-4"
        />
      </div>

      <DloLostFilesNotice
        message={STR.dloDraftAudioLost}
        names={form.lostAudioNames}
      />
      <DloLostFilesNotice
        message={STR.dloDraftImagesLost}
        names={form.lostImageNames}
      />
      <DloLostFilesNotice
        message={STR.dloDraftDocumentsLost}
        names={form.lostDocumentNames}
      />

      {showLinks ? (
        <div id={YOUTUBE_PANEL_ID} className="mt-4 border-t pt-4">
          <YouTubeLinkInput
            embedded
            videos={form.youtube}
            onChange={form.setYoutube}
            onError={form.setError}
            disabled={form.submitting}
          />
        </div>
      ) : null}
    </FormCard>
  );
}
