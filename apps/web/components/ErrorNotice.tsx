'use client';

// The one way this product shows a failure.
//
// It replaces the bare red paragraph this app used ~70 times, which had two
// problems it exists to fix. It could not offer a retry,
// so whether a recoverable failure had a button next to it depended on whether
// the author of that particular screen had happened to add one — and the failure
// most in need of a button (the API restarting under a poll) was on the screens
// that had none. And it rendered whatever string it was handed, which is how a
// ZodError blob ended up overflowing a card on a phone.
//
// Handing it the CAUGHT VALUE rather than a string is the intended use: the
// message and the retry verdict are then both derived by `describeError`, so a
// screen cannot show "press the button again" next to a failure where pressing it
// again cannot work, and cannot show a button for a malformed request.

import { AlertTriangle, RefreshCw, WifiOff } from 'lucide-react';
import { describeError, type ErrorKind } from '../lib/errorMessage';
import { STR } from '../lib/strings';

interface ErrorNoticeProps {
  /**
   * The thrown value. Preferred over `message`: it carries the status, which is
   * what decides both the wording and whether a retry is offered at all.
   */
  error?: unknown;
  /**
   * A message the caller has already chosen — a route's own Marathi sentence, or
   * a string polled off a row. Used when there is no thrown value to describe.
   */
  message?: string;
  /** Names this action, for a failure with no diagnosis of its own. */
  fallback?: string;
  /**
   * Wiring this makes a retry button appear — but only when the failure is one a
   * retry could fix. A 400 or a 404 renders the message alone even with a handler
   * attached, because a button that cannot work is worse than no button.
   */
  onRetry?: (() => void) | undefined;
  retryLabel?: string;
  /** Disables the button and shows a spinner while the retry is in flight. */
  retrying?: boolean;
  /** Renders a "बंद करा" button. For a notice about one attempt, not a state. */
  onDismiss?: (() => void) | undefined;
  className?: string;
}

function NoticeIcon({ kind }: { kind: ErrorKind }) {
  // Offline is the one cause an officer can act on directly, so it gets its own
  // mark; everything else shares one, because a taxonomy of warning glyphs is
  // information the reader cannot use.
  const Icon =
    kind === 'offline' || kind === 'unreachable' ? WifiOff : AlertTriangle;
  return <Icon className="error-notice-icon" aria-hidden="true" size={20} />;
}

export function ErrorNotice({
  error,
  message,
  fallback,
  onRetry,
  retryLabel,
  retrying = false,
  onDismiss,
  className,
}: ErrorNoticeProps) {
  // A caller-supplied message is still normalised, so a string polled off a row
  // cannot put a provider blob on screen either.
  const described = describeError(
    error !== undefined
      ? error
      : message !== undefined
        ? new Error(message)
        : undefined,
    fallback,
  );

  const showRetry = onRetry !== undefined && described.retryable;

  return (
    <div
      className={className ? `error-notice ${className}` : 'error-notice'}
      role="alert"
    >
      <NoticeIcon kind={described.kind} />
      <div className="error-notice-body">
        <p className="error-notice-text">{described.message}</p>
        {showRetry || onDismiss ? (
          <div className="error-notice-actions">
            {showRetry ? (
              <button
                type="button"
                className="btn"
                onClick={onRetry}
                disabled={retrying}
              >
                {retrying ? (
                  <span className="spinner" aria-hidden="true" />
                ) : (
                  <RefreshCw size={16} aria-hidden="true" />
                )}
                {retryLabel ?? STR.errRetry}
              </button>
            ) : null}
            {onDismiss ? (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={onDismiss}
              >
                {STR.errDismiss}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
