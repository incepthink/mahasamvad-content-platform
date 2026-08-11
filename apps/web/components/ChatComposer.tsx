'use client';

// The composer: the text box, the attachment tray, and the one rule that governs both —
// ATTACH → PREPARE → SEND. While anything in the tray is still uploading, being read or being
// transcribed, the send button is disabled and says why. Nothing is ever sent half-prepared.
//
// Documents get a full <DocumentIntake> card rather than a chip, because a scanned PDF needs
// its page picker here, on this screen, before a single page is OCR'd — the same spend gate
// every other upload surface has. Recordings and YouTube links become chips that report their
// own progress, since there is nothing to choose about them.

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
  ArrowUp,
  CirclePlay,
  FileText,
  Image as ImageIcon,
  Mic,
  Square,
  X,
} from 'lucide-react';
import { DocumentIntake } from './DocumentIntake';
import { YouTubeLinkInput } from './YouTubeLinkInput';
import { STR } from '../lib/strings';
import type { DraftAttachment } from '../lib/useChatAttachments';

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
  return STR.chatAttachReady;
}

export function ChatComposer({
  attachments,
  preparing,
  full,
  sending,
  onAddImages,
  onAddDocumentSlot,
  onDocumentText,
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
  onAddDocumentSlot: () => void;
  onDocumentText: (slot: string, name: string, text: string) => void;
  onAddAudio: (files: readonly File[]) => void;
  onAddYouTube: (video: YouTubeVideo) => void;
  onRemove: (key: string) => void;
  onSend: (content: string) => void;
  onStop: () => void;
}) {
  const [text, setText] = useState('');
  const [showYouTube, setShowYouTube] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const audioInput = useRef<HTMLInputElement>(null);

  const documents = attachments.filter(
    (attachment) => attachment.kind === 'document',
  );
  const chips = attachments.filter(
    (attachment) => attachment.kind !== 'document',
  );
  const hasReady = attachments.some(
    (attachment) => attachment.state === 'ready',
  );
  const canSend = !sending && !preparing && (text.trim() !== '' || hasReady);

  const submit = () => {
    if (sending) return;
    if (preparing) {
      setError(STR.chatAttachWait);
      return;
    }
    if (text.trim() === '' && !hasReady) return;
    setError(null);
    onSend(text);
    setText('');
    setShowYouTube(false);
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
      {documents.map((attachment) => (
        <div key={attachment.key} className="chat-document">
          <DocumentIntake
            storageKey={attachment.documentSlot ?? attachment.key}
            title={STR.chatAttachDocument}
            hint={STR.chatAttachDocumentNotice}
            maxChars={CHAT_MESSAGE_MAX_CHARS}
            // LIVE mode: the text is a second source held beside the box, exactly as on the
            // media room. A hand-over button here would mean an upload nobody pressed is
            // silently dropped from the turn.
            onTextChange={(value, snapshot) =>
              onDocumentText(
                attachment.documentSlot ?? attachment.key,
                snapshot?.fileName ?? '',
                value,
              )
            }
            onRemove={() => onRemove(attachment.key)}
          />
        </div>
      ))}

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

      {chips.length > 0 ? (
        <ul className="chat-tray">
          {chips.map((attachment) => {
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
            onClick={onAddDocumentSlot}
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

          {sending ? (
            <button
              type="button"
              className="btn chat-send chat-send--stop"
              onClick={onStop}
            >
              <Square size={18} aria-hidden="true" />
              <span className="chat-send-label">{STR.chatStop}</span>
            </button>
          ) : (
            <button
              type="button"
              className="btn chat-send"
              onClick={submit}
              disabled={!canSend}
              title={preparing ? STR.chatAttachWait : STR.chatSend}
            >
              <ArrowUp size={18} aria-hidden="true" />
              <span className="chat-send-label">{STR.chatSend}</span>
            </button>
          )}
        </div>
      </div>

      {preparing ? (
        <p className="chat-composer-note">{STR.chatAttachWait}</p>
      ) : null}
      {error !== null ? (
        <p className="chat-composer-error" role="alert">
          {error}
        </p>
      ) : null}
      <p className="chat-composer-hint">{STR.chatAttachAudioNotice}</p>

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
