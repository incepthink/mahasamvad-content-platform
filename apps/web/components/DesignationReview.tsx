'use client';

// "व्यक्ती व पदनाम" — the pre-generation designation check.
//
// In government communication a person's designation is part of how they are officially
// named: a meeting recording says "देवेंद्र फडणवीस" and the published article must say
// "मुख्यमंत्री देवेंद्र फडणवीस". This card is where the officer sees, before any generation is
// paid for, exactly which title will be printed before which name.
//
// Three deliberate behaviours:
//   - A blank पदनाम is a valid answer, not an error. It means "print this name bare", which is
//     what happens for anyone the नाव-शब्दकोश has not met. Nothing is ever inferred from the
//     note, so the officer filling this in IS the source of truth.
//   - The पदनाम field is backed by a <datalist> of the dictionary's verified titles. Picking
//     rather than typing is what keeps "मुख्यमंत्री" spelled one way across every officer and
//     every article — and a picked title already has a confirmed English form, so the English
//     translation renders it correctly too.
//   - "यापुढेही हेच वापरा" is opt-in per row. Unticked, the पदनाम applies to this article only;
//     ticked, it becomes the dictionary's answer next time. Someone named in a one-off capacity
//     should not silently rewrite their permanent entry.
//
// Controlled by the parent so /dlo and the media room can hold the state
// in whatever shape their own flow needs.

import type { KnownDesignation, PreparedName } from '@dgipr/schemas';
import { STR } from '../lib/strings';

// One editable row's current state, keyed by the person's Marathi name.
export type DesignationEdit = Readonly<{
  designation: string;
  remember: boolean;
}>;

// Names the officer added by hand because the extractor missed them.
export type DesignationExtra = Readonly<{
  name: string;
  designation: string;
  remember: boolean;
}>;

const DATALIST_ID = 'designation-options';

export function DesignationReview({
  names,
  known,
  edits,
  extras,
  loading,
  error,
  busy,
  onEditDesignation,
  onToggleRemember,
  onChangeExtra,
  onAddExtra,
  onRegenerate,
}: {
  names: readonly PreparedName[] | null;
  known: readonly KnownDesignation[];
  // Keyed by `PreparedName.marathi`; a name with no entry falls back to what prepare returned.
  edits: Readonly<Record<string, DesignationEdit>>;
  extras: readonly DesignationExtra[];
  loading: boolean;
  error: string | null;
  busy: boolean;
  onEditDesignation: (marathi: string, designation: string) => void;
  onToggleRemember: (marathi: string, remember: boolean) => void;
  onChangeExtra: (index: number, patch: Partial<DesignationExtra>) => void;
  onAddExtra: () => void;
  onRegenerate: () => void;
}) {
  const valueFor = (term: PreparedName): DesignationEdit =>
    edits[term.marathi] ?? {
      designation: term.designation,
      // A designation that came FROM the dictionary is already remembered; re-saving an
      // unchanged value would only churn the row's updated_at.
      remember: false,
    };

  return (
    <section className="card names-review">
      <h3 className="names-review-title">{STR.designationsTitle}</h3>
      <p className="hint">{STR.designationsHint}</p>

      {loading ? <p className="hint">{STR.designationsLoading}</p> : null}

      {error ? (
        <div className="btn-row" style={{ marginTop: 12 }}>
          <p className="form-error" style={{ marginRight: 12 }}>
            {error}
          </p>
          <button
            type="button"
            className="btn btn-small"
            onClick={onRegenerate}
            disabled={busy || loading}
          >
            {STR.designationsRegenerate}
          </button>
        </div>
      ) : null}

      {!loading && !error && names !== null && names.length === 0 ? (
        <p className="hint">{STR.designationsEmpty}</p>
      ) : null}

      {/* One shared datalist for every row — the dictionary's verified titles. */}
      <datalist id={DATALIST_ID}>
        {known.map((option) => (
          <option key={option.marathi} value={option.marathi} />
        ))}
      </datalist>

      {(names ?? []).map((term) => {
        const value = valueFor(term);
        return (
          <div
            key={term.marathi}
            className={`names-review-row ${term.inGlossary ? 'is-verified' : 'is-unverified'}`}
          >
            <div className="glossary-cell">
              <span className="glossary-field-label">
                {STR.designationsName}
              </span>
              <span className="glossary-marathi">{term.marathi}</span>
            </div>

            <div className="glossary-cell">
              <span className="glossary-field-label">
                {STR.designationsDesignation}
              </span>
              <input
                type="text"
                list={DATALIST_ID}
                value={value.designation}
                placeholder={STR.designationsPlaceholder}
                onChange={(e) =>
                  onEditDesignation(term.marathi, e.target.value)
                }
                disabled={busy}
              />
            </div>

            {/* Only offered once there is something to remember. */}
            {value.designation.trim().length > 0 ? (
              <label className="names-lock-toggle">
                <input
                  type="checkbox"
                  checked={value.remember}
                  onChange={(e) =>
                    onToggleRemember(term.marathi, e.target.checked)
                  }
                  disabled={busy}
                />
                <span>{STR.designationsRemember}</span>
              </label>
            ) : (
              <span />
            )}

            <span
              className={`chip ${term.inGlossary ? 'chip-completed' : 'chip-queued'}`}
            >
              {term.inGlossary ? STR.glossaryVerified : STR.designationsNew}
            </span>
          </div>
        );
      })}

      {extras.map((extra, i) => (
        <div key={i} className="names-review-row is-extra">
          <div className="glossary-cell">
            <span className="glossary-field-label">{STR.designationsName}</span>
            <input
              type="text"
              value={extra.name}
              placeholder={STR.designationsNamePlaceholder}
              onChange={(e) => onChangeExtra(i, { name: e.target.value })}
              disabled={busy}
            />
          </div>
          <div className="glossary-cell">
            <span className="glossary-field-label">
              {STR.designationsDesignation}
            </span>
            <input
              type="text"
              list={DATALIST_ID}
              value={extra.designation}
              placeholder={STR.designationsPlaceholder}
              onChange={(e) => onChangeExtra(i, { designation: e.target.value })}
              disabled={busy}
            />
          </div>
          {extra.designation.trim().length > 0 && extra.name.trim().length > 0 ? (
            <label className="names-lock-toggle">
              <input
                type="checkbox"
                checked={extra.remember}
                onChange={(e) => onChangeExtra(i, { remember: e.target.checked })}
                disabled={busy}
              />
              <span>{STR.designationsRemember}</span>
            </label>
          ) : (
            <span />
          )}
          <span />
        </div>
      ))}

      {names !== null && !loading ? (
        <div className="btn-row" style={{ marginTop: 12 }}>
          <button
            type="button"
            className="btn btn-small"
            onClick={onAddExtra}
            disabled={busy}
          >
            {STR.designationsAddName}
          </button>
          <button
            type="button"
            className="btn btn-small"
            onClick={onRegenerate}
            disabled={busy}
          >
            {STR.designationsRegenerate}
          </button>
        </div>
      ) : null}

      {(names ?? []).length > 0 || extras.length > 0 ? (
        <p className="hint" style={{ marginTop: 10 }}>
          {STR.designationsRememberHint}
        </p>
      ) : null}
    </section>
  );
}

// Fold the card's state into the wire shape. Blank designations are dropped: an empty field
// means "print this name bare", which is the absence of a pair, not a pair with an empty value.
export function collectDesignations(
  names: readonly PreparedName[] | null,
  edits: Readonly<Record<string, DesignationEdit>>,
  extras: readonly DesignationExtra[],
): Array<{ name: string; designation: string; remember?: boolean }> {
  const out: Array<{
    name: string;
    designation: string;
    remember?: boolean;
  }> = [];
  const seen = new Set<string>();

  for (const term of names ?? []) {
    const edit = edits[term.marathi];
    const designation = (edit?.designation ?? term.designation).trim();
    if (designation.length === 0) continue;
    seen.add(term.marathi);
    out.push({
      name: term.marathi,
      designation,
      ...(edit?.remember ? { remember: true } : {}),
    });
  }

  for (const extra of extras) {
    const name = extra.name.trim();
    const designation = extra.designation.trim();
    if (name.length === 0 || designation.length === 0) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({
      name,
      designation,
      ...(extra.remember ? { remember: true } : {}),
    });
  }

  return out;
}
