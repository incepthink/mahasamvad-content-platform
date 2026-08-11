'use client';

// The composer: the text box, the attachment tray, and the one rule that governs both —
// ATTACH → SEND → PREPARE. Picking a file costs nothing; the reading, uploading and
// transcribing all happen when पाठवा is pressed, and the box holds the officer's question
// until that work is done and the turn has actually left.
//
// EVERY attachment is a chip here, documents included: the document button opens the file
// explorer directly, exactly like the image button, and the file is read whole. The page
// picker other surfaces show belongs to their spend gate — see readDocument in
// useChatAttachments for why a chat attachment does not get one.

import { useRef, useState, type KeyboardEvent } from 'react';
import {
  AUDIO_FILE_ACCEPT,
  CHAT_MESSAGE_MAX_CHARS,
  IMAGE_FILE_ACCEPT,
  type YouTubeVideo,
} from '@dgipr/schemas';
// CirclePlay, not a YouTube brand mark: lucide 1.x carries no brand icons — the same
// substitution YouTubeLinkInput makes, and for the same reason.
import {
  CirclePlay,
  FileText,
  Image as ImageIcon,
  Mic,
  Send,
  Square,
  X,
} from 'lucide-react';
import { YouTubeLinkInput } from './YouTubeLinkInput';
import { STR } from '../lib/strings';
import {
  CHAT_DOCUMENT_ACCEPT,
  type DraftAttachment,
} from '../lib/useChatAttachments';

const KIND_ICON = {
  image: ImageIcon,
  document: FileText,
  audio: Mic,
  youtube: CirclePlay,
} as const;

function stateLabel(attachment: DraftAttachment): string {
  if (attachment.state === 'failed') {
    return attachment.error ?? STR.chatAttachFailed;
  }
  if (attachment.state === 'transcribing') return STR.chatAttachTranscribing;
  if (attachment.state === 'preparing') return STR.chatAttachPreparing;
  // Nothing has been read yet, and the chip says so rather than claiming to be ready.
  if (attachment.state === 'pending') return STR.chatAttachPending;
  return STR.chatAttachReady;
}

export function ChatComposer({
  attachments,
  preparing,
  full,
  sending,
  onAddImages,
  onAddDocuments,
  onAddAudio,
  onAddYouTube,
  onRemove,
  onSend,
  onStop,
}: {
  attachments: readonly DraftAttachment[];
  preparing: boolean;
  full: boolean;
  sending: boolean;
  onAddImages: (files: readonly File[]) => void;
  onAddDocuments: (files: readonly File[]) => void;
  onAddAudio: (files: readonly File[]) => void;
  onAddYouTube: (video: YouTubeVideo) => void;
  onRemove: (key: string) => void;
  // Resolves true once the turn has left. False means nothing was sent — every attachment
  // failed to prepare and there was no question to carry — so the box keeps what was typed.
  onSend: (content: string) => Promise<boolean>;
  onStop: () => void;
}) {
  const [text, setText] = useState('');
  const [showYouTube, setShowYouTube] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const documentInput = useRef<HTMLInputElement>(null);
  const audioInput = useRef<HTMLInputElement>(null);

  // A file that has not been read yet still counts as something to send — reading it is what
  // pressing पाठवा is for.
  const hasAttachments = attachments.some(
    (attachment) => attachment.state !== 'failed',
  );
  const busy = sending || preparing;
  const canSend = !busy && (text.trim() !== '' || hasAttachments);

  const submit = () => {
    if (busy) return;
    if (text.trim() === '' && !hasAttachments) return;
    setError(null);
    setShowYouTube(false);
    void onSend(text).then((sent) => {
      // Cleared only once the turn is on its way. Preparing the attachments can take minutes,
      // and a box emptied at the click would leave the officer's question nowhere on screen.
      if (sent) setText('');
    });
  };

  // Enter sends, Shift+Enter is a newline — the chat convention. A composer that needed a
  // mouse for every message would be slower than the tool it replaces.
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <div className="chat-composer">
      {showYouTube ? (
        <div className="chat-youtube">
          <YouTubeLinkInput
            videos={[]}
            onChange={(videos) => {
              const video = videos[0];
              if (video) {
                onAddYouTube(video);
                setShowYouTube(false);
              }
            }}
            onError={setError}
            maxLinks={1}
          />
        </div>
      ) : null}

      {attachments.length > 0 ? (
        <ul className="chat-tray">
          {attachments.map((attachment) => {
            const Icon = KIND_ICON[attachment.kind];
            return (
              <li
                key={attachment.key}
                className={`chat-tray-item is-${attachment.state}`}
              >
                <Icon size={16} aria-hidden="true" />
                <span className="chat-tray-name">
                  {attachment.name || STR.chatAttachImage}
                </span>
                <span className="chat-tray-state">
                  {stateLabel(attachment)}
                </span>
                <button
                  type="button"
                  className="chat-tray-remove"
                  onClick={() => onRemove(attachment.key)}
                  aria-label={STR.chatAttachRemove}
                >
                  <X size={15} aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      <div className="chat-input-row">
        <textarea
          className="chat-input"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={STR.chatPlaceholder}
          // Only while the attachments are being prepared: that text is already committed to
          // the turn in flight. A streaming ANSWER leaves the box open, so the next question
          // can be written while this one is being answered.
          disabled={preparing}
          rows={1}
          maxLength={CHAT_MESSAGE_MAX_CHARS}
          aria-label={STR.chatPlaceholder}
        />
        <div className="chat-tools">
          <button
            type="button"
            className="btn-ghost chat-tool"
            onClick={() => imageInput.current?.click()}
            disabled={full}
            title={STR.chatAttachImage}
            aria-label={STR.chatAttachImage}
          >
            <ImageIcon size={20} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="btn-ghost chat-tool"
            onClick={() => documentInput.current?.click()}
            disabled={full}
            title={STR.chatAttachDocument}
            aria-label={STR.chatAttachDocument}
          >
            <FileText size={20} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="btn-ghost chat-tool"
            onClick={() => audioInput.current?.click()}
            disabled={full}
            title={STR.chatAttachAudio}
            aria-label={STR.chatAttachAudio}
          >
            <Mic size={20} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="btn-ghost chat-tool"
            onClick={() => setShowYouTube((open) => !open)}
            disabled={full}
            title={STR.chatAttachYouTube}
            aria-label={STR.chatAttachYouTube}
          >
            <CirclePlay size={20} aria-hidden="true" />
          </button>

          {/* Icon-only, like the four tools beside it — the label is carried by
              title + aria-label so the button stays a round mark rather than a
              wide pill that changes width when the answer starts. */}
          {sending ? (
            <button
              type="button"
              className="btn chat-send chat-send--stop"
              onClick={onStop}
              title={STR.chatStop}
              aria-label={STR.chatStop}
            >
              <Square size={17} aria-hidden="true" />
            </button>
          ) : (
            <button
              type="button"
              className="btn chat-send"
              onClick={submit}
              disabled={!canSend}
              title={preparing ? STR.chatAttachWorking : STR.chatSend}
              aria-label={STR.chatSend}
            >
              <Send size={18} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      {preparing ? (
        <p className="chat-composer-note">{STR.chatAttachWorking}</p>
      ) : null}
      {error !== null ? (
        <p className="chat-composer-error" role="alert">
          {error}
        </p>
      ) : null}

      <input
        ref={imageInput}
        type="file"
        accept={IMAGE_FILE_ACCEPT}
        multiple
        hidden
        onChange={(event) => {
          onAddImages(Array.from(event.target.files ?? []));
          // Cleared so picking the same file twice in a row still fires a change event.
          event.target.value = '';
        }}
      />
      <input
        ref={documentInput}
        type="file"
        accept={CHAT_DOCUMENT_ACCEPT}
        multiple
        hidden
        onChange={(event) => {
          onAddDocuments(Array.from(event.target.files ?? []));
          event.target.value = '';
        }}
      />
      <input
        ref={audioInput}
        type="file"
        accept={AUDIO_FILE_ACCEPT}
        multiple
        hidden
        onChange={(event) => {
          onAddAudio(Array.from(event.target.files ?? []));
          event.target.value = '';
        }}
      />
    </div>
  );
}
