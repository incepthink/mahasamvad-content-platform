'use client';

// The last resort: a throw in the ROOT LAYOUT itself, which app/error.tsx cannot catch
// because it renders inside that layout. Next replaces the entire document with this, so
// it must supply its own <html> and <body> — and, importantly, it does NOT get
// globals.css or the Mukta font, since those are the layout's.
//
// That is why the few styles it needs are inline. A stylesheet reference here would be a
// second thing that can fail at the moment everything else already has, and a Devanagari
// page falling back to a system font still reads correctly on every machine these
// officers use (Windows ships Nirmala UI, which shapes the conjuncts properly — see the
// font note in layout.tsx).
//
// In practice this file should never render. It exists so that when it does, the officer
// gets a Marathi sentence and a button instead of a white page.

import { useEffect } from 'react';
import { STR } from '../lib/strings';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[render] the application shell failed:', error);
  }, [error]);

  return (
    <html lang="mr">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          // The palette's literals, not its tokens: this page gets no stylesheet,
          // so --bg and --text do not exist here. Keep them in step with the
          // :root block in app/dgipr.css by hand — there is no other way.
          background: '#eef1f3',
          color: '#303b42',
          fontFamily:
            "'Mukta', 'Nirmala UI', 'Noto Sans Devanagari', system-ui, sans-serif",
          fontSize: 18,
          lineHeight: 1.6,
        }}
      >
        <div
          role="alert"
          style={{
            maxWidth: 520,
            width: '100%',
            background: '#f7f9fa',
            border: '1px solid rgba(47, 69, 80, 0.18)',
            borderRadius: 12,
            padding: '28px 24px',
            textAlign: 'center',
            boxShadow: '0 2px 10px rgba(17, 48, 59, 0.12)',
          }}
        >
          <h1 style={{ margin: '0 0 12px', fontSize: '1.4rem' }}>
            {STR.crashTitle}
          </h1>
          <p style={{ margin: '0 0 22px' }}>{STR.crashBody}</p>
          <button
            type="button"
            onClick={reset}
            style={{
              font: 'inherit',
              fontWeight: 700,
              color: '#fff',
              background: '#23866b',
              border: 'none',
              borderRadius: 10,
              // Keeps the product's 56px primary-button target: this is the one
              // control on the page, and it is being pressed by the people the
              // large-target rule at the top of globals.css is written for.
              minHeight: 56,
              padding: '14px 34px',
              cursor: 'pointer',
            }}
          >
            {STR.crashRetry}
          </button>
        </div>
      </body>
    </html>
  );
}
