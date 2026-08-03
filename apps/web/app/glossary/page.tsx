'use client';

// Marathi-first glossary review page. Staff verify/correct the auto-mined name
// candidates a translation leaves behind. Verified rows become translation locks.

import { Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GlossaryTerm, TermType } from '@dgipr/schemas';
import { Pagination } from '../../components/Pagination';
import {
  createGlossaryTerm,
  deleteGlossaryTerm,
  listGlossaryTerms,
  updateGlossaryTerm,
} from '../../lib/api';
import { STR, TERM_TYPE_LABELS } from '../../lib/strings';

const PAGE_SIZE = 20;
const TERM_TYPES: TermType[] = [
  'person',
  'designation',
  'scheme',
  'place',
  'org',
  'other',
];

type StatusFilter = 'all' | 'unverified' | 'verified';

function errText(error: unknown): string {
  return error instanceof Error ? error.message : STR.genericError;
}

function AddTermFold({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [marathi, setMarathi] = useState('');
  const [english, setEnglish] = useState('');
  const [hindi, setHindi] = useState('');
  const [designation, setDesignation] = useState('');
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
        // Only a person carries a designation, and an omitted value stays omitted
        // for databases that have not received the designation migration yet.
        ...(termType === 'person' && designation.trim()
          ? { designation: designation.trim() }
          : {}),
        termType,
        verified: true,
      });
      setMarathi('');
      setEnglish('');
      setHindi('');
      setDesignation('');
      setTermType('person');
      setOpen(false);
      onAdded();
    } catch (caught) {
      setError(errText(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <details
      className="fold gl-add-fold"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>{STR.glossaryAddToggle}</summary>
      <div className="fold-body gl-add-body">
        <div className="gl-form-grid">
          <div className="gl-field">
            <label className="field-label" htmlFor="gl-add-marathi">
              {STR.glossaryMarathi}
            </label>
            <input
              id="gl-add-marathi"
              type="text"
              value={marathi}
              placeholder={STR.glossaryMarathiPlaceholder}
              onChange={(event) => setMarathi(event.target.value)}
              disabled={busy}
            />
          </div>
          <div className="gl-field">
            <label className="field-label" htmlFor="gl-add-english">
              {STR.glossaryEnglish}
            </label>
            <input
              id="gl-add-english"
              type="text"
              value={english}
              placeholder={STR.glossaryEnglishPlaceholder}
              onChange={(event) => setEnglish(event.target.value)}
              disabled={busy}
            />
          </div>
          <div className="gl-field">
            <label className="field-label" htmlFor="gl-add-hindi">
              {STR.glossaryHindi}
            </label>
            <input
              id="gl-add-hindi"
              type="text"
              value={hindi}
              placeholder={STR.glossaryHindiPlaceholder}
              onChange={(event) => setHindi(event.target.value)}
              disabled={busy}
            />
          </div>
          {termType === 'person' ? (
            <div className="gl-field">
              <label className="field-label" htmlFor="gl-add-designation">
                {STR.designationsDesignation}
              </label>
              <input
                id="gl-add-designation"
                type="text"
                value={designation}
                placeholder={STR.designationsPlaceholder}
                onChange={(event) => setDesignation(event.target.value)}
                disabled={busy}
              />
            </div>
          ) : null}
          <div className="gl-field">
            <label className="field-label" htmlFor="gl-add-type">
              {STR.glossaryType}
            </label>
            <select
              id="gl-add-type"
              className="glossary-select"
              value={termType}
              onChange={(event) => setTermType(event.target.value as TermType)}
              disabled={busy}
            >
              {TERM_TYPES.map((type) => (
                <option key={type} value={type}>
                  {TERM_TYPE_LABELS[type]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="btn-row gl-add-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void add()}
            disabled={busy || !canAdd}
          >
            {busy ? STR.glossaryAdding : STR.glossaryAdd}
          </button>
        </div>
        {error ? <p className="form-error">{error}</p> : null}
      </div>
    </details>
  );
}

function GlossaryToolbar({
  search,
  onSearch,
  typeFilter,
  onTypeFilter,
  statusFilter,
  onStatusFilter,
  itemsLoading,
  start,
  end,
  total,
}: {
  search: string;
  onSearch: (value: string) => void;
  typeFilter: TermType | '';
  onTypeFilter: (value: TermType | '') => void;
  statusFilter: StatusFilter;
  onStatusFilter: (value: StatusFilter) => void;
  itemsLoading: boolean;
  start: number;
  end: number;
  total: number;
}) {
  const statuses: ReadonlyArray<{
    value: StatusFilter;
    label: string;
  }> = [
    { value: 'all', label: STR.glossaryStatusAll },
    { value: 'unverified', label: STR.glossaryStatusUnverified },
    { value: 'verified', label: STR.glossaryStatusVerified },
  ];

  return (
    <div className="gl-toolbar">
      <input
        type="text"
        value={search}
        placeholder={STR.glossarySearchPlaceholder}
        onChange={(event) => onSearch(event.target.value)}
        className="gl-search"
      />
      <select
        className="glossary-select"
        value={typeFilter}
        onChange={(event) => onTypeFilter(event.target.value as TermType | '')}
      >
        <option value="">{STR.glossaryFilterAllTypes}</option>
        {TERM_TYPES.map((type) => (
          <option key={type} value={type}>
            {TERM_TYPE_LABELS[type]}
          </option>
        ))}
      </select>
      <div className="gl-status">
        {statuses.map((status) => (
          <button
            key={status.value}
            type="button"
            aria-pressed={statusFilter === status.value}
            onClick={() => onStatusFilter(status.value)}
          >
            {status.label}
          </button>
        ))}
      </div>
      <span className="gl-count">
        {itemsLoading
          ? STR.glossaryLoading
          : `${STR.glossaryShowing} ${start}–${end} · ${STR.glossaryCount}: ${total}`}
      </span>
    </div>
  );
}

function BulkVerifyBar({
  selectedCount,
  allSelected,
  busy,
  onToggleAll,
  onVerify,
  onClear,
}: {
  selectedCount: number;
  allSelected: boolean;
  busy: boolean;
  onToggleAll: () => void;
  onVerify: () => void;
  onClear: () => void;
}) {
  return (
    <div className="gl-bulk-bar">
      <label className="gl-check-label">
        <input
          type="checkbox"
          checked={allSelected}
          onChange={onToggleAll}
          disabled={busy}
        />
        {STR.glossarySelectAllUnverified}
      </label>
      <strong>
        {selectedCount} {STR.glossaryBulkSelected}
      </strong>
      <div className="btn-row gl-bulk-actions">
        <button
          type="button"
          className="btn btn-small btn-primary"
          onClick={onVerify}
          disabled={busy}
        >
          {busy ? STR.glossaryBulkBusy : STR.glossaryBulkVerify}
        </button>
        <button
          type="button"
          className="btn btn-small"
          onClick={onClear}
          disabled={busy}
        >
          {STR.glossaryBulkClear}
        </button>
      </div>
    </div>
  );
}

function GlossaryTermRow({
  term,
  selected,
  selectionDisabled,
  onSelected,
  onChanged,
}: {
  term: GlossaryTerm;
  selected: boolean;
  selectionDisabled: boolean;
  onSelected: (id: string, checked: boolean) => void;
  onChanged: () => void;
}) {
  const [expanded, setExpanded] = useState(!term.verified);
  const [english, setEnglish] = useState(term.english);
  const [hindi, setHindi] = useState(term.hindi ?? '');
  const [designation, setDesignation] = useState(term.designation ?? '');
  const [termType, setTermType] = useState<TermType>(term.termType);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setEnglish(term.english);
    setHindi(term.hindi ?? '');
    setDesignation(term.designation ?? '');
    setTermType(term.termType);
  }, [term.designation, term.english, term.hindi, term.termType]);

  useEffect(() => {
    setExpanded(!term.verified);
  }, [term.verified]);

  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(false), 2000);
    return () => clearTimeout(timer);
  }, [saved]);

  const dirty =
    english.trim() !== term.english ||
    hindi.trim() !== (term.hindi ?? '') ||
    designation.trim() !== (term.designation ?? '') ||
    termType !== term.termType;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (caught) {
      setError(errText(caught));
    } finally {
      setBusy(false);
    }
  };

  const save = () =>
    void run(async () => {
      await updateGlossaryTerm(term.id, {
        english: english.trim(),
        hindi: hindi.trim() || null,
        designation: termType === 'person' ? designation.trim() || null : null,
        termType,
      });
      setSaved(true);
    });

  const toggleVerified = () =>
    void run(async () => {
      await updateGlossaryTerm(term.id, { verified: !term.verified });
      setExpanded(term.verified);
    });

  const remove = () => {
    if (!window.confirm(STR.glossaryDeleteConfirm)) return;
    void run(() => deleteGlossaryTerm(term.id));
  };

  const cancel = () => {
    setEnglish(term.english);
    setHindi(term.hindi ?? '');
    setDesignation(term.designation ?? '');
    setTermType(term.termType);
    setError(null);
    setExpanded(!term.verified);
  };

  return (
    <div
      className={`gl-row${term.verified ? ' is-verified' : ' is-review'}${expanded ? ' is-open' : ''}`}
    >
      <div className="gl-row-head">
        {!term.verified ? (
          <input
            type="checkbox"
            className="gl-row-check"
            checked={selected}
            aria-label={`${STR.glossaryBulkSelected}: ${term.marathi}`}
            onChange={(event) => onSelected(term.id, event.target.checked)}
            disabled={busy || selectionDisabled}
          />
        ) : null}
        <div className="gl-row-term">
          <div className="glossary-marathi">{term.marathi}</div>
          <div className="gl-term-sub">
            <span>
              {STR.glossaryEnglish}: {term.english}
            </span>
            {term.hindi ? (
              <span>
                {STR.glossaryHindi}: {term.hindi}
              </span>
            ) : null}
            {term.designation ? (
              <span>
                {STR.designationsDesignation}: {term.designation}
              </span>
            ) : null}
          </div>
        </div>
        <div className="gl-row-tags">
          <span className="chip gl-type-chip">
            {TERM_TYPE_LABELS[term.termType]}
          </span>
          <span
            className={`chip ${term.verified ? 'chip-completed' : 'chip-queued'}`}
          >
            {term.verified ? STR.glossaryVerified : STR.glossaryUnverified}
          </span>
        </div>
        <div className="gl-row-actions">
          {!expanded ? (
            <>
              <button
                type="button"
                className="btn btn-small"
                onClick={() => setExpanded(true)}
                disabled={busy}
              >
                {STR.glossaryEdit}
              </button>
              <button
                type="button"
                className="btn btn-small"
                onClick={toggleVerified}
                disabled={busy}
              >
                {term.verified ? STR.glossaryUnverify : STR.glossaryVerify}
              </button>
            </>
          ) : null}
          <button
            type="button"
            className="btn btn-small btn-danger-ghost gl-delete-btn"
            onClick={remove}
            disabled={busy}
            aria-label={STR.glossaryDelete}
            title={STR.glossaryDelete}
          >
            <Trash2 size={16} aria-hidden="true" />
          </button>
        </div>
      </div>

      {expanded ? (
        <div className="gl-row-form">
          <div className="gl-field">
            <label className="field-label" htmlFor={`gl-english-${term.id}`}>
              {STR.glossaryEnglish}
            </label>
            <input
              id={`gl-english-${term.id}`}
              type="text"
              value={english}
              onChange={(event) => setEnglish(event.target.value)}
              disabled={busy}
            />
          </div>
          <div className="gl-field">
            <label className="field-label" htmlFor={`gl-hindi-${term.id}`}>
              {STR.glossaryHindi}
            </label>
            <input
              id={`gl-hindi-${term.id}`}
              type="text"
              value={hindi}
              onChange={(event) => setHindi(event.target.value)}
              disabled={busy}
            />
          </div>
          {termType === 'person' ? (
            <div className="gl-field">
              <label
                className="field-label"
                htmlFor={`gl-designation-${term.id}`}
              >
                {STR.designationsDesignation}
              </label>
              <input
                id={`gl-designation-${term.id}`}
                type="text"
                value={designation}
                placeholder={STR.designationsPlaceholder}
                onChange={(event) => setDesignation(event.target.value)}
                disabled={busy}
              />
            </div>
          ) : null}
          <div className="gl-field">
            <label className="field-label" htmlFor={`gl-type-${term.id}`}>
              {STR.glossaryType}
            </label>
            <select
              id={`gl-type-${term.id}`}
              className="glossary-select"
              value={termType}
              onChange={(event) => setTermType(event.target.value as TermType)}
              disabled={busy}
            >
              {TERM_TYPES.map((type) => (
                <option key={type} value={type}>
                  {TERM_TYPE_LABELS[type]}
                </option>
              ))}
            </select>
          </div>
          <div className="btn-row gl-row-form-actions">
            {dirty ? (
              <button
                type="button"
                className="btn btn-small btn-primary"
                onClick={save}
                disabled={busy || english.trim().length === 0}
              >
                {busy ? STR.glossarySaving : STR.glossarySave}
              </button>
            ) : null}
            <button
              type="button"
              className="btn btn-small"
              onClick={cancel}
              disabled={busy}
            >
              {STR.glossaryCancel}
            </button>
            <button
              type="button"
              className="btn btn-small"
              onClick={toggleVerified}
              disabled={busy}
            >
              {term.verified ? STR.glossaryUnverify : STR.glossaryVerify}
            </button>
            {saved ? (
              <span className="gl-saved" role="status">
                {STR.glossarySaved}
              </span>
            ) : null}
          </div>
          {error ? <p className="form-error gl-row-error">{error}</p> : null}
        </div>
      ) : error ? (
        <p className="form-error gl-row-error">{error}</p>
      ) : null}
    </div>
  );
}

function GlossarySkeleton() {
  return (
    <div className="gl-list" aria-busy="true">
      <span className="gl-loading-label">{STR.glossaryLoading}</span>
      {Array.from({ length: 5 }, (_, index) => (
        <div key={index} className="gl-row gl-row-skeleton">
          <div
            className="skeleton skeleton-line"
            style={{ width: `${70 - index * 5}%` }}
          />
          <div
            className="skeleton skeleton-line"
            style={{ width: `${50 - index * 4}%` }}
          />
        </div>
      ))}
    </div>
  );
}

export default function GlossaryPage() {
  const [items, setItems] = useState<GlossaryTerm[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<TermType | ''>('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const requestId = useRef(0);

  const refresh = useCallback(async () => {
    const currentRequest = ++requestId.current;
    setItems(null);
    setError(null);
    try {
      const params: {
        verified?: boolean;
        type?: TermType;
        search?: string;
        limit: number;
        offset: number;
      } = {
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      };
      if (statusFilter !== 'all') params.verified = statusFilter === 'verified';
      if (typeFilter) params.type = typeFilter;
      if (appliedSearch) params.search = appliedSearch;
      const result = await listGlossaryTerms(params);
      if (currentRequest !== requestId.current) return;
      setItems(result.items);
      setTotal(result.total);
    } catch (caught) {
      if (currentRequest !== requestId.current) return;
      setError(errText(caught));
    }
  }, [appliedSearch, page, statusFilter, typeFilter]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setAppliedSearch(search.trim());
      setPage(1);
      setSelected(new Set());
    }, 200);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    setSelected(new Set());
  }, [page]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  const changeTypeFilter = (value: TermType | '') => {
    setTypeFilter(value);
    setPage(1);
    setSelected(new Set());
  };

  const changeStatusFilter = (value: StatusFilter) => {
    setStatusFilter(value);
    setPage(1);
    setSelected(new Set());
  };

  const afterMutation = useCallback(() => {
    setSelected(new Set());
    setBulkError(null);
    void refresh();
  }, [refresh]);

  const setRowSelected = (id: string, checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const unverifiedIds = useMemo(
    () => (items ?? []).filter((term) => !term.verified).map((term) => term.id),
    [items],
  );
  const allSelected =
    unverifiedIds.length > 0 && unverifiedIds.every((id) => selected.has(id));

  const toggleAll = () => {
    setSelected((current) => {
      const next = new Set(current);
      if (allSelected) {
        unverifiedIds.forEach((id) => next.delete(id));
      } else {
        unverifiedIds.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  const bulkVerify = async () => {
    setBulkBusy(true);
    setBulkError(null);
    let failures = 0;
    for (const id of selected) {
      try {
        await updateGlossaryTerm(id, { verified: true });
      } catch {
        failures += 1;
      }
    }
    setBulkBusy(false);
    setSelected(new Set());
    if (failures > 0) setBulkError(STR.glossaryBulkPartial);
    void refresh();
  };

  const start = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const end = items
    ? Math.min(start + items.length - 1, total)
    : Math.min(page * PAGE_SIZE, total);
  const hasActiveFilter =
    search.trim().length > 0 || typeFilter !== '' || statusFilter !== 'all';

  return (
    <main className="page">
      <header className="page-head">
        <div className="page-head-text">
          <h1 className="page-title">{STR.glossaryTitle}</h1>
          <p className="page-sub">{STR.glossaryIntro}</p>
        </div>
      </header>

      <AddTermFold onAdded={afterMutation} />

      <div className="card gl-card">
        {error ? <p className="form-error">{error}</p> : null}

        <GlossaryToolbar
          search={search}
          onSearch={setSearch}
          typeFilter={typeFilter}
          onTypeFilter={changeTypeFilter}
          statusFilter={statusFilter}
          onStatusFilter={changeStatusFilter}
          itemsLoading={items === null && !error}
          start={start}
          end={end}
          total={total}
        />

        {bulkError ? <p className="form-error">{bulkError}</p> : null}

        {selected.size > 0 ? (
          <BulkVerifyBar
            selectedCount={selected.size}
            allSelected={allSelected}
            busy={bulkBusy}
            onToggleAll={toggleAll}
            onVerify={() => void bulkVerify()}
            onClear={() => setSelected(new Set())}
          />
        ) : null}

        {items === null && !error ? <GlossarySkeleton /> : null}

        {items && items.length === 0 ? (
          <p className="hint">
            {hasActiveFilter ? STR.glossaryNoResults : STR.glossaryEmpty}
          </p>
        ) : null}

        {items && items.length > 0 ? (
          <div className="gl-list" aria-live="polite">
            {items.map((term) => (
              <GlossaryTermRow
                key={term.id}
                term={term}
                selected={selected.has(term.id)}
                selectionDisabled={bulkBusy}
                onSelected={setRowSelected}
                onChanged={afterMutation}
              />
            ))}
          </div>
        ) : null}

        {pageCount > 1 ? (
          <Pagination page={page} pageCount={pageCount} onChange={setPage} />
        ) : null}
      </div>
    </main>
  );
}
