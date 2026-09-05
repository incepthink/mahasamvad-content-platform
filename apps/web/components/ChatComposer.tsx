'use client';

// The composer: the text box and attachment tray. Native PDFs begin preparing when picked so
// that work overlaps typing; other files retain their send-time preparation.
//
// **NOTHING HERE WAITS FOR AN ATTACHMENT.** `preparing` reports what the tray is doing and
// nothing more — it is not a gate on the box or on the button. A file still uploading is
// waited for inside the sent turn (useChatThread), so pressing पाठवा with a 30 MB PDF halfway
// up is a normal send: the box clears, the question appears, and the answer follows when the
// file lands. `sending` is the only thing that swaps the button, exactly as it does for an
// answer already streaming.
//
// EVERY attachment appears in the tray, documents included: the document button opens the
// file explorer directly, exactly like the image button, and the file is read whole. The page
// picker other surfaces show belongs to their spend gate — see readDocument in
// useChatAttachments for why a chat attachment does not get one. A PICTURE is drawn as a
// thumbnail and everything else as a named chip; that split, and why, lives in
// components/conversation/AttachmentTray, which /new-video-workflow renders too.
//
// The fixed/default model gates the tools beside it: a text-only provider takes no picture and no native PDF, so those controls are
// unavailable rather than silently dropped on the way to a model that would then answer
// confidently about nothing. The flags come from the API (useChatProvider), never from a copy
// of the engine's table restated here — and this gating is a courtesy, not the guard: the turn
// route enforces the same flags, because a browser is never the last word on what reaches a
// provider.
//
// A picture can also be PASTED — Ctrl+V of a screenshot, or of an image copied from a page.
// Two listeners rather than one: the React handler on this card covers a paste into the text
// box, and a document listener covers a paste made without clicking into it first, which is
// how most people paste a screenshot. The document one stands down whenever the paste was
// already taken (`defaultPrevented`) or belongs to some other field on the page, so the two
// can never attach the same picture twice.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
} from 'react';
import {
  AUDIO_FILE_ACCEPT,
  CHAT_MESSAGE_MAX_CHARS,
  IMAGE_FILE_ACCEPT,
  type ChatProvider,
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
} from 'lucide-react';
import { ComposeSafeTextarea, isComposingEvent } from './ComposeSafeInput';
import { YouTubeLinkInput, YOUTUBE_INPUT_OFF } from './YouTubeLinkInput';
import {
  AttachmentTray,
  type TrayAttachment,
} from './conversation/AttachmentTray';
import { STR } from '../lib/strings';
import { storedErrorMessage } from '../lib/errorMessage';
import { imageFilesFromClipboard, isEditableTarget } from '../lib/pastedImages';
import { useFilePreviews } from '../lib/useFilePreviews';
import {
  CHAT_DOCUMENT_ACCEPT,
  CHAT_TEXT_DOCUMENT_ACCEPT,
  isPdfFileName,
  type DraftAttachment,
} from '../lib/useChatAttachments';
import { useChatProvider } from '../lib/useChatProvider';

const KIND_ICON = {
  image: ImageIcon,
  document: FileText,
  audio: Mic,
  youtube: CirclePlay,
} as const;

function stateLabel(attachment: DraftAttachment): string {
  if (attachment.state === 'failed') {
    return storedErrorMessage(attachment.error, STR.chatAttachFailed);
  }
  if (attachment.state === 'transcribing') return STR.chatAttachTranscribing;
  if (attachment.state === 'preparing') return STR.chatAttachPreparing;
  // Nothing has been read yet, and the chip says so rather than claiming to be ready.
  if (attachment.state === 'pending') return STR.chatAttachPending;
  return STR.chatAttachReady;
}

// What the SELECTED provider could not read, and so must not be sent. The mirror of the turn
// route's own guard, one step earlier: it keys on the file NAME because a PDF is exactly the
// document that becomes a documentId, and a name is all a chip has before it is prepared.
// Audio and YouTube are absent by construction — both arrive as extracted text, which every
// provider reads. A chip that has already failed is not carried either way.
function unreadableBy(
  attachment: DraftAttachment,
  capabilities: {
    supportsImages: boolean;
    supportsTextDocuments: boolean;
    supportsPdf: boolean;
  },
): boolean {
  if (attachment.state === 'failed') return false;
  if (attachment.kind === 'image') return !capabilities.supportsImages;
  if (attachment.kind === 'document') {
    return isPdfFileName(attachment.name)
      ? !capabilities.supportsPdf
      : !capabilities.supportsTextDocuments;
  }
  return false;
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
  //
  // The provider travels UP from here rather than down as a prop: the picker is a composer
  // control, so its state belongs beside the text box it qualifies, and only the turn needs to
  // know what was chosen.
  onSend: (content: string, provider: ChatProvider) => Promise<boolean>;
  onStop: () => void;
}) {
  const [text, setText] = useState('');
  const [showYouTube, setShowYouTube] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const documentInput = useRef<HTMLInputElement>(null);
  const audioInput = useRef<HTMLInputElement>(null);
  const { provider, capabilities } = useChatProvider();

  const imagesBlocked = !capabilities.supportsImages;
  const pdfBlocked = !capabilities.supportsPdf;
  const documentsBlocked = !capabilities.supportsTextDocuments;

  // Named after the provider, e.g. "Qwen चित्रे वाचू शकत नाही." — the same sentence the turn
  // route refuses with, so a greyed-out button and a rejected turn read alike. It covers the
  // two flags that actually differ between the providers a deployment can offer; a provider
  // that could take no document at all would want a third sentence, and there is none to
  // check the wording against.
  const imageBlockedLabel = `${capabilities.label} ${STR.chatProviderNoImages}`;

  // A non-PDF file that has not been read yet still counts as something to send — reading it
  // is what pressing पाठवा is for.
  const hasAttachments = attachments.some(
    (attachment) => attachment.state !== 'failed',
  );
  // A file picked under one provider and still in the tray when another was chosen. The chip
  // keeps its remove button, so the message below names a fix that is one press away — and
  // sending anyway would only earn the turn route's refusal.
  const blocked = attachments.some((attachment) =>
    unreadableBy(attachment, capabilities),
  );
  const canSend =
    !sending && !blocked && (text.trim() !== '' || hasAttachments);

  const submit = () => {
    if (sending || blocked) return;
    if (text.trim() === '' && !hasAttachments) return;
    setError(null);
    setShowYouTube(false);
    void onSend(text, provider).then((sent) => {
      // Cleared only once the turn is on its way. False means there was nothing to send —
      // every attachment had already failed and no question was typed — and a box emptied
      // then would leave the officer's words nowhere.
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

  // Returns true when the clipboard was ours to take, which is also when the browser's own
  // paste must be stopped — a picture would otherwise drop a file name into the text box in
  // the browsers that write one.
  const takeImages = useCallback(
    (data: DataTransfer | null): boolean => {
      const { files, rejected } = imageFilesFromClipboard(data);
      if (files.length === 0) {
        if (rejected === 0) return false;
        setError(STR.chatPasteUnsupported);
        return true;
      }
      // The other way in. Disabling the image button closes the file dialog, not Ctrl+V, and a
      // paste that silently does nothing reads as the feature being broken.
      if (imagesBlocked) {
        setError(imageBlockedLabel);
        return true;
      }
      if (full) {
        setError(STR.chatAttachTooMany);
        return true;
      }
      setError(null);
      onAddImages(files);
      return true;
    },
    [full, imageBlockedLabel, imagesBlocked, onAddImages],
  );

  // A paste made with nothing focused, or with the focus on one of the tool buttons. Anything
  // typed into another field on the page keeps its own paste.
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

  // A picked picture is held here until the turn is sent (useChatAttachments), so the file
  // itself is what the thumbnail is minted from — there is no uploaded URL to show yet, and
  // by the time there is one the chip has already been consumed by the turn.
  const imageFiles = useMemo(
    () =>
      attachments.flatMap((attachment) =>
        attachment.kind === 'image' && attachment.file ? [attachment.file] : [],
      ),
    [attachments],
  );
  const previews = useFilePreviews(imageFiles);

  const trayItems: TrayAttachment[] = attachments.map((attachment) => {
    const preview =
      attachment.kind === 'image' && attachment.file
        ? previews.get(attachment.file)
        : undefined;
    return {
      key: attachment.key,
      // An image pasted from the clipboard arrives unnamed; the fallback is what the
      // tooltip and the remove button say about it.
      name: attachment.name || STR.chatAttachImage,
      previewUrl: preview,
      icon: KIND_ICON[attachment.kind],
      status: stateLabel(attachment),
      busy:
        attachment.state === 'preparing' || attachment.state === 'transcribing',
      ready: attachment.state === 'ready',
      failed: attachment.state === 'failed',
      removeLabel: STR.chatAttachRemove,
      onRemove: () => onRemove(attachment.key),
    };
  });

  return (
    <div className="chat-composer" onPaste={onPaste}>
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

      <AttachmentTray items={trayItems} />

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
          // Never disabled. Attachment work happens beside the box, and a streaming answer
          // leaves it open for the next question — so there is nothing left to lock it for.
          rows={1}
          maxLength={CHAT_MESSAGE_MAX_CHARS}
          aria-label={STR.chatPlaceholder}
        />
        <div className="chat-tools">
          {/* Unavailable rather than hidden when the provider cannot see a picture: a
              control that vanishes reads as a bug, and the title says which model is the
              reason. */}
          <button
            type="button"
            className="btn-ghost chat-tool"
            onClick={() => imageInput.current?.click()}
            disabled={full || imagesBlocked}
            title={imagesBlocked ? imageBlockedLabel : STR.chatAttachImage}
            aria-label={
              imagesBlocked
                ? `${STR.chatAttachImage} — ${imageBlockedLabel}`
                : STR.chatAttachImage
            }
          >
            <ImageIcon size={20} aria-hidden="true" />
          </button>
          {/* Only the PDF HALF of this picker is provider-specific: DOCX and TXT are read
              here and reach the model as extracted text, so they work everywhere. The button
              therefore stays live and it is the accept list that narrows — and it is only
              disabled outright by a provider that could take no document at all. */}
          <button
            type="button"
            className="btn-ghost chat-tool"
            onClick={() => documentInput.current?.click()}
            disabled={full || (documentsBlocked && pdfBlocked)}
            title={
              documentsBlocked
                ? `${capabilities.label} ${STR.chatProviderNoDocuments}`
                : pdfBlocked
                  ? `${STR.chatAttachDocument} — ${capabilities.label} ${STR.chatProviderNoPdf}`
                  : STR.chatAttachDocument
            }
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
          {/* Gated on `full` like the three tools beside it, and on nothing else: it
              opens the same card the other two create surfaces render, so if that card
              is ever switched off again (YOUTUBE_INPUT_OFF in YouTubeLinkInput) this
              button must be dimmed with it — a tool that opens an inert panel is worse
              than one that plainly cannot be pressed. */}
          <button
            type="button"
            className={`btn-ghost chat-tool${YOUTUBE_INPUT_OFF ? ' chat-tool--off' : ''}`}
            onClick={() => setShowYouTube((open) => !open)}
            disabled={full || YOUTUBE_INPUT_OFF}
            aria-expanded={showYouTube}
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
              title={STR.chatSend}
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
      {blocked ? (
        <p className="chat-composer-error" role="alert">
          {STR.chatProviderUnreadable}
        </p>
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
      {/* `accept` is a filter, not a guarantee — every file dialog offers an "all files"
          escape — so a PDF that gets through is dropped here with the same sentence the
          button's title carries, rather than attached and then refused by the API. */}
      <input
        ref={documentInput}
        type="file"
        accept={pdfBlocked ? CHAT_TEXT_DOCUMENT_ACCEPT : CHAT_DOCUMENT_ACCEPT}
        multiple
        hidden
        onChange={(event) => {
          const picked = Array.from(event.target.files ?? []);
          const allowed = pdfBlocked
            ? picked.filter((file) => !isPdfFileName(file.name))
            : picked;
          if (allowed.length < picked.length) {
            setError(`${capabilities.label} ${STR.chatProviderNoPdf}`);
          }
          onAddDocuments(allowed);
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
