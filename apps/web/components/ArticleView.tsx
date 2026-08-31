'use client';

// Read-only article display + copy/download actions + the article feedback loop.
// Every translation starts with the in-page name check (TranslationTermsReview):
// "Translate to English" / "Translate to Hindi" first fetches the article's proper
// nouns for the user to confirm/correct, and only the confirmed names — locked — reach
// the Sarvam translation (as English spellings for English, as frozen Devanagari forms
// for Hindi). English and Hindi are stored independently on the row: a मराठी | English |
// हिंदी toggle shows whichever exist, copy/download follow the shown language, and each
// translation has its own re-translate fold running the same name check (a wrong
// spelling noticed late is fixed right here, not on /glossary).

import { useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  CirclePlay,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Music,
} from 'lucide-react';
import type {
  ArticleVersionText,
  GenerationDetail,
  GenerationSourceFile,
  PrepareTranslationResponse,
  TranslationLanguage,
  TranslationTermInput,
} from '@dgipr/schemas';
import {
  articlePdfDownloadUrl,
  generationSourceFileUrl,
  getArticleVersions,
  getGenerationSourceFiles,
  prepareGenerationTranslation,
  requestTranslation,
  restoreArticleVersion,
  sendArticleFeedback,
} from '../lib/api';
import { FileName } from './FileName';
import { STR } from '../lib/strings';
import { errorMessage } from '../lib/errorMessage';
import { downloadBlob } from '../lib/download';
import { CrossFormatLinks } from './CrossFormatLinks';
import { FeedbackBox } from './FeedbackBox';
import { MarkdownText } from './MarkdownText';
import { TranslationTermsReview } from './TranslationTermsReview';
import { ErrorNotice } from './ErrorNotice';

// How each kind of source is drawn inside the note fold. The icon is the only kind marker:
// the file name already carries its extension, so a label chip beside it said it twice.
const SOURCE_ICON: Record<GenerationSourceFile['kind'], React.ReactNode> = {
  audio: <Music size={18} />,
  youtube: <CirclePlay size={18} />,
  image: <ImageIcon size={18} />,
  pdf: <FileText size={18} />,
  docx: <FileText size={18} />,
  txt: <FileText size={18} />,
};

export function ArticleView({
  detail,
  onFeedbackSent,
  embedded = false,
}: {
  detail: GenerationDetail;
  onFeedbackSent: () => Promise<void>;
  // Poster-focused runs keep the source article in a closed disclosure below the poster.
  // In that case the parent already owns the visible title and card shell.
  embedded?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [lang, setLang] = useState<'mr' | TranslationLanguage>('mr');
  // Name-check flow: idle → preparing (extracting names) → review (card shown);
  // confirming covers the translate POST fired from the review card. `pendingLang`
  // is the language that flow will translate into once confirmed.
  const [prep, setPrep] = useState<'idle' | 'preparing' | 'review'>('idle');
  const [pendingLang, setPendingLang] = useState<TranslationLanguage>('en');
  const [prepared, setPrepared] = useState<
    PrepareTranslationResponse['terms'] | null
  >(null);
  const [confirming, setConfirming] = useState(false);
  const [translateError, setTranslateError] = useState<string | null>(null);
  // The intake's own uploads, loaded the first time the note fold is opened rather than with
  // the run: they come off the intake's `files` jsonb, which carries every transcript and
  // OCR'd page, and the detail poll behind this page runs every 2.5 s. A run with nothing
  // behind it (the media room reads its document through the ephemeral service and archives
  // nothing) simply answers with an empty list and the fold shows the note alone.
  const [sourceFiles, setSourceFiles] = useState<GenerationSourceFile[] | null>(
    null,
  );
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [sourcesError, setSourcesError] = useState<string | null>(null);

  const loadSourceFiles = async () => {
    if (sourceFiles !== null || sourcesLoading) return;
    setSourcesLoading(true);
    setSourcesError(null);
    try {
      setSourceFiles(await getGenerationSourceFiles(detail.id));
    } catch (e) {
      setSourcesError(errorMessage(e));
    } finally {
      setSourcesLoading(false);
    }
  };

  // ---- article version history ----
  //
  // A feedback round overwrites the article, so before this the previous wording was simply
  // gone. `detail.articleVersions` is metadata only (the payload is polled every 2.5 s), and
  // it is what decides whether the arrows are drawn at all; the TEXT is fetched once, the
  // first time the officer moves.
  //
  // `viewing` is the version being LOOKED at, null meaning "whatever is on the row". Looking
  // is not restoring: an older wording is read in place and nothing changes until
  // "ही आवृत्ती पुन्हा वापरा" is pressed. That split is the whole point of the control — an
  // officer who has just been burned by one feedback round should be able to see what they
  // had without buying another change.
  const versions = detail.articleVersions;
  const [viewing, setViewing] = useState<number | null>(null);
  // Cached WITH the version count it was fetched at. The snapshots themselves are immutable,
  // but a feedback round appends one — and a cache that outlived that round would answer a
  // request for the new version with `undefined`, which reads on screen as an arrow that does
  // nothing. Comparing counts re-fetches exactly when there is something new to fetch.
  const [versionTexts, setVersionTexts] = useState<{
    count: number;
    items: ArticleVersionText[];
  } | null>(null);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [versionError, setVersionError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);

  const currentVersion =
    versions.find((version) => version.current)?.version ?? versions.length;
  // What the arrows are currently pointed at. Falls back to the row's own version, so the
  // first press moves one step from where the officer is actually reading.
  const shownVersion = viewing ?? currentVersion;

  // Fetched once and kept: the texts are immutable snapshots, and a new one only ever
  // arrives with a new revision — which replaces `detail` and resets this view anyway.
  const loadVersionTexts = async (): Promise<ArticleVersionText[] | null> => {
    if (versionTexts && versionTexts.count === versions.length) {
      return versionTexts.items;
    }
    setVersionsLoading(true);
    setVersionError(null);
    try {
      const loaded = await getArticleVersions(detail.id);
      setVersionTexts({ count: loaded.length, items: loaded });
      return loaded;
    } catch (e) {
      setVersionError(errorMessage(e));
      return null;
    } finally {
      setVersionsLoading(false);
    }
  };

  const goToVersion = async (version: number) => {
    if (version < 1 || version > versions.length) return;
    const loaded = await loadVersionTexts();
    if (!loaded) return;
    setVersionError(null);
    setViewing(version);
  };

  const restoreViewedVersion = async () => {
    if (viewing === null) return;
    setRestoring(true);
    setVersionError(null);
    try {
      await restoreArticleVersion(detail.id, viewing);
      // Back to "showing the row", and the refresh below brings the row's new article and a
      // version list whose `current` marker has moved. Cleared BEFORE the refresh so the body
      // never shows a stale snapshot over fresh metadata.
      setViewing(null);
      setVersionTexts(null);
      await onFeedbackSent();
    } catch (e) {
      setVersionError(errorMessage(e));
    } finally {
      setRestoring(false);
    }
  };

  const marathi = detail.article ?? '';
  // Stored translations, keyed the same way as the toggle. A language is "available"
  // only once its text exists, so nothing about the UI changes until one is made.
  const translations: Record<TranslationLanguage, string | null> = {
    en: detail.articleEnglish,
    hi: detail.articleHindi,
  };
  const has = (language: TranslationLanguage) =>
    (translations[language]?.length ?? 0) > 0;
  const shownLang = lang !== 'mr' && has(lang) ? lang : 'mr';
  // What the arrows are pointed at, and whether that is something other than the row. Both
  // need `shownLang`, which is why they sit here rather than beside the state above.
  const shownMeta =
    versions.find((version) => version.version === shownVersion) ?? null;
  const viewedText =
    viewing === null
      ? null
      : (versionTexts?.items.find((version) => version.version === viewing)
          ?.article ?? null);
  // PREVIEWING: the body is showing a wording the run is not currently using. Everything that
  // ACTS on the article is stood down while this is true — see the render — because acting on
  // the row while reading something else is the one thing this control could get wrong.
  const viewingOlder =
    shownLang === 'mr' && viewedText !== null && !(shownMeta?.current ?? false);
  const shown = viewingOlder
    ? viewedText
    : shownLang === 'mr'
      ? marathi
      : (translations[shownLang] ?? '');

  // The translate job runs beside whatever else is in flight and reports itself on
  // the detail payload rather than through status/step, so this stays accurate while
  // the poster is still rendering. A background failure arrives the same way.
  // Only one translation runs at a time, and `translatingLanguage` names which — so a
  // reload mid-run still puts the spinner on the right button.
  const translating = detail.translating;
  const translatingLang = detail.translatingLanguage;
  const error = translateError ?? detail.translateError;

  // Article feedback is offered as soon as the article is on screen — including while
  // the poster still renders. The revision runs beside the poster job and reports
  // itself through detail.articleRevising (like translation), not status/step, so the
  // box only has to reflect that flag: swap to an inline spinner while a revise is in
  // flight, otherwise stay interactive. (A settled-run edit flips status and swaps the
  // whole page to ProgressSteps, unmounting this view, so no gate is needed here.)
  const revising = detail.articleRevising;

  const copyToClipboard = async () => {
    await navigator.clipboard.writeText(shown);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Step 1 of translating: fetch the article's names for review. The prepare call is
  // language-independent (the same confirmed rows serve both targets), so only the
  // remembered `pendingLang` differs. On failure the flow returns to idle with a
  // Marathi error — never silently translating with unchecked names.
  const startNameCheck = async (language: TranslationLanguage) => {
    setPendingLang(language);
    setPrep('preparing');
    setTranslateError(null);
    try {
      const result = await prepareGenerationTranslation(detail.id);
      setPrepared(result.terms);
      setPrep('review');
    } catch {
      setTranslateError(STR.namesPrepareError);
      setPrep('idle');
    }
  };

  // Step 2: the user confirmed the names — start the translation with them locked,
  // into whichever language started this check. The job reports itself through
  // detail.translating, so after the refresh the existing spinner takes over.
  const confirmTranslate = async (terms: TranslationTermInput[]) => {
    setConfirming(true);
    setTranslateError(null);
    try {
      await requestTranslation(detail.id, pendingLang, terms);
      setPrep('idle');
      setPrepared(null);
      await onFeedbackSent();
    } catch (e) {
      setTranslateError(errorMessage(e));
    } finally {
      setConfirming(false);
    }
  };

  const cancelNameCheck = () => {
    setPrep('idle');
    setPrepared(null);
  };

  // Shared body for the name-check flow (initial translate and the re-translate
  // folds): spinner while extracting, then the review card. Rendered in one place at
  // a time — `pendingLang` decides where, so two folds can't both show it.
  const nameCheckBody =
    prep === 'preparing' ? (
      <span className="translating-note">
        <span className="spinner" aria-hidden="true" />
        {STR.namesChecking}
      </span>
    ) : prep === 'review' && prepared ? (
      <TranslationTermsReview
        terms={prepared}
        busy={confirming}
        language={pendingLang}
        onConfirm={confirmTranslate}
        onCancel={cancelNameCheck}
      />
    ) : null;

  const translatingNote = (language: TranslationLanguage) => (
    <span className="translating-note">
      <span className="spinner" aria-hidden="true" />
      {language === 'hi' ? STR.translatingHindi : STR.translatingEnglish}
    </span>
  );

  // The re-translate fold shown under an existing translation: same name check, run
  // again for that one language.
  const retranslateFold = (language: TranslationLanguage) => (
    <details className="fold" key={language}>
      <summary>
        {language === 'hi' ? STR.retranslateFoldHindi : STR.retranslateFold}
      </summary>
      <div className="fold-body">
        {translating && translatingLang === language ? (
          translatingNote(language)
        ) : prep !== 'idle' && pendingLang === language ? (
          nameCheckBody
        ) : (
          <button
            type="button"
            className="btn btn-small"
            disabled={translating || prep !== 'idle'}
            onClick={() => startNameCheck(language)}
          >
            {STR.namesStartCheck}
          </button>
        )}
      </div>
    </details>
  );

  return (
    <section
      className={embedded ? 'article-view-embedded' : 'card'}
      aria-label={embedded ? STR.articleTitle : undefined}
    >
      <div
        className="article-head"
        style={embedded ? { justifyContent: 'flex-end' } : undefined}
      >
        {!embedded ? <h2 style={{ margin: 0 }}>{STR.articleTitle}</h2> : null}
        {has('en') || has('hi') ? (
          <div className="lang-toggle" role="group" aria-label="भाषा">
            <button
              type="button"
              className="btn btn-small"
              aria-pressed={shownLang === 'mr'}
              onClick={() => setLang('mr')}
            >
              {STR.showMarathi}
            </button>
            {has('en') ? (
              <button
                type="button"
                className="btn btn-small"
                aria-pressed={shownLang === 'en'}
                onClick={() => setLang('en')}
              >
                {STR.showEnglish}
              </button>
            ) : null}
            {has('hi') ? (
              <button
                type="button"
                className="btn btn-small"
                aria-pressed={shownLang === 'hi'}
                onClick={() => setLang('hi')}
              >
                {STR.showHindi}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Names the Hindi translation could not carry verbatim (from the in-process job
          registry, so it appears right after a run and is lost on API restart). Shown
          only while the Hindi text is on screen — it is a prompt to check that output. */}
      {shownLang === 'hi' &&
      detail.translateWarnings &&
      detail.translateWarnings.length > 0 ? (
        <div className="info-callout warn" style={{ marginBottom: 12 }}>
          <p className="field-label">{STR.translateUnpreservedTitle}</p>
          <p className="hint">
            {STR.translateUnpreservedHint} {detail.translateWarnings.join(', ')}
          </p>
        </div>
      ) : null}

      {/* Approved designations the article could not carry as approved. Same in-process
          registry as the translation warnings above, and shown for the same reason: a
          designation that silently failed to apply is the one outcome this feature must never
          produce quietly. Only on the Marathi text — the translations derive from it. */}
      {shownLang === 'mr' && detail.designationWarnings.length > 0 ? (
        <div className="info-callout warn" style={{ marginBottom: 12 }}>
          <p className="field-label">{STR.designationWarnTitle}</p>
          {detail.designationWarnings.some((w) => w.reason === 'not-found') ? (
            <p className="hint">
              {STR.designationWarnNotFound}{' '}
              {detail.designationWarnings
                .filter((w) => w.reason === 'not-found')
                .map((w) => `${w.designation} ${w.name}`)
                .join(', ')}
            </p>
          ) : null}
          {detail.designationWarnings.some((w) => w.reason === 'corrected') ? (
            <p className="hint">
              {STR.designationWarnCorrected}{' '}
              {detail.designationWarnings
                .filter((w) => w.reason === 'corrected')
                .map(
                  (w) => `${w.replaced ?? ''} → ${w.designation} (${w.name})`,
                )
                .join(', ')}
            </p>
          ) : null}
        </div>
      ) : null}

      {/* The officer asked for a length the article did not reach. Shown rather than silently
          accepted, because the platform will not pad a government article to hit a count: the
          shortfall is information the officer can act on (add source material, or accept the
          shorter piece). Marathi only, like the block above — the translations derive from it. */}
      {shownLang === 'mr' && detail.lengthWarning ? (
        <div className="info-callout warn" style={{ marginBottom: 12 }}>
          <p className="field-label">{STR.lengthWarnTitle}</p>
          <p className="hint">
            {(() => {
              const { requested, actual, unit } = detail.lengthWarning;
              const label =
                unit === 'words' ? STR.lengthUnitWords : STR.lengthUnitChars;
              return actual < requested
                ? STR.lengthWarnShort(label(requested), label(actual))
                : STR.lengthWarnLong(label(requested), label(actual));
            })()}
          </p>
        </div>
      ) : null}

      {/* The version arrows. Marathi only: the English and Hindi columns are translations of
          whatever is on the row right now, so stepping back through Marathi wordings while
          reading one of them would show a version marker over text it does not describe.
          Hidden entirely below two versions — one wording is not a history. */}
      {shownLang === 'mr' && versions.length > 1 ? (
        <div
          className="article-versions"
          role="group"
          aria-label={STR.articleVersionsLabel}
        >
          <button
            type="button"
            className="btn btn-small btn-icon"
            aria-label={STR.articleVersionPrev}
            title={STR.articleVersionPrev}
            disabled={shownVersion <= 1 || versionsLoading || restoring}
            onClick={() => void goToVersion(shownVersion - 1)}
          >
            <ChevronLeft size={20} aria-hidden="true" />
          </button>
          <div className="article-versions-label">
            <span className="article-versions-count">
              {STR.articleVersionOf(shownVersion, versions.length)}
            </span>
            {/* What this wording IS: the run's first article, the one in use, or the
                instruction that produced it. */}
            <span className="hint">
              {versionsLoading
                ? STR.articleVersionLoading
                : shownVersion === 1 && shownMeta?.feedback === null
                  ? STR.articleVersionOriginal
                  : shownMeta?.feedback
                    ? `${STR.articleVersionFeedback} ${shownMeta.feedback}`
                    : shownMeta?.current
                      ? STR.articleVersionCurrent
                      : ''}
            </span>
          </div>
          <button
            type="button"
            className="btn btn-small btn-icon"
            aria-label={STR.articleVersionNext}
            title={STR.articleVersionNext}
            disabled={
              shownVersion >= versions.length || versionsLoading || restoring
            }
            onClick={() => void goToVersion(shownVersion + 1)}
          >
            <ChevronRight size={20} aria-hidden="true" />
          </button>
          {/* Only while looking at something other than the row: restoring the wording
              already in use would be a button that does nothing. */}
          {viewingOlder ? (
            <button
              type="button"
              className="btn btn-small article-versions-restore"
              disabled={restoring}
              onClick={() => void restoreViewedVersion()}
            >
              {restoring
                ? STR.articleVersionRestoring
                : STR.articleVersionRestore}
            </button>
          ) : null}
        </div>
      ) : null}

      {/* Said out loud, because the body below is now showing text that is NOT what the run
          will export, translate or revise until the button above is pressed. */}
      {viewingOlder ? (
        <p className="hint article-versions-note">
          {STR.articleVersionViewingOld}
        </p>
      ) : null}

      {versionError ? <ErrorNotice message={versionError} /> : null}

      {/* Display only — the generator's Markdown structure rendered as real headings,
          lists and paragraphs. Copy, .txt/.md download and the PDF export below all
          keep reading `shown` raw, so what leaves the page is unchanged. */}
      <MarkdownText text={shown} className="article-body" />

      <div className="btn-row" style={{ marginTop: 18 }}>
        <button type="button" className="btn" onClick={copyToClipboard}>
          {copied ? STR.copied : STR.copyText}
        </button>
        <button
          type="button"
          className="btn"
          onClick={() =>
            downloadBlob(
              `lekh-${detail.id}-${shownLang}.txt`,
              shown,
              'text/plain',
            )
          }
        >
          {STR.downloadTxt}
        </button>
        <button
          type="button"
          className="btn"
          onClick={() =>
            downloadBlob(
              `lekh-${detail.id}-${shownLang}.md`,
              shown,
              'text/markdown',
            )
          }
        >
          {STR.downloadMd}
        </button>
        {/* Rendered server-side by Chromium — a browser-side PDF library cannot shape
            Devanagari matras — so this is a link, not a downloadBlob: only the API can force
            a cross-origin download. It follows the language toggle, and because shownLang
            already falls back to 'mr' when a language has no text, it can never hit the
            route's "translation not ready" 404. */}
        {/* Rendered from the ROW, so it cannot show the wording being previewed. Hidden
            rather than left to hand the officer a PDF of different text than the one on
            screen. Copy and the two downloads above read `shown` and so follow the preview. */}
        {viewingOlder ? null : (
          <a className="btn" href={articlePdfDownloadUrl(detail.id, shownLang)}>
            {STR.downloadPdf}
          </a>
        )}

        {/* "Same note, other platform". Only when this run has NO poster — article-only
            and DLO runs, which never render PosterPanel and would otherwise have no way
            across since the cross-format folds left पुढील पाऊल. With a poster the links
            live in PosterPanel's row instead, beside the poster they belong to. */}
        {!detail.posterUrl ? (
          <CrossFormatLinks
            generationId={detail.id}
            category={detail.category}
          />
        ) : null}

        {/* One button per language that has no translation yet; the one being
            translated right now shows the spinner in its place. */}
        {/* Translation reads the row too — same reason as the PDF link. */}
        {(viewingOlder ? [] : (['en', 'hi'] as const)).map((language) =>
          has(language) ? null : translating && translatingLang === language ? (
            <span key={language}>{translatingNote(language)}</span>
          ) : prep === 'idle' && !translating ? (
            <button
              key={language}
              type="button"
              className="btn"
              onClick={() => startNameCheck(language)}
            >
              {language === 'hi'
                ? STR.translateToHindi
                : STR.translateToEnglish}
            </button>
          ) : null,
        )}
      </div>

      {/* The name check for a not-yet-made translation sits directly under the
          buttons; for an existing one it lives inside that language's fold below. */}
      {!has(pendingLang) && !translating ? nameCheckBody : null}

      {error ? <ErrorNotice message={error} /> : null}

      {(['en', 'hi'] as const).map((language) =>
        has(language) ? retranslateFold(language) : null,
      )}

      {detail.factCheck ? (
        <details className="fold">
          <summary>{STR.factCheckTitle}</summary>
          <div className="fold-body">{detail.factCheck}</div>
        </details>
      ) : null}

      {/* The note, and under it the files it was assembled from. Opening the fold is what
          fetches them — see loadSourceFiles. */}
      <details
        className="fold"
        onToggle={(event) => {
          if (event.currentTarget.open) void loadSourceFiles();
        }}
      >
        <summary>{STR.noteTitle}</summary>
        {/* A run started from a pasted article or an upload can carry no note text at all;
            an empty fold-body would then be pure padding above the source list. */}
        {detail.note.trim() ? (
          <div className="fold-body">{detail.note}</div>
        ) : null}
        {sourcesLoading ? (
          <p className="hint source-files-loading">
            <span className="spinner" aria-hidden="true" />
            {STR.sourceFilesLoading}
          </p>
        ) : null}
        {sourcesError ? <ErrorNotice message={sourcesError} /> : null}
        {sourceFiles && sourceFiles.length > 0 ? (
          <div className="source-files">
            <ul className="file-list">
              {sourceFiles.map((file) => (
                <li key={file.index}>
                  {/* A YouTube source was never downloaded — it opens at the video itself;
                      everything else is served back from the private bucket by the API. */}
                  <a
                    className="file-row file-row-link"
                    href={
                      file.externalUrl ??
                      generationSourceFileUrl(detail.id, file.index)
                    }
                    target="_blank"
                    rel="noreferrer"
                  >
                    {SOURCE_ICON[file.kind]}
                    <FileName name={file.name} className="file-name" />
                    <ExternalLink
                      size={16}
                      aria-label={STR.sourceFilesNewTab}
                    />
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </details>

      <div style={{ marginTop: 18 }}>
        {/* Not offered while an older wording is on screen: the feedback box revises the ROW,
            so an officer looking back at version 1 and typing a change would get version 3
            edited instead. Restoring first, then asking for the change, is the sequence the
            arrows are there to make possible. */}
        {viewingOlder ? null : revising ? (
          <span className="translating-note">
            <span className="spinner" aria-hidden="true" />
            {STR.revisingArticle}
          </span>
        ) : (
          <FeedbackBox
            title={STR.articleFeedbackTitle}
            hint={STR.articleFeedbackHint}
            suggestions={STR.chipsArticle}
            onSubmit={async (feedback) => {
              await sendArticleFeedback(detail.id, feedback);
              await onFeedbackSent();
            }}
          />
        )}
        {detail.articleReviseError ? (
          <ErrorNotice message={detail.articleReviseError} />
        ) : null}
      </div>
    </section>
  );
}
