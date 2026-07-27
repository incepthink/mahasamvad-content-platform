'use client';

// The Pointers card on /dlo: a read-only summary of what the reviewed source says, as one
// flat ordered list of Marathi key points (see extract-pointers.ts). It reads like an article
// summary, not a form — there is nothing to tick, because the article is written from the
// complete reviewed text below rather than from a selection made here.
//
// Purely presentational: the parent owns the fetch, the three-state list (null = not fetched
// yet) and the regenerate action. This component only renders what it is handed, which is why
// it takes plain strings rather than a schema type.

import { STR } from '../lib/strings';

export function PointerList({
  points,
  loading,
  error,
  busy,
  onRegenerate,
}: {
  points: readonly string[];
  loading: boolean;
  error: boolean;
  busy: boolean;
  onRegenerate: () => void;
}) {
  return (
    <section className="card">
      <div className="article-head">
        <h2>{STR.dloPointersTitle}</h2>
      </div>

      {loading ? (
        <div className="dlo-processing">
          <span className="spinner spinner-lg" aria-hidden="true" />
          <p className="dlo-processing-title">{STR.dloPointersLoading}</p>
        </div>
      ) : error ? (
        <>
          <p className="hint">{STR.dloPointersError}</p>
          <div className="btn-row" style={{ marginTop: 12 }}>
            <button
              type="button"
              className="btn btn-small"
              onClick={onRegenerate}
              disabled={busy}
            >
              {STR.dloPointersRegenerate}
            </button>
          </div>
        </>
      ) : points.length === 0 ? (
        <p className="hint">{STR.dloPointersEmpty}</p>
      ) : (
        <>
          <p className="hint">{STR.dloPointersHint}</p>
          <ul className="pointer-list">
            {points.map((point, index) => (
              <li key={`${index}-${point}`}>{point}</li>
            ))}
          </ul>
          <div className="btn-row" style={{ marginTop: 16 }}>
            <button
              type="button"
              className="btn btn-small"
              onClick={onRegenerate}
              disabled={busy}
            >
              {STR.dloPointersRegenerate}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
