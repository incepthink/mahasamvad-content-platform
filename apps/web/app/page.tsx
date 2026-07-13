'use client';

// New generation: paste/upload the note (टिपणी), pick article/poster/both, one
// primary action. Redirects to the generation's progress page on success.

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Category, DesignMode, OutputType } from '@dgipr/schemas';
import { createGeneration } from '../lib/api';
import {
  CATEGORY_OPTIONS,
  DESIGN_OPTIONS,
  OUTPUT_OPTIONS,
} from '../lib/generationOptions';
import { useTasks } from '../lib/TasksProvider';
import { STR } from '../lib/strings';
import ReferencePicker, {
  type ReferenceSelection,
} from '../components/ReferencePicker';

export default function NewGenerationPage() {
  const router = useRouter();
  const { addTask, openPanel, hasActiveTwitterTask, hasActiveArticleTask } =
    useTasks();
  const [note, setNote] = useState('');
  const [heading, setHeading] = useState('');
  const [category, setCategory] = useState<Category>('scheme');
  const [outputType, setOutputType] = useState<OutputType>('both');
  const [designMode, setDesignMode] = useState<DesignMode>('onbrand');
  const [reference, setReference] = useState<ReferenceSelection | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const isTwitter = category === 'twitter';

  // Which library the template picker shows: twitter masters for the twitter flow
  // (except 'fresh' — no master is edited), article masters for news/scheme runs
  // that render a poster. null hides the picker entirely.
  const pickerCategory: 'twitter' | 'article' | null = isTwitter
    ? designMode === 'fresh'
      ? null
      : 'twitter'
    : outputType !== 'article'
      ? 'article'
      : null;

  // A pin is only meaningful for the combination it was chosen under.
  useEffect(() => {
    setReference(null);
  }, [category, designMode, outputType]);

  const onFile = (file: File | undefined) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.txt')) {
      setError(STR.txtOnly);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setNote(String(reader.result ?? ''));
      setError(null);
    };
    reader.readAsText(file, 'utf-8');
  };

  const submit = async () => {
    if (note.trim().length < 20) {
      setError(STR.noteTooShort);
      return;
    }
    if (isTwitter && hasActiveTwitterTask) {
      setError(STR.busyError);
      return;
    }
    if (!isTwitter && hasActiveArticleTask) {
      setError(STR.busyError);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const id = await createGeneration({
        note: note.trim(),
        heading: heading.trim(),
        category,
        // Twitter always produces a poster + caption; outputType is ignored by the runner.
        outputType: isTwitter ? 'poster' : outputType,
        designMode: isTwitter ? designMode : undefined,
        referenceImageId:
          reference?.kind === 'image' ? reference.id : undefined,
        referenceTypeId: reference?.kind === 'type' ? reference.id : undefined,
      });
      if (isTwitter) {
        // Background task: don't navigate. Track it, open the panel, reset the form
        // to a non-twitter default so the now-disabled Twitter card reads clearly.
        addTask(id);
        openPanel();
        setNote('');
        setCategory('scheme');
        setSubmitting(false);
      } else {
        // Navigate to the progress page, but also register a session row so the
        // navbar tasks panel offers a shortcut back to this run.
        addTask(id);
        router.push(`/generations/${id}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : STR.genericError);
      setSubmitting(false);
    }
  };

  return (
    <main className="page">
      <h1 className="page-title">{STR.newTitle}</h1>

      <section className="card">
        <label className="field-label" htmlFor="note">
          {STR.noteLabel}
        </label>
        <p className="hint">{STR.noteHint}</p>
        <textarea
          id="note"
          className="note-input"
          placeholder={STR.notePlaceholder}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          style={{ marginTop: 10 }}
        />
        <div className="btn-row" style={{ marginTop: 12 }}>
          <button
            type="button"
            className="btn btn-small"
            onClick={() => fileInput.current?.click()}
          >
            {STR.uploadTxt}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".txt,text/plain"
            hidden
            onChange={(e) => onFile(e.target.files?.[0])}
          />
        </div>
      </section>

      <section className="card">
        <label className="field-label" htmlFor="heading">
          {STR.headingLabel}
        </label>
        <p className="hint">{STR.headingHint}</p>
        <input
          id="heading"
          type="text"
          placeholder={STR.headingPlaceholder}
          value={heading}
          onChange={(e) => setHeading(e.target.value)}
          style={{ marginTop: 10 }}
        />
      </section>

      <section className="card">
        <h2>{STR.categoryLabel}</h2>
        <div className="output-picker">
          {CATEGORY_OPTIONS.map((option) => {
            // v1 allows one active task per lane at a time: the Twitter card is
            // gated by an in-flight twitter run, the news/scheme cards by an
            // in-flight article run (the lanes don't block each other).
            const disabled =
              option.value === 'twitter'
                ? hasActiveTwitterTask
                : hasActiveArticleTask;
            return (
              <button
                key={option.value}
                type="button"
                className="output-option"
                aria-pressed={category === option.value}
                disabled={disabled}
                onClick={() => setCategory(option.value)}
              >
                <span className="icon" aria-hidden="true">
                  <option.icon size={30} strokeWidth={1.75} />
                </span>
                <span className="name">{option.name}</span>
                <span className="desc">{option.desc}</span>
              </button>
            );
          })}
        </div>
        {hasActiveTwitterTask ? (
          <p className="info-callout">{STR.twitterBusyInfo}</p>
        ) : null}
        {hasActiveArticleTask ? (
          <p className="info-callout">{STR.articleBusyInfo}</p>
        ) : null}
      </section>

      {isTwitter ? (
        <section className="card">
          <h2>{STR.designModeLabel}</h2>
          <div className="output-picker">
            {DESIGN_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className="output-option"
                aria-pressed={designMode === option.value}
                onClick={() => setDesignMode(option.value)}
              >
                <span className="icon" aria-hidden="true">
                  <option.icon size={30} strokeWidth={1.75} />
                </span>
                <span className="name">{option.name}</span>
                <span className="desc">{option.desc}</span>
              </button>
            ))}
          </div>
        </section>
      ) : (
        <section className="card">
          <h2>{STR.outputTypeLabel}</h2>
          <div className="output-picker">
            {OUTPUT_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className="output-option"
                aria-pressed={outputType === option.value}
                onClick={() => setOutputType(option.value)}
              >
                <span className="icon" aria-hidden="true">
                  <option.icon size={30} strokeWidth={1.75} />
                </span>
                <span className="name">{option.name}</span>
                <span className="desc">{option.desc}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {pickerCategory ? (
        // Keyed by category so switching it remounts the picker: the reset effect
        // above clears the pin, and the remount drops the child's stale manual mode
        // (which would otherwise still show the previous category's library).
        <ReferencePicker
          key={pickerCategory}
          category={pickerCategory}
          value={reference}
          onChange={setReference}
        />
      ) : null}

      <section className="card">
        <div className="btn-row">
          <button
            type="button"
            className="btn btn-primary"
            onClick={submit}
            disabled={submitting}
          >
            {submitting ? STR.submitting : STR.submit}
          </button>
        </div>
        {error ? <p className="form-error">{error}</p> : null}
      </section>
    </main>
  );
}
