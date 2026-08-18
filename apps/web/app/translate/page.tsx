'use client';

// Standalone translation of pasted text OR an uploaded file, between मराठी, इंग्रजी and
// हिंदी in any direction.
//
// ONE flow, deliberately. There used to be a second "PDF फाईल" tab running a parallel
// background job (per-page, per-language, its own routes and its own page picker), which
// meant two upload experiences, two page pickers and two shapes of result on one page. Now
// the shared <DocumentIntake> reads any pdf/docx/txt — including a scanned PDF, whose pages
// are picked before a single OCR credit is spent — and its text is a SECOND source counted
// beside the box above it. From there everything is the text path: one submit, the name
// check, one translation.
//
// The upload runs in LIVE mode (onTextChange), not handoff, and the submit reads an unread
// scan itself — the media room's arrangement, for the same reason. In handoff mode the file's
// text reached this page only when a button INSIDE the upload card was pressed, so a scanned
// PDF took three presses in three different places (निवडलेली पृष्ठे वाचा → हा मजकूर वापरा →
// भाषांतर करा) and an officer who pressed only the last one was told to write something to
// translate while their document sat there, read and ignored. Now भाषांतर करा is enough on its
// own: it triggers the OCR read of the ticked pages if that has not happened yet and continues
// into the translation as soon as the text lands. The page picker is still the spend gate —
// no page is read unless it was ticked — the press that authorises it has just moved.
//
// ONE question is asked — which language to translate INTO — and its three answers are
// ALWAYS enabled. The officer is not asked what language they pasted, and the text is not
// inspected to guess it (a मराठी/हिंदी guess shares one script and can only ever be a
// heuristic; a wrong one sends Hindi to a prompt that calls itself a "Marathi-to-English
// translator"). Nothing on this row appears, vanishes or switches itself off as they type.
//
// The SOURCE is derived, never asked: Latin script in means an English source, Devanagari
// means Marathi (or Hindi when मराठी is the target, since Marathi cannot be both). That is a
// SCRIPT test rather than a language guess, and the API serves every pair it can produce —
// including the identity ones, which come back unchanged instead of erroring — so no answer
// on the row can ever be the wrong one to offer. The box's own label names the source the
// current text and target imply, so the derivation is visible without being a question.
// Everything else downstream (whether the name-review step runs) follows from it.
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

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  type PrepareTranslationResponse,
  type TextTranslationLanguage,
  type TranslationTermInput,
} from '@dgipr/schemas';
import { prepareTextTranslation, translateText } from '../../lib/api';
import { downloadBlob } from '../../lib/download';
import { STR } from '../../lib/strings';
import {
  DocumentIntake,
  type DocumentIntakeStatus,
} from '../../components/DocumentIntake';
import { TranslationTermsReview } from '../../components/TranslationTermsReview';
import { ComposeSafeTextarea } from '../../components/ComposeSafeInput';

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
// detectProofreadLanguage uses. The text is consulted for its SCRIPT and nothing else — no
// word list, no मराठी/हिंदी judgement, nothing that can be wrong about a language.
const DEVANAGARI_RATIO_FOR_INDIC = 0.3;

function writtenInDevanagari(text: string): boolean {
  const devanagari = (text.match(/[ऀ-ॿ]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  if (devanagari + latin === 0) return false;
  return devanagari / (devanagari + latin) >= DEVANAGARI_RATIO_FOR_INDIC;
}

/**
 * The source language to send with the chosen target. Decided by SCRIPT, never by asking:
 *
 *   Latin script in  → the source is English, whichever target was picked.
 *   Devanagari in    → मराठी, except when मराठी is the target, where it can only be हिंदी.
 *
 * The one language this cannot tell apart from Marathi is Hindi, and the tie goes to
 * Marathi because that is what this department pastes. Every combination it can produce is
 * a pair the API serves (TEXT_TRANSLATION_PAIRS covers all nine, identity included), which
 * is what lets all three targets stay enabled with nothing left to reject — an English note
 * asked for in हिंदी is en→hi, a real translation, and asked for in इंग्रजी it is en→en,
 * which comes straight back unchanged rather than switching a button off.
 */
function sourceForTarget(
  target: TextTranslationLanguage,
  text: string,
): TextTranslationLanguage {
  if (!writtenInDevanagari(text)) return 'en';
  return target === 'mr' ? 'hi' : 'mr';
}

// Where the upload card remembers its in-flight job. Named once because the remove control
// has to clear it by hand — see clearDocument.
const DOC_STORAGE_KEY = 'dgipr.translate.document';

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
  'en>hi': 'english-hindi-translation.txt',
  'hi>mr': 'hindi-marathi-translation.txt',
  'hi>en': 'hindi-english-translation.txt',
};

export default function TranslatePage() {
  const [text, setText] = useState('');
  // The uploaded file's text, kept BESIDE the textarea rather than pushed into it: the two
  // are independent sources and either one alone is a complete job.
  const [docText, setDocText] = useState('');
  const [docStatus, setDocStatus] = useState<DocumentIntakeStatus>('empty');
  // Bumping this asks the upload card to run its selected-page extraction. A counter rather
  // than a flag so a retry after a failed read is an explicit new request.
  const [readRequest, setReadRequest] = useState(0);
  // The submit is waiting for that read to land before it can translate anything.
  const [awaitingRead, setAwaitingRead] = useState(false);
  const readRequestedForSubmitRef = useRef(false);
  // What the upload card last published, so an identical re-publish (a re-render of the
  // card, a poll that changed nothing) cannot throw away a finished translation.
  const docTextRef = useRef('');
  // Remounts the upload card to drop a finished document (its own state is internal).
  const [docKey, setDocKey] = useState(0);
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

  // What actually gets translated: typed text, uploaded file, or both, in that order.
  // Blank-line separated so a pasted note and an attached document read as two blocks.
  const combinedText = useMemo(
    () => [text.trim(), docText.trim()].filter(Boolean).join('\n\n'),
    [text, docText],
  );

  // Never asked, never guessed at as a LANGUAGE — see sourceForTarget. Every target the row
  // offers therefore yields a pair the API serves, which is what lets all three stay enabled
  // with nothing left to reject.
  const source = sourceForTarget(target, combinedText);

  // The `unread` arm is what keeps a scanned PDF usable: its pages are ticked but nobody has
  // paid to read them yet, so it contributes nothing to combinedText, and reading it and then
  // translating is exactly what startSubmit does. Testing the text alone would leave an
  // officer whose only source is a scan with a dead button and no way forward.
  const canSubmit = combinedText.length > 0 || docStatus === 'unread';
  const busy = submitting || awaitingRead || prep !== 'idle';
  const disabled = busy || !canSubmit;
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

  // Throw the attached file away without translating it. "दुसरी फाईल निवडा" only ever
  // REPLACED it, so an officer who decided to translate the pasted text alone had no way to
  // detach the document — and in live mode its text is counted at submit whether or not
  // anyone is still looking at it. A remount is what clears the card's internal state, and
  // the stored job id has to go with it or the mount effect would re-attach the same file.
  const clearDocument = () => {
    window.sessionStorage.removeItem(DOC_STORAGE_KEY);
    docTextRef.current = '';
    setDocText('');
    setDocStatus('empty');
    setDocKey((n) => n + 1);
    resetFlow();
  };

  // Step 1 on a Marathi source: extract the text's names for review. Failure returns to
  // idle with a Marathi error — never silently translating with unchecked names.
  const startNameCheck = async () => {
    setPrep('preparing');
    setError(null);
    setResult(null);
    try {
      const res = await prepareTextTranslation(combinedText);
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
        text: combinedText,
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
    if (combinedText.length === 0) return;
    if (reviewsNames) {
      void startNameCheck();
      return;
    }
    setResult(null);
    void runTranslation();
  };

  // भाषांतर करा, pressed. An attached scan whose ticked pages nobody has read yet is read
  // FIRST and the translation continues by itself when the text lands (the effect below) —
  // so the officer never has to find a second button in the upload card. `reading` is
  // included because a read already under way needs waiting for, not starting again.
  const startSubmit = () => {
    if (docStatus === 'unread' || docStatus === 'reading') {
      setAwaitingRead(true);
      if (docStatus === 'unread') {
        readRequestedForSubmitRef.current = true;
        setReadRequest((request) => request + 1);
      }
      return;
    }
    submit();
  };

  // Held in a ref so the effect below can run on the document's status alone and still call
  // the CURRENT closure — one that can see the text the read just produced.
  const startSubmitRef = useRef(startSubmit);
  useEffect(() => {
    startSubmitRef.current = startSubmit;
  });
  useEffect(() => {
    if (!awaitingRead) return;
    if (docStatus === 'unread') {
      // A file attached while we were already waiting, or a read that failed and left pages
      // ticked: ask once more rather than sitting on a spinner for ever.
      if (!readRequestedForSubmitRef.current) {
        readRequestedForSubmitRef.current = true;
        setReadRequest((request) => request + 1);
      }
      return;
    }
    if (docStatus === 'ready') {
      readRequestedForSubmitRef.current = false;
      setAwaitingRead(false);
      startSubmitRef.current();
    } else if (docStatus === 'failed' || docStatus === 'empty') {
      // Nothing came back. Stop waiting and leave the card's own error standing rather than
      // translating an empty selection.
      readRequestedForSubmitRef.current = false;
      setAwaitingRead(false);
    }
  }, [awaitingRead, docStatus]);

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
        {/* Uncontrolled by design: an InScript keyboard assembles each Marathi character in
            stages a controlled box can overwrite half-formed. See ComposeSafeInput. */}
        <ComposeSafeTextarea
          id="translate-text"
          className="note-input"
          placeholder={STR.translateInputPlaceholder}
          value={text}
          onChange={(next) => {
            setText(next);
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
                disabled={busy}
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

      {/* The document to translate usually arrives as a file, not in the clipboard. The
              shared intake reads pdf/docx/txt — a scanned PDF stops to ask which pages are
              worth OCR'ing before a credit is spent — and its text is counted beside the box
              above, in LIVE mode, so there is no hand-over button to find and no way to leave
              an upload behind. No character budget is passed: this page imposes no length
              limit on the text, so page selection is about OCR spend, not about trimming. */}
      <DocumentIntake
        key={docKey}
        storageKey={DOC_STORAGE_KEY}
        feature="translate"
        accept={['pdf', 'docx', 'txt']}
        onTextChange={(value) => {
          // Only a real change may invalidate a finished translation.
          if (value === docTextRef.current) return;
          docTextRef.current = value;
          setDocText(value);
          resetFlow();
        }}
        onStatusChange={setDocStatus}
        readRequest={readRequest}
        // Offered only once there IS a file: the component renders this control in every
        // state including the empty upload card, where there is nothing to delete.
        {...(docStatus === 'empty' ? {} : { onRemove: clearDocument })}
        // The same भाषांतर करा, beside the file controls. A scanned PDF's page picker is
        // taller than the viewport, so the submit below it is off screen at exactly the
        // moment the officer has finished choosing pages.
        submitAction={
          <button
            type="button"
            className="btn btn-primary btn-small"
            onClick={startSubmit}
            disabled={disabled}
          >
            {awaitingRead ? STR.docReadingForSubmit : STR.translateAction}
          </button>
        }
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
            onClick={startSubmit}
            disabled={disabled}
          >
            {STR.translateAction}
          </button>
          {awaitingRead ? (
            <span className="translating-note">
              <span className="spinner" aria-hidden="true" />
              {STR.docReadingForSubmit}
            </span>
          ) : null}
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
