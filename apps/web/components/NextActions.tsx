'use client';

// "पुढील पाऊल" panel on a finished generation. Everything here creates a NEW
// generation from this run's note via the same API the home form uses (this run
// is never mutated):
//   - cross-format: every format EXCEPT the run's own — an article run offers both
//     social posts, a social run offers an article plus the other platform — with
//     the same design/template questions the home form asks;
//   - edit-note: reopen the note prefilled, tweak it, re-run with the same settings.
// Social runs are background tasks (track + open the panel, no navigation);
// article runs navigate to the new run's progress page — same conventions as the
// home form's submit.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { isSocialCategory } from '@dgipr/schemas';
import type {
  Category,
  DesignMode,
  GenerationDetail,
  OutputType,
} from '@dgipr/schemas';
import { createGeneration, requestArticlePoster } from '../lib/api';
import {
  ARTICLE_CATEGORY_OPTIONS,
  DESIGN_OPTIONS,
  OUTPUT_OPTIONS,
  SOCIAL_SOURCE_OPTIONS,
  type GenerationOption,
  type SocialSource,
} from '../lib/generationOptions';
import { useTasks } from '../lib/TasksProvider';
import { STR } from '../lib/strings';
import ReferencePicker, { type ReferenceSelection } from './ReferencePicker';

function OptionCards<Value extends string>({
  label,
  options,
  value,
  onSelect,
}: {
  label: string;
  options: ReadonlyArray<GenerationOption<Value>>;
  value: Value;
  onSelect: (value: Value) => void;
}) {
  return (
    <div className="next-actions-picker">
      <p className="field-label">{label}</p>
      <div
        className={
          options.length === 2
            ? 'output-picker output-picker-two'
            : 'output-picker'
        }
      >
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            className="output-option"
            aria-pressed={value === option.value}
            onClick={() => onSelect(option.value)}
          >
            <span className="icon" aria-hidden="true">
              <option.icon size={30} strokeWidth={1.75} />
            </span>
            <span className="name">{option.name}</span>
            <span className="desc">{option.desc}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// Every block reports a successful spawn so the page can refresh the thread
// strip — essential for the social paths, which never navigate away.
type BlockProps = {
  detail: GenerationDetail;
  onSpawned?: (() => void) | undefined;
};

// The two social lanes are one flow with different labels (and, for now, one
// shared n8n workflow), so the fold is rendered per platform from this table.
const SOCIAL_PLATFORMS = ['twitter', 'facebook'] as const;
type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

const SOCIAL_COPY: Record<
  SocialPlatform,
  { title: string; hint: string; cta: string; started: string }
> = {
  twitter: {
    title: STR.nextTwitterTitle,
    hint: STR.nextTwitterHint,
    cta: STR.nextTwitterCta,
    started: STR.nextTwitterStarted,
  },
  facebook: {
    title: STR.nextFacebookTitle,
    hint: STR.nextFacebookHint,
    cta: STR.nextFacebookCta,
    started: STR.nextFacebookStarted,
  },
};

// Narrows a run's category to its social labels (null for news/scheme), so
// callers read the platform copy without casting the widened Category.
function socialCopyOf(
  category: Category,
): (typeof SOCIAL_COPY)[SocialPlatform] | null {
  return category === 'twitter' || category === 'facebook'
    ? SOCIAL_COPY[category]
    : null;
}

// Any run → create a social post (ट्विटर/फेसबुक) from the same note.
function CreateSocialBlock({
  detail,
  platform,
  onSpawned,
}: BlockProps & { platform: SocialPlatform }) {
  const { addTask, openPanel, hasActiveSocialTask } = useTasks();
  const copy = SOCIAL_COPY[platform];
  // The generated article is the default source; the guard mirrors the API's
  // 20-char note minimum so a degenerate article silently falls back to the note.
  const articleText = detail.article?.trim() ?? '';
  const canUseArticle = articleText.length >= 20;
  const [source, setSource] = useState<SocialSource>(
    canUseArticle ? 'article' : 'note',
  );
  const [designMode, setDesignMode] = useState<DesignMode>('onbrand');
  const [reference, setReference] = useState<ReferenceSelection | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [started, setStarted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A pin is only meaningful for the design mode it was chosen under.
  useEffect(() => {
    setReference(null);
  }, [designMode]);

  const submit = async () => {
    if (hasActiveSocialTask) {
      setError(STR.busyError);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const id = await createGeneration({
        note: source === 'article' && canUseArticle ? articleText : detail.note,
        heading: detail.heading ?? undefined,
        category: platform,
        outputType: 'poster',
        designMode,
        referenceImageId:
          reference?.kind === 'image' ? reference.id : undefined,
        referenceTypeId: reference?.kind === 'type' ? reference.id : undefined,
        sourceGenerationId: detail.id,
      });
      addTask(id);
      openPanel();
      setStarted(true);
      setReference(null);
      onSpawned?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : STR.genericError);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <details className="fold">
      <summary>{copy.title}</summary>
      <div className="fold-body">
        <p className="hint">{copy.hint}</p>
        {canUseArticle ? (
          <OptionCards
            label={STR.nextSourceLabel}
            options={SOCIAL_SOURCE_OPTIONS}
            value={source}
            onSelect={setSource}
          />
        ) : null}
        <OptionCards
          label={STR.designModeLabel}
          options={DESIGN_OPTIONS}
          value={designMode}
          onSelect={setDesignMode}
        />
        {designMode !== 'fresh' ? (
          <ReferencePicker
            variant="inline"
            category="twitter"
            value={reference}
            onChange={setReference}
          />
        ) : null}
        <div className="btn-row" style={{ marginTop: 16 }}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={submit}
            disabled={submitting || hasActiveSocialTask}
          >
            {submitting ? STR.submitting : copy.cta}
          </button>
        </div>
        {started && hasActiveSocialTask ? (
          <p className="form-success">{copy.started}</p>
        ) : hasActiveSocialTask ? (
          <p className="info-callout">{STR.socialBusyInfo}</p>
        ) : null}
        {error ? <p className="form-error">{error}</p> : null}
      </div>
    </details>
  );
}

// Article run without a poster → attach the article poster to THIS run (no new
// generation): article-only runs, DLO runs, and poster-phase-failure retries.
// After the 202 the row is running again, so onPosterStarted must refresh the
// detail poll; the whole NextActions panel then unmounts (non-terminal) and the
// page shows the poster skeleton. No addTask/lane gating — nothing new to track.
function CreatePosterBlock({
  detail,
  onPosterStarted,
}: {
  detail: GenerationDetail;
  onPosterStarted?: (() => void) | undefined;
}) {
  const [reference, setReference] = useState<ReferenceSelection | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await requestArticlePoster(
        detail.id,
        reference?.kind === 'image' ? reference.id : undefined,
      );
      onPosterStarted?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : STR.genericError);
      setSubmitting(false);
    }
  };

  return (
    <details className="fold">
      <summary>{STR.nextPosterTitle}</summary>
      <div className="fold-body">
        <p className="hint">
          {detail.status === 'failed'
            ? STR.nextPosterRetryHint
            : STR.nextPosterHint}
        </p>
        <ReferencePicker
          variant="inline"
          category="article"
          value={reference}
          onChange={setReference}
        />
        <div className="btn-row" style={{ marginTop: 16 }}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={submit}
            disabled={submitting}
          >
            {submitting ? STR.submitting : STR.nextPosterCta}
          </button>
        </div>
        {error ? <p className="form-error">{error}</p> : null}
      </div>
    </details>
  );
}

// Social run → create an article (news/scheme voice, optional poster) from the
// same note.
function CreateArticleBlock({ detail, onSpawned }: BlockProps) {
  const router = useRouter();
  const { addTask, hasActiveArticleTask } = useTasks();
  const [category, setCategory] = useState<Category>('scheme');
  const [outputType, setOutputType] = useState<OutputType>('both');
  const [reference, setReference] = useState<ReferenceSelection | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A pin is only meaningful for a run that renders a poster.
  useEffect(() => {
    setReference(null);
  }, [outputType]);

  const submit = async () => {
    if (hasActiveArticleTask) {
      setError(STR.busyError);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const id = await createGeneration({
        note: detail.note,
        heading: detail.heading ?? undefined,
        category,
        outputType,
        referenceImageId:
          reference?.kind === 'image' ? reference.id : undefined,
        sourceGenerationId: detail.id,
      });
      addTask(id);
      onSpawned?.();
      router.push(`/generations/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : STR.genericError);
      setSubmitting(false);
    }
  };

  return (
    <details className="fold">
      <summary>{STR.nextArticleTitle}</summary>
      <div className="fold-body">
        <p className="hint">{STR.nextArticleHint}</p>
        <OptionCards
          label={STR.categoryLabel}
          options={ARTICLE_CATEGORY_OPTIONS}
          value={category}
          onSelect={setCategory}
        />
        <OptionCards
          label={STR.outputTypeLabel}
          options={OUTPUT_OPTIONS}
          value={outputType}
          onSelect={setOutputType}
        />
        {outputType !== 'article' ? (
          <ReferencePicker
            variant="inline"
            category="article"
            value={reference}
            onChange={setReference}
          />
        ) : null}
        <div className="btn-row" style={{ marginTop: 16 }}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={submit}
            disabled={submitting || hasActiveArticleTask}
          >
            {submitting ? STR.submitting : STR.nextArticleCta}
          </button>
        </div>
        {hasActiveArticleTask ? (
          <p className="info-callout">{STR.articleBusyInfo}</p>
        ) : null}
        {error ? <p className="form-error">{error}</p> : null}
      </div>
    </details>
  );
}

// Edit the note (and heading) and start a fresh run with this run's own
// settings. Reference pins are deliberately NOT carried over — the pinned image
// may since have been deleted or disabled, so automatic rotation is the safe
// default for the re-run.
function EditNoteBlock({ detail, onSpawned }: BlockProps) {
  const router = useRouter();
  const { addTask, openPanel, hasActiveSocialTask, hasActiveArticleTask } =
    useTasks();
  const socialCopy = socialCopyOf(detail.category);
  const isSocial = socialCopy !== null;
  const laneBusy = isSocial ? hasActiveSocialTask : hasActiveArticleTask;
  const [note, setNote] = useState(detail.note);
  const [heading, setHeading] = useState(detail.heading ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [started, setStarted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (note.trim().length < 20) {
      setError(STR.noteTooShort);
      return;
    }
    if (laneBusy) {
      setError(STR.busyError);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const id = await createGeneration({
        note: note.trim(),
        heading: heading.trim(),
        category: detail.category,
        outputType: detail.outputType,
        designMode: detail.designMode ?? undefined,
        sourceGenerationId: detail.id,
      });
      addTask(id);
      onSpawned?.();
      if (isSocial) {
        openPanel();
        setStarted(true);
        setSubmitting(false);
      } else {
        router.push(`/generations/${id}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : STR.genericError);
      setSubmitting(false);
    }
  };

  return (
    <details className="fold">
      <summary>{STR.editNoteTitle}</summary>
      <div className="fold-body">
        <p className="hint">{STR.editNoteHint}</p>
        <textarea
          className="note-input"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          style={{ marginTop: 10 }}
        />
        <input
          type="text"
          placeholder={STR.headingPlaceholder}
          value={heading}
          onChange={(e) => setHeading(e.target.value)}
          style={{ marginTop: 10 }}
        />
        <div className="btn-row" style={{ marginTop: 16 }}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={submit}
            disabled={submitting || laneBusy}
          >
            {submitting ? STR.submitting : STR.editNoteCta}
          </button>
        </div>
        {started && socialCopy && hasActiveSocialTask ? (
          <p className="form-success">{socialCopy.started}</p>
        ) : laneBusy ? (
          <p className="info-callout">
            {isSocial ? STR.socialBusyInfo : STR.articleBusyInfo}
          </p>
        ) : null}
        {error ? <p className="form-error">{error}</p> : null}
      </div>
    </details>
  );
}

export function NextActions({
  detail,
  onSpawned,
  onPosterStarted,
}: BlockProps & { onPosterStarted?: (() => void) | undefined }) {
  const terminal = detail.status === 'completed' || detail.status === 'failed';
  if (!terminal) return null;

  const isSocial = isSocialCategory(detail.category);
  // Offer every format except this run's own: an article run gets both social
  // folds, a social run gets the article fold plus the other platform's.
  const socialFolds = SOCIAL_PLATFORMS.filter(
    (platform) => platform !== detail.category,
  );

  return (
    <section className="card next-actions">
      <h2>{STR.nextActionsTitle}</h2>
      <p className="hint">{STR.nextActionsHint}</p>
      {/* Outside the completed-only gate: on a failed row with an article the
          failure was the poster phase, so this doubles as the cheap retry. */}
      {!isSocial && detail.article && !detail.posterUrl ? (
        <CreatePosterBlock detail={detail} onPosterStarted={onPosterStarted} />
      ) : null}
      {detail.status === 'completed' ? (
        <>
          {isSocial ? (
            <CreateArticleBlock detail={detail} onSpawned={onSpawned} />
          ) : null}
          {socialFolds.map((platform) => (
            <CreateSocialBlock
              key={platform}
              detail={detail}
              platform={platform}
              onSpawned={onSpawned}
            />
          ))}
        </>
      ) : null}
      <EditNoteBlock detail={detail} onSpawned={onSpawned} />
    </section>
  );
}
