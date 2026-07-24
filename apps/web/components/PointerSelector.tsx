'use client';

// The Pointers step of /dlo: the note's facts as AI-summarized Marathi bullets grouped by
// 5W1H (कोण/काय/केव्हा/कुठे/का/कसे), each with a checkbox. Everything is checked by default;
// unchecking a bullet tells the article pipeline to leave that fact out (page.tsx turns the
// deselected bullets into `excludedFacts` on the generate request).
//
// Controlled, like DloSourceReview: the parent owns the deselected set and the groups; this
// component only renders and reports toggles. A pointer's identity is `${dimension}#${index}`
// (see pointerId), stable within one extraction — the parent clears the deselected set when a
// fresh extraction arrives, so a stale id can never survive a regenerate.

import type { PointerDimension, PointerGroup } from '@dgipr/schemas';
import { STR } from '../lib/strings';

const DIMENSION_LABEL: Record<PointerDimension, string> = {
  who: STR.dloPointerDimWho,
  what: STR.dloPointerDimWhat,
  when: STR.dloPointerDimWhen,
  where: STR.dloPointerDimWhere,
  why: STR.dloPointerDimWhy,
  how: STR.dloPointerDimHow,
};

export function pointerId(dimension: string, index: number): string {
  return `${dimension}#${index}`;
}

function marathiNumber(value: number): string {
  return value.toLocaleString('mr-IN');
}

export function PointerSelector({
  groups,
  loading,
  error,
  deselected,
  busy,
  onToggle,
  onRegenerate,
}: {
  groups: readonly PointerGroup[];
  loading: boolean;
  error: boolean;
  deselected: ReadonlySet<string>;
  busy: boolean;
  onToggle: (id: string) => void;
  onRegenerate: () => void;
}) {
  return (
    <section className="card">
      <div className="article-head">
        <h2>{STR.dloPointersTitle}</h2>
        {!loading && deselected.size > 0 ? (
          <span className="chip chip-failed">
            {marathiNumber(deselected.size)} {STR.dloPointersExcludedCount}
          </span>
        ) : null}
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
      ) : groups.length === 0 ? (
        <p className="hint">{STR.dloPointersEmpty}</p>
      ) : (
        <>
          <p className="hint">{STR.dloPointersHint}</p>
          {groups.map((group) => (
            <div key={group.dimension} className="pointer-group">
              <p className="field-label">{DIMENSION_LABEL[group.dimension]}</p>
              <ul className="pointer-list">
                {group.points.map((point, index) => {
                  const id = pointerId(group.dimension, index);
                  const included = !deselected.has(id);
                  return (
                    <li key={id}>
                      <label
                        className={`pointer-row${included ? '' : ' excluded'}`}
                      >
                        <input
                          type="checkbox"
                          checked={included}
                          disabled={busy}
                          onChange={() => onToggle(id)}
                        />
                        <span className="pointer-text">{point}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
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
      )}
    </section>
  );
}
