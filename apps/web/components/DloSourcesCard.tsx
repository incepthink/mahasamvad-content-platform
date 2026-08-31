'use client';

// "Attach whatever this meeting produced." One card holding every file source /dlo takes —
// recordings, photographs of documents, and PDF/DOCX/TXT files.
//
// It was three cards, one per kind, each with its own heading, hint and upload button, and
// the officer had to scroll past all three to reach the rest of the form even when they were
// attaching nothing. The question those three cards asked is the same question ("what do you
// want to add?"), so they are one card with one row of buttons and one list of what has been
// attached — which is shorter on the page and reads as one decision rather than three.
//
// What did NOT merge is how each kind is read, because that genuinely differs and the card
// still shows it:
//
//   recording     transcribed whole during प्रक्रिया — nothing to choose, so attaching is the
//                 whole interaction and the row is just a name and a size.
//   photograph    one page, read during प्रक्रिया like a transcript. Shown as a thumbnail,
//                 because phone snaps of a GR are told apart by what they show.
//   document      NOT read on our side at all. It is uploaded with the intake and handed to
//                 the article model as a file (`file_input`), which is why there is no page
//                 picker and no OCR step here any more — so a document row looks exactly
//                 like a recording row: a name, a size and a remove button.
//
// The card owns no state. Every list belongs to the form that will submit it (see
// DloIntakeForm, which drafts them to sessionStorage), so this only decides which picks are
// allowed to join them — via lib/filePicks, shared with the standalone recording picker on
// /transcribe so the two can never disagree about what a valid file is.

import { useRef, type ReactNode } from 'react';
import { FileText, Image as ImageIcon, Mic, Paperclip } from 'lucide-react';
import {
  AUDIO_FILE_ACCEPT,
  IMAGE_FILE_ACCEPT,
  isAudioFileName,
  isImageFileName,
} from '@dgipr/schemas';
import { DOCUMENT_FILE_ACCEPT, isDocumentFileName } from './DocumentIntake';
import { acceptFilePicks } from '../lib/filePicks';
import { AudioFileList } from './AudioFilePicker';
import { CardTitle } from './CardTitle';
import { ImageThumbnailGrid } from './ImageThumbnailGrid';
import { STR } from '../lib/strings';

export function DloSourcesCard({
  files,
  onFilesChange,
  audioNotice,
  images,
  onImagesChange,
  imageNotice,
  documents,
  onDocumentsChange,
  documentNotice,
  onError,
  disabled = false,
}: {
  files: readonly File[];
  onFilesChange: (files: File[]) => void;
  // Anything the form needs to say about the recordings — /dlo uses it to ask for ones a
  // reload could not keep.
  audioNotice?: ReactNode | undefined;
  images: readonly File[];
  onImagesChange: (files: File[]) => void;
  imageNotice?: ReactNode | undefined;
  documents: readonly File[];
  onDocumentsChange: (files: File[]) => void;
  documentNotice?: ReactNode | undefined;
  // Rejections are reported to the form rather than rendered here, so a refusal appears
  // beside the submit button with every other reason a run cannot start.
  onError: (message: string | null) => void;
  disabled?: boolean | undefined;
}) {
  const audioInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const documentInput = useRef<HTMLInputElement>(null);

  const addAudio = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    const {
      files: next,
      added,
      error,
    } = acceptFilePicks({
      current: files,
      picked: Array.from(list),
      isAllowedName: isAudioFileName,
      typeError: STR.dloFileTypeError,
    });
    onError(error);
    if (added > 0) onFilesChange(next);
  };

  const addImages = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    const {
      files: next,
      added,
      error,
    } = acceptFilePicks({
      current: images,
      picked: Array.from(list),
      isAllowedName: isImageFileName,
      typeError: STR.dloImageTypeError,
    });
    onError(error);
    if (added > 0) onImagesChange(next);
  };

  const addDocuments = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    const {
      files: next,
      added,
      error,
    } = acceptFilePicks({
      current: documents,
      picked: Array.from(list),
      isAllowedName: isDocumentFileName,
      typeError: STR.docUnsupported,
    });
    onError(error);
    if (added > 0) onDocumentsChange(next);
  };

  return (
    <section className="card">
      <CardTitle icon={Paperclip}>{STR.dloAttachTitle}</CardTitle>
      <p className="hint">{STR.dloAttachHint}</p>

      {/* One row, three buttons, in the order the sources are listed below. Each carries its
          own icon because the labels are short and the row is scanned rather than read. */}
      <div className="btn-row" style={{ marginTop: 12 }}>
        <button
          type="button"
          className="btn btn-small"
          disabled={disabled}
          onClick={() => audioInput.current?.click()}
        >
          <Mic size={18} aria-hidden="true" />
          {STR.dloAudioUpload}
        </button>
        <button
          type="button"
          className="btn btn-small"
          disabled={disabled}
          onClick={() => imageInput.current?.click()}
        >
          <ImageIcon size={18} aria-hidden="true" />
          {STR.dloImagesUpload}
        </button>
        {/* A file dialog like the two beside it. It used to add an empty reader block
            instead, because a document was read here page by page; it is now uploaded
            with the intake and read by the article model itself, so there is nothing to
            choose and attaching is the whole interaction. */}
        <button
          type="button"
          className="btn btn-small"
          disabled={disabled}
          onClick={() => documentInput.current?.click()}
        >
          <FileText size={18} aria-hidden="true" />
          {STR.dloDocsUpload}
        </button>
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

      {audioNotice}
      {imageNotice}
      {documentNotice}

      {files.length > 0 ? (
        <>
          <p className="field-label" style={{ marginTop: 16 }}>
            {STR.dloAudioFilesTitle}
          </p>
          <AudioFileList files={files} onChange={onFilesChange} />
        </>
      ) : null}

      {images.length > 0 ? (
        <>
          <p className="field-label" style={{ marginTop: 16 }}>
            {STR.dloImagesFilesTitle}
          </p>
          <ImageThumbnailGrid files={images} onChange={onImagesChange} />
        </>
      ) : null}

      {documents.length > 0 ? (
        <>
          <p className="field-label" style={{ marginTop: 16 }}>
            {STR.dloDocsFilesTitle}
          </p>
          <AudioFileList
            files={documents}
            onChange={onDocumentsChange}
            icon={FileText}
          />
        </>
      ) : null}
    </section>
  );
}
