'use client';

// "पुढील पाऊल" panel on a finished generation. Everything here creates a NEW
// generation from this run's note via the same API the home form uses (this run
// is never mutated):
//   - cross-format: an article run offers a Twitter post, a twitter run offers an
//     article — with the same design/template questions the home form asks;
//   - edit-note: reopen the note prefilled, tweak it, re-run with the same settings.
// Twitter runs are background tasks (track + open the panel, no navigation);
// article runs navigate to the new run's progress page — same conventions as the
// home form's submit.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type {
  Category,
  DesignMode,
  GenerationDetail,
  OutputType,
} from '@dgipr/schemas';
import { createGeneration } from '../lib/api';
import {
  ARTICLE_CATEGORY_OPTIONS,
  DESIGN_OPTIONS,
  OUTPUT_OPTIONS,
  type GenerationOption,
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
// strip — essential for the twitter paths, which never navigate away.
type BlockProps = {
  detail: GenerationDetail;
  onSpawned?: (() => void) | undefined;
};

// Article/news/scheme run → create a Twitter post from the same note.
function CreateTwitterBlock({ detail, onSpawned }: BlockProps) {
  const { addTask, openPanel, hasActiveTwitterTask } = useTasks();
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
    if (hasActiveTwitterTask) {
      setError(STR.busyError);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const id = await createGeneration({
        note: detail.note,
        heading: detail.heading ?? undefined,
        category: 'twitter',
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
      <summary>{STR.nextTwitterTitle}</summary>
      <div className="fold-body">
        <p className="hint">{STR.nextTwitterHint}</p>
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
            disabled={submitting || hasActiveTwitterTask}
          >
            {submitting ? STR.submitting : STR.nextTwitterCta}
          </button>
        </div>
        {started && hasActiveTwitterTask ? (
          <p className="form-success">{STR.nextTwitterStarted}</p>
        ) : hasActiveTwitterTask ? (
          <p className="info-callout">{STR.twitterBusyInfo}</p>
        ) : null}
        {error ? <p className="form-error">{error}</p> : null}
      </div>
    </details>
  );
}

// Twitter run → create an article (news/scheme voice, optional poster) from the
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
  const { addTask, openPanel, hasActiveTwitterTask, hasActiveArticleTask } =
    useTasks();
  const isTwitter = detail.category === 'twitter';
  const laneBusy = isTwitter ? hasActiveTwitterTask : hasActiveArticleTask;
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
      if (isTwitter) {
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
        {started && isTwitter && hasActiveTwitterTask ? (
          <p className="form-success">{STR.nextTwitterStarted}</p>
        ) : laneBusy ? (
          <p className="info-callout">
            {isTwitter ? STR.twitterBusyInfo : STR.articleBusyInfo}
          </p>
        ) : null}
        {error ? <p className="form-error">{error}</p> : null}
      </div>
    </details>
  );
}

export function NextActions({ detail, onSpawned }: BlockProps) {
  const terminal = detail.status === 'completed' || detail.status === 'failed';
  if (!terminal) return null;

  return (
    <section className="card next-actions">
      <h2>{STR.nextActionsTitle}</h2>
      <p className="hint">{STR.nextActionsHint}</p>
      {detail.status === 'completed' ? (
        detail.category === 'twitter' ? (
          <CreateArticleBlock detail={detail} onSpawned={onSpawned} />
        ) : (
          <CreateTwitterBlock detail={detail} onSpawned={onSpawned} />
        )
      ) : null}
      <EditNoteBlock detail={detail} onSpawned={onSpawned} />
    </section>
  );
}
