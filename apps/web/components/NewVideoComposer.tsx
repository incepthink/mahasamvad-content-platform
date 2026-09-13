'use client';

// The composer for the /new-video-workflow EXPERIMENT.
//
// Modelled on ChatComposer and reusing its CSS (`chat-input-row`, `chat-tray`, `chat-tool`,
// `chat-send`) so this page reads as part of the product without a second design system — the
// text owns the full width of the card and the controls sit in a bar beneath it, on both
// surfaces. The attachment tray is now literally the same component (see
// components/conversation/AttachmentTray), so a picked reference picture looks and behaves
// here exactly as an attached picture does on /chat. The differences left are the two things
// a video composer needs and a chat composer does not: there is no stop button, because a
// generation cannot be interrupted once the model has it; and the box can be thrown FULL
// SCREEN, because a video prompt is thousands of characters that get read and edited rather
// than a question that gets asked.
//
// Expanding does not move the textarea in the tree — a class on the same element does the
// whole thing (see `.chat-composer.is-expanded`). Re-mounting it would drop the caret and,
// because ComposeSafeTextarea is uncontrolled, re-seed the field from its mount value.
//
// The one control /chat has no use for is THE OUTPUT SHAPE, sitting beside the expand button.
// It is a per-turn choice held here rather than in the hook, because it belongs to the message
// being composed — and it deliberately persists between turns, so an officer building a reel
// picks ९:१६ once and every follow-up edit comes back in the same frame. It reaches Gemini as a
// request field (`response_format.aspect_ratio`), never as a sentence appended to the prompt,
// which is what lets this page gain a control over the render without giving up its one rule.
//
// A reference picture can also be PASTED, exactly as on /chat and through the same helper:
// a React handler on this card for a paste into the box, and a document listener for a paste
// made without clicking into it first. See ChatComposer's header for why both are needed and
// why they cannot double-attach.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
} from 'react';
import {
  CornerDownRight,
  Image as ImageIcon,
  Maximize2,
  Minimize2,
  RectangleHorizontal,
  RectangleVertical,
  Send,
  Users,
  X,
} from 'lucide-react';
import {
  DEFAULT_NEW_VIDEO_ASPECT,
  NEW_VIDEO_IMAGE_ACCEPT,
  NEW_VIDEO_MAX_IMAGES,
  type NewVideoAspect,
  type NewVideoCharacter,
} from '@dgipr/schemas';
import { ComposeSafeTextarea, isComposingEvent } from './ComposeSafeInput';
import {
  AttachmentTray,
  type TrayAttachment,
} from './conversation/AttachmentTray';
import { NewVideoCharacters } from './NewVideoCharacters';
import { imageFilesFromClipboard, isEditableTarget } from '../lib/pastedImages';
import { STR } from '../lib/strings';
import type { StagedImage } from '../lib/useNewVideoWorkflow';

// Both shapes the API accepts, in the order they are offered. Landscape leads because it is
// the default — the button that is already pressed when the page opens.
const ASPECT_OPTIONS: ReadonlyArray<{
  value: NewVideoAspect;
  label: string;
  Icon: typeof RectangleHorizontal;
}> = [
  {
    value: '16:9',
    label: STR.nvwAspectLandscape,
    Icon: RectangleHorizontal,
  },
  { value: '9:16', label: STR.nvwAspectPortrait, Icon: RectangleVertical },
];

function stateLabel(image: StagedImage): string {
  if (image.state === 'failed') return image.error ?? STR.nvwImageFailed;
  if (image.state === 'uploading') return STR.nvwImageUploading;
  return STR.nvwImageReady;
}

export function NewVideoComposer({
  images,
  busy,
  sending,
  isFollowUp,
  characters,
  castIds,
  castLocked,
  onCastIdsChange,
  forkOrdinal,
  onClearFork,
  onAddImages,
  onRemoveImage,
  onSend,
}: {
  images: readonly StagedImage[];
  /** A generation is already running in this conversation — the server refuses a second. */
  busy: boolean;
  sending: boolean;
  isFollowUp: boolean;
  /** This conversation's cast, once the server holds one. Empty before the first turn. */
  characters: readonly NewVideoCharacter[];
  castIds: readonly string[];
  /** The cast is fixed once there is a video to edit; the panel says why rather than hiding. */
  castLocked: boolean;
  onCastIdsChange: (ids: readonly string[]) => void;
  /**
   * FORKING (Step 4): the 1-based number of the turn this instruction will continue from, or
   * null for the ordinary case. A number rather than a turn id, because all this component
   * does with it is name the video — the id belongs to the pane that owns the list.
   */
  forkOrdinal: number | null;
  onClearFork: () => void;
  onAddImages: (files: readonly File[]) => void;
  onRemoveImage: (key: string) => void;
  /** Resolves true once the turn has left, which is when the box may be cleared. */
  onSend: (prompt: string, aspect: NewVideoAspect) => Promise<boolean>;
}) {
  const [text, setText] = useState('');
  const [aspect, setAspect] = useState<NewVideoAspect>(
    DEFAULT_NEW_VIDEO_ASPECT,
  );
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [castOpen, setCastOpen] = useState(false);
  const imageInput = useRef<HTMLInputElement>(null);
  // The card, so the textarea inside it can be found without a ref of its own —
  // ComposeSafeTextarea owns that ref (it is what keeps the field uncontrolled) and does not
  // forward one.
  const card = useRef<HTMLDivElement>(null);
  const wasExpanded = useRef(expanded);

  // Escape closes it, like every other overlay in the product (the rail drawer, TasksMenu).
  // Guarded by isComposing on the textarea's own handler instead would be wrong: this is a
  // document listener, and an IME uses Escape to abandon a word.
  useEffect(() => {
    if (!expanded) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && !event.isComposing) setExpanded(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [expanded]);

  // Expanding and collapsing both move the officer BACK to the writing, rather than leaving
  // the caret on the button they pressed. Guarded on an actual transition so the composer
  // never grabs focus when the page opens.
  useEffect(() => {
    if (wasExpanded.current === expanded) return;
    wasExpanded.current = expanded;
    card.current?.querySelector('textarea')?.focus();
  }, [expanded]);

  const uploading = images.some((image) => image.state === 'uploading');
  const full = images.length >= NEW_VIDEO_MAX_IMAGES;
  const room = Math.max(0, NEW_VIDEO_MAX_IMAGES - images.length);
  // An image still uploading holds the send, unlike /chat: there the attachment is waited for
  // inside the turn, but here the turn is a paid render and starting one without the reference
  // picture the officer attached would look like the model ignoring it.
  const canSend = !sending && !busy && !uploading && text.trim() !== '';

  const submit = () => {
    if (!canSend) return;
    void onSend(text, aspect).then((sent) => {
      if (!sent) return;
      setText('');
      // The chosen shape is deliberately NOT reset: the next instruction in a conversation is
      // an edit of the video just made, and handing it back at a different ratio would undo a
      // choice nobody changed.
      // The prompt is gone, so a full-screen box is now a full-screen blank sheet over the
      // video the officer just paid for.
      setExpanded(false);
    });
  };

  // Enter sends, Shift+Enter is a newline — the chat convention. isComposingEvent keeps an
  // InScript/phonetic Marathi keyboard's commit keystroke from firing the message mid-word.
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (isComposingEvent(event)) return;
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  // Returns true when the clipboard was ours to take, which is also when the browser's own
  // paste must be stopped.
  const takeImages = useCallback(
    (data: DataTransfer | null): boolean => {
      const { files, rejected } = imageFilesFromClipboard(data);
      if (files.length === 0) {
        if (rejected === 0) return false;
        setError(STR.nvwPasteUnsupported);
        return true;
      }
      if (full) {
        setError(STR.nvwImageTooMany);
        return true;
      }
      // Only as many as there is room for, so a paste of six pictures fills the last slots
      // instead of failing four uploads the server would refuse anyway.
      setError(files.length > room ? STR.nvwImageTooMany : null);
      onAddImages(files.slice(0, room));
      return true;
    },
    [full, onAddImages, room],
  );

  useEffect(() => {
    const onDocumentPaste = (event: globalThis.ClipboardEvent) => {
      if (event.defaultPrevented) return;
      if (isEditableTarget(event.target)) return;
      if (takeImages(event.clipboardData)) event.preventDefault();
    };
    document.addEventListener('paste', onDocumentPaste);
    return () => document.removeEventListener('paste', onDocumentPaste);
  }, [takeImages]);

  const onPaste = (event: ClipboardEvent<HTMLDivElement>) => {
    if (takeImages(event.clipboardData)) event.preventDefault();
  };

  // Every reference picture has its object URL from the moment it was picked, so every item
  // here is a tile — this surface never attaches anything a thumbnail cannot show.
  const trayItems: TrayAttachment[] = images.map((image) => ({
    key: image.key,
    name: image.name,
    previewUrl: image.previewUrl,
    status: stateLabel(image),
    busy: image.state === 'uploading',
    ready: image.state === 'ready',
    failed: image.state === 'failed',
    removeLabel: STR.nvwRemoveImage,
    onRemove: () => onRemoveImage(image.key),
  }));

  return (
    <>
      {expanded ? (
        <button
          type="button"
          className="nvw-backdrop"
          aria-label={STR.nvwCollapse}
          onClick={() => setExpanded(false)}
        />
      ) : null}

      <div
        ref={card}
        className={expanded ? 'chat-composer is-expanded' : 'chat-composer'}
        onPaste={onPaste}
      >
        {/* FORKING (Step 4). ABOVE the box, not under it: it changes what the words about to
            be typed will apply to, so an officer must meet it before writing rather than
            after. Dismissible in place as well as by re-pressing the turn's own button —
            scrolling back up to disarm something is not a thing to make anyone do. */}
        {forkOrdinal !== null ? (
          <div className="nvw-fork-banner" role="status">
            <CornerDownRight size={16} aria-hidden="true" />
            <span className="nvw-fork-banner-text">
              <strong>
                {STR.nvwForkActive} · {STR.nvwForkTurn}{' '}
                {forkOrdinal.toLocaleString('mr-IN')}
              </strong>
              <span className="nvw-fork-banner-hint">
                {STR.nvwForkActiveHint}
              </span>
            </span>
            <button
              type="button"
              className="btn-ghost nvw-fork-clear"
              onClick={onClearFork}
              title={STR.nvwForkCancel}
              aria-label={STR.nvwForkCancel}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        ) : null}

        <AttachmentTray items={trayItems} />

        <div className="chat-input-row">
          <ComposeSafeTextarea
            className="chat-input"
            value={text}
            onChange={setText}
            onKeyDown={onKeyDown}
            placeholder={STR.nvwPlaceholder}
            rows={1}
            aria-label={STR.nvwPlaceholder}
          />
          <div className="chat-tools">
            <button
              type="button"
              className="btn-ghost chat-tool"
              onClick={() => imageInput.current?.click()}
              disabled={full}
              title={STR.nvwAttachImage}
              aria-label={STR.nvwAttachImage}
            >
              <ImageIcon size={20} aria-hidden="true" />
            </button>
            {/* The cast (migration 0054) — the control that makes a character and their voice
                the same in a NEW conversation without re-uploading a portrait or retyping a
                description. Never disabled: the panel is also the registry's editor, and an
                officer may be tidying it up while a render is in flight. The count is on the
                button because a cast is invisible in the prompt and is easy to forget. */}
            <button
              type="button"
              className={
                castIds.length > 0
                  ? 'btn-ghost chat-tool is-active'
                  : 'btn-ghost chat-tool'
              }
              onClick={() => setCastOpen(true)}
              title={STR.nvwCharactersTitle}
              aria-label={
                castIds.length > 0
                  ? `${STR.nvwCharactersTitle} (${castIds.length.toLocaleString('mr-IN')})`
                  : STR.nvwCharactersTitle
              }
            >
              <Users size={20} aria-hidden="true" />
              {castIds.length > 0 ? (
                <span className="chat-tool-count">
                  {castIds.length.toLocaleString('mr-IN')}
                </span>
              ) : null}
            </button>
            <button
              type="button"
              className="btn-ghost chat-tool"
              onClick={() => setExpanded((open) => !open)}
              title={expanded ? STR.nvwCollapse : STR.nvwExpand}
              aria-label={expanded ? STR.nvwCollapse : STR.nvwExpand}
              aria-pressed={expanded}
            >
              {expanded ? (
                <Minimize2 size={19} aria-hidden="true" />
              ) : (
                <Maximize2 size={19} aria-hidden="true" />
              )}
            </button>
            {/* The output shape. A radiogroup rather than two toggles: exactly one is always
                chosen, and arrow keys move between them for free. Never disabled while a
                render runs — this belongs to the message being written, not to the one in
                flight. */}
            <div
              className="chat-aspect"
              role="radiogroup"
              aria-label={STR.nvwAspectLabel}
            >
              {ASPECT_OPTIONS.map(({ value, label, Icon }) => {
                const active = aspect === value;
                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    className={
                      active
                        ? 'chat-aspect-option is-active'
                        : 'chat-aspect-option'
                    }
                    onClick={() => setAspect(value)}
                    title={label}
                    aria-label={label}
                  >
                    <Icon size={17} aria-hidden="true" />
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              className="btn chat-send"
              onClick={submit}
              disabled={!canSend}
              title={isFollowUp ? STR.nvwSendFollowUp : STR.nvwSend}
              aria-label={isFollowUp ? STR.nvwSendFollowUp : STR.nvwSend}
            >
              {sending ? (
                <span className="spinner" aria-hidden="true" />
              ) : (
                <Send size={18} aria-hidden="true" />
              )}
            </button>
          </div>
        </div>

        {/* Who is in this video, named under the box: a cast is invisible in the prompt, and
            an officer who cannot see it cannot tell whether the model was told about it. */}
        {castLocked && characters.length > 0 ? (
          <p className="chat-composer-note">
            {STR.nvwCastSelected}: {characters.map((c) => c.name).join(', ')}
          </p>
        ) : null}

        {busy ? <p className="chat-composer-note">{STR.nvwBusy}</p> : null}
        {error !== null ? (
          <p className="chat-composer-error" role="alert">
            {error}
          </p>
        ) : null}

        <NewVideoCharacters
          open={castOpen}
          onOpenChange={setCastOpen}
          selectedIds={castIds}
          onSelectedIdsChange={onCastIdsChange}
          castLocked={castLocked}
        />

        <input
          ref={imageInput}
          type="file"
          accept={NEW_VIDEO_IMAGE_ACCEPT}
          multiple
          hidden
          onChange={(event) => {
            onAddImages(Array.from(event.target.files ?? []));
            // Cleared so picking the same file twice in a row still fires a change event.
            event.target.value = '';
          }}
        />
      </div>
    </>
  );
}
