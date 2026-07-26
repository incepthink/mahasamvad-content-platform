'use client';

// The page list. One component for every surface that shows the pages of an uploaded
// document — /translate, /dlo, the media room, /proofread — because they had all grown
// their own copy of the same markup, and the next improvement to it (a page image beside
// the OCR text) should not have to be made four times.
//
// It renders TWO shapes, and the difference is a product rule, not a style choice:
//
//   pages given      the document has been read. Each row shows its text, editable, with a
//                    character count and the backend that produced it.
//   pageNumbers only the document has NOT been read, because reading it costs OCR credits
//                    per page. Numbers alone — rendering its text would mean running the
//                    very OCR the user is being asked to authorise.
//
// It holds no selection state. The surfaces disagree about how to store one for good
// reasons (see lib/documentSelection.ts), so this asks a predicate and reports events.
// The only state here is which row is expanded and whether the re-read confirm is open —
// both purely local, both meaningless to the caller.

import { useState } from 'react';
import type { PdfTextSourceValue } from '@dgipr/schemas';
import { type PageLike, defaultPageKey } from '../lib/documentSelection';
import { STR } from '../lib/strings';
import { PageRangeSelector } from './PageRangeSelector';

function marathiNumber(value: number): string {
  return value.toLocaleString('mr-IN');
}

export function DocumentPages({
  pages,
  pageNumbers,
  isSelected,
  edits,
  keyOf = defaultPageKey,
  source,
  busy = false,
  showSourceBadge = true,
  showSelectAll = true,
  showRangeSelector = true,
  onToggle,
  onSetAll,
  onEdit,
  onReextract,
}: {
  // The pages that have been read. Omit (and pass pageNumbers) for a document awaiting
  // its page selection.
  pages?: readonly PageLike[] | undefined;
  // Every page the document HAS, for the pre-read picker. Ignored when `pages` is given.
  pageNumbers?: readonly number[] | undefined;
  isSelected: (page: number) => boolean;
  edits?: Readonly<Record<string, string>> | undefined;
  // How an edit is keyed. Single-document surfaces use the page number; /dlo shows several
  // documents at once and keys by `${fileIndex}:${page}`.
  keyOf?: ((page: number) => string) | undefined;
  source?: PdfTextSourceValue | null | undefined;
  busy?: boolean | undefined;
  showSourceBadge?: boolean | undefined;
  // /dlo hides these: its card header checkbox already IS the file's select-all, and two
  // controls for one thing on the same card read as a bug.
  showSelectAll?: boolean | undefined;
  // Whether an ALREADY-READ document gets the range selector above its text rows. On by
  // default (a 50-page born-digital file needs it as much as a scan does); /dlo turns it
  // off on its per-file cards, where the card header is already the file's selection
  // control and the rows are there to be read, not bulk-picked. Ignored for a document
  // that has not been read — there the selector IS the picker.
  showRangeSelector?: boolean | undefined;
  onToggle: (page: number) => void;
  onSetAll: (pages: number[], include: boolean) => void;
  // Omit to make the list read-only (no textareas).
  onEdit?: ((key: string, value: string) => void) | undefined;
  // Omit to hide the "read it with OCR instead" override.
  onReextract?: (() => void) | undefined;
}) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [confirmingReextract, setConfirmingReextract] = useState(false);

  // One row per page, carrying its text when there is text to carry. Built as a single
  // list so the two shapes below differ only in whether `page` is null — never in which
  // array is being indexed.
  const rows: Array<{ number: number; page: PageLike | null }> = pages
    ? pages.map((page) => ({ number: page.page, page }))
    : (pageNumbers ?? []).map((number) => ({ number, page: null }));
  if (rows.length === 0) return null;

  const listed = rows.map((row) => row.number);
  const selectedCount = listed.filter(isSelected).length;

  return (
    <>
      {/* Which backend read this file changes how hard the text should be looked at, so it
          is stated rather than left to be guessed. */}
      {showSourceBadge && source ? (
        <p className="hint" style={{ marginTop: 8 }}>
          <span
            className={
              source === 'ocr' ? 'chip chip-queued' : 'chip chip-completed'
            }
          >
            {source === 'ocr' ? STR.docSourceOcr : STR.docSourceTextLayer}
          </span>{' '}
          {source === 'ocr' ? STR.docSourceOcrHint : STR.docSourceTextLayerHint}
        </p>
      ) : null}

      {/* The automatic text-layer/OCR gate cannot catch every broken PDF font, so the user
          can overrule it. Offered only on a text-layer read — re-running OCR on OCR output
          just spends the minutes again. */}
      {onReextract && source === 'text-layer' && !confirmingReextract ? (
        <div className="btn-row" style={{ marginTop: 10 }}>
          <button
            type="button"
            className="btn btn-small"
            disabled={busy}
            onClick={() => setConfirmingReextract(true)}
          >
            {STR.docReextract}
          </button>
        </div>
      ) : null}
      {onReextract && confirmingReextract ? (
        <div className="info-callout" style={{ marginTop: 10 }}>
          <p>{STR.docReextractHint}</p>
          <div className="btn-row" style={{ marginTop: 8 }}>
            <button
              type="button"
              className="btn btn-primary btn-small"
              disabled={busy}
              onClick={() => {
                setConfirmingReextract(false);
                onReextract();
              }}
            >
              {STR.docReextractYes}
            </button>
            <button
              type="button"
              className="btn btn-small"
              onClick={() => setConfirmingReextract(false)}
            >
              {STR.docReextractCancel}
            </button>
          </div>
        </div>
      ) : null}

      {/* A document nobody has read yet has nothing to show but its page numbers, so the
          range selector IS the picker — no row list at all. This is the shape that has to
          survive a 50-page scan, and the one place the chip grid stays open: it is the whole
          control here, not a shortcut over something already on screen. */}
      {!pages ? (
        <PageRangeSelector
          listed={listed}
          isSelected={isSelected}
          onToggle={onToggle}
          onSetAll={onSetAll}
          busy={busy}
          showSelectAll={showSelectAll}
          collapsible={false}
        />
      ) : (
        <>
          {/* A read document keeps its rows (the text has to be readable and editable),
              with the selector above them as the bulk control. It starts folded here —
              the rows are already the visual list; this is the shortcut. */}
          {showRangeSelector ? (
            <PageRangeSelector
              listed={listed}
              isSelected={isSelected}
              onToggle={onToggle}
              onSetAll={onSetAll}
              busy={busy}
              showSelectAll={showSelectAll}
              defaultExpanded={false}
            />
          ) : showSelectAll ? (
            <div className="btn-row" style={{ marginTop: 12 }}>
              <button
                type="button"
                className="btn btn-small"
                disabled={busy}
                onClick={() => onSetAll(listed, true)}
              >
                {STR.docSelectAll}
              </button>
              <button
                type="button"
                className="btn btn-small"
                disabled={busy}
                onClick={() => onSetAll(listed, false)}
              >
                {STR.docClearAll}
              </button>
            </div>
          ) : null}

          <ul className="page-list">
            {rows.map(({ number, page }) => {
              const key = keyOf(number);
              const text = page ? (edits?.[key] ?? page.text) : null;
              const isOpen = openKey === key;
              return (
                <li key={key} className="page-row">
                  <label className="page-row-head">
                    <input
                      type="checkbox"
                      checked={isSelected(number)}
                      disabled={busy}
                      onChange={() => onToggle(number)}
                    />
                    <span className="page-row-name">
                      {STR.docPage} {marathiNumber(number)}
                    </span>
                    {/* A page with no text has no language to report — the detector defaults to
                    Marathi on an empty string, which would badge a blank page मराठी. */}
                    {page?.language && text && text.length > 0 ? (
                      <span className="chip chip-queued">
                        {page.language === 'en' ? STR.docLangEn : STR.docLangMr}
                      </span>
                    ) : null}
                    {edits?.[key] !== undefined ? (
                      <span className="chip chip-completed">
                        {STR.docEdited}
                      </span>
                    ) : null}
                    {text !== null ? (
                      <span className="page-row-chars">
                        {marathiNumber(text.length)} {STR.docChars}
                      </span>
                    ) : null}
                    {text !== null && onEdit ? (
                      <button
                        type="button"
                        className="btn btn-small"
                        onClick={(event) => {
                          event.preventDefault();
                          setOpenKey(isOpen ? null : key);
                        }}
                      >
                        {isOpen ? STR.docEditClose : STR.docEdit}
                      </button>
                    ) : null}
                  </label>
                  {isOpen && text !== null && onEdit ? (
                    <textarea
                      className="note-input"
                      value={text}
                      disabled={busy}
                      onChange={(event) => onEdit(key, event.target.value)}
                      style={{ marginTop: 10, minHeight: 220 }}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        </>
      )}

      {selectedCount === 0 ? (
        <p className="hint" style={{ marginTop: 10 }}>
          {STR.docNoPagesSelected}
        </p>
      ) : null}
    </>
  );
}
