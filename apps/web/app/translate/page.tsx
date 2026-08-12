'use client';

// Standalone translation of pasted text OR an uploaded file, in four directions:
// मराठी → इंग्रजी, मराठी → हिंदी, इंग्रजी → मराठी and हिंदी → मराठी.
//
// ONE flow, deliberately. There used to be a second "PDF फाईल" tab running a parallel
// background job (per-page, per-language, its own routes and its own page picker), which
// meant two upload experiences, two page pickers and two shapes of result on one page. Now
// the shared <DocumentIntake> reads any pdf/docx/txt — including a scanned PDF, whose pages
// are picked before a single OCR credit is spent — and drops the text into the same box the
// user could have pasted into. From there everything is the text path: one submit, the name
// check, one translation.
//
// ONE question is asked — which language to translate INTO — and its three answers are
// ALWAYS enabled. The officer is not asked what language they pasted, and the text is not
// inspected to guess it (a मराठी/हिंदी guess shares one script and can only ever be a
// heuristic; a wrong one sends Hindi to a prompt that calls itself a "Marathi-to-English
// translator"). Nothing on this row appears, vanishes or switches itself off as they type.
//
// The SOURCE follows from the target, because the pairs the API serves — mr→en, mr→hi,
// en→mr, hi→mr — leave it no freedom: इंग्रजी or हिंदी out means मराठी in. Only मराठी out is
// ambiguous, and there the choice is between an ENGLISH and a HINDI source, which is a
// SCRIPT test (Latin vs Devanagari) rather than a language guess. The box's own label names
// the source the current target implies, so the derivation is visible without being a
// question. Everything else downstream (whether the name-review step runs) follows from it.
//
// The two-step submit is the point of the page when the source is MARATHI: submitting first
// runs the name check (TranslationTermsReview) so the user confirms/corrects every proper
// noun's spelling in place, and only then does the translation run — with those names locked
// and saved to the नाव-शब्दकोश for future runs. For Hindi the confirmed names are frozen in
// Devanagari rather than mapped to English.
//
// Going INTO Marathi there is no review step, and that is not a shortcut — it is that the
// question has no content. The card asks "is this Marathi name's English/Hindi spelling
// right?"; here the spelling the output is held to is the dictionary's own `marathi` column,
// already reviewed, and the API enforces it deterministically after translating (see
// translate-article.ts). So the submit goes straight to the translation, and the card is
// replaced by one line saying so.
//
// Nothing is stored — not the text, not the uploaded file (the intake job is in-memory with
// a TTL).
//
// This page imposes NO length limit on the text: translateArticle chunks internally, so a
// long document translates as one long synchronous request. The API's own
// TRANSLATE_TEXT_MAX_CHARS zod cap is still in force server-side, so an over-long text
// surfaces as a request error rather than a local warning.

import { useState } from 'react';
import {
  type PrepareTranslationResponse,
  type TextTranslationLanguage,
  type TranslationTermInput,
} from '@dgipr/schemas';
import { prepareTextTranslation, translateText } from '../../lib/api';
import { downloadBlob } from '../../lib/download';
import { STR } from '../../lib/strings';
import { DocumentIntake } from '../../components/DocumentIntake';
import { TranslationTermsReview } from '../../components/TranslationTermsReview';

type TranslationResult = Readonly<{
  text: string;
  source: TextTranslationLanguage;
  language: TextTranslationLanguage;
  lockedTermCount: number;
  // Locked names the output could not carry verbatim (always empty for English, whose
  // names are locked in the prompt instead of checked afterwards).
  unpreservedNames: readonly string[];
}>;

// The three languages a translation can go INTO. All three are always selectable; none is
// ever conditioned on the text.
const TARGET_OPTIONS = [
  { value: 'mr', label: STR.translateTargetMarathi },
  { value: 'en', label: STR.translateTargetEnglish },
  { value: 'hi', label: STR.translateTargetHindi },
] as const satisfies readonly {
  value: TextTranslationLanguage;
  label: string;
}[];

// Latin letters vs Devanagari, the same 0.3 threshold content-engine's
// detectProofreadLanguage uses. Only consulted when the target is मराठी, where the source is
// either English or Hindi and those two are told apart by SCRIPT — no word list, no
// मराठी/हिंदी judgement, nothing that can be wrong about a language.
const DEVANAGARI_RATIO_FOR_INDIC = 0.3;

function writtenInDevanagari(text: string): boolean {
  const devanagari = (text.match(/[ऀ-ॿ]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  if (devanagari + latin === 0) return false;
  return devanagari / (devanagari + latin) >= DEVANAGARI_RATIO_FOR_INDIC;
}

/**
 * The language the text must be in for the chosen target to be a translation the API serves.
 * Anything but मराठी out means मराठी in; मराठी out means English or Hindi in, which is the
 * one place the text itself is consulted — for its script, never for its language.
 */
function sourceForTarget(
  target: TextTranslationLanguage,
  text: string,
): TextTranslationLanguage {
  if (target !== 'mr') return 'mr';
  return writtenInDevanagari(text) ? 'hi' : 'en';
}

const INPUT_LABELS: Readonly<Record<TextTranslationLanguage, string>> = {
  mr: STR.translateInputLabelMarathi,
  en: STR.translateInputLabelEnglish,
  hi: STR.translateInputLabelHindi,
};

const OUTPUT_TITLES: Readonly<Record<TextTranslationLanguage, string>> = {
  mr: STR.translateOutputTitleMarathi,
  en: STR.translateOutputTitle,
  hi: STR.translateOutputTitleHindi,
};

const DOWNLOAD_NAMES: Readonly<Record<string, string>> = {
  'mr>en': 'marathi-english-translation.txt',
  'mr>hi': 'marathi-hindi-translation.txt',
  'en>mr': 'english-marathi-translation.txt',
  'hi>mr': 'hindi-marathi-translation.txt',
};

export default function TranslatePage() {
  const [text, setText] = useState('');
  // The page's one question. इंग्रजी is the department's commonest job and so is the default.
  const [target, setTarget] = useState<TextTranslationLanguage>('en');
  // Name-check flow: idle → preparing (extracting names) → review (card shown).
  const [prep, setPrep] = useState<'idle' | 'preparing' | 'review'>('idle');
  const [prepared, setPrepared] = useState<
    PrepareTranslationResponse['terms'] | null
  >(null);
  const [result, setResult] = useState<TranslationResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Never asked, never guessed at as a LANGUAGE — see sourceForTarget. Every target the row
  // offers therefore yields a pair the API serves, which is what lets all three stay enabled
  // with nothing left to reject.
  const source = sourceForTarget(target, text);

  const disabled = submitting || prep !== 'idle' || text.trim().length === 0;
  // The review card only has a question to ask about a MARATHI source (see the header).
  const reviewsNames = source === 'mr';

  // Any change to the text or the target invalidates a prepared name list and an old result —
  // a result belongs to the direction it was made in, and on a →मराठी run the text is also
  // what decides whether the source is read as English or Hindi.
  const resetFlow = () => {
    setResult(null);
    setPrep('idle');
    setPrepared(null);
    setError(null);
  };

  // Step 1 on a Marathi source: extract the text's names for review. Failure returns to
  // idle with a Marathi error — never silently translating with unchecked names.
  const startNameCheck = async () => {
    if (disabled) return;
    setPrep('preparing');
    setError(null);
    setResult(null);
    try {
      const res = await prepareTextTranslation(text.trim());
      setPrepared(res.terms);
      setPrep('review');
    } catch {
      setError(STR.namesPrepareError);
      setPrep('idle');
    }
  };

  // Step 2: translate, with the confirmed names locked and saved verified where there were
  // any to confirm. The result carries its own direction so the output card cannot mislabel
  // itself if the pills are changed afterwards (changing them clears the result anyway).
  const runTranslation = async (terms?: TranslationTermInput[]) => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await translateText({
        text: text.trim(),
        sourceLanguage: source,
        language: target,
        ...(terms ? { terms } : {}),
      });
      setResult({
        text: res.translated,
        source: res.sourceLanguage,
        language: res.language,
        lockedTermCount: res.lockedTermCount,
        unpreservedNames: res.unpreservedNames,
      });
      setPrep('idle');
      setPrepared(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : STR.genericError);
    } finally {
      setSubmitting(false);
    }
  };

  // The one submit button. A Marathi source stops at the name check first; going INTO
  // Marathi there is nothing to check, so it translates directly.
  const submit = () => {
    if (disabled) return;
    if (reviewsNames) {
      void startNameCheck();
      return;
    }
    setResult(null);
    void runTranslation();
  };

  const copyToClipboard = async () => {
    if (!result) return;
    await navigator.clipboard.writeText(result.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <main className="page">
      <header className="page-head">
        <div className="page-head-text">
          <h1 className="page-title">{STR.translatePageTitle}</h1>
          <p className="page-sub">{STR.translatePageIntro}</p>
        </div>
      </header>

      <section className="card">
        {/* The label names the source the chosen target implies, so the box states what it
            expects instead of the row below it having to ask. */}
        <label className="field-label" htmlFor="translate-text">
          {INPUT_LABELS[source]}
        </label>
        <p className="hint">{STR.translateInputHint}</p>
        <textarea
          id="translate-text"
          className="note-input"
          placeholder={STR.translateInputPlaceholder}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            resetFlow();
          }}
          style={{ marginTop: 10 }}
        />
        <p className="hint char-count">
          {text.length.toLocaleString('en-IN')} {STR.docChars}
        </p>

        {/* The target row sits with the text it is about, not in a card of its own two
            scrolls further down. All three are ALWAYS enabled — nothing here is conditioned
            on what the box contains, so nothing appears, vanishes or switches itself off
            under the officer's cursor as they type. */}
        <div className="translate-target">
          <p className="field-label">{STR.translateDirectionLabel}</p>
          <div
            className="lang-toggle"
            role="group"
            aria-label={STR.translateDirectionLabel}
          >
            {TARGET_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className="btn btn-small"
                aria-pressed={target === option.value}
                disabled={submitting || prep !== 'idle'}
                onClick={() => {
                  setTarget(option.value);
                  // A result belongs to the direction it was made in; changing the target
                  // invalidates it exactly like editing the text does.
                  resetFlow();
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* The document to translate usually arrives as a file, not in the clipboard.
              The shared intake reads pdf/docx/txt and drops the text into the box above,
              where it is edited and translated like anything else — a scanned PDF stops to
              ask which pages are worth OCR'ing before a credit is spent. No character
              budget is passed: this page imposes no length limit on the text, so page
              selection is about OCR spend, not about trimming to fit. */}
      <DocumentIntake
        storageKey="dgipr.translate.document"
        feature="translate"
        accept={['pdf', 'docx', 'txt']}
        onText={(value) => {
          setText(value);
          resetFlow();
        }}
      />

      {/* The submit, as an action bar rather than a full sheet of white holding one button
          (see .card-action). The name-review panel is a sibling below it, not a child: it
          carries its own frame and would sit inside a tinted bar as a panel within a panel. */}
      <section className="card card-action">
        {/* Said before the submit, not after it: an officer used to a two-step submit
            should know the step is missing on purpose and where the spelling comes from. */}
        {!reviewsNames ? (
          <p className="hint">{STR.translateIntoMarathiNames}</p>
        ) : null}

        <div className="btn-row" style={{ marginTop: reviewsNames ? 0 : 14 }}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={submit}
            disabled={disabled}
          >
            {STR.translateAction}
          </button>
          {prep === 'preparing' ? (
            <span className="translating-note">
              <span className="spinner" aria-hidden="true" />
              {STR.namesChecking}
            </span>
          ) : null}
          {submitting ? (
            <span className="translating-note">
              <span className="spinner" aria-hidden="true" />
              {STR.translating} {STR.translateMayTakeTime}
            </span>
          ) : null}
        </div>
        {error ? <p className="form-error">{error}</p> : null}
      </section>

      {prep === 'review' && prepared ? (
        <TranslationTermsReview
          terms={prepared}
          busy={submitting}
          // The panel only ever renders on a Marathi source, where the target is en or
          // hi — which is exactly what its own prop accepts.
          language={target === 'hi' ? 'hi' : 'en'}
          onConfirm={(terms) => void runTranslation(terms)}
          onCancel={() => {
            setPrep('idle');
            setPrepared(null);
          }}
        />
      ) : null}

      {result ? (
        <section className="card">
          <h2>{OUTPUT_TITLES[result.language]}</h2>
          {result.unpreservedNames.length > 0 ? (
            <div className="info-callout warn" style={{ marginBottom: 12 }}>
              <p className="field-label">{STR.translateUnpreservedTitle}</p>
              <p className="hint">
                {STR.translateUnpreservedHint}{' '}
                {result.unpreservedNames.join(', ')}
              </p>
            </div>
          ) : null}
          <div className="article-body">{result.text}</div>
          <div className="btn-row" style={{ marginTop: 18 }}>
            <button type="button" className="btn" onClick={copyToClipboard}>
              {copied ? STR.copied : STR.copyText}
            </button>
            <button
              type="button"
              className="btn"
              onClick={() =>
                downloadBlob(
                  DOWNLOAD_NAMES[`${result.source}>${result.language}`] ??
                    'translation.txt',
                  result.text,
                  'text/plain',
                )
              }
            >
              {STR.downloadTxt}
            </button>
          </div>
          <p className="hint">
            {result.lockedTermCount} {STR.translateLockedTerms}
          </p>
        </section>
      ) : null}
    </main>
  );
}
