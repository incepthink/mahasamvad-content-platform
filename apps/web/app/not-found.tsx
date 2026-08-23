// The 404. Reached by a stale bookmark, a link to a run that was removed, or a
// mistyped address — and until now it was Next's own English default page.
//
// Not a client component: nothing here reacts to anything, so it stays on the server.

import Link from 'next/link';
import { Home, SearchX } from 'lucide-react';
import { STR } from '../lib/strings';

export default function NotFound() {
  return (
    <main className="page">
      <section className="card crash-card">
        <SearchX
          className="crash-icon"
          size={40}
          strokeWidth={1.75}
          aria-hidden="true"
        />
        <h1 className="crash-title">{STR.notFoundTitle}</h1>
        <p className="crash-body">{STR.notFoundBody}</p>
        <div className="crash-actions">
          <Link className="btn btn-primary" href="/">
            <Home size={18} aria-hidden="true" />
            {STR.crashHome}
          </Link>
        </div>
      </section>
    </main>
  );
}
