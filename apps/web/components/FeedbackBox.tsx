'use client';

// Free-text feedback box. `onSubmit` sends the feedback to the API; the parent
// refreshes the generation afterwards so the page flips into progress view.

import { useState } from 'react';
import { STR } from '../lib/strings';

export function FeedbackBox({
  title,
  hint,
  onSubmit,
  disabled = false,
  suggestions,
  children,
}: {
  title: string;
  hint?: string;
  onSubmit: (feedback: string) => Promise<void>;
  disabled?: boolean;
  // One-tap common asks: clicking a chip prefills the textarea (still editable),
  // so frequent revisions don't require typing.
  suggestions?: readonly string[];
  // Optional extra controls rendered above the textarea (e.g. the poster's
  // text-vs-picture choice).
  children?: React.ReactNode;
}) {
  const [feedback, setFeedback] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (disabled || sending) return;
    if (feedback.trim().length < 3) {
      setError(STR.feedbackTooShort);
      return;
    }
    setSending(true);
    setError(null);
    try {
      await onSubmit(feedback.trim());
      setFeedback('');
    } catch (e) {
      setError(e instanceof Error ? e.message : STR.genericError);
    } finally {
      setSending(false);
    }
  };

  return (
    <details className="fold" aria-disabled={disabled}>
      <summary>{title}</summary>
      <div className="fold-body">
        {hint ? <p className="hint">{hint}</p> : null}
        {children}
        {suggestions && suggestions.length > 0 ? (
          <div className="suggestion-row">
            <span className="suggestion-label">
              {STR.feedbackSuggestionsLabel}
            </span>
            {suggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                className="suggestion-chip"
                disabled={disabled || sending}
                onClick={() => {
                  setFeedback(suggestion);
                  setError(null);
                }}
              >
                {suggestion}
              </button>
            ))}
          </div>
        ) : null}
        <textarea
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          placeholder={STR.feedbackPlaceholder}
          rows={3}
          disabled={disabled || sending}
          style={{ marginTop: 10 }}
        />
        <div className="btn-row" style={{ marginTop: 12 }}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={submit}
            disabled={disabled || sending}
          >
            {sending ? STR.sendingFeedback : STR.sendFeedback}
          </button>
        </div>
        {error ? <p className="form-error">{error}</p> : null}
      </div>
    </details>
  );
}
