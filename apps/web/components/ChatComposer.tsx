'use client';

// The composer: the text box and attachment tray. Native PDFs begin preparing when picked so
// that work overlaps typing; other files retain their send-time preparation. The box holds the
// officer's question until every selected attachment is ready and the turn has actually left.
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
import { ComposeSafeTextarea, isComposingEvent } from './ComposeSafeInput';
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

  // A non-PDF file that has not been read yet still counts as something to send — reading it
  // is what pressing पाठवा is for.
  const hasAttachments = attachments.some(
    (attachment) => attachment.state !== 'failed',
  );
  const nativePdfPreparing = attachments.some(
    (attachment) =>
      attachment.kind === 'document' &&
      attachment.name.toLowerCase().endsWith('.pdf') &&
      attachment.state === 'preparing',
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
    // An IME uses Enter to COMMIT the word it is assembling — on an InScript or phonetic
    // Marathi keyboard that keystroke belongs to the keyboard, not to us. Sending on it fires
    // the message mid-word AND swallows the character being committed.
    if (isComposingEvent(event)) return;
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
        {/* Uncontrolled by design — see ComposeSafeInput. Clearing after a successful send
            still works: setText('') is a value this box did not report, so it is written
            through to the DOM. */}
        <ComposeSafeTextarea
          className="chat-input"
          value={text}
          onChange={setText}
          onKeyDown={onKeyDown}
          placeholder={STR.chatPlaceholder}
          // Selection-time PDF preparation deliberately overlaps typing. Send-time preparation
          // locks the committed question; a streaming answer leaves the box open for the next.
          disabled={preparing && !nativePdfPreparing}
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
