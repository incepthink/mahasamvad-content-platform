'use client';

// Free-text feedback box. `onSubmit` sends the feedback to the API; the parent
// refreshes the generation afterwards so the page flips into progress view.

import { useEffect, useRef, useState } from 'react';
import { STR } from '../lib/strings';
import { errorMessage } from '../lib/errorMessage';
// Feedback is written in Marathi on an InScript keyboard, which a controlled box can
// overwrite half-formed. See ComposeSafeInput.
import { ComposeSafeTextarea } from './ComposeSafeInput';
import { ErrorNotice } from './ErrorNotice';

export function FeedbackBox({
  title,
  hint,
  onSubmit,
  disabled = false,
  suggestions,
  children,
  learn,
  onOpenChange,
  onDraftChange,
  fill,
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
  // The four below exist for /learn's practice lessons and are inert everywhere else.
  // `learn` names the fold for the coach (the fold, `-chips`, `-text` and `-send`).
  learn?: string | undefined;
  // Reported whenever the fold opens or closes, and whenever the typed text changes.
  onOpenChange?: ((open: boolean) => void) | undefined;
  onDraftChange?: ((text: string) => void) | undefined;
  // Replaces the typed text with `text` each time `seq` changes — the coach's "write the
  // example" button. The seq, not the text, is the trigger: the same example can be asked
  // for twice.
  fill?: Readonly<{ text: string; seq: number }> | null | undefined;
}) {
  const [feedback, setFeedback] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onDraftChangeRef = useRef(onDraftChange);
  onDraftChangeRef.current = onDraftChange;
  useEffect(() => onDraftChangeRef.current?.(feedback), [feedback]);

  const fillSeq = fill?.seq;
  const fillText = fill?.text;
  useEffect(() => {
    if (fillSeq === undefined || fillText === undefined) return;
    setFeedback(fillText);
    setError(null);
  }, [fillSeq, fillText]);

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
      setError(errorMessage(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <details
      className="fold"
      aria-disabled={disabled}
      data-learn={learn}
      onToggle={
        onOpenChange
          ? (event) => onOpenChange(event.currentTarget.open)
          : undefined
      }
    >
      <summary>{title}</summary>
      <div className="fold-body">
        {hint ? <p className="hint">{hint}</p> : null}
        {children}
        {suggestions && suggestions.length > 0 ? (
          <div
            className="suggestion-row"
            data-learn={learn ? `${learn}-chips` : undefined}
          >
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
        <div data-learn={learn ? `${learn}-text` : undefined}>
          <ComposeSafeTextarea
            value={feedback}
            onChange={setFeedback}
            placeholder={STR.feedbackPlaceholder}
            rows={3}
            disabled={disabled || sending}
            style={{ marginTop: 10 }}
          />
        </div>
        <div className="btn-row" style={{ marginTop: 12 }}>
          <button
            type="button"
            data-learn={learn ? `${learn}-send` : undefined}
            className="btn btn-primary"
            onClick={submit}
            disabled={disabled || sending}
          >
            {sending ? STR.sendingFeedback : STR.sendFeedback}
          </button>
        </div>
        {error ? <ErrorNotice message={error} /> : null}
      </div>
    </details>
  );
}
