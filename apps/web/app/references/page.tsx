'use client';

// Master-template library. Each poster type (builtin or custom) holds a rotation
// of images: every image marked "वापरात" (enabled) can be picked at random for a
// generation, so several may be enabled at once. Custom twitter types carry their
// own name + classifier description and can be created/deleted here.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ImageIcon,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Type,
  Upload,
} from 'lucide-react';
import type {
  ReferenceCategory,
  ReferenceImage,
  ReferenceType,
} from '@dgipr/schemas';
import {
  analyzeReferenceImage,
  createReferenceType,
  deleteReferenceImage,
  deleteReferenceType,
  listReferenceImages,
  listReferenceTypes,
  setReferenceImageEnabled,
  setReferenceImagePhotoZone,
  updateReferenceImageLayoutSpec,
  updateReferenceType,
  uploadReferenceImage,
} from '../../lib/api';
import {
  HighlightedText,
  ReferenceSearchBar,
  UnanalyzedNote,
} from '../../components/ReferenceSearchBar';
import {
  NO_FILTERS,
  highlightRanges,
  searchReferences,
  type ReferenceFilters,
  type SearchableReference,
} from '../../lib/referenceSearch';
import { REF_CATEGORY_LABELS, STR } from '../../lib/strings';

const ACCEPTED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const DATE_FORMAT = new Intl.DateTimeFormat('mr-IN', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

function errText(error: unknown): string {
  return error instanceof Error ? error.message : STR.genericError;
}

// What the vision pass read off this master. Two fields here are consequential and
// therefore surfaced (not buried) and correctable by hand: hasPhotoZone, which stops
// the image model painting a hero photograph onto a text-only template; and the
// subject line, which the reference ranker matches a note against — a vague read
// there quietly picks the wrong template on every future run, and re-rolling the
// vision pass is not a reliable fix for a vague answer.
function LayoutBadge({
  image,
  disabled,
  query,
  onRecheck,
  onFlip,
  onSaveAbout,
}: {
  image: ReferenceImage;
  disabled: boolean;
  // The live search query, so the words that put this tile on screen are marked in the
  // very lines they matched. Both summaries are shown here in full (unlike the picker's
  // windowed snippet) — this is the page where they are edited.
  query: string;
  onRecheck: () => void;
  onFlip: () => void;
  onSaveAbout: (contentSummary: string) => Promise<boolean>;
}) {
  const spec = image.layoutSpec;
  const [editingAbout, setEditingAbout] = useState(false);
  const [aboutDraft, setAboutDraft] = useState(spec?.contentSummary ?? '');

  if (!spec) {
    return (
      <div className="ref-layout ref-layout-unknown">
        <span className="ref-layout-row">
          <span className="chip chip-queued">{STR.refLayoutUnknown}</span>
          <button
            type="button"
            className="btn btn-small"
            disabled={disabled}
            onClick={onRecheck}
          >
            <RefreshCw size={14} strokeWidth={2} aria-hidden="true" />
            {disabled ? STR.refLayoutChecking : STR.refLayoutRecheck}
          </button>
        </span>
      </div>
    );
  }

  const Icon = spec.hasPhotoZone ? ImageIcon : Type;
  return (
    <div className="ref-layout">
      <span className="ref-layout-row">
        <span
          className={`chip ref-layout-chip ${spec.hasPhotoZone ? 'chip-running' : 'chip-completed'}`}
        >
          <Icon size={13} strokeWidth={2} aria-hidden="true" />
          {spec.hasPhotoZone ? STR.refLayoutWithPhoto : STR.refLayoutTextOnly}
        </span>
        {spec.bulletSlots > 0 ? (
          <span className="ref-layout-slots">
            {spec.bulletSlots} {STR.refLayoutSlots}
          </span>
        ) : null}
        <button
          type="button"
          className="btn btn-small"
          disabled={disabled}
          onClick={onRecheck}
          aria-label={STR.refLayoutRecheck}
        >
          <RefreshCw size={14} strokeWidth={2} aria-hidden="true" />
          {disabled ? STR.refLayoutChecking : STR.refLayoutRecheck}
        </button>
      </span>
      <p className="ref-layout-summary" title={spec.layoutSummary}>
        <HighlightedText
          text={spec.layoutSummary}
          highlights={highlightRanges(spec.layoutSummary, query)}
        />
      </p>
      {editingAbout ? (
        <div className="ref-layout-about-edit">
          <label className="field-label" htmlFor={`about-${image.id}`}>
            {STR.refLayoutAboutLabel}
          </label>
          <p className="hint">{STR.refLayoutAboutHint}</p>
          <textarea
            id={`about-${image.id}`}
            className="ref-desc-input"
            placeholder={STR.refLayoutAboutPlaceholder}
            value={aboutDraft}
            maxLength={400}
            disabled={disabled}
            onChange={(event) => setAboutDraft(event.target.value)}
          />
          <div className="btn-row">
            <button
              type="button"
              className="btn btn-small btn-primary"
              disabled={disabled}
              onClick={() => {
                void onSaveAbout(aboutDraft).then((ok) => {
                  if (ok) setEditingAbout(false);
                });
              }}
            >
              {disabled ? STR.refLayoutAboutSaving : STR.refLayoutAboutSave}
            </button>
            <button
              type="button"
              className="btn btn-small"
              disabled={disabled}
              onClick={() => {
                setEditingAbout(false);
                setAboutDraft(spec.contentSummary ?? '');
              }}
            >
              {STR.refLayoutAboutCancel}
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* The button sits OUTSIDE the paragraph: .ref-layout-summary clamps to
              two lines with overflow:hidden, which would swallow it on a long
              summary. */}
          <p
            className="ref-layout-summary ref-layout-about"
            title={spec.contentSummary ?? ''}
          >
            <strong>{STR.refLayoutAbout}</strong>{' '}
            {spec.contentSummary ? (
              <HighlightedText
                text={spec.contentSummary}
                highlights={highlightRanges(spec.contentSummary, query)}
              />
            ) : (
              <span className="ref-layout-about-empty">
                {STR.refLayoutAboutEmpty}
              </span>
            )}
          </p>
          <button
            type="button"
            className="ref-layout-flip"
            disabled={disabled}
            onClick={() => {
              setAboutDraft(spec.contentSummary ?? '');
              setEditingAbout(true);
            }}
          >
            {STR.refLayoutAboutEdit}
          </button>
        </>
      )}
      <button
        type="button"
        className="ref-layout-flip"
        disabled={disabled}
        onClick={onFlip}
      >
        {spec.hasPhotoZone
          ? STR.refLayoutFlipToTextOnly
          : STR.refLayoutFlipToPhoto}
      </button>
    </div>
  );
}

// One image tile: preview + date + layout reading + enable/disable/delete actions.
function ImageTile({
  image,
  typeLabel,
  disabled,
  query,
  dimmed = false,
  onToggle,
  onDelete,
  onRecheck,
  onFlip,
  onSaveAbout,
}: {
  image: ReferenceImage;
  typeLabel: string;
  disabled: boolean;
  query: string;
  // An un-analyzed master shown during a search: it is here because it CANNOT be
  // searched, not because it matched, and dimming is what keeps that distinction visible
  // in a grid where everything else did match.
  dimmed?: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onRecheck: () => void;
  onFlip: () => void;
  onSaveAbout: (contentSummary: string) => Promise<boolean>;
}) {
  return (
    <div
      className={`ref-thumb${image.isActive ? ' is-enabled' : ''}${dimmed ? ' is-unsearchable' : ''}`}
    >
      <div className={`ref-thumb-frame ref-thumb-frame-${image.category}`}>
        {/* Immutable library URLs are safe to render directly. */}
        <img src={image.url} alt={typeLabel} loading="lazy" />
        {image.isActive ? (
          <span className="ref-thumb-badge">{STR.refEnabled}</span>
        ) : null}
      </div>
      <div className="ref-thumb-meta">
        <span className="ref-thumb-date">
          {STR.refUploadedOn}: {DATE_FORMAT.format(new Date(image.createdAt))}
        </span>
        <LayoutBadge
          image={image}
          disabled={disabled}
          query={query}
          onRecheck={onRecheck}
          onFlip={onFlip}
          onSaveAbout={onSaveAbout}
        />
        <div className="ref-thumb-actions">
          <button
            type="button"
            className={`btn btn-small${image.isActive ? '' : ' btn-primary'}`}
            disabled={disabled}
            onClick={onToggle}
          >
            {image.isActive ? STR.refDisable : STR.refEnable}
          </button>
          <button
            type="button"
            className="btn btn-small btn-danger-ghost"
            disabled={disabled}
            onClick={onDelete}
            aria-label={STR.refDelete}
          >
            <Trash2 size={16} strokeWidth={2} aria-hidden="true" />
            {STR.refDelete}
          </button>
        </div>
      </div>
    </div>
  );
}

// One poster type: label + description (inline-editable), its image rotation,
// upload, and — for custom types — deletion of the whole type.
function TypeCard({
  type,
  images,
  unsearchable = [],
  query,
  searching = false,
  onChanged,
}: {
  type: ReferenceType;
  // Already filtered and ordered by the page. While searching this is the type's matches
  // in rank order; otherwise it is its whole rotation.
  images: ReferenceImage[];
  // This type's un-analyzed masters, shown only while searching — see UnanalyzedNote.
  unsearchable?: ReferenceImage[];
  query: string;
  searching?: boolean;
  onChanged: () => Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [labelDraft, setLabelDraft] = useState(type.labelMr);
  const [descDraft, setDescDraft] = useState(type.description);
  const [brandDraft, setBrandDraft] = useState(type.brand);

  // Reports whether the action succeeded, so a caller holding an open editor
  // (the subject-line one) keeps the operator's draft on screen after a failure
  // instead of closing over it.
  const run = async (fn: () => Promise<unknown>): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await onChanged();
      return true;
    } catch (caught) {
      setError(errText(caught));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const upload = (file: File | undefined) => {
    if (!file) return;
    if (!ACCEPTED_TYPES.has(file.type)) {
      setError(STR.refFileTypeError);
      return;
    }
    void run(() => uploadReferenceImage(type.category, type.slug, file));
  };

  const saveType = () => {
    void run(async () => {
      await updateReferenceType(type.id, {
        labelMr: labelDraft.trim(),
        description: descDraft.trim(),
        brand: brandDraft,
      });
      setEditing(false);
    });
  };

  const removeType = () => {
    if (!window.confirm(STR.refTypeDeleteConfirm)) return;
    void run(() => deleteReferenceType(type.id));
  };

  // While searching, the page has already ranked these by relevance — re-sorting here
  // would throw that away and put an exact subject-line hit below an enabled near-miss.
  const sorted = searching
    ? images
    : [...images].sort(
        (a, b) =>
          Number(b.isActive) - Number(a.isActive) ||
          b.createdAt.localeCompare(a.createdAt),
      );
  const shown = [...sorted, ...unsearchable];
  const enabledCount = images.filter((image) => image.isActive).length;

  return (
    <div className="card ref-type-card">
      <div className="ref-type-head">
        <div className="ref-type-title-row">
          <h3>{type.labelMr}</h3>
          {!type.isBuiltin ? (
            <span className="chip chip-running">{STR.refCustomChip}</span>
          ) : null}
          {type.brand === 'cmo' ? (
            <span className="chip chip-completed">{STR.refBrandChip}</span>
          ) : null}
          {enabledCount > 0 ? (
            <span className="chip chip-completed">
              {enabledCount} {STR.refEnabled}
            </span>
          ) : (
            <span className="chip chip-queued">{STR.refNoneEnabled}</span>
          )}
        </div>
        <div className="ref-type-head-actions">
          <button
            type="button"
            className="btn btn-small"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            <Upload size={16} strokeWidth={2} aria-hidden="true" />
            {busy ? STR.refUploading : STR.refUpload}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            onChange={(event) => {
              upload(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
        </div>
      </div>

      {editing ? (
        <div className="ref-edit-form">
          <div>
            <label className="field-label" htmlFor={`label-${type.id}`}>
              {STR.refTypeName}
            </label>
            <input
              id={`label-${type.id}`}
              type="text"
              value={labelDraft}
              maxLength={60}
              onChange={(event) => setLabelDraft(event.target.value)}
            />
          </div>
          <div>
            <label className="field-label" htmlFor={`desc-${type.id}`}>
              {STR.refTypeDesc}
            </label>
            <p className="hint">{STR.refTypeDescHint}</p>
            <textarea
              id={`desc-${type.id}`}
              className="ref-desc-input"
              value={descDraft}
              maxLength={300}
              onChange={(event) => setDescDraft(event.target.value)}
            />
          </div>
          <div>
            <label className="field-label" htmlFor={`brand-${type.id}`}>
              {STR.refBrandLabel}
            </label>
            <select
              id={`brand-${type.id}`}
              value={brandDraft}
              onChange={(event) =>
                setBrandDraft(event.target.value as ReferenceType['brand'])
              }
            >
              <option value="dgipr">{STR.refBrandDgipr}</option>
              <option value="cmo">{STR.refBrandCmo}</option>
            </select>
          </div>
          <div className="btn-row">
            <button
              type="button"
              className="btn btn-small btn-primary"
              disabled={
                busy ||
                labelDraft.trim().length === 0 ||
                descDraft.trim().length < 3
              }
              onClick={saveType}
            >
              {busy ? STR.refTypeSaving : STR.refTypeSave}
            </button>
            <button
              type="button"
              className="btn btn-small"
              disabled={busy}
              onClick={() => {
                setEditing(false);
                setLabelDraft(type.labelMr);
                setDescDraft(type.description);
                setBrandDraft(type.brand);
              }}
            >
              {STR.refTypeCancel}
            </button>
          </div>
        </div>
      ) : (
        <div className="ref-type-desc-row">
          {type.description ? (
            <p className="ref-type-desc">{type.description}</p>
          ) : (
            <p className="ref-type-desc is-empty">—</p>
          )}
          <button
            type="button"
            className="btn btn-small ref-edit-btn"
            disabled={busy}
            onClick={() => setEditing(true)}
          >
            <Pencil size={15} strokeWidth={2} aria-hidden="true" />
            {STR.refTypeEdit}
          </button>
        </div>
      )}

      {shown.length === 0 ? <p className="hint">{STR.refEmpty}</p> : null}
      {shown.length > 0 ? (
        <div className="ref-thumb-grid">
          {shown.map((image) => (
            <ImageTile
              key={image.id}
              image={image}
              typeLabel={type.labelMr}
              disabled={busy}
              query={query}
              dimmed={searching && image.layoutSpec === null}
              onToggle={() =>
                void run(() =>
                  setReferenceImageEnabled(image.id, !image.isActive),
                )
              }
              onDelete={() => {
                if (!window.confirm(STR.refDeleteConfirm)) return;
                void run(() => deleteReferenceImage(image.id));
              }}
              onRecheck={() => void run(() => analyzeReferenceImage(image.id))}
              onFlip={() =>
                void run(() =>
                  setReferenceImagePhotoZone(
                    image.id,
                    !image.layoutSpec?.hasPhotoZone,
                  ),
                )
              }
              onSaveAbout={(contentSummary) =>
                run(() =>
                  updateReferenceImageLayoutSpec(image.id, { contentSummary }),
                )
              }
            />
          ))}
        </div>
      ) : null}

      {!type.isBuiltin ? (
        <div className="ref-type-footer">
          <button
            type="button"
            className="btn btn-small btn-danger-ghost"
            disabled={busy}
            onClick={removeType}
          >
            <Trash2 size={16} strokeWidth={2} aria-hidden="true" />
            {STR.refTypeDelete}
          </button>
        </div>
      ) : null}

      {error ? <p className="form-error">{error}</p> : null}
    </div>
  );
}

// Footer card of the twitter section: create a custom type (name + classifier
// description; images are uploaded on the card that appears after creation).
function NewTypeCard({ onCreated }: { onCreated: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [desc, setDesc] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      await createReferenceType({
        labelMr: label.trim(),
        description: desc.trim(),
      });
      await onCreated();
      setLabel('');
      setDesc('');
      setOpen(false);
    } catch (caught) {
      setError(errText(caught));
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        className="ref-new-type-toggle"
        onClick={() => setOpen(true)}
      >
        <span className="ref-new-type-icon" aria-hidden="true">
          <Plus size={26} strokeWidth={2} />
        </span>
        <span className="ref-new-type-title">{STR.refTypeNew}</span>
        <span className="ref-new-type-hint">{STR.refTypeNewHint}</span>
      </button>
    );
  }

  return (
    <div className="card ref-type-card ref-new-type-form">
      <h3>{STR.refTypeNew}</h3>
      <div className="ref-edit-form">
        <div>
          <label className="field-label" htmlFor="new-type-label">
            {STR.refTypeName}
          </label>
          <input
            id="new-type-label"
            type="text"
            placeholder={STR.refTypeNamePlaceholder}
            value={label}
            maxLength={60}
            onChange={(event) => setLabel(event.target.value)}
          />
        </div>
        <div>
          <label className="field-label" htmlFor="new-type-desc">
            {STR.refTypeDesc}
          </label>
          <p className="hint">{STR.refTypeDescHint}</p>
          <textarea
            id="new-type-desc"
            className="ref-desc-input"
            placeholder={STR.refTypeDescPlaceholder}
            value={desc}
            maxLength={300}
            onChange={(event) => setDesc(event.target.value)}
          />
        </div>
        <div className="btn-row">
          <button
            type="button"
            className="btn btn-small btn-primary"
            disabled={
              busy || label.trim().length === 0 || desc.trim().length < 3
            }
            onClick={() => void create()}
          >
            {busy ? STR.refTypeCreating : STR.refTypeCreate}
          </button>
          <button
            type="button"
            className="btn btn-small"
            disabled={busy}
            onClick={() => setOpen(false)}
          >
            {STR.refTypeCancel}
          </button>
        </div>
      </div>
      {error ? <p className="form-error">{error}</p> : null}
    </div>
  );
}

export default function ReferencesPage() {
  const [types, setTypes] = useState<ReferenceType[] | null>(null);
  const [images, setImages] = useState<ReferenceImage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<ReferenceFilters>(NO_FILTERS);

  const refresh = useCallback(async () => {
    try {
      const [nextTypes, nextImages] = await Promise.all([
        listReferenceTypes(),
        listReferenceImages(),
      ]);
      setTypes(nextTypes);
      setImages(nextImages);
      setError(null);
    } catch (caught) {
      setError(errText(caught));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const byCategory = useMemo(() => {
    const map = new Map<ReferenceCategory, ReferenceType[]>();
    for (const type of types ?? []) {
      const list = map.get(type.category) ?? [];
      list.push(type);
      map.set(type.category, list);
    }
    return map;
  }, [types]);

  // Unlike the picker, this page searches DISABLED masters too: it is where a template is
  // brought back into rotation, so hiding the ones that are out of it would hide exactly
  // the ones being looked for.
  const searchable = useMemo<SearchableReference[]>(() => {
    const typeBySlug = new Map(
      (types ?? []).map((type) => [`${type.category}:${type.slug}`, type]),
    );
    return (images ?? []).flatMap((image) => {
      const type = typeBySlug.get(`${image.category}:${image.subtype}`);
      if (!type) return [];
      return [
        {
          image,
          typeId: type.id,
          typeLabel: type.labelMr,
          typeDescription: type.description,
        },
      ];
    });
  }, [types, images]);

  const search = useMemo(
    () => searchReferences(searchable, query, filters),
    [searchable, query, filters],
  );
  const searching = search.queryActive || search.filtersActive;

  // Rank position per image, so each type card can show its own matches in the page's
  // global relevance order rather than re-deriving one.
  const matchOrder = useMemo(() => {
    const order = new Map<string, number>();
    search.matches.forEach((match, index) =>
      order.set(match.entry.image.id, index),
    );
    return order;
  }, [search]);

  const unsearchableIds = useMemo(
    () => new Set(search.unanalyzed.map((entry) => entry.image.id)),
    [search],
  );

  const loaded = types !== null && images !== null;
  const categories: ReferenceCategory[] = ['twitter', 'article'];

  return (
    <main className="page">
      <h1 className="page-title">{STR.refTitle}</h1>
      <p className="hint ref-intro">{STR.refIntro}</p>
      {error ? <p className="form-error">{error}</p> : null}

      {loaded ? (
        <div className="ref-search-sticky">
          <ReferenceSearchBar
            query={query}
            onQueryChange={setQuery}
            filters={filters}
            onFiltersChange={setFilters}
            resultCount={search.matches.length}
            total={search.total}
            hint
          />
        </div>
      ) : null}

      {!loaded && !error ? (
        <div className="ref-loading">
          <span className="spinner" aria-hidden="true" />
        </div>
      ) : null}

      {loaded && searching && search.matches.length === 0 ? (
        <div className="ref-search-empty">
          <p>{STR.refSearchNoResults}</p>
          <p className="hint">{STR.refSearchNoResultsHint}</p>
        </div>
      ) : null}
      {loaded && searching ? (
        <UnanalyzedNote count={search.unanalyzed.length} />
      ) : null}

      {loaded
        ? categories.map((category) => {
            const cards = (byCategory.get(category) ?? []).map((type) => {
              const own = (images ?? []).filter(
                (image) =>
                  image.category === category && image.subtype === type.slug,
              );
              const matched = searching
                ? own
                    .filter((image) => matchOrder.has(image.id))
                    .sort(
                      (a, b) =>
                        (matchOrder.get(a.id) ?? 0) -
                        (matchOrder.get(b.id) ?? 0),
                    )
                : own;
              // Un-analyzed masters are appended (dimmed) rather than filtered out, so a
              // search never makes a template unreachable — this card is the only place
              // its "पुन्हा तपासा" button lives.
              const unsearchable = searching
                ? own.filter((image) => unsearchableIds.has(image.id))
                : [];
              return { type, matched, unsearchable };
            });
            // A type with nothing to show disappears while searching; with no query the
            // page keeps every type, including empty ones, because uploading into an
            // empty type is what its card is for.
            const visible = searching
              ? cards.filter(
                  (card) =>
                    card.matched.length > 0 || card.unsearchable.length > 0,
                )
              : cards;
            if (searching && visible.length === 0) return null;

            return (
              <section className="ref-category" key={category}>
                <h2 className="ref-category-title">
                  {REF_CATEGORY_LABELS[category]}
                </h2>
                <div className="ref-type-list">
                  {visible.map(({ type, matched, unsearchable }) => (
                    <TypeCard
                      key={type.id}
                      type={type}
                      images={matched}
                      unsearchable={unsearchable}
                      query={query}
                      searching={searching}
                      onChanged={refresh}
                    />
                  ))}
                  {/* Creating a type is an admin action, not a search result — it stays
                      out of the filtered view rather than looking like a match. */}
                  {category === 'twitter' && !searching ? (
                    <NewTypeCard onCreated={refresh} />
                  ) : null}
                </div>
              </section>
            );
          })
        : null}
    </main>
  );
}
