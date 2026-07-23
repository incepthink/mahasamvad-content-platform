'use client';

// Pre-translation "check the names" card, shared by the generation detail page and
// the standalone /translate page. Every translation goes through it: the API's
// prepare step supplies the text's proper nouns (merged with the नाव-शब्दकोश), the
// user corrects/adds the target-language spelling here, and confirming starts the
// translation with exactly these spellings locked — a wrong name (संवाद वारी →
// "dialogue van") never reaches the output, and the confirmed rows are saved verified
// so future translations inherit them without a /glossary visit.
//
// Which spelling columns show follows the TARGET language(s). An English run shows the
// English spelling; a HINDI run shows the Hindi Devanagari spelling (pre-filled with the
// Marathi form, edited only where Hindi differs, e.g. कोल्हापूर → कोल्हापुर). When BOTH
// languages are requested at once (the PDF path), BOTH columns show, so the officer
// never has to untick one language to correct a name in the other. A column that is not
// shown is carried through untouched, so confirming never wipes the other language's
// spelling.
//
// On a Hindi-capable run each proper-noun row also carries a "keep verbatim in Hindi"
// toggle. It is on by default for real proper nouns (person/place/org/scheme) and is the
// escape hatch for the extractor's mistakes: unticking a common noun the extractor
// mis-typed as a name (विधानसभा, सहकारी संस्था) demotes it to `other`, so it is
// translated normally instead of frozen — which is what lets an over-locked document
// translate at all.

import { useState } from 'react';
import type {
  PrepareTranslationResponse,
  TermType,
  TranslationLanguage,
  TranslationTermInput,
} from '@dgipr/schemas';
import { STR } from '../lib/strings';

type PreparedTerm = PrepareTranslationResponse['terms'][number];

type ExtraRow = { marathi: string; english: string; hindi: string };

// Which glossary types the Hindi path freezes verbatim (mirrors HINDI_LOCKED_TERM_TYPES
// in translate-article.ts). The lock toggle is only meaningful — and only shown — for
// these, because a designation/other row is already translated, not locked.
const HINDI_LOCKED_TYPES: ReadonlySet<TermType> = new Set([
  'person',
  'place',
  'org',
  'scheme',
]);

export function TranslationTermsReview({
  terms,
  busy,
  language = 'en',
  languages,
  collapseVerified = false,
  onConfirm,
  onCancel,
}: {
  terms: readonly PreparedTerm[];
  busy: boolean;
  // Target language of the translation this check precedes. Used when a single language
  // is in play (the article + pasted-text paths).
  language?: TranslationLanguage;
  // The full set of target languages, when more than one runs at once (the PDF path).
  // When it holds both 'en' and 'hi', both spelling columns show. Takes precedence over
  // `language` when provided.
  languages?: readonly TranslationLanguage[];
  // Folds the already-verified rows away behind a toggle. Off for an article or a
  // pasted paragraph, where the list is short; on for a whole PDF, where a hundred
  // rows of nothing-to-do would bury the handful that need the user's eyes. The
  // hidden rows are still submitted — folding is display only.
  collapseVerified?: boolean;
  onConfirm: (confirmed: TranslationTermInput[]) => void | Promise<void>;
  onCancel?: () => void;
}) {
  const targets = languages ?? [language];
  const showEnglish = targets.includes('en');
  const showHindi = targets.includes('hi');

  // Editable spelling per proposed term, one array per language; the Marathi side is
  // the fixed key. A column that is not shown is carried through untouched. Hindi seeds
  // from the pre-filled Hindi form (which prepare defaults to the Marathi spelling).
  const [english, setEnglish] = useState<string[]>(() =>
    terms.map((t) => t.english),
  );
  const [hindi, setHindi] = useState<string[]>(() =>
    terms.map((t) => t.hindi ?? t.marathi),
  );
  // Per-row "freeze this name verbatim in Hindi". Seeded from the extractor's type: a
  // proper-noun type starts locked, anything else starts unlocked. Only rendered for
  // proper-noun rows on a Hindi-capable run.
  const [lockHindi, setLockHindi] = useState<boolean[]>(() =>
    terms.map((t) => HINDI_LOCKED_TYPES.has(t.termType)),
  );
  // User-added names the extractor missed (the संवाद वारी case). Starts with one
  // open row of inputs so adding a name never needs a click first.
  const [extras, setExtras] = useState<ExtraRow[]>([
    { marathi: '', english: '', hindi: '' },
  ]);
  const [showVerified, setShowVerified] = useState(false);

  const verifiedCount = terms.filter((term) => term.verified).length;
  const hideVerified = collapseVerified && !showVerified && verifiedCount > 0;

  const confirm = () => {
    // Proceeding IS the verification: every proposed row with a non-empty spelling in a
    // shown column is confirmed, except untouched already-verified rows (they are already
    // locked server-side — re-upserting them would only churn the rows). Both spellings
    // are always sent so an upsert never wipes a non-edited column.
    const confirmed: TranslationTermInput[] = [];
    for (const [i, term] of terms.entries()) {
      const englishValue = showEnglish
        ? (english[i] ?? '').trim()
        : term.english;
      const hindiValue = showHindi
        ? (hindi[i] ?? '').trim()
        : (term.hindi ?? term.marathi);
      // A row unticked in the Hindi lock is demoted to `other`, which the Hindi lock
      // skips — so a common noun the extractor over-typed is translated, not frozen.
      const rowLocked = HINDI_LOCKED_TYPES.has(term.termType)
        ? (lockHindi[i] ?? true)
        : true;
      const termType: TermType | undefined = rowLocked ? term.termType : 'other';

      // Skip a shown column left empty; skip an already-verified row nothing changed on.
      if (showEnglish && englishValue.length === 0) continue;
      if (showHindi && hindiValue.length === 0) continue;
      const unchanged =
        term.verified &&
        englishValue === term.english &&
        hindiValue === (term.hindi ?? term.marathi) &&
        termType === term.termType;
      if (unchanged) continue;

      confirmed.push({
        marathi: term.marathi,
        english: englishValue,
        hindi: hindiValue,
        termType,
      });
    }
    for (const extra of extras) {
      const marathi = extra.marathi.trim();
      if (marathi.length === 0) continue;
      // A Hindi-only extra has no English (and vice versa); default the hidden/blank
      // column to the Marathi form (english is NOT NULL and the API applies the same
      // fallback).
      const englishValue = extra.english.trim() || marathi;
      const hindiValue = extra.hindi.trim() || marathi;
      if (showEnglish && !showHindi && extra.english.trim().length === 0)
        continue;
      if (showHindi && !showEnglish && extra.hindi.trim().length === 0) continue;
      confirmed.push({ marathi, english: englishValue, hindi: hindiValue });
    }
    void onConfirm(confirmed);
  };

  const title = showHindi && !showEnglish ? STR.namesReviewTitleHindi : STR.namesReviewTitle;
  const hint =
    terms.length > 0
      ? showHindi && !showEnglish
        ? STR.namesReviewHintHindi
        : STR.namesReviewHint
      : STR.namesReviewEmpty;

  return (
    <div className="names-review">
      <h3 className="names-review-title">{title}</h3>
      <p className="hint">{hint}</p>
      {showHindi ? <p className="hint">{STR.namesHindiHint}</p> : null}
      {showHindi ? <p className="hint">{STR.namesLockHindiHint}</p> : null}

      {hideVerified ? (
        <div className="btn-row" style={{ marginTop: 12 }}>
          <button
            type="button"
            className="btn btn-small"
            onClick={() => setShowVerified(true)}
          >
            {verifiedCount} {STR.namesShowVerified}
          </button>
        </div>
      ) : null}

      {terms.map((term, i) =>
        hideVerified && term.verified ? null : (
          <div
            key={term.marathi}
            className={`names-review-row ${term.verified ? 'is-verified' : 'is-unverified'}`}
          >
            <div className="glossary-cell">
              <span className="glossary-field-label">
                {STR.glossaryMarathi}
              </span>
              <span className="glossary-marathi">{term.marathi}</span>
            </div>
            {showEnglish ? (
              <div className="glossary-cell">
                <span className="glossary-field-label">
                  {STR.glossaryEnglish}
                </span>
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
            ) : null}
            {showHindi ? (
              <div className="glossary-cell">
                <span className="glossary-field-label">
                  {STR.glossaryHindi}
                </span>
                <input
                  type="text"
                  value={hindi[i] ?? ''}
                  onChange={(e) =>
                    setHindi((prev) => {
                      const next = [...prev];
                      next[i] = e.target.value;
                      return next;
                    })
                  }
                  disabled={busy}
                />
              </div>
            ) : null}
            {showHindi && HINDI_LOCKED_TYPES.has(term.termType) ? (
              <label className="names-lock-toggle">
                <input
                  type="checkbox"
                  checked={lockHindi[i] ?? true}
                  onChange={(e) =>
                    setLockHindi((prev) => {
                      const next = [...prev];
                      next[i] = e.target.checked;
                      return next;
                    })
                  }
                  disabled={busy}
                />
                <span>{STR.namesLockHindi}</span>
              </label>
            ) : null}
            <span
              className={`chip ${term.verified ? 'chip-completed' : 'chip-queued'}`}
            >
              {term.verified ? STR.glossaryVerified : STR.glossaryUnverified}
            </span>
          </div>
        ),
      )}

      {collapseVerified && showVerified && verifiedCount > 0 ? (
        <div className="btn-row" style={{ marginTop: 12 }}>
          <button
            type="button"
            className="btn btn-small"
            onClick={() => setShowVerified(false)}
          >
            {STR.namesHideVerified}
          </button>
        </div>
      ) : null}

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
          {showEnglish ? (
            <div className="glossary-cell">
              <span className="glossary-field-label">
                {STR.glossaryEnglish}
              </span>
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
          ) : null}
          {showHindi ? (
            <div className="glossary-cell">
              <span className="glossary-field-label">{STR.glossaryHindi}</span>
              <input
                type="text"
                value={extra.hindi}
                placeholder={STR.namesAddHindiPlaceholder}
                onChange={(e) =>
                  setExtras((prev) =>
                    prev.map((row, j) =>
                      j === i ? { ...row, hindi: e.target.value } : row,
                    ),
                  )
                }
                disabled={busy}
              />
            </div>
          ) : null}
          <span />
        </div>
      ))}

      <div className="btn-row" style={{ marginTop: 12 }}>
        <button
          type="button"
          className="btn btn-small"
          onClick={() =>
            setExtras((prev) => [
              ...prev,
              { marathi: '', english: '', hindi: '' },
            ])
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
