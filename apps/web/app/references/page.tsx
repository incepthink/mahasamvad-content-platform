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
  updateReferenceType,
  uploadReferenceImage,
} from '../../lib/api';
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

// What the vision pass read off this master. hasPhotoZone is the consequential
// field: it is what stops the image model painting a hero photograph onto a
// text-only template, so it is surfaced (not buried) and stays correctable.
function LayoutBadge({
  image,
  disabled,
  onRecheck,
  onFlip,
}: {
  image: ReferenceImage;
  disabled: boolean;
  onRecheck: () => void;
  onFlip: () => void;
}) {
  const spec = image.layoutSpec;

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
        {spec.layoutSummary}
      </p>
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
  onToggle,
  onDelete,
  onRecheck,
  onFlip,
}: {
  image: ReferenceImage;
  typeLabel: string;
  disabled: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onRecheck: () => void;
  onFlip: () => void;
}) {
  return (
    <div className={`ref-thumb${image.isActive ? ' is-enabled' : ''}`}>
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
          onRecheck={onRecheck}
          onFlip={onFlip}
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
  onChanged,
}: {
  type: ReferenceType;
  images: ReferenceImage[];
  onChanged: () => Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [labelDraft, setLabelDraft] = useState(type.labelMr);
  const [descDraft, setDescDraft] = useState(type.description);
  const [brandDraft, setBrandDraft] = useState(type.brand);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await onChanged();
    } catch (caught) {
      setError(errText(caught));
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

  const sorted = [...images].sort(
    (a, b) =>
      Number(b.isActive) - Number(a.isActive) ||
      b.createdAt.localeCompare(a.createdAt),
  );
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

      {sorted.length === 0 ? <p className="hint">{STR.refEmpty}</p> : null}
      {sorted.length > 0 ? (
        <div className="ref-thumb-grid">
          {sorted.map((image) => (
            <ImageTile
              key={image.id}
              image={image}
              typeLabel={type.labelMr}
              disabled={busy}
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

  const loaded = types !== null && images !== null;
  const categories: ReferenceCategory[] = ['twitter', 'article'];

  return (
    <main className="page">
      <h1 className="page-title">{STR.refTitle}</h1>
      <p className="hint ref-intro">{STR.refIntro}</p>
      {error ? <p className="form-error">{error}</p> : null}

      {!loaded && !error ? (
        <div className="ref-loading">
          <span className="spinner" aria-hidden="true" />
        </div>
      ) : null}

      {loaded
        ? categories.map((category) => (
            <section className="ref-category" key={category}>
              <h2 className="ref-category-title">
                {REF_CATEGORY_LABELS[category]}
              </h2>
              <div className="ref-type-list">
                {(byCategory.get(category) ?? []).map((type) => (
                  <TypeCard
                    key={type.id}
                    type={type}
                    images={(images ?? []).filter(
                      (image) =>
                        image.category === category &&
                        image.subtype === type.slug,
                    )}
                    onChanged={refresh}
                  />
                ))}
                {category === 'twitter' ? (
                  <NewTypeCard onCreated={refresh} />
                ) : null}
              </div>
            </section>
          ))
        : null}
    </main>
  );
}
