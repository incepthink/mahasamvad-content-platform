'use client';

/**
 * The ONE input on /transcribe — the same card the other two create surfaces use
 * (components/common/FormCard + a tool row + AttachmentStrip), so a recording attached
 * here looks exactly like a recording attached on /dlo.
 *
 * It was two cards: <AudioFilePicker> with its own heading, hint, worded upload button and
 * vertical file list, and the YouTube card as a sibling below it. Same question ("what am I
 * transcribing?") asked in two boxes, in a shape neither of the other create pages uses any
 * more — which is exactly the drift that made /dlo three cards before its composer merged
 * them.
 *
 * THE DROPZONE STANDS WHERE THE TEXT BOX STANDS on the other two surfaces. /dlo's composer
 * leads with a textarea because the news is partly typed; here there is nothing to type, and
 * a card whose only way in is a 36px icon would be a worse page than the worded button it
 * replaced. So the slot the textarea occupies is a click-or-drop target, and the tool row
 * below it carries the same two tools /dlo's does — the microphone repeating the dropzone
 * deliberately, the way every chat composer repeats its own attach affordance.
 *
 * THE SUBMIT LIVES IN THIS CARD, at the end of the tool row beside the tools it acts on.
 * It used to be `GenerateBar`, pinned to the foot of the viewport, on the reasoning that a
 * button under a several-block form is off screen. That reasoning does not hold here: this
 * card IS the form, and everything below it (the result, the past runs) is output rather
 * than input. The complaint the form can raise is rendered directly under the button, so a
 * refusal is never scrolled away from the press that caused it. Same move app/page.tsx made.
 *
 * The composer owns no state except whether the link panel is open: both lists belong to
 * TranscriptionForm, which will submit them. Which picks may join them is `lib/filePicks`,
 * shared with /dlo's composer so the two can never disagree about what a valid recording is.
 */

import { useRef, useState } from 'react';
import { CirclePlay, Mic } from 'lucide-react';
import {
  RECORDING_FILE_ACCEPT,
  TRANSCRIPTION_MAX_FILES,
  type YouTubeVideo,
} from '@dgipr/schemas';
import {
  AttachmentStrip,
  type AttachmentItem,
} from '@/components/common/AttachmentStrip';
import { ComposerToolbarButton } from '@/components/common/ComposerToolbarButton';
import { FormCard } from '@/components/common/FormCard';
import { InfoHint } from '@/components/common/InfoHint';
import { ErrorNotice } from '@/components/ErrorNotice';
import {
  YouTubeLinkInput,
  YOUTUBE_INPUT_OFF,
} from '@/components/YouTubeLinkInput';
import { AudioTrimDialog } from '@/components/common/AudioTrimDialog';
import { formatFileSize } from '@/lib/fileSize';
import { audioCardMeta, type AudioTrimsState } from '@/lib/useAudioTrims';
import { STR } from '@/lib/strings';
import { cn } from '@/lib/utils';
import {
  recordingCardMeta,
  type useVideoExtraction,
} from '@/lib/useVideoExtraction';

const YOUTUBE_PANEL_ID = 'transcribe-youtube-panel';

export function TranscribeComposer({
  files,
  audioTrims,
  extraction,
  onPickRecordings,
  onFilesChange,
  youtube,
  onYoutubeChange,
  onError,
  error,
  submitLabel,
  canSubmit,
  submitBusy,
  onSubmit,
  disabled = false,
}: {
  files: readonly File[];
  // Which part of each recording is set to be used. Owned by the form, because it has to
  // reach the submit — this only opens the dialog that edits it.
  audioTrims: AudioTrimsState;
  // Videos being turned into recordings in the browser. Owned by the form, because the
  // Android share path converts shared videos before it submits them.
  extraction: ReturnType<typeof useVideoExtraction>;
  // What the officer picked or dropped, unfiltered: the form decides which are recordings,
  // which are videos to convert, and which are refused.
  onPickRecordings: (picked: readonly File[]) => void;
  // Called with the whole next list, so the form keeps ownership of what it will submit.
  onFilesChange: (files: File[]) => void;
  youtube: readonly YouTubeVideo[];
  onYoutubeChange: (videos: YouTubeVideo[]) => void;
  // Rejections go to the form, which owns them, and come back as `error` below — so every
  // reason a run cannot start is stated in one place, under the button.
  onError: (message: string | null) => void;
  error: string | null;
  submitLabel: string;
  // The form's own condition, unchanged: at least one source is attached.
  canSubmit: boolean;
  // This submit, or an earlier one of this browser's, is still going.
  submitBusy: boolean;
  onSubmit: () => void;
  disabled?: boolean | undefined;
}) {
  const audioInput = useRef<HTMLInputElement>(null);
  // A link already added keeps the panel open on its own: folding a source away would leave
  // it counted at submit with no sign of it on screen.
  const [linkOpen, setLinkOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  // Which recording's trim dialog is open. The FILE rather than an index, because an index
  // would point at a different recording the moment one above it is removed.
  const [trimming, setTrimming] = useState<File | null>(null);
  const showLinks = linkOpen || youtube.length > 0;
  // A video still converting counts: it is about to become a recording.
  const atLimit =
    files.length + extraction.jobs.length >= TRANSCRIPTION_MAX_FILES;

  const addFiles = (picked: readonly File[]) => {
    if (picked.length > 0) onPickRecordings(picked);
  };

  // Keyed by name AND size: two takes of the same meeting can arrive under one name.
  const attachments: AttachmentItem[] = files.map((file, index) => ({
    id: `audio-${file.name}-${file.size}-${index}`,
    name: file.name,
    icon: Mic,
    // The chosen window once there is one, so a trim is visible without reopening the
    // dialog; the file's size otherwise, which is what the card always said.
    meta: recordingCardMeta(
      file,
      audioCardMeta(audioTrims.get(file), formatFileSize(file.size)),
    ),
    removeLabel: `${STR.dloRemoveAudio}: ${file.name}`,
    onRemove: () => onFilesChange(files.filter((_, i) => i !== index)),
    // The one thing a recording's card has to open: which PART of it to use.
    onOpen: () => setTrimming(file),
    openLabel: STR.audioTrimEditLabel(file.name),
    open: trimming === file,
  }));
  // Videos still converting, after the recordings they will join.
  attachments.push(...extraction.items);

  return (
    <FormCard
      label={STR.transcribeNewTitle}
      info={<InfoHint text={STR.infoTranscribeInput} />}
    >
      {/* Where the other two composers put their text box. A button rather than a div, so
          the keyboard reaches it and the file dialog opens the same way for everyone; the
          drag handlers are a second way in, never the only one. */}
      <button
        type="button"
        disabled={disabled || atLimit}
        onClick={() => audioInput.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          addFiles(Array.from(event.dataTransfer.files));
        }}
        className={cn(
          'border-input mt-4 flex min-h-24 w-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed px-4 py-6 text-center transition-colors',
          'hover:bg-accent/40',
          'focus-visible:border-ring focus-visible:ring-ring/50 outline-none focus-visible:ring-[3px]',
          dragging && 'border-primary/50 bg-accent',
          (disabled || atLimit) && 'pointer-events-none opacity-60',
        )}
      >
        <Mic className="text-muted-foreground size-6" aria-hidden="true" />
        <span className="text-base font-semibold">{STR.transcribeUpload}</span>
        <span className="text-muted-foreground text-sm">
          {STR.transcribeDropHint}
        </span>
      </button>

      {/* The same two tools /dlo's composer carries, in the same order and the same
          icon-only treatment — the Marathi label travels as title + aria-label, so the
          meaning is never left to the glyph. */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <ComposerToolbarButton
          icon={Mic}
          label={STR.transcribeUpload}
          disabled={disabled || atLimit}
          onClick={() => audioInput.current?.click()}
        />
        {/* Dimmed rather than hidden while the link source is switched off product-wide:
            an officer who has used it should see that the capability exists and is
            unavailable, not find it silently missing. */}
        <ComposerToolbarButton
          icon={CirclePlay}
          label={STR.ytTitle}
          disabled={disabled || YOUTUBE_INPUT_OFF}
          active={showLinks}
          controls={YOUTUBE_PANEL_ID}
          onClick={() => setLinkOpen((open) => !open)}
        />

        <div className="ms-auto flex items-center gap-2">
          {/* The page's one action, at the end of the row that feeds it. Enabled, it
              carries the slow warm sheen (`mr-submit-flow`, globals.css) — the only
              moving thing on the page, so "there is something to press now" reads
              without a label; disabled it is quiet and still. The condition is the
              form's, unchanged: at least one recording or link. */}
          <button
            type="button"
            onClick={onSubmit}
            // Held while a video converts: pressed then, the run would leave without it.
            disabled={submitBusy || !canSubmit || extraction.busy}
            className={cn(
              'text-primary-foreground inline-flex h-9 shrink-0 items-center rounded-md px-5 text-sm font-bold transition-[filter]',
              'focus-visible:ring-ring/50 outline-none focus-visible:ring-[3px]',
              'disabled:cursor-not-allowed disabled:opacity-60',
              submitBusy || !canSubmit || extraction.busy
                ? 'bg-primary'
                : 'mr-submit-flow hover:saturate-110 hover:brightness-105',
            )}
          >
            {submitLabel}
          </button>
        </div>

        <input
          ref={audioInput}
          type="file"
          accept={RECORDING_FILE_ACCEPT}
          multiple
          hidden
          onChange={(event) => {
            addFiles(Array.from(event.target.files ?? []));
            // Clearing lets the same file be re-picked after it was removed.
            event.target.value = '';
          }}
        />
      </div>

      {/* Why a press would be refused, stated under the button rather than beside the
          control that caused it — the officer presses here, so the answer belongs here. */}
      {error ? (
        <div className="mt-3">
          <ErrorNotice message={error} />
        </div>
      ) : null}

      {/* Directly under the tools that produced them, so "attach" and "attached" are one
          place on the screen. */}
      <AttachmentStrip
        items={attachments}
        disabled={disabled}
        className="mt-4"
      />

      {/* Mounted once for the whole strip rather than per card: the dialog is told which
          recording it is about, so opening it does not build a media element per attachment. */}
      <AudioTrimDialog
        file={trimming}
        trim={trimming === null ? null : audioTrims.get(trimming)}
        open={trimming !== null}
        onOpenChange={(next) => {
          if (!next) setTrimming(null);
        }}
        onApply={(trim) => {
          if (trimming !== null) audioTrims.set(trimming, trim);
        }}
      />

      {showLinks ? (
        <div id={YOUTUBE_PANEL_ID} className="mt-4 border-t pt-4">
          <YouTubeLinkInput
            embedded
            videos={youtube}
            onChange={onYoutubeChange}
            onError={onError}
            disabled={disabled}
            maxLinks={TRANSCRIPTION_MAX_FILES}
          />
        </div>
      ) : null}
    </FormCard>
  );
}
