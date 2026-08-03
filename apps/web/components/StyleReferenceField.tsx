'use client';

// The officer-supplied STYLE reference — tier 1 of the simplified article generator's reference
// hierarchy (select-style-reference.ts), above vector retrieval and the same-category fallback.
//
// It is rendered on /dlo only, and that is not an oversight: the media room always submits
// `providedArticle: true`, meaning its note IS the finished article and the generator never
// runs, so the field would be dead data on every run there. /dlo is the one surface that turns
// source material into prose.
//
// The hint carries the whole safety story in plain Marathi — this article is copied for its
// SHAPE, never for its facts. An officer who pastes a topically-related article expecting its
// details to be reused would be misreading the field, and the prompt would (correctly) ignore
// them, so the misunderstanding has to be prevented here rather than explained afterwards.

import { useId } from 'react';
import { BookOpen } from 'lucide-react';
import { STR } from '../lib/strings';

export function StyleReferenceField({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  // Both /dlo steps can mount this field, and a fixed id would make one step's label focus the
  // other step's input — the bug PageRangeSelector already hit.
  const id = useId();

  return (
    <section className="card">
      <label className="field-label" htmlFor={id}>
        <BookOpen size={18} className="label-icon" aria-hidden="true" />
        {STR.styleRefLabel}
      </label>
      <p className="hint">{STR.styleRefHint}</p>
      <textarea
        id={id}
        className="note-input"
        rows={6}
        placeholder={STR.styleRefPlaceholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        style={{ marginTop: 10 }}
      />
    </section>
  );
}
