'use client';

// Read-only article display + copy/download actions + the article feedback loop.
//
// THE ACTION ROW IS FOUR COMMANDS, NOT SEVEN. It used to carry three download buttons,
// two cross-format links and two translate buttons side by side; it is now copy, one
// डाउनलोड menu (.txt / .md / PDF), one क्रिएटिव्ह link and one भाषांतर करा link.
//
// TRANSLATION IS NO LONGER STARTED HERE. It was a second, parallel translation flow —
// this page ran its own name check and stored the result on the row — while /translate
// exists to do exactly that and is where the target language is chosen. भाषांतर करा now
// opens that page with this article already in its box (`?from=<id>&lang=<shown>`), so
// the question is asked in one place. Rows that ALREADY carry a stored English or Hindi
// translation keep their मराठी | English | हिंदी toggle, and copy/download follow
// whichever is on screen — nothing made before this is lost, it simply cannot be
// remade from here.

import { useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CirclePlay,
  Download,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Languages,
  Music,
  Sparkles,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type {
  ArticleVersionText,
  GenerationDetail,
  GenerationSourceFile,
  TranslationLanguage,
} from '@dgipr/schemas';
import {
  articlePdfDownloadUrl,
  generationSourceFileUrl,
  getArticleVersions,
  getGenerationSourceFiles,
  restoreArticleVersion,
  sendArticleFeedback,
} from '../lib/api';
import { FileName } from './FileName';
import { STR } from '../lib/strings';
import { errorMessage } from '../lib/errorMessage';
import { downloadBlob } from '../lib/download';
import { FeedbackBox } from './FeedbackBox';
import { MarkdownText } from './MarkdownText';
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

// What the learning pass did with this round of feedback, and which articles the rule now
// applies to. Machine keys travel on the wire (migration 0057); every Marathi label lives in
// strings.ts, so these two maps are the only place the two meet.
const LEARNED_PREF_ACTIONS: Record<
  GenerationDetail['learnedPreferences'][number]['action'],
  string
> = {
  added: STR.learnedPrefsActionAdded,
  reinforced: STR.learnedPrefsActionReinforced,
  superseded: STR.learnedPrefsActionSuperseded,
  merged: STR.learnedPrefsActionMerged,
};

const LEARNED_PREF_SCOPES: Record<
  GenerationDetail['learnedPreferences'][number]['scope'],
  string
> = {
  news: STR.learnedPrefsScopeNews,
  scheme: STR.learnedPrefsScopeScheme,
  both: STR.learnedPrefsScopeBoth,
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

  // A translation started before this page stopped starting them (or by an older build)
  // still reports itself on the detail payload rather than through status/step, so the
  // line stays accurate while the poster is still rendering.
  const error = detail.translateError;

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

  // The link that replaced the two translate buttons. It carries the run's id and which
  // language is on screen, and /translate fetches the text from there — an article is
  // thousands of characters and a URL is not where a government press note belongs.
  const translateHref = `/translate?from=${encodeURIComponent(detail.id)}&lang=${shownLang}`;

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

      {/* "Memory updated" — what the last feedback round taught the platform (migration 0057).
          Shown rather than left silent, because a learned rule is DEPARTMENT-WIDE: it steers
          every future /dlo article for every officer, so the one who wrote the feedback is the
          one who has to be able to see it and undo it on the review page. Marathi only, like
          the two blocks above; the translations derive from the article, not from this. */}
      {shownLang === 'mr' && detail.learnedPreferences.length > 0 ? (
        <div className="info-callout ok" style={{ marginBottom: 12 }}>
          <p className="field-label">{STR.learnedPrefsTitle}</p>
          <p className="hint">{STR.learnedPrefsIntro}</p>
          <ul className="hint" style={{ margin: '6px 0 0', paddingLeft: 20 }}>
            {detail.learnedPreferences.map((note) => (
              <li key={note.id}>
                {note.rule}
                {' — '}
                {LEARNED_PREF_ACTIONS[note.action]}
                {', '}
                {LEARNED_PREF_SCOPES[note.scope]}
              </li>
            ))}
          </ul>
          {/* The callout is transient — it is reported from an in-process registry, not a
              column — so this link is the only durable way back to what was just learned.
              It matters most for the officer who did NOT mean to teach a rule: the page it
              opens is where they turn it off. */}
          <Link className="pref-generation-link" href="/preferences">
            {STR.learnedPrefsReview}
          </Link>
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
        {/* THREE FORMATS, ONE BUTTON. .txt and .md are written in the browser from the
            text on screen, so they follow the language toggle AND a version preview; the
            PDF is a LINK because it is rendered server-side by Chromium (a browser-side
            PDF library cannot shape Devanagari matras) and only the API can force a
            cross-origin download. That is why the PDF item is the one that disappears
            while an older wording is being previewed: it is rendered from the ROW, and
            handing the officer a PDF of different text than the one on screen is the one
            thing this control must not do. */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="btn">
              <Download size={16} strokeWidth={2} aria-hidden="true" />
              <span>{STR.downloadMenu}</span>
              <ChevronDown size={15} strokeWidth={2.2} aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuItem
              onSelect={() =>
                downloadBlob(
                  `lekh-${detail.id}-${shownLang}.txt`,
                  shown,
                  'text/plain',
                )
              }
            >
              {STR.downloadTxt}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() =>
                downloadBlob(
                  `lekh-${detail.id}-${shownLang}.md`,
                  shown,
                  'text/markdown',
                )
              }
            >
              {STR.downloadMd}
            </DropdownMenuItem>
            {viewingOlder ? null : (
              <DropdownMenuItem asChild>
                <a href={articlePdfDownloadUrl(detail.id, shownLang)}>
                  {STR.downloadPdf}
                </a>
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* "Make a poster out of THIS ARTICLE" — one link, not one per platform. It opens
            Creative and Social with the article in the box (`use=article`, see
            useCreateForm) and the poster lane preselected; the officer still chooses the
            template and presses तयार करा there, which is where those questions live.
            Only when this run has NO poster — article-only and DLO runs. With a poster the
            cross-format links live in PosterPanel's row instead, beside the poster they
            belong to. Hidden while an older wording is on screen, like the PDF: the fetch
            on the other side reads the ROW. */}
        {!detail.posterUrl && !viewingOlder ? (
          <Link
            className="btn"
            href={`/?from=${encodeURIComponent(detail.id)}&format=twitter&use=article`}
            title={STR.crossFormatToCreative}
            aria-label={STR.crossFormatToCreative}
          >
            <Sparkles size={16} strokeWidth={1.9} aria-hidden="true" />
            <span>{STR.crossFormatCreativeShort}</span>
            <ArrowRight size={15} strokeWidth={2.2} aria-hidden="true" />
          </Link>
        ) : null}

        {/* Opens /translate with this article in its box. Hidden while an older wording is
            previewed for the same reason as the two above: that page fetches the ROW. */}
        {viewingOlder ? null : (
          <Link
            className="btn"
            href={translateHref}
            title={STR.articleTranslateLinkTitle}
            aria-label={STR.articleTranslateLinkTitle}
          >
            <Languages size={16} strokeWidth={1.9} aria-hidden="true" />
            <span>{STR.articleTranslateLink}</span>
            <ArrowRight size={15} strokeWidth={2.2} aria-hidden="true" />
          </Link>
        )}
      </div>

      {error ? <ErrorNotice message={error} /> : null}

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
