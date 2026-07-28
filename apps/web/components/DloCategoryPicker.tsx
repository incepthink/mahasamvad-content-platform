'use client';

// Article-category picker (news vs scheme), shared by the /dlo intake form and the review
// step — the officer can change their mind after reading what the sources actually say.
// Same option cards as the home form.

import type { DloCategory } from '@dgipr/schemas';
import { ARTICLE_CATEGORY_OPTIONS } from '../lib/generationOptions';
import { STR } from '../lib/strings';

export function DloCategoryPicker({
  value,
  onChange,
}: {
  value: DloCategory;
  onChange: (next: DloCategory) => void;
}) {
  return (
    <>
      <h2>{STR.categoryLabel}</h2>
      <div className="output-picker">
        {ARTICLE_CATEGORY_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            className="output-option"
            aria-pressed={value === option.value}
            onClick={() => {
              // ARTICLE_CATEGORY_OPTIONS already excludes the social lanes; this
              // re-narrows the widened Category to the two a DLO run can produce.
              if (option.value === 'news' || option.value === 'scheme') {
                onChange(option.value);
              }
            }}
          >
            <span className="icon" aria-hidden="true">
              <option.icon size={30} strokeWidth={1.75} />
            </span>
            <span className="name">{option.name}</span>
            <span className="desc">{option.desc}</span>
          </button>
        ))}
      </div>
    </>
  );
}
