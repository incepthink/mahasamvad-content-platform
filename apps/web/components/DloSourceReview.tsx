'use client';

// The review step of /dlo: one card per source instead of one big box.
//
// The officer's job here is spotting STT and OCR errors in names, amounts and
// scheme names before they become "facts" — the pipeline never invents, but it
// trusts its input completely. That job is per source, so the transcript of each
// recording and the text of each document get their own card, and a PDF gets a
// page list so pages that do not belong in the article (annexures, signature
// pages, tabular accounting) can simply be unchecked.
//
// The PDF half of a card is <DocumentPages>, the shared page list every upload surface
// uses — so a PDF here looks and behaves exactly as it does on /translate, and the next
// improvement to it arrives here for free. What stays local to this file is what is
// genuinely DLO's: the per-source card, the include checkbox that spans notes/recordings/
// documents alike, and the needs-selection messaging.
//
// Two deliberate differences from /translate's page picker:
//   - recordings and DOCX text are shown EXPANDED. They have to be read to be
//     checked, and there is usually one of them; a 20-page PDF is the opposite
//     case, so its pages stay collapsed.
//   - the whole-file checkbox on a PDF card is its select-all: unchecking clears
//     every page, checking restores them. (Which is why the shared list's own
//     select-all row is switched off here — two controls for one thing reads as a bug.)
//
// A PDF has TWO shapes here. A file that has been read lists its pages with their text,
// editable, as above. A SCANNED file that has not (status 'needs-selection') lists page
// NUMBERS only: reading it costs OCR credits per page, so the officer picks first and the
// page.tsx "निवडलेली पृष्ठे वाचा" button spends only on what is ticked. Until then the file
// contributes nothing to the assembled note, which is why generate is blocked while one is
// outstanding.

// CirclePlay stands in for a YouTube mark: lucide 1.x carries no brand icons.
import { CirclePlay, FileText, Image as ImageIcon, Music } from 'lucide-react';
import type { DloIntakeDetail, DloIntakeFile } from '@dgipr/schemas';
import { dloFileImageUrl } from '../lib/api';
import {
  NOTES_KEY,
  filePageNumbers,
  pageKey,
  sourceKey,
  sourceText,
} from '../lib/dloReview';
import { STR } from '../lib/strings';
import { DocumentPages } from './DocumentPages';

function marathiNumber(value: number): string {
  return value.toLocaleString('mr-IN');
}

const KIND_LABEL: Record<DloIntakeFile['kind'], string> = {
  audio: STR.dloReviewKindAudio,
  // A transcribed YouTube video behaves exactly like a recording from here on — one card,
  // one editable transcript — so only the badge and the icon distinguish it.
  youtube: STR.ytSourceLabel,
  // A photograph read by the same OCR a PDF page gets, so from here on it is a card with one
  // editable text — plus the picture itself, which is what makes checking a misread name
  // possible at all.
  image: STR.dloReviewKindImage,
  pdf: STR.dloReviewKindPdf,
  docx: STR.dloReviewKindDocx,
  txt: STR.dloReviewKindTxt,
};

export function DloSourceReview({
  intake,
  edits,
  excluded,
  busy,
  reextractingIndex,
  onEdit,
  onToggle,
  onToggleFilePages,
  onReextract,
}: {
  intake: DloIntakeDetail;
  edits: Readonly<Record<string, string>>;
  excluded: ReadonlySet<string>;
  busy: boolean;
  reextractingIndex: number | null;
  onEdit: (key: string, value: string) => void;
  onToggle: (key: string) => void;
  onToggleFilePages: (index: number, include: boolean) => void;
  onReextract: (index: number) => void;
}) {
  return (
    <>
      {intake.notes.trim().length > 0 ? (
        <section className="card">
          <SourceHead
            icon={<FileText size={20} aria-hidden="true" />}
            label={STR.dloReviewNotesTitle}
            included={!excluded.has(NOTES_KEY)}
            onToggle={() => onToggle(NOTES_KEY)}
            disabled={busy}
            meta={`${marathiNumber(
              (edits[NOTES_KEY] ?? intake.notes).length,
            )} ${STR.dloCharsSuffix}`}
          />
          <textarea
            className="note-input"
            value={edits[NOTES_KEY] ?? intake.notes}
            disabled={busy || excluded.has(NOTES_KEY)}
            onChange={(event) => onEdit(NOTES_KEY, event.target.value)}
            style={{ marginTop: 12, minHeight: 180 }}
          />
        </section>
      ) : null}

      {intake.files.map((file, index) => {
        const key = sourceKey(index);
        const reextracting = reextractingIndex === index;
        const pages = file.pages ?? null;
        // A scanned PDF nobody has paid to read yet: it lists page NUMBERS, because its
        // text is precisely what the officer is deciding whether to buy.
        const needsSelection = file.status === 'needs-selection';
        const pageNumbers = filePageNumbers(file);
        const selectedNumbers = (pageNumbers ?? []).filter(
          (page) => !excluded.has(pageKey(index, page)),
        );
        const included = pageNumbers
          ? selectedNumbers.length > 0
          : !excluded.has(key);
        const chars = pages
          ? sourceText(file, index, edits, excluded).length
          : (edits[key] ?? file.text ?? '').length;

        return (
          <section className="card" key={`${file.name}-${index}`}>
            <SourceHead
              icon={
                file.kind === 'youtube' ? (
                  <CirclePlay size={20} aria-hidden="true" />
                ) : file.kind === 'audio' ? (
                  <Music size={20} aria-hidden="true" />
                ) : file.kind === 'image' ? (
                  <ImageIcon size={20} aria-hidden="true" />
                ) : (
                  <FileText size={20} aria-hidden="true" />
                )
              }
              label={file.name}
              kindLabel={KIND_LABEL[file.kind]}
              included={included}
              onToggle={() =>
                pageNumbers
                  ? onToggleFilePages(index, !included)
                  : onToggle(key)
              }
              disabled={busy || reextracting || file.status === 'failed'}
              meta={
                pageNumbers
                  ? `${marathiNumber(selectedNumbers.length)} / ${marathiNumber(
                      pageNumbers.length,
                    )} ${STR.dloReviewPagesSelected}${
                      needsSelection
                        ? ''
                        : ` · ${marathiNumber(chars)} ${STR.dloCharsSuffix}`
                    }`
                  : `${marathiNumber(chars)} ${STR.dloCharsSuffix}`
              }
              extraChip={
                needsSelection ? STR.dloReviewNeedsSelectionChip : undefined
              }
            />

            {/* The video this transcript came from. Worth a line of its own: the card
                header shows the TITLE, and checking a name or a figure against what was
                actually said means going back to the source. */}
            {file.sourceUrl ? (
              <a
                className="yt-source-link"
                href={file.sourceUrl}
                target="_blank"
                rel="noreferrer"
                style={{ marginTop: 8 }}
              >
                <CirclePlay size={14} aria-hidden="true" />
                {file.sourceAuthor
                  ? `${file.sourceAuthor} · ${STR.ytOpen}`
                  : STR.ytOpen}
              </a>
            ) : null}

            {file.status === 'failed' ? (
              <p className="form-error" style={{ marginTop: 10 }}>
                {file.error ?? STR.dloReviewSourceFailed}
              </p>
            ) : null}

            {needsSelection ? (
              <div className="info-callout" style={{ marginTop: 10 }}>
                <p>{STR.dloReviewNeedsSelection}</p>
              </div>
            ) : null}

            {reextracting ? (
              <p className="translating-note" style={{ marginTop: 10 }}>
                <span className="spinner" aria-hidden="true" />
                {STR.dloReviewRereading}
              </p>
            ) : null}

            {/* One list for both PDF shapes: `pages` when the file has been read,
                `pageNumbers` when it has not (its text is exactly what the officer is
                deciding whether to buy). The shared component also owns the OCR-override
                confirm and the text-layer/OCR badge. */}
            {pageNumbers ? (
              <DocumentPages
                {...(needsSelection
                  ? { pageNumbers }
                  : { pages: pages ?? undefined })}
                isSelected={(page) => !excluded.has(pageKey(index, page))}
                edits={edits}
                keyOf={(page) => pageKey(index, page)}
                source={file.pdfSource ?? null}
                busy={busy || reextracting}
                // The card header's checkbox is already this file's select-all.
                showSelectAll={false}
                onToggle={(page) => onToggle(pageKey(index, page))}
                onSetAll={(_, include) => onToggleFilePages(index, include)}
                onEdit={onEdit}
                // The OCR override is offered only while the original is still in the
                // private bucket: a document read at the input step whose upload job had
                // expired by then kept its text but not its bytes.
                {...(reextracting || file.canReextract !== true
                  ? {}
                  : { onReextract: () => onReextract(index) })}
              />
            ) : null}

            {/* A photograph that read as nothing at all. Said plainly, and NOT as an error:
                the OCR ran and answered honestly, so the actionable thing is to look at the
                picture beside it — and, if the text is there but unreadable to the model, to
                type it in, which the box below allows. */}
            {file.kind === 'image' &&
            file.status === 'done' &&
            (edits[key] ?? file.text ?? '').trim().length === 0 ? (
              <div className="info-callout" style={{ marginTop: 10 }}>
                <p>{STR.dloReviewImageEmpty}</p>
              </div>
            ) : null}

            {!pages && !needsSelection && file.status !== 'failed' ? (
              // An image shows the original beside its transcript: proofreading Marathi OCR
              // means comparing it with something, and the alternative is an officer checking
              // a name against nothing. Everything else keeps the full-width box.
              file.kind === 'image' && file.canPreview ? (
                <div className="image-review">
                  <a
                    className="image-review-shot"
                    href={dloFileImageUrl(intake.id, index)}
                    target="_blank"
                    rel="noreferrer"
                    title={STR.dloReviewImageOpen}
                  >
                    {/* Plain <img>, like the YouTube thumbnails: this is served by the API
                        out of the PRIVATE bucket, so next/image would need a remote pattern
                        for it and could not optimise a one-off per-intake object anyway. */}
                    <img
                      src={dloFileImageUrl(intake.id, index)}
                      alt={`${STR.dloReviewImageAlt}: ${file.name}`}
                      loading="lazy"
                    />
                    <span>{STR.dloReviewImageOpen}</span>
                  </a>
                  <textarea
                    className="note-input"
                    value={edits[key] ?? file.text ?? ''}
                    disabled={busy || excluded.has(key)}
                    onChange={(event) => onEdit(key, event.target.value)}
                  />
                </div>
              ) : (
                <textarea
                  className="note-input"
                  value={edits[key] ?? file.text ?? ''}
                  disabled={busy || excluded.has(key)}
                  onChange={(event) => onEdit(key, event.target.value)}
                  style={{ marginTop: 12, minHeight: 220 }}
                />
              )
            ) : null}
          </section>
        );
      })}
    </>
  );
}

// The shared card header: include checkbox, name, kind, and whatever counts the
// card wants to show on the right.
function SourceHead({
  icon,
  label,
  kindLabel,
  extraChip,
  included,
  onToggle,
  disabled,
  meta,
}: {
  icon: React.ReactNode;
  label: string;
  kindLabel?: string;
  extraChip?: string | undefined;
  included: boolean;
  onToggle: () => void;
  disabled: boolean;
  meta: string;
}) {
  return (
    <label className="page-row-head">
      <input
        type="checkbox"
        checked={included}
        disabled={disabled}
        aria-label={STR.dloReviewInclude}
        onChange={onToggle}
      />
      {icon}
      <span className="page-row-name">{label}</span>
      {kindLabel ? <span className="chip chip-queued">{kindLabel}</span> : null}
      {extraChip ? <span className="chip chip-queued">{extraChip}</span> : null}
      {!included ? (
        <span className="chip chip-failed">{STR.dloReviewExcluded}</span>
      ) : null}
      <span className="page-row-chars">{meta}</span>
    </label>
  );
}
