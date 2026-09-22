'use client';

// संपादकीय नियम — the review page for the /dlo lane's learned editorial rules (0057).
//
// WHY THIS PAGE IS THE GATE ON AUTOMATIC LEARNING. Phase 1 made a rule in the table steer
// every /dlo article; Phase 2 taught the platform to write those rules out of an officer's
// feedback, behind a default-off flag. The flag stayed off until this page existed for one
// reason: there is no auth here, so a rule learned from one officer's feedback binds every
// other officer's next article, and until it could be SEEN and TURNED OFF that was a change
// nobody could undo. That is what the notice at the top says out loud.
//
// Modelled on /glossary, which is the platform's other learned-knowledge admin surface — the
// glossary remembers what things are CALLED, this remembers how an article is WRITTEN — and
// built from `.page-head` / `.card` / the token scale rather than new markup, because this
// product has no UI library by choice.
//
// THE ONE PIECE OF REAL LOGIC IS THE IN-USE MARKER, and it is deliberately not computed
// here: only the top MAX_INJECTED_PREFERENCES rules of each category are sent to the model,
// so an active rule can be perfectly real and still not be followed. The API answers that
// with the very query the article runs (`injected`), and this page only renders the answer —
// re-ranking the rows in the browser would give the marker a second source of truth.

import { Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  MAX_INJECTED_PREFERENCES,
  PREFERENCE_RULE_MAX_CHARS,
  type EditorialPreference,
  type EditorialPreferenceScope,
  type EditorialPreferenceStatus,
  type InjectedPreferenceIds,
} from '@dgipr/schemas';
import { Pagination } from '../../components/Pagination';
import {
  createEditorialPreference,
  deleteEditorialPreference,
  listEditorialPreferences,
  updateEditorialPreference,
} from '../../lib/api';
import { STR } from '../../lib/strings';
import { ErrorNotice } from '../../components/ErrorNotice';
import { PageShell } from '../../components/common/PageShell';

const PAGE_SIZE = 20;

const SCOPES: readonly EditorialPreferenceScope[] = ['both', 'news', 'scheme'];

// Machine keys travel on the wire; every Marathi label lives in strings.ts. The scope labels
// are the ones the "memory updated" callout already uses, so a rule reads the same way on the
// article it was learned from and on this page.
const SCOPE_LABELS: Record<EditorialPreferenceScope, string> = {
  news: STR.learnedPrefsScopeNews,
  scheme: STR.learnedPrefsScopeScheme,
  both: STR.learnedPrefsScopeBoth,
};

const STATUS_LABELS: Record<EditorialPreferenceStatus, string> = {
  active: STR.prefsStatusActive,
  disabled: STR.prefsStatusDisabled,
  superseded: STR.prefsStatusSuperseded,
};

type StatusFilter = 'all' | EditorialPreferenceStatus;

const STATUS_FILTERS: ReadonlyArray<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: STR.prefsFilterAllStatuses },
  { value: 'active', label: STR.prefsStatusActive },
  { value: 'disabled', label: STR.prefsStatusDisabled },
  { value: 'superseded', label: STR.prefsStatusSuperseded },
];

/**
 * Where this rule stands with respect to the cap, as a chip.
 *
 * `null` for anything that is not active — a disabled or superseded rule already carries a
 * status chip saying so, and a second chip about the cap would only be answering a question
 * nobody asked. For an active rule the honest answer depends on its own scope: a `news` rule
 * has only one pool it can be in, so being in it IS "in use", while a `both` rule that made
 * one pool and not the other must say which.
 */
function injectionChip(
  preference: EditorialPreference,
  injected: InjectedPreferenceIds,
): { label: string; title: string; kind: 'in' | 'out' } | null {
  if (preference.status !== 'active') return null;
  const inNews = injected.news.includes(preference.id);
  const inScheme = injected.scheme.includes(preference.id);
  if (!inNews && !inScheme) {
    return {
      label: STR.prefsBeyondCap,
      title: STR.prefsBeyondCapTitle(MAX_INJECTED_PREFERENCES),
      kind: 'out',
    };
  }
  const partial =
    preference.scope === 'both' && inNews !== inScheme
      ? inNews
        ? STR.prefsInUseNewsOnly
        : STR.prefsInUseSchemeOnly
      : STR.prefsInUse;
  return { label: partial, title: STR.prefsInUseTitle, kind: 'in' };
}

function AddPreferenceFold({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [rule, setRule] = useState('');
  const [scope, setScope] = useState<EditorialPreferenceScope>('both');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const trimmed = rule.trim();
  const canAdd =
    trimmed.length > 0 && trimmed.length <= PREFERENCE_RULE_MAX_CHARS;

  const add = async () => {
    if (!canAdd) return;
    setBusy(true);
    setError(null);
    try {
      // `source` is not sent: a rule that arrives through this route was typed by a person,
      // which is exactly what the API records as `manual`.
      await createEditorialPreference({ rule: trimmed, scope });
      setRule('');
      setScope('both');
      setOpen(false);
      onAdded();
    } catch (caught) {
      setError(caught);
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
      <summary>{STR.prefsAddToggle}</summary>
      <div className="fold-body gl-add-body">
        <div className="pref-field">
          <label className="field-label" htmlFor="pref-add-rule">
            {STR.prefsRuleLabel}
          </label>
          <textarea
            id="pref-add-rule"
            rows={2}
            value={rule}
            placeholder={STR.prefsRulePlaceholder}
            maxLength={PREFERENCE_RULE_MAX_CHARS}
            onChange={(event) => setRule(event.target.value)}
            disabled={busy}
          />
          <p className="hint">{STR.prefsRuleHint}</p>
          <p className="hint pref-count">
            {STR.prefsRuleCount(rule.length, PREFERENCE_RULE_MAX_CHARS)}
          </p>
        </div>
        <div className="pref-field pref-scope-field">
          <label className="field-label" htmlFor="pref-add-scope">
            {STR.prefsScopeLabel}
          </label>
          <select
            id="pref-add-scope"
            className="glossary-select"
            value={scope}
            onChange={(event) =>
              setScope(event.target.value as EditorialPreferenceScope)
            }
            disabled={busy}
          >
            {SCOPES.map((value) => (
              <option key={value} value={value}>
                {SCOPE_LABELS[value]}
              </option>
            ))}
          </select>
        </div>
        <div className="btn-row gl-add-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void add()}
            disabled={busy || !canAdd}
          >
            {busy ? STR.prefsAdding : STR.prefsAdd}
          </button>
        </div>
        {error !== null ? <ErrorNotice error={error} /> : null}
      </div>
    </details>
  );
}

function PreferenceRow({
  preference,
  injected,
  onChanged,
}: {
  preference: EditorialPreference;
  injected: InjectedPreferenceIds;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [rule, setRule] = useState(preference.rule);
  const [scope, setScope] = useState<EditorialPreferenceScope>(
    preference.scope,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setRule(preference.rule);
    setScope(preference.scope);
  }, [preference.rule, preference.scope]);

  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(false), 2000);
    return () => clearTimeout(timer);
  }, [saved]);

  const trimmed = rule.trim();
  const dirty = trimmed !== preference.rule || scope !== preference.scope;
  const canSave =
    trimmed.length > 0 && trimmed.length <= PREFERENCE_RULE_MAX_CHARS;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };

  const save = () =>
    void run(async () => {
      await updateEditorialPreference(preference.id, { rule: trimmed, scope });
      setSaved(true);
      setEditing(false);
    });

  // Disabling is the ordinary way to stop a rule, and it keeps the row — which is what makes
  // it reversible and what keeps "why did the article read like that in August?" answerable.
  const toggleStatus = () =>
    void run(() =>
      updateEditorialPreference(preference.id, {
        status: preference.status === 'active' ? 'disabled' : 'active',
      }),
    );

  const remove = () => {
    if (!window.confirm(STR.prefsDeleteConfirm)) return;
    void run(() => deleteEditorialPreference(preference.id));
  };

  const cancel = () => {
    setRule(preference.rule);
    setScope(preference.scope);
    setError(null);
    setEditing(false);
  };

  const chip = injectionChip(preference, injected);
  const statusClass =
    preference.status === 'active'
      ? 'is-active'
      : preference.status === 'disabled'
        ? 'is-disabled'
        : 'is-superseded';

  return (
    <div className={`pref-row ${statusClass}${editing ? ' is-open' : ''}`}>
      <div className="pref-row-head">
        <div className="pref-row-main">
          <p className="pref-rule" lang="mr">
            {preference.rule}
          </p>
          <div className="pref-row-tags">
            <span className="chip pref-scope-chip">
              {SCOPE_LABELS[preference.scope]}
            </span>
            {preference.status !== 'active' ? (
              <span className="chip chip-queued">
                {STATUS_LABELS[preference.status]}
              </span>
            ) : null}
            {chip ? (
              <span
                className={`chip ${chip.kind === 'in' ? 'chip-completed' : 'pref-chip-capped'}`}
                title={chip.title}
              >
                {chip.label}
              </span>
            ) : null}
            <span className="pref-meta-item">
              {preference.source === 'learned'
                ? STR.prefsSourceLearned
                : STR.prefsSourceManual}
            </span>
            {preference.reinforcementCount > 1 ? (
              <span className="pref-meta-item">
                {STR.prefsReinforcement(preference.reinforcementCount)}
              </span>
            ) : null}
          </div>
        </div>
        <div className="pref-row-actions">
          {!editing ? (
            <>
              <button
                type="button"
                className="btn btn-small"
                onClick={() => setEditing(true)}
                disabled={busy}
              >
                {STR.prefsEdit}
              </button>
              {/* A superseded rule is history: it was replaced rather than turned off, so
                  offering to "turn it on" would put two versions of one rule in front of
                  the model at once. */}
              {preference.status !== 'superseded' ? (
                <button
                  type="button"
                  className="btn btn-small"
                  onClick={toggleStatus}
                  disabled={busy}
                >
                  {preference.status === 'active'
                    ? STR.prefsDisable
                    : STR.prefsEnable}
                </button>
              ) : null}
            </>
          ) : null}
          <button
            type="button"
            className="btn btn-small btn-danger-ghost pref-delete-btn"
            onClick={remove}
            disabled={busy}
            aria-label={STR.prefsDelete}
            title={STR.prefsDelete}
          >
            <Trash2 size={16} aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Provenance. A learned rule was never typed by anyone, so without the feedback that
          produced it an officer reading the list has no way to judge whether it says what
          the department meant. The generation link is best-effort by construction: 0057's
          FK is `on delete set null`, so a run that has since been removed leaves the words
          behind without the link. */}
      {preference.sourceFeedback ? (
        <div className="pref-provenance">
          <span className="field-label">{STR.prefsSourceFeedbackLabel}</span>
          <blockquote className="pref-feedback" lang="mr">
            {preference.sourceFeedback}
          </blockquote>
          {preference.sourceGenerationId ? (
            <Link
              className="pref-generation-link"
              href={`/generations/${preference.sourceGenerationId}`}
            >
              {STR.prefsViewGeneration}
            </Link>
          ) : null}
        </div>
      ) : null}

      {preference.status === 'superseded' ? (
        <p className="hint">{STR.prefsSupersededBy}</p>
      ) : null}

      {editing ? (
        <div className="pref-row-form">
          <div className="pref-field">
            <label className="field-label" htmlFor={`pref-rule-${preference.id}`}>
              {STR.prefsRuleLabel}
            </label>
            <textarea
              id={`pref-rule-${preference.id}`}
              rows={2}
              value={rule}
              maxLength={PREFERENCE_RULE_MAX_CHARS}
              onChange={(event) => setRule(event.target.value)}
              disabled={busy}
            />
            <p className="hint pref-count">
              {STR.prefsRuleCount(rule.length, PREFERENCE_RULE_MAX_CHARS)}
            </p>
          </div>
          <div className="pref-field pref-scope-field">
            <label
              className="field-label"
              htmlFor={`pref-scope-${preference.id}`}
            >
              {STR.prefsScopeLabel}
            </label>
            <select
              id={`pref-scope-${preference.id}`}
              className="glossary-select"
              value={scope}
              onChange={(event) =>
                setScope(event.target.value as EditorialPreferenceScope)
              }
              disabled={busy}
            >
              {SCOPES.map((value) => (
                <option key={value} value={value}>
                  {SCOPE_LABELS[value]}
                </option>
              ))}
            </select>
          </div>
          <div className="btn-row pref-row-form-actions">
            <button
              type="button"
              className="btn btn-small btn-primary"
              onClick={save}
              disabled={busy || !dirty || !canSave}
            >
              {busy ? STR.prefsSaving : STR.prefsSave}
            </button>
            <button
              type="button"
              className="btn btn-small"
              onClick={cancel}
              disabled={busy}
            >
              {STR.prefsCancel}
            </button>
            {saved ? (
              <span className="gl-saved" role="status">
                {STR.prefsSaved}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      {error !== null ? (
        <ErrorNotice error={error} className="pref-row-error" />
      ) : null}
    </div>
  );
}

function PreferenceSkeleton() {
  return (
    <div className="pref-list" aria-busy="true">
      <span className="gl-loading-label">{STR.prefsLoading}</span>
      {Array.from({ length: 4 }, (_, index) => (
        <div key={index} className="pref-row pref-row-skeleton">
          <div
            className="skeleton skeleton-line"
            style={{ width: `${80 - index * 6}%` }}
          />
          <div
            className="skeleton skeleton-line"
            style={{ width: `${45 - index * 4}%` }}
          />
        </div>
      ))}
    </div>
  );
}

const EMPTY_INJECTED: InjectedPreferenceIds = { news: [], scheme: [] };

export default function PreferencesPage() {
  const [items, setItems] = useState<EditorialPreference[] | null>(null);
  const [injected, setInjected] =
    useState<InjectedPreferenceIds>(EMPTY_INJECTED);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<unknown>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [scopeFilter, setScopeFilter] = useState<EditorialPreferenceScope | ''>(
    '',
  );
  const [page, setPage] = useState(1);

  const refresh = useCallback(async () => {
    setItems(null);
    setError(null);
    try {
      const params: {
        status?: EditorialPreferenceStatus;
        scope?: EditorialPreferenceScope;
        limit: number;
        offset: number;
      } = { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE };
      if (statusFilter !== 'all') params.status = statusFilter;
      if (scopeFilter) params.scope = scopeFilter;
      const result = await listEditorialPreferences(params);
      setItems(result.items);
      setInjected(result.injected);
      setTotal(result.total);
    } catch (caught) {
      setError(caught);
    }
  }, [page, scopeFilter, statusFilter]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  const changeStatusFilter = (value: StatusFilter) => {
    setStatusFilter(value);
    setPage(1);
  };

  const changeScopeFilter = (value: EditorialPreferenceScope | '') => {
    setScopeFilter(value);
    setPage(1);
  };

  const start = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const end = items
    ? Math.min(start + items.length - 1, total)
    : Math.min(page * PAGE_SIZE, total);
  const hasActiveFilter = statusFilter !== 'all' || scopeFilter !== '';

  return (
    <PageShell
      background="preferences"
      title={STR.prefsTitle}
      subtitle={STR.prefsIntro}
    >
      <p className="info-callout">{STR.prefsSharedNotice}</p>

      <AddPreferenceFold onAdded={() => void refresh()} />

      <div className="card gl-card">
        {error !== null ? (
          <ErrorNotice
            error={error}
            fallback={STR.prefsLoadFailed}
            onRetry={() => void refresh()}
          />
        ) : null}

        <div className="gl-toolbar">
          <div className="gl-status">
            {STATUS_FILTERS.map((status) => (
              <button
                key={status.value}
                type="button"
                aria-pressed={statusFilter === status.value}
                onClick={() => changeStatusFilter(status.value)}
              >
                {status.label}
              </button>
            ))}
          </div>
          <select
            className="glossary-select"
            aria-label={STR.prefsScopeLabel}
            value={scopeFilter}
            onChange={(event) =>
              changeScopeFilter(
                event.target.value as EditorialPreferenceScope | '',
              )
            }
          >
            <option value="">{STR.prefsFilterAllScopes}</option>
            {SCOPES.map((value) => (
              <option key={value} value={value}>
                {SCOPE_LABELS[value]}
              </option>
            ))}
          </select>
          <span className="gl-count">
            {items === null && error === null
              ? STR.prefsLoading
              : `${STR.prefsShowing} ${start}–${end} · ${STR.prefsCount}: ${total}`}
          </span>
        </div>

        <p className="hint pref-cap-note">
          {STR.prefsCapNote(MAX_INJECTED_PREFERENCES)}
        </p>

        {items === null && error === null ? <PreferenceSkeleton /> : null}

        {items && items.length === 0 ? (
          <p className="hint">
            {hasActiveFilter ? STR.prefsNoResults : STR.prefsEmpty}
          </p>
        ) : null}

        {items && items.length > 0 ? (
          <div className="pref-list" aria-live="polite">
            {items.map((preference) => (
              <PreferenceRow
                key={preference.id}
                preference={preference}
                injected={injected}
                onChanged={() => void refresh()}
              />
            ))}
          </div>
        ) : null}

        {pageCount > 1 ? (
          <Pagination page={page} pageCount={pageCount} onChange={setPage} />
        ) : null}
      </div>
    </PageShell>
  );
}
