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
// Two deliberate differences from /translate's page picker, which this otherwise
// mirrors (down to reusing its .page-list markup and Marathi labels):
//   - recordings and DOCX text are shown EXPANDED. They have to be read to be
//     checked, and there is usually one of them; a 20-page PDF is the opposite
//     case, so its pages stay collapsed.
//   - the whole-file checkbox on a PDF card is its select-all: unchecking clears
//     every page, checking restores them.
//
// A PDF has TWO shapes here. A file that has been read lists its pages with their text,
// editable, as above. A SCANNED file that has not (status 'needs-selection') lists page
// NUMBERS only: reading it costs OCR credits per page, so the officer picks first and the
// page.tsx "निवडलेली पृष्ठे वाचा" button spends only on what is ticked. Until then the file
// contributes nothing to the assembled note, which is why generate is blocked while one is
// outstanding.

import { useState } from 'react';
import { FileText, Music } from 'lucide-react';
import type { DloIntakeDetail, DloIntakeFile } from '@dgipr/schemas';
import {
  NOTES_KEY,
  filePageNumbers,
  pageKey,
  sourceKey,
  sourceText,
} from '../lib/dloReview';
import { STR } from '../lib/strings';

function marathiNumber(value: number): string {
  return value.toLocaleString('mr-IN');
}

const KIND_LABEL: Record<DloIntakeFile['kind'], string> = {
  audio: STR.dloReviewKindAudio,
  pdf: STR.dloReviewKindPdf,
  docx: STR.dloReviewKindDocx,
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
  const [openPage, setOpenPage] = useState<string | null>(null);
  const [confirmingReextract, setConfirmingReextract] = useState<number | null>(
    null,
  );

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
                file.kind === 'audio' ? (
                  <Music size={20} aria-hidden="true" />
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

            {/* Which backend read this PDF changes how hard the text should be
                looked at, so it is stated rather than left to be guessed. */}
            {file.pdfSource ? (
              <p className="hint" style={{ marginTop: 8 }}>
                <span
                  className={
                    file.pdfSource === 'ocr'
                      ? 'chip chip-queued'
                      : 'chip chip-completed'
                  }
                >
                  {file.pdfSource === 'ocr'
                    ? STR.translateDocSourceOcr
                    : STR.translateDocSourceTextLayer}
                </span>{' '}
                {file.pdfSource === 'ocr'
                  ? STR.translateDocSourceOcrHint
                  : STR.translateDocSourceTextLayerHint}
              </p>
            ) : null}

            {reextracting ? (
              <p className="translating-note" style={{ marginTop: 10 }}>
                <span className="spinner" aria-hidden="true" />
                {STR.dloReviewRereading}
              </p>
            ) : null}

            {/* The automatic text-layer/OCR gate cannot catch every broken PDF
                font, so the officer can overrule it. Offered only on a text-layer
                read — re-running OCR on OCR output just spends the minutes again. */}
            {file.pdfSource === 'text-layer' &&
            !reextracting &&
            confirmingReextract !== index ? (
              <div className="btn-row" style={{ marginTop: 10 }}>
                <button
                  type="button"
                  className="btn btn-small"
                  disabled={busy}
                  onClick={() => setConfirmingReextract(index)}
                >
                  {STR.translateDocReextract}
                </button>
              </div>
            ) : null}
            {confirmingReextract === index ? (
              <div className="info-callout" style={{ marginTop: 10 }}>
                <p>{STR.translateDocReextractHint}</p>
                <div className="btn-row" style={{ marginTop: 8 }}>
                  <button
                    type="button"
                    className="btn btn-primary btn-small"
                    disabled={busy}
                    onClick={() => {
                      setConfirmingReextract(null);
                      onReextract(index);
                    }}
                  >
                    {STR.translateDocReextractYes}
                  </button>
                  <button
                    type="button"
                    className="btn btn-small"
                    onClick={() => setConfirmingReextract(null)}
                  >
                    {STR.translateDocReextractCancel}
                  </button>
                </div>
              </div>
            ) : null}

            {/* Numbers only — this PDF has not been read, so there is no text to show
                and no per-page editing to offer until there is. */}
            {needsSelection && pageNumbers ? (
              <>
                <ul className="page-list">
                  {pageNumbers.map((page) => {
                    const itemKey = pageKey(index, page);
                    return (
                      <li key={page} className="page-row">
                        <label className="page-row-head">
                          <input
                            type="checkbox"
                            checked={!excluded.has(itemKey)}
                            disabled={busy}
                            onChange={() => onToggle(itemKey)}
                          />
                          <span className="page-row-name">
                            {STR.translateDocPage} {marathiNumber(page)}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
                {selectedNumbers.length === 0 ? (
                  <p className="hint" style={{ marginTop: 10 }}>
                    {STR.dloReviewNoPages}
                  </p>
                ) : null}
              </>
            ) : null}

            {pages ? (
              <>
                <ul className="page-list">
                  {pages.map((page) => {
                    const itemKey = pageKey(index, page.page);
                    const text = edits[itemKey] ?? page.text;
                    const isOpen = openPage === itemKey;
                    return (
                      <li key={page.page} className="page-row">
                        <label className="page-row-head">
                          <input
                            type="checkbox"
                            checked={!excluded.has(itemKey)}
                            disabled={busy || reextracting}
                            onChange={() => onToggle(itemKey)}
                          />
                          <span className="page-row-name">
                            {STR.translateDocPage} {marathiNumber(page.page)}
                          </span>
                          {edits[itemKey] !== undefined ? (
                            <span className="chip chip-completed">
                              {STR.translateDocEdited}
                            </span>
                          ) : null}
                          <span className="page-row-chars">
                            {marathiNumber(text.length)} {STR.translateDocChars}
                          </span>
                          <button
                            type="button"
                            className="btn btn-small"
                            onClick={(event) => {
                              event.preventDefault();
                              setOpenPage(isOpen ? null : itemKey);
                            }}
                          >
                            {isOpen
                              ? STR.translateDocEditClose
                              : STR.translateDocEdit}
                          </button>
                        </label>
                        {isOpen ? (
                          <textarea
                            className="note-input"
                            value={text}
                            disabled={busy || reextracting}
                            onChange={(event) =>
                              onEdit(itemKey, event.target.value)
                            }
                            style={{ marginTop: 10, minHeight: 220 }}
                          />
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
                {selectedNumbers.length === 0 ? (
                  <p className="hint" style={{ marginTop: 10 }}>
                    {STR.dloReviewNoPages}
                  </p>
                ) : null}
              </>
            ) : null}

            {!pages && !needsSelection && file.status !== 'failed' ? (
              <textarea
                className="note-input"
                value={edits[key] ?? file.text ?? ''}
                disabled={busy || excluded.has(key)}
                onChange={(event) => onEdit(key, event.target.value)}
                style={{ marginTop: 12, minHeight: 220 }}
              />
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
