'use client';

import { useState } from 'react';
import { Pencil } from 'lucide-react';

export function InlineEditableField({
  id,
  label,
  value,
  onChange,
  disabled = false,
  kind = 'textarea',
  maxLength,
  emptyText = 'मजकूर दिलेला नाही',
}: {
  id: string;
  label: string;
  value: string;
  onChange?: ((value: string) => void) | undefined;
  disabled?: boolean;
  kind?: 'text' | 'textarea';
  maxLength?: number;
  emptyText?: string;
}) {
  const [editing, setEditing] = useState(false);
  const editLabel = `${label} संपादित करा`;

  return (
    <div className={`inline-edit-field${editing ? ' is-editing' : ''}`}>
      <label className="inline-edit-title" htmlFor={editing ? id : undefined}>
        {label}
      </label>
      {editing && onChange ? (
        kind === 'text' ? (
          <input
            id={id}
            type="text"
            className="inline-edit-control"
            value={value}
            maxLength={maxLength}
            disabled={disabled}
            autoFocus
            onBlur={() => setEditing(false)}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') event.currentTarget.blur();
            }}
          />
        ) : (
          <textarea
            id={id}
            className="note-input inline-edit-control"
            value={value}
            maxLength={maxLength}
            disabled={disabled}
            autoFocus
            onBlur={() => setEditing(false)}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') event.currentTarget.blur();
            }}
          />
        )
      ) : (
        <>
          <p
            className={`inline-edit-value${value.trim() === '' ? ' is-empty' : ''}`}
          >
            {value.trim() === '' ? emptyText : value}
          </p>
          {onChange ? (
            <button
              type="button"
              className="inline-edit-trigger"
              aria-label={editLabel}
              title={editLabel}
              disabled={disabled}
              onClick={() => setEditing(true)}
            >
              <Pencil size={17} aria-hidden="true" />
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}
