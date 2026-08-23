'use client';

// The route-level React error boundary. Catches anything that throws while a page
// RENDERS — a shape the UI did not expect, a null the payload was supposed to carry —
// as opposed to the request failures every screen already handles by hand.
//
// Without it Next shows its own screen: an English dev overlay in development, and in
// production the bare "Application error: a client-side exception has occurred" on a
// white page. For an officer that is indistinguishable from the site being gone, and it
// offers nothing to press — the browser's Back button is the only way out.
//
// So this states two things and nothing else. The work is on the server (it is: every
// run, intake, transcript and video is a row, and none of them is held in this page's
// state), and there are two buttons: try this page again, or go somewhere that works.
// It deliberately claims no cause — nobody here knows one.

import { useEffect } from 'react';
import Link from 'next/link';
import { AlertTriangle, Home, RefreshCw } from 'lucide-react';
import { STR } from '../lib/strings';

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // The message is NEVER rendered — it is a developer string by construction, which is
  // the whole reason this file exists. It goes to the console, where the digest is what
  // ties a report to a server log line.
  useEffect(() => {
    console.error('[render] page failed to render:', error);
  }, [error]);

  return (
    <main className="page">
      <section className="card crash-card" role="alert">
        <AlertTriangle
          className="crash-icon"
          size={40}
          strokeWidth={1.75}
          aria-hidden="true"
        />
        <h1 className="crash-title">{STR.crashTitle}</h1>
        <p className="crash-body">{STR.crashBody}</p>
        <div className="crash-actions">
          <button type="button" className="btn btn-primary" onClick={reset}>
            <RefreshCw size={18} aria-hidden="true" />
            {STR.crashRetry}
          </button>
          <Link className="btn" href="/">
            <Home size={18} aria-hidden="true" />
            {STR.crashHome}
          </Link>
        </div>
      </section>
    </main>
  );
}
