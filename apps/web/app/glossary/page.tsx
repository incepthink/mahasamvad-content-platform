'use client';

// Marathi-first glossary review page. Staff verify/correct the auto-mined
// Marathi->English name candidates a translation leaves behind (and add their own):
// only verified rows lock into future translations, so this is where name accuracy
// compounds — the "no more Donkey" review loop. Thin client over the /api/glossary
// routes; the API and DB do the real work.

import { useCallback, useEffect, useState } from 'react';
import type { GlossaryTerm, TermType } from '@dgipr/schemas';
import {
  createGlossaryTerm,
  deleteGlossaryTerm,
  listGlossaryTerms,
  updateGlossaryTerm,
} from '../../lib/api';
import { STR, TERM_TYPE_LABELS } from '../../lib/strings';

const TERM_TYPES: TermType[] = [
  'person',
  'designation',
  'scheme',
  'place',
  'org',
  'other',
];

function errText(e: unknown): string {
  return e instanceof Error ? e.message : STR.genericError;
}

// One reviewable row: Marathi (fixed key) | editable English | type | verify/delete.
function GlossaryRow({
  term,
  onChanged,
}: {
  term: GlossaryTerm;
  onChanged: () => void;
}) {
  const [english, setEnglish] = useState(term.english);
  const [hindi, setHindi] = useState(term.hindi ?? '');
  const [termType, setTermType] = useState<TermType>(term.termType);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty =
    english.trim() !== term.english ||
    hindi.trim() !== (term.hindi ?? '') ||
    termType !== term.termType;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const save = () =>
    run(() =>
      updateGlossaryTerm(term.id, {
        english: english.trim(),
        hindi: hindi.trim() || null,
        termType,
      }),
    );
  const toggleVerified = () =>
    run(() => updateGlossaryTerm(term.id, { verified: !term.verified }));
  const remove = () => {
    if (!window.confirm(STR.glossaryDeleteConfirm)) return;
    void run(() => deleteGlossaryTerm(term.id));
  };

  return (
    <div
      className={`glossary-row ${term.verified ? 'is-verified' : 'is-unverified'}`}
    >
      <div className="glossary-cell">
        <span className="glossary-field-label">{STR.glossaryMarathi}</span>
        <span className="glossary-marathi">{term.marathi}</span>
      </div>

      <div className="glossary-cell">
        <span className="glossary-field-label">{STR.glossaryEnglish}</span>
        <input
          type="text"
          value={english}
          onChange={(e) => setEnglish(e.target.value)}
          disabled={busy}
        />
      </div>

      <div className="glossary-cell">
        <span className="glossary-field-label">{STR.glossaryHindi}</span>
        <input
          type="text"
          value={hindi}
          onChange={(e) => setHindi(e.target.value)}
          disabled={busy}
        />
      </div>

      <div className="glossary-cell">
        <span className="glossary-field-label">{STR.glossaryType}</span>
        <select
          className="glossary-select"
          value={termType}
          onChange={(e) => setTermType(e.target.value as TermType)}
          disabled={busy}
        >
          {TERM_TYPES.map((t) => (
            <option key={t} value={t}>
              {TERM_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </div>

      <div className="glossary-row-actions">
        <span
          className={`chip ${term.verified ? 'chip-completed' : 'chip-queued'}`}
        >
          {term.verified ? STR.glossaryVerified : STR.glossaryUnverified}
        </span>
        {dirty ? (
          <button
            type="button"
            className="btn btn-small btn-primary"
            onClick={save}
            disabled={busy}
          >
            {busy ? STR.glossarySaving : STR.glossarySave}
          </button>
        ) : null}
        <button
          type="button"
          className="btn btn-small"
          onClick={toggleVerified}
          disabled={busy}
        >
          {term.verified ? STR.glossaryUnverify : STR.glossaryVerify}
        </button>
        <button
          type="button"
          className="btn btn-small"
          onClick={remove}
          disabled={busy}
        >
          {STR.glossaryDelete}
        </button>
        {error ? <span className="glossary-row-error">{error}</span> : null}
      </div>
    </div>
  );
}

function AddTermForm({ onAdded }: { onAdded: () => void }) {
  const [marathi, setMarathi] = useState('');
  const [english, setEnglish] = useState('');
  const [hindi, setHindi] = useState('');
  const [termType, setTermType] = useState<TermType>('person');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canAdd = marathi.trim().length > 0 && english.trim().length > 0;

  const add = async () => {
    if (!canAdd) return;
    setBusy(true);
    setError(null);
    try {
      await createGlossaryTerm({
        marathi: marathi.trim(),
        english: english.trim(),
        hindi: hindi.trim() || undefined,
        termType,
        verified: true,
      });
      setMarathi('');
      setEnglish('');
      setHindi('');
      setTermType('person');
      onAdded();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <h2>{STR.glossaryAddTitle}</h2>
      <div className="glossary-add">
        <div className="glossary-cell">
          <span className="glossary-field-label">{STR.glossaryMarathi}</span>
          <input
            type="text"
            value={marathi}
            placeholder={STR.glossaryMarathiPlaceholder}
            onChange={(e) => setMarathi(e.target.value)}
            disabled={busy}
          />
        </div>
        <div className="glossary-cell">
          <span className="glossary-field-label">{STR.glossaryEnglish}</span>
          <input
            type="text"
            value={english}
            placeholder={STR.glossaryEnglishPlaceholder}
            onChange={(e) => setEnglish(e.target.value)}
            disabled={busy}
          />
        </div>
        <div className="glossary-cell">
          <span className="glossary-field-label">{STR.glossaryHindi}</span>
          <input
            type="text"
            value={hindi}
            placeholder={STR.glossaryHindiPlaceholder}
            onChange={(e) => setHindi(e.target.value)}
            disabled={busy}
          />
        </div>
        <div className="glossary-cell">
          <span className="glossary-field-label">{STR.glossaryType}</span>
          <select
            className="glossary-select"
            value={termType}
            onChange={(e) => setTermType(e.target.value as TermType)}
            disabled={busy}
          >
            {TERM_TYPES.map((t) => (
              <option key={t} value={t}>
                {TERM_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          className="btn btn-primary glossary-add-btn"
          onClick={add}
          disabled={busy || !canAdd}
        >
          {busy ? STR.glossaryAdding : STR.glossaryAdd}
        </button>
      </div>
      {error ? <p className="form-error">{error}</p> : null}
    </div>
  );
}

export default function GlossaryPage() {
  const [terms, setTerms] = useState<GlossaryTerm[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<TermType | ''>('');
  const [unverifiedOnly, setUnverifiedOnly] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const params: { type?: TermType; search?: string } = {};
      if (typeFilter) params.type = typeFilter;
      if (search.trim()) params.search = search.trim();
      const items = await listGlossaryTerms(params);
      setTerms(items);
      setError(null);
    } catch (e) {
      setError(errText(e));
    }
  }, [typeFilter, search]);

  // Debounce so typing a search doesn't fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => void refresh(), 250);
    return () => clearTimeout(t);
  }, [refresh]);

  // "Unverified only" is a client-side view of the loaded list — the API filters
  // by verified=true, and the review focus here is the not-yet-verified rows.
  const shown = terms
    ? unverifiedOnly
      ? terms.filter((t) => !t.verified)
      : terms
    : null;

  return (
    <main className="page">
      <h1 className="page-title">{STR.glossaryTitle}</h1>
      <p className="hint" style={{ maxWidth: 760, marginBottom: 20 }}>
        {STR.glossaryIntro}
      </p>

      <AddTermForm onAdded={refresh} />

      <div className="card" style={{ marginTop: 24 }}>
        <div className="glossary-toolbar">
          <input
            type="text"
            value={search}
            placeholder={STR.glossarySearchPlaceholder}
            onChange={(e) => setSearch(e.target.value)}
            className="glossary-search"
          />
          <select
            className="glossary-select"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as TermType | '')}
          >
            <option value="">{STR.glossaryFilterAllTypes}</option>
            {TERM_TYPES.map((t) => (
              <option key={t} value={t}>
                {TERM_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
          <label className="glossary-checkbox">
            <input
              type="checkbox"
              checked={unverifiedOnly}
              onChange={(e) => setUnverifiedOnly(e.target.checked)}
            />
            {STR.glossaryUnverifiedOnly}
          </label>
          {shown ? (
            <span className="glossary-count">
              {STR.glossaryCount}: {shown.length}
            </span>
          ) : null}
        </div>

        {error ? <p className="form-error">{error}</p> : null}

        {shown && shown.length === 0 ? (
          <p className="hint">{STR.glossaryEmpty}</p>
        ) : null}

        {shown && shown.length > 0 ? (
          <div className="glossary-list">
            {shown.map((term) => (
              <GlossaryRow key={term.id} term={term} onChanged={refresh} />
            ))}
          </div>
        ) : null}
      </div>
    </main>
  );
}
