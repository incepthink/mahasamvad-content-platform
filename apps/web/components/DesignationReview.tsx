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

import { UserCog } from 'lucide-react';
import type { KnownDesignation, PreparedName } from '@dgipr/schemas';
import { CardTitle } from './CardTitle';
import { STR } from '../lib/strings';
import { ErrorNotice } from './ErrorNotice';

// One editable row's current state, keyed by the person's Marathi name.
export type DesignationEdit = Readonly<{
  designation: string;
  remember: boolean;
  // Only meaningful on a `suggested` row (a person the note does not name, proposed because the
  // dictionary knows who holds the office it DOES name). Such a row is excluded until the
  // officer ticks it — see collectDesignations. Always false on an ordinary row.
  //
  // Required rather than optional so it matches the autosaved shape exactly (which defaults it),
  // and so a future construction site cannot forget it and silently un-accept a confirmed row.
  accepted: boolean;
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
  onToggleAccepted,
  onChangeExtra,
  onAddExtra,
  onRegenerate,
  onVerify,
  verifying,
  verifyError,
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
  onToggleAccepted: (marathi: string, accepted: boolean) => void;
  onChangeExtra: (index: number, patch: Partial<DesignationExtra>) => void;
  onAddExtra: () => void;
  onRegenerate: () => void;
  // "तपासले म्हणून खूण करा" on an unverified row. Writes straight to the नाव-शब्दकोश — the
  // parent owns the request so it can also flip the row's badge on success.
  onVerify: (marathi: string) => void;
  verifying: readonly string[];
  verifyError: string | null;
}) {
  const valueFor = (term: PreparedName): DesignationEdit =>
    edits[term.marathi] ?? {
      designation: term.designation,
      // A designation that came FROM the dictionary is already remembered; re-saving an
      // unchanged value would only churn the row's updated_at.
      remember: false,
      // Suggestions start ACCEPTED. They used to start unticked, which read as the safe
      // default and was in fact a silent one: the officer ticks it on the run where they
      // notice, and every later run drops the name again with no notice at all — measured
      // live, one run in four carried the designation and three did not. Since a suggestion
      // is a lookup against a VERIFIED dictionary row, and this card is shown before any
      // spend with the person named on it, the review is preserved by making it visible and
      // untickable rather than by making it off. See the comment on `suggested`.
      accepted: term.suggested,
    };

  const hasSuggested = (names ?? []).some((term) => term.suggested);
  // A पदनाम read off the note itself is explained once, above the rows, rather than repeating
  // the sentence on every row that has one.
  const hasFromText = (names ?? []).some(
    (term) =>
      term.fromText &&
      (edits[term.marathi]?.designation ?? term.designation) ===
        term.designation,
  );

  return (
    <section className="card names-review">
      <CardTitle icon={UserCog} level={3} className="names-review-title">
        {STR.designationsTitle}
      </CardTitle>
      <p className="hint">{STR.designationsHint}</p>

      {/* The lookup is a paid call over the whole reviewed note and can take a few seconds,
          during which this card would otherwise be an empty box. A spinner beside the label
          says the names are still being found rather than that there are none — and the
          लेख तयार करा button is held until this finishes, so the wait has to be visible. */}
      {loading ? (
        <p className="translating-note" aria-live="polite">
          <span className="spinner" aria-hidden="true" />
          {STR.designationsLoading}
        </p>
      ) : null}

      {error ? (
        <div className="btn-row" style={{ marginTop: 12 }}>
          <ErrorNotice message={error} />
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

      {hasSuggested ? (
        <p className="hint names-suggest-hint">{STR.designationsSuggestHint}</p>
      ) : null}

      {hasFromText ? (
        <p className="hint names-suggest-hint">
          {STR.designationsFromTextHint}
        </p>
      ) : null}

      {verifyError ? <ErrorNotice message={verifyError} /> : null}

      {(names ?? []).map((term) => {
        const value = valueFor(term);
        // A suggestion is inert until ticked: the dictionary knows who holds an office, but
        // only the officer knows this meeting was that officeholder's.
        const accepted = value.accepted === true;
        const inactive = term.suggested && !accepted;
        return (
          <div
            key={term.marathi}
            className={[
              'names-review-row',
              term.verified ? 'is-verified' : 'is-unverified',
              term.suggested ? 'is-suggested' : '',
              inactive ? 'is-inactive' : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <div className="glossary-cell">
              <span className="glossary-field-label">
                {STR.designationsName}
              </span>
              {term.suggested ? (
                <label className="names-suggest-accept">
                  <input
                    type="checkbox"
                    checked={accepted}
                    onChange={(e) =>
                      onToggleAccepted(term.marathi, e.target.checked)
                    }
                    disabled={busy}
                  />
                  <span className="glossary-marathi">{term.marathi}</span>
                </label>
              ) : (
                <span className="glossary-marathi">{term.marathi}</span>
              )}
              {/* The phrase in the officer's own text that caused this suggestion. A suggested
                  person is by definition NOT named in the document, so without this the row is
                  unfalsifiable — the officer is asked to untick "if wrong" with nothing to
                  judge it against. Older API responses default `mention` to '' and simply show
                  nothing here. */}
              {term.suggested && term.mention ? (
                <span className="names-suggest-because">
                  {STR.designationsSuggestedFrom} “{term.mention}”{' '}
                  {STR.designationsSuggestedFromSuffix}
                </span>
              ) : null}
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
                disabled={busy || inactive}
              />
              {/* Shown only while the note's own wording is still what stands in the field —
                  the moment the officer edits it, it is theirs and the provenance tag would
                  be a lie. */}
              {term.fromText && value.designation === term.designation ? (
                <span className="names-from-text">
                  {STR.designationsFromText}
                </span>
              ) : null}
            </div>

            {/* Only offered once there is something to remember, and never on a suggestion the
                officer has not accepted — remembering an unconfirmed guess is the one write
                that could corrupt the dictionary this feature reads from. */}
            {value.designation.trim().length > 0 && !inactive ? (
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

            {/* The नाव-शब्दकोश's verified flag, reachable from the card the officer is already
                on. Not offered on an unaccepted suggestion — that name is not in play yet. */}
            {!term.verified && !inactive ? (
              <button
                type="button"
                className="btn btn-small"
                onClick={() => onVerify(term.marathi)}
                disabled={busy || verifying.includes(term.marathi)}
              >
                {verifying.includes(term.marathi)
                  ? STR.designationsVerifying
                  : STR.designationsVerify}
              </button>
            ) : null}

            {/* Keyed on `verified`, NOT `inGlossary`. The dictionary holding a row only means
                something extracted it once; "तपासले" is a claim that a human confirmed the
                spelling, and showing it for an unverified row both overstated it and hid the
                one row the officer could usefully act on. */}
            <span
              className={`chip ${
                !term.suggested && term.verified
                  ? 'chip-completed'
                  : 'chip-queued'
              }`}
            >
              {term.suggested
                ? STR.designationsSuggested
                : term.verified
                  ? STR.glossaryVerified
                  : STR.designationsNew}
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
              onChange={(e) =>
                onChangeExtra(i, { designation: e.target.value })
              }
              disabled={busy}
            />
          </div>
          {extra.designation.trim().length > 0 &&
          extra.name.trim().length > 0 ? (
            <label className="names-lock-toggle">
              <input
                type="checkbox"
                checked={extra.remember}
                onChange={(e) =>
                  onChangeExtra(i, { remember: e.target.checked })
                }
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
    // A dictionary suggestion (the note names the office, not the person) is included unless
    // the officer UNTICKS it. `?? term.suggested` rather than `?? false` is what makes the
    // pre-tick real: an untouched row has no edit entry at all, so a `false` fallback would
    // drop every suggestion the officer simply left alone — which is the exact behaviour
    // this replaced. An explicit `accepted: false` from an untick is a real `false` and
    // survives the `??`.
    const accepted = edit?.accepted ?? term.suggested;
    if (term.suggested && !accepted) continue;
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
