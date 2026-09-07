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
import { STR } from '../lib/strings';
import { FormCard } from './common/FormCard';
import { PromptTextarea } from './common/PromptTextarea';

export function StyleReferenceField({
  value,
  onChange,
  disabled = false,
  className = 'mt-6',
}: {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean | undefined;
  className?: string | undefined;
}) {
  // Both /dlo steps can mount this field, and a fixed id would make one step's label focus the
  // other step's input — the bug PageRangeSelector already hit.
  const id = useId();

  return (
    <FormCard
      htmlFor={id}
      label={STR.styleRefLabel}
      hint={STR.styleRefHint}
      className={className}
    >
      {/* Uncontrolled by design — see ComposeSafeInput. A pasted article arrives whole, but an
          officer may still correct it by hand, and that is the path that loses characters. */}
      <PromptTextarea
        id={id}
        rows={6}
        placeholder={STR.styleRefPlaceholder}
        value={value}
        onChange={onChange}
        disabled={disabled}
        className="mt-3 max-h-96 min-h-36 w-full"
      />
    </FormCard>
  );
}
