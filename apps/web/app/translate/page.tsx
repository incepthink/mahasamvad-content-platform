'use client';

// Standalone translation of pasted text OR an uploaded file, between मराठी, इंग्रजी and
// हिंदी in any direction.
//
// SAME SHAPE AS THE OTHER TWO CREATE SURFACES — Creative and Social (app/page.tsx) and
// लेख / बातमी (app/dlo/page.tsx): a doodle wallpaper, a page-head, and one composer card
// built out of components/common (FormCard → PromptTextarea → a tool row →
// AttachmentStrip) WITH THE SUBMIT AT THE END OF THAT ROW. It used to be a legacy `.card`
// holding a `.note-input`, a row of `.btn btn-small` pills, a full-width upload card and a
// `.card-action` bar of its own — the same four ideas in four different spellings, which is
// exactly how these pages drift apart.
//
// THE SUBMIT IS IN THE COMPOSER CARD, not pinned to the foot of the viewport. `GenerateBar`
// earned its place while the compulsory part of a page ran several blocks long and a button
// at the end of the flow was off screen; here everything a translation needs is in this one
// card and the blocks below it (the name review, the result) are consequences of pressing
// it, not things to fill in first. So the button sits with the controls it acts on — the
// text, the file and the target — and every complaint it can raise is rendered directly
// under it rather than at the bottom of the window.
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
// The upload block itself now lives BEHIND the paperclip inside the composer, and what is
// attached is a card in the strip under the tool row (AttachmentStrip), the shape /dlo and
// the media room already use. The block folds away on its own once the file is read and
// stays open while it still has something to ask — a page selection, or a failure. There is
// no longer a duplicate submit inside the upload card either: it existed because a scanned
// PDF's page picker is taller than the viewport and the submit below it was off screen. The
// upload block now opens BELOW the tool row that carries भाषांतर करा, so the picker can be
// as tall as it likes without pushing the button anywhere.
//
// ONE question is asked — which language to translate INTO — and its three answers are
// ALWAYS enabled. The officer is not asked what language they pasted, and the text is not
// inspected to guess it (a मराठी/हिंदी guess shares one script and can only ever be a
// heuristic; a wrong one sends Hindi to a prompt that calls itself a "Marathi-to-English
// translator"). Nothing on this control appears, vanishes or switches itself off as they type.
//
// The SOURCE is derived, never asked: Latin script in means an English source, Devanagari
// means Marathi (or Hindi when मराठी is the target, since Marathi cannot be both). That is a
// SCRIPT test rather than a language guess, and the API serves every pair it can produce —
// including the identity ones, which come back unchanged instead of erroring — so no answer
// in the menu can ever be the wrong one to offer. The box's own label names the source the
// current text and target imply, so the derivation is visible without being a question.
// Everything else downstream (whether the name-review step runs) follows from it.
//
// The two-step submit is the point of the page when the source is MARATHI: submitting first
// runs the name check (TranslationTermsReview) so the user confirms/corrects every proper
// noun's spelling in place, and only then does the translation run — with those names locked
// and saved to the नाव-शब्दकोश for future runs. For Hindi the confirmed names are frozen in
// Devanagari rather than mapped to English.
//
// भाषांतर करा stays LIVE through that second step, and pressing it there confirms the open
// card with whatever spellings have been typed into it — it does not re-run the extraction.
// The card carries its own confirm button, but a real name list is long enough to push that
// button below the fold, so the button the officer already pressed once has to keep working
// rather than sit greyed out while the page waits for a second one they cannot see. The
// review card renders under the composer, so that button is a short scroll up from it.
//
// Going INTO Marathi there is no review step, and that is not a shortcut — it is that the
// question has no content. The card asks "is this Marathi name's English/Hindi spelling
// right?"; here the spelling the output is held to is the dictionary's own `marathi` column,
// already reviewed, and the API enforces it deterministically after translating (see
// translate-article.ts). So the submit goes straight to the translation, and the card is
// replaced by one line saying so.
//
// Nothing is stored — not the text, not the uploaded file (the intake job is in-memory with
// a TTL) — so this page has no history list to show, unlike /dlo and /transcribe.
//
// This page imposes NO length limit on the text: translateArticle chunks internally, so a
// long document translates as one long synchronous request. The API's own
// TRANSLATE_TEXT_MAX_CHARS zod cap is still in force server-side, so an over-long text
// surfaces as a request error rather than a local warning.

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, FileText, Languages, Paperclip } from 'lucide-react';
import {
  type PrepareTranslationResponse,
  type TextTranslationLanguage,
  type TranslationTermInput,
} from '@dgipr/schemas';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AttachmentStrip,
  type AttachmentItem,
} from '@/components/common/AttachmentStrip';
import { ComposerToolbarButton } from '@/components/common/ComposerToolbarButton';
import { FormCard } from '@/components/common/FormCard';
import { PageBackdrop } from '@/components/common/PageBackdrop';
import { PromptTextarea } from '@/components/common/PromptTextarea';
import { ErrorNotice } from '@/components/ErrorNotice';
import { cn } from '@/lib/utils';
import { prepareTextTranslation, translateText } from '../../lib/api';
import { downloadBlob } from '../../lib/download';
import { TRANSLATE_DOODLES } from '../../lib/doodleMarks';
import { STR } from '../../lib/strings';
import { errorMessage } from '../../lib/errorMessage';
import {
  DocumentIntake,
  type DocumentIntakeInfo,
  type DocumentIntakeStatus,
} from '../../components/DocumentIntake';
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

// The upload block this page's paperclip opens, named so the button can point at it.
const DOC_PANEL_ID = 'translate-document';

const INPUT_LABELS: Readonly<Record<TextTranslationLanguage, string>> = {
  mr: STR.translateInputLabelMarathi,
  en: STR.translateInputLabelEnglish,
  hi: STR.translateInputLabelHindi,
};

const TARGET_LABELS: Readonly<Record<TextTranslationLanguage, string>> = {
  mr: STR.translateTargetMarathi,
  en: STR.translateTargetEnglish,
  hi: STR.translateTargetHindi,
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
  // Enough to NAME the file in the attachment strip while it is still being read — the
  // snapshot cannot, being null until there is text to describe.
  const [docInfo, setDocInfo] = useState<DocumentIntakeInfo | null>(null);
  // Whether the upload block below the strip is on screen. Opened by the paperclip and by
  // the attachment card; folded away on its own once a read starts (see the effect below).
  const [docOpen, setDocOpen] = useState(false);
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
  // Bumping this asks the open name-review card to confirm itself with the spellings
  // currently typed into it — see the submit below.
  const [confirmRequest, setConfirmRequest] = useState(0);
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

  // Never asked, never guessed at as a LANGUAGE — see sourceForTarget. Every target the menu
  // offers therefore yields a pair the API serves, which is what lets all three stay enabled
  // with nothing left to reject.
  const source = sourceForTarget(target, combinedText);

  // The `unread` arm is what keeps a scanned PDF usable: its pages are ticked but nobody has
  // paid to read them yet, so it contributes nothing to combinedText, and reading it and then
  // translating is exactly what startSubmit does. Testing the text alone would leave an
  // officer whose only source is a scan with a dead button and no way forward.
  const canSubmit = combinedText.length > 0 || docStatus === 'unread';
  // Locks the target menu: an open review card was extracted for one target (its columns
  // and its Hindi lock follow it), so changing the target under it would discard the
  // officer's corrections through resetFlow.
  const busy = submitting || awaitingRead || prep !== 'idle';
  // The submit is NOT disabled merely because the name-review card is open. That card is
  // the second half of this page's one submit, not a modal to be answered elsewhere: the
  // officer corrects a spelling and presses भाषांतर करा, which is the button they pressed
  // to get here and — pinned — the one always on screen. Pressing it there confirms the
  // card with what they have typed (see submit). Everything that is genuinely in flight —
  // the name extraction, an OCR read, the translation itself — still disables it, since
  // re-pressing those would either double-charge or discard work.
  const submitBusy = submitting || awaitingRead || prep === 'preparing';
  // The review card only has a question to ask about a MARATHI source (see the header).
  const reviewsNames = source === 'mr';

  const submitLabel = awaitingRead
    ? STR.docReadingForSubmit
    : prep === 'preparing'
      ? STR.namesChecking
      : submitting
        ? STR.translating
        : STR.translateAction;

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
    // The remount reports 'empty' with no file on its own, but not until it has mounted —
    // and until then the strip would still be showing a card for a document that is gone.
    setDocInfo(null);
    setDocStatus('empty');
    setDocOpen(false);
    setDocKey((n) => n + 1);
    resetFlow();
  };

  // Once a file IS attached, the upload block folds away on its own and its card in the
  // strip takes over — reading progress, page count, remove. Only on the TRANSITION into a
  // read, so re-opening the block from the card leaves it open. A scan waiting for its page
  // selection, or a failed read, is exempt: `docNeedsBlock` below keeps that block on screen
  // regardless, because it is asking a question.
  const docReadStartedRef = useRef(false);
  useEffect(() => {
    const reading = docStatus === 'reading' || docStatus === 'ready';
    if (reading && !docReadStartedRef.current) setDocOpen(false);
    docReadStartedRef.current = reading;
  }, [docStatus]);

  // Folding either of these away would hide the question, and in the page-selection case
  // the run would then be submitted from a document nobody had paid to read.
  const docNeedsBlock = docStatus === 'unread' || docStatus === 'failed';
  const showDoc = docOpen || docNeedsBlock;

  const attachments: AttachmentItem[] = docInfo
    ? [
        {
          id: 'document',
          name: docInfo.fileName,
          icon: FileText,
          meta:
            docStatus === 'reading'
              ? STR.attachmentReading
              : docStatus === 'unread'
                ? STR.attachmentNeedsPages
                : docStatus === 'failed'
                  ? STR.attachmentFailed
                  : docInfo.pageCount !== null
                    ? `${docInfo.pageCount.toLocaleString('mr-IN')} ${STR.attachmentPagesSuffix}`
                    : STR.attachmentReady,
          busy: docStatus === 'reading',
          failed: docStatus === 'failed',
          removeLabel: `${STR.docRemove}: ${docInfo.fileName}`,
          onRemove: clearDocument,
          // Only while the block is foldable: opening it is the point of the card, but a
          // block that is on screen asking a question must not be closable from here.
          ...(docNeedsBlock
            ? {}
            : {
                open: showDoc,
                openLabel: showDoc ? STR.attachmentClose : STR.attachmentOpen,
                onOpen: () => setDocOpen((open) => !open),
              }),
        },
      ]
    : [];

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
  // itself if the target is changed afterwards (changing it clears the result anyway).
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
      setError(errorMessage(e));
    } finally {
      setSubmitting(false);
    }
  };

  // The one submit button. A Marathi source stops at the name check first; going INTO
  // Marathi there is nothing to check, so it translates directly.
  const submit = () => {
    if (combinedText.length === 0) return;
    // The review card is already open: this press IS the confirmation. Re-running the name
    // check instead would throw away every spelling the officer just corrected and re-bill
    // the extraction for a list they are looking at.
    if (prep === 'review') {
      setConfirmRequest((request) => request + 1);
      return;
    }
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
    // No foot clearance and so no `.translate-page`: the submit is in the composer card
    // below, so nothing is pinned over the last block or over the credit line any more.
    <main className="page">
      {/* Wallpaper for this lane: what an officer brings here is one language and takes
          away another — books, letters, a globe, an exchange. The marks are decorative
          only, and the vocabulary lives beside the other lanes' in lib/doodleMarks.ts —
          see components/common/PageBackdrop.tsx. */}
      <PageBackdrop marks={TRANSLATE_DOODLES} seed={23} />

      <header className="page-head">
        <div className="page-head-text">
          <h1 className="page-title">{STR.translatePageTitle}</h1>
          <p className="page-sub">{STR.translatePageIntro}</p>
        </div>
      </header>

      <div className="flex flex-col gap-5">
        {/* The one input. Everything that decides WHAT is translated lives in this card:
            the typed text, the file behind [+], and which language it goes into. */}
        <FormCard
          htmlFor="translate-text"
          // The label names the source the chosen target implies, so the box states what
          // it expects instead of a separate control having to ask.
          label={INPUT_LABELS[source]}
          hint={STR.translateInputHint}
        >
          <div className="mt-4">
            <PromptTextarea
              id="translate-text"
              value={text}
              onChange={(next) => {
                setText(next);
                resetFlow();
              }}
              placeholder={STR.translateInputPlaceholder}
              disabled={submitting}
              className="w-full"
            />

            {/* The one band of controls: attach a file, choose the target. Icon-only for
                the tool, the same h-9 dropdown the other two create surfaces use for the
                question they ask once and rarely change. */}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <ComposerToolbarButton
                icon={Paperclip}
                label={STR.docUpload}
                disabled={submitting}
                active={showDoc}
                controls={DOC_PANEL_ID}
                onClick={() => setDocOpen((open) => !open)}
              />

              {/* All three are ALWAYS offered — nothing here is conditioned on what the
                  box contains, so nothing appears, vanishes or switches itself off under
                  the officer's cursor as they type. */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    type="button"
                    disabled={busy}
                    aria-label={STR.translateDirectionLabel}
                    title={STR.translateDirectionLabel}
                    className="justify-between font-normal"
                  >
                    <Languages aria-hidden="true" />
                    {TARGET_LABELS[target]}
                    <ChevronDown aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-56">
                  <DropdownMenuGroup>
                    {TARGET_OPTIONS.map((option) => (
                      <DropdownMenuItem
                        key={option.value}
                        onSelect={() => {
                          setTarget(option.value);
                          // A result belongs to the direction it was made in; changing
                          // the target invalidates it exactly like editing the text does.
                          resetFlow();
                        }}
                      >
                        {option.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>

              {/* The count and the page's one action, held together and pushed to the
                  end of the same row — so they wrap onto a line of their own rather than
                  the button being stranded under a lone tool button on a narrow card.
                  The same arrangement /dlo's composer uses. */}
              <div className="ms-auto flex items-center gap-3">
                {/* A pasted press note is long enough that "how much is this?" is a real
                    question; an empty box does not need the answer. */}
                {text.length > 0 ? (
                  <span className="text-muted-foreground text-sm">
                    {text.length.toLocaleString('en-IN')} {STR.docChars}
                  </span>
                ) : null}

                {/* THE SUBMIT, at the end of the tool row, exactly as it sits on Creative
                    and Social (components/media-room/NoteComposer) and on /dlo. Both
                    conditions are the ones the pinned bar carried, unchanged: DISABLED
                    until there is something to translate (`canSubmit` — which counts a
                    scanned PDF whose pages are ticked but unread, or an officer whose only
                    source is a scan would face a dead button), and disabled again while
                    anything is genuinely in flight. It is deliberately NOT disabled merely
                    because the name-review card is open: that card is the second half of
                    this one submit, and pressing here confirms it.

                    Enabled, it carries the slow warm sheen (`mr-submit-flow`,
                    globals.css) — the only moving thing on the page, so "there is
                    something to press now" reads without a label; disabled it is quiet and
                    still. */}
                <button
                  type="button"
                  onClick={startSubmit}
                  disabled={submitBusy || !canSubmit}
                  className={cn(
                    'text-primary-foreground inline-flex h-9 shrink-0 items-center rounded-md px-5 text-sm font-bold transition-[filter]',
                    'focus-visible:ring-ring/50 outline-none focus-visible:ring-[3px]',
                    'disabled:cursor-not-allowed disabled:opacity-60',
                    submitBusy || !canSubmit
                      ? 'bg-primary'
                      : 'mr-submit-flow hover:saturate-110 hover:brightness-105',
                  )}
                >
                  {submitLabel}
                </button>
              </div>
            </div>

            {/* Why a press was refused, under the button that was pressed. It used to be
                in the pinned bar; with the button in the card, a message left down there
                would be a refusal the officer never sees. */}
            {error ? (
              <div className="mt-3">
                <ErrorNotice message={error} />
              </div>
            ) : null}

            {/* The one thing the button's own label has no room for: a long text takes a
                minute or two. Only while it is actually running. */}
            {submitting ? (
              <p
                className="text-muted-foreground mt-2 text-sm"
                aria-live="polite"
              >
                {STR.translateMayTakeTime}
              </p>
            ) : null}

            {/* Directly under the button that produced it, so "attach" and "attached" are
                one place on the screen. */}
            <AttachmentStrip
              items={attachments}
              disabled={submitting}
              className="mt-4"
            />
          </div>

          {/* The document to translate usually arrives as a file, not in the clipboard. The
              shared intake reads pdf/docx/txt — a scanned PDF stops to ask which pages are
              worth OCR'ing before a credit is spent — and its text is counted beside the box
              above, in LIVE mode, so there is no hand-over button to find and no way to
              leave an upload behind. No character budget is passed: this page imposes no
              length limit on the text, so page selection is about OCR spend, not about
              trimming. */}
          {/* No rule of its own: `.doc-intake-embedded` already draws the divider and the
              spacing above itself, and a wrapper adding a second `border-t` stacked two
              lines above the block. The same bare `mt-3` NoteComposer uses. */}
          {showDoc ? (
            <div id={DOC_PANEL_ID} className="mt-3">
              <DocumentIntake
                key={docKey}
                storageKey={DOC_STORAGE_KEY}
                embedded
                feature="translate"
                accept={['pdf', 'docx', 'txt']}
                onTextChange={(value) => {
                  // Only a real change may invalidate a finished translation.
                  if (value === docTextRef.current) return;
                  docTextRef.current = value;
                  setDocText(value);
                  resetFlow();
                }}
                onStatusChange={(status, info) => {
                  setDocStatus(status);
                  setDocInfo(info);
                }}
                readRequest={readRequest}
                // Offered only once there IS a file: the component renders this control in
                // every state including the empty upload card, where there is nothing to
                // delete — and the [+] toggle already closes that.
                {...(docStatus === 'empty' ? {} : { onRemove: clearDocument })}
              />
            </div>
          ) : null}
        </FormCard>

        {prep === 'review' && prepared ? (
          <TranslationTermsReview
            terms={prepared}
            busy={submitting}
            confirmRequest={confirmRequest}
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
          // The same box shape as the composer above it (see FormCard), written out
          // because this one is headed by an <h2> rather than by a label pointing at a
          // control.
          <section className="bg-card rounded-2xl border p-4 shadow-sm sm:p-5">
            <h2 className="text-foreground m-0 text-base font-semibold">
              {OUTPUT_TITLES[result.language]}
            </h2>

            {result.unpreservedNames.length > 0 ? (
              <div className="info-callout warn" style={{ marginTop: 12 }}>
                <p className="field-label">{STR.translateUnpreservedTitle}</p>
                <p className="hint">
                  {STR.translateUnpreservedHint}{' '}
                  {result.unpreservedNames.join(', ')}
                </p>
              </div>
            ) : null}

            <div className="article-body mt-4">{result.text}</div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button variant="outline" type="button" onClick={copyToClipboard}>
                {copied ? STR.copied : STR.copyText}
              </Button>
              <Button
                variant="outline"
                type="button"
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
              </Button>
              <span className="text-muted-foreground ms-auto text-sm">
                {result.lockedTermCount} {STR.translateLockedTerms}
              </span>
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}
