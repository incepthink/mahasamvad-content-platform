'use client';

// New generation: paste/upload the note (टिपणी), pick article/poster/both, one
// primary action. Redirects to the generation's progress page on success.

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Category, DesignMode, OutputType } from '@dgipr/schemas';
import { createGeneration } from '../lib/api';
import { useTasks } from '../lib/TasksProvider';
import { STR } from '../lib/strings';

const CATEGORY_OPTIONS: ReadonlyArray<{
  value: Category;
  icon: string;
  name: string;
  desc: string;
}> = [
  { value: 'scheme', icon: '📋', name: STR.categoryScheme, desc: STR.categorySchemeDesc },
  { value: 'news', icon: '📰', name: STR.categoryNews, desc: STR.categoryNewsDesc },
  { value: 'twitter', icon: '🐦', name: STR.categoryTwitter, desc: STR.categoryTwitterDesc },
];

const OUTPUT_OPTIONS: ReadonlyArray<{
  value: OutputType;
  icon: string;
  name: string;
  desc: string;
}> = [
  { value: 'article', icon: '📄', name: STR.outputArticle, desc: STR.outputArticleDesc },
  { value: 'poster', icon: '🖼️', name: STR.outputPoster, desc: STR.outputPosterDesc },
  { value: 'both', icon: '📄🖼️', name: STR.outputBoth, desc: STR.outputBothDesc },
];

const DESIGN_OPTIONS: ReadonlyArray<{
  value: DesignMode;
  icon: string;
  name: string;
  desc: string;
}> = [
  { value: 'onbrand', icon: '🎯', name: STR.designOnbrand, desc: STR.designOnbrandDesc },
  { value: 'adaptive', icon: '🎨', name: STR.designAdaptive, desc: STR.designAdaptiveDesc },
  { value: 'fresh', icon: '✨', name: STR.designFresh, desc: STR.designFreshDesc },
];

export default function NewGenerationPage() {
  const router = useRouter();
  const { addTask, openPanel, hasActiveTwitterTask } = useTasks();
  const [note, setNote] = useState('');
  const [heading, setHeading] = useState('');
  const [category, setCategory] = useState<Category>('scheme');
  const [outputType, setOutputType] = useState<OutputType>('both');
  const [designMode, setDesignMode] = useState<DesignMode>('onbrand');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const isTwitter = category === 'twitter';

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
            // v1 allows one active Twitter task at a time: disable the card while one
            // runs (other cards stay usable).
            const disabled =
              option.value === 'twitter' && hasActiveTwitterTask;
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
                  {option.icon}
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
                  {option.icon}
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
                  {option.icon}
                </span>
                <span className="name">{option.name}</span>
                <span className="desc">{option.desc}</span>
              </button>
            ))}
          </div>
        </section>
      )}

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
