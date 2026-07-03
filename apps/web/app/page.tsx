'use client';

// New generation: paste/upload the note (टिपणी), pick article/poster/both, one
// primary action. Redirects to the generation's progress page on success.

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { OutputType } from '@dgipr/schemas';
import { createGeneration } from '../lib/api';
import { STR } from '../lib/strings';

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

export default function NewGenerationPage() {
  const router = useRouter();
  const [note, setNote] = useState('');
  const [outputType, setOutputType] = useState<OutputType>('both');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

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
    setSubmitting(true);
    setError(null);
    try {
      const id = await createGeneration({ note: note.trim(), outputType });
      router.push(`/generations/${id}`);
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

        <div className="btn-row" style={{ marginTop: 24 }}>
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
