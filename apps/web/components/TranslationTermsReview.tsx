'use client';

// Pre-translation "check the names" card, shared by the generation detail page and
// the standalone /translate page. Every translation goes through it: the API's
// prepare step supplies the text's proper nouns (merged with the नाव-शब्दकोश), the
// user corrects/adds English spellings here, and confirming starts the translation
// with exactly these spellings locked — a wrong name (संवाद वारी → "dialogue van")
// never reaches the English output, and the confirmed rows are saved verified so
// future translations inherit them without a /glossary visit.

import { useState } from 'react';
import type {
  PrepareTranslationResponse,
  TranslationTermInput,
} from '@dgipr/schemas';
import { STR } from '../lib/strings';

type PreparedTerm = PrepareTranslationResponse['terms'][number];

type ExtraRow = { marathi: string; english: string };

export function TranslationTermsReview({
  terms,
  busy,
  onConfirm,
  onCancel,
}: {
  terms: readonly PreparedTerm[];
  busy: boolean;
  onConfirm: (confirmed: TranslationTermInput[]) => void | Promise<void>;
  onCancel?: () => void;
}) {
  // Editable English spelling per proposed term; the Marathi side is the fixed key.
  const [english, setEnglish] = useState<string[]>(() =>
    terms.map((t) => t.english),
  );
  // User-added names the extractor missed (the संवाद वारी case). Starts with one
  // open pair of inputs so adding a name never needs a click first.
  const [extras, setExtras] = useState<ExtraRow[]>([
    { marathi: '', english: '' },
  ]);

  const confirm = () => {
    // Proceeding IS the verification: every proposed row with a non-empty English
    // spelling is confirmed, except untouched already-verified rows (they are
    // already locked server-side — re-upserting them would only churn the rows).
    const confirmed: TranslationTermInput[] = [];
    for (const [i, term] of terms.entries()) {
      const value = (english[i] ?? '').trim();
      if (value.length === 0) continue;
      if (term.verified && value === term.english) continue;
      confirmed.push({
        marathi: term.marathi,
        english: value,
        termType: term.termType,
      });
    }
    for (const extra of extras) {
      const marathi = extra.marathi.trim();
      const value = extra.english.trim();
      if (marathi.length === 0 || value.length === 0) continue;
      confirmed.push({ marathi, english: value });
    }
    void onConfirm(confirmed);
  };

  return (
    <div className="names-review">
      <h3 className="names-review-title">{STR.namesReviewTitle}</h3>
      <p className="hint">
        {terms.length > 0 ? STR.namesReviewHint : STR.namesReviewEmpty}
      </p>

      {terms.map((term, i) => (
        <div
          key={term.marathi}
          className={`names-review-row ${term.verified ? 'is-verified' : 'is-unverified'}`}
        >
          <div className="glossary-cell">
            <span className="glossary-field-label">{STR.glossaryMarathi}</span>
            <span className="glossary-marathi">{term.marathi}</span>
          </div>
          <div className="glossary-cell">
            <span className="glossary-field-label">{STR.glossaryEnglish}</span>
            <input
              type="text"
              value={english[i] ?? ''}
              onChange={(e) =>
                setEnglish((prev) => {
                  const next = [...prev];
                  next[i] = e.target.value;
                  return next;
                })
              }
              disabled={busy}
            />
          </div>
          <span
            className={`chip ${term.verified ? 'chip-completed' : 'chip-queued'}`}
          >
            {term.verified ? STR.glossaryVerified : STR.glossaryUnverified}
          </span>
        </div>
      ))}

      {extras.map((extra, i) => (
        <div key={i} className="names-review-row is-extra">
          <div className="glossary-cell">
            <span className="glossary-field-label">{STR.glossaryMarathi}</span>
            <input
              type="text"
              value={extra.marathi}
              placeholder={STR.namesAddMarathiPlaceholder}
              onChange={(e) =>
                setExtras((prev) =>
                  prev.map((row, j) =>
                    j === i ? { ...row, marathi: e.target.value } : row,
                  ),
                )
              }
              disabled={busy}
            />
          </div>
          <div className="glossary-cell">
            <span className="glossary-field-label">{STR.glossaryEnglish}</span>
            <input
              type="text"
              value={extra.english}
              placeholder={STR.namesAddEnglishPlaceholder}
              onChange={(e) =>
                setExtras((prev) =>
                  prev.map((row, j) =>
                    j === i ? { ...row, english: e.target.value } : row,
                  ),
                )
              }
              disabled={busy}
            />
          </div>
          <span />
        </div>
      ))}

      <div className="btn-row" style={{ marginTop: 12 }}>
        <button
          type="button"
          className="btn btn-small"
          onClick={() =>
            setExtras((prev) => [...prev, { marathi: '', english: '' }])
          }
          disabled={busy}
        >
          {STR.namesAddName}
        </button>
      </div>

      <div className="btn-row" style={{ marginTop: 16 }}>
        <button
          type="button"
          className="btn btn-primary"
          onClick={confirm}
          disabled={busy}
        >
          {busy ? STR.translating : STR.namesConfirmTranslate}
        </button>
        {onCancel ? (
          <button
            type="button"
            className="btn"
            onClick={onCancel}
            disabled={busy}
          >
            {STR.namesCancel}
          </button>
        ) : null}
      </div>
    </div>
  );
}
