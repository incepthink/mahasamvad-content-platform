'use client';

// "AI साठी सूचना" — the officer's free-text direction for ONE article run
// (generations.instructions, migration 0041). Emphasis, ordering, tone, what to keep short.
//
// It sits beside StyleReferenceField and is deliberately its sibling in shape, because the two
// answer neighbouring questions: that field says "write it like THIS article", this one says
// "write it like THIS". Both are style-side inputs, and neither is ever a factual source — the
// prompt block that renders this text carries that rule explicitly, so an officer who types a
// figure here does not get it published. The hint says so in plain Marathi rather than letting
// them discover it from a missing number in the output.
//
// Rendered on /dlo only, for the same reason StyleReferenceField is: the media room always
// submits `providedArticle: true`, so no prose is generated there and the field would be dead
// data on every run.
//
// The counter appears only once something is typed, and only warns near the ceiling — a live
// "0 / 2,000" on an optional field reads as a form to fill in rather than an offer.

import { useId } from 'react';
import { Sparkles } from 'lucide-react';
import { ARTICLE_INSTRUCTIONS_MAX_CHARS } from '@dgipr/schemas';
import { STR } from '../lib/strings';

export function AiInstructionsField({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  // Both /dlo steps can mount this field, and a fixed id would make one step's label focus the
  // other step's input — the bug PageRangeSelector already hit.
  const id = useId();
  const tooLong = value.trim().length > ARTICLE_INSTRUCTIONS_MAX_CHARS;

  return (
    <section className="card">
      <label className="field-label" htmlFor={id}>
        <Sparkles size={18} className="label-icon" aria-hidden="true" />
        {STR.aiInstructionsLabel}
      </label>
      <p className="hint">{STR.aiInstructionsHint}</p>
      <textarea
        id={id}
        className="note-input instructions-input"
        rows={4}
        placeholder={STR.aiInstructionsPlaceholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        style={{ marginTop: 10 }}
      />
      {value.trim().length > 0 ? (
        <p
          className={tooLong ? 'form-error' : 'hint'}
          style={{ marginTop: 6 }}
          aria-live="polite"
        >
          {tooLong
            ? STR.aiInstructionsTooLong
            : `${value.trim().length.toLocaleString('mr-IN')} / ${ARTICLE_INSTRUCTIONS_MAX_CHARS.toLocaleString('mr-IN')} ${STR.dloCharsSuffix}`}
        </p>
      ) : null}
    </section>
  );
}
