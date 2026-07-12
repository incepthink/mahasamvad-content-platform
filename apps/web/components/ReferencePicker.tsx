'use client';

// Optional template pin on the create form. Default is the automatic per-type
// rotation ("आपोआप निवड"); expanding the gallery lets the user pin one enabled
// library image for this run. Pinning a twitter image also pins the post type
// (classification is skipped) — the hint below the selection says so.
//
// Types + images are fetched lazily on first expand; enabled images only.

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Sparkles, X } from 'lucide-react';
import type { ReferenceImage, ReferenceType } from '@dgipr/schemas';
import { listReferenceImages, listReferenceTypes } from '../lib/api';
import { STR } from '../lib/strings';

type PickerCategory = 'twitter' | 'article';

type Library = Readonly<{
  types: ReferenceType[];
  images: ReferenceImage[];
}>;

function Thumb({
  image,
  label,
  selected,
  onClick,
}: {
  image: ReferenceImage;
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="ref-picker-thumb"
      aria-pressed={selected}
      onClick={onClick}
      title={label}
    >
      {/* Immutable library URLs are safe to render directly. */}
      <img src={image.url} alt={label} loading="lazy" />
    </button>
  );
}

export default function ReferencePicker({
  category,
  value,
  onChange,
}: {
  category: PickerCategory;
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [library, setLibrary] = useState<Library | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [types, images] = await Promise.all([
        listReferenceTypes(),
        listReferenceImages(),
      ]);
      setLibrary({ types, images });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : STR.genericError);
    } finally {
      setLoading(false);
    }
  };

  const toggleExpand = () => {
    if (!expanded && !library && !loading) void load();
    setExpanded((open) => !open);
  };

  // Enabled images of the relevant category, grouped under their type (types
  // with nothing enabled disappear — same rule the generation catalog applies).
  const groups = useMemo(() => {
    if (!library) return [];
    return library.types
      .filter((type) => type.category === category)
      .map((type) => ({
        type,
        images: library.images.filter(
          (image) =>
            image.category === category &&
            image.subtype === type.slug &&
            image.isActive,
        ),
      }))
      .filter((group) => group.images.length > 0);
  }, [library, category]);

  const selected =
    value && library
      ? (library.images.find((image) => image.id === value) ?? null)
      : null;
  const selectedType =
    selected && library
      ? (library.types.find(
          (type) =>
            type.category === selected.category &&
            type.slug === selected.subtype,
        ) ?? null)
      : null;

  const pick = (id: string) => onChange(value === id ? null : id);

  return (
    <section className="card ref-picker">
      <h2>{STR.refPickerTitle}</h2>
      <p className="hint">{STR.refPickerHint}</p>

      <div className="ref-picker-toprow">
        {selected ? (
          <div className="ref-picker-selected">
            <img src={selected.url} alt="" aria-hidden="true" />
            <div className="ref-picker-selected-info">
              <span className="ref-picker-selected-label">
                {STR.refPickerSelected}
                {selectedType ? ` — ${selectedType.labelMr}` : ''}
              </span>
              {category === 'twitter' ? (
                <span className="ref-picker-selected-hint">
                  {STR.refPickerPinnedTypeHint}
                </span>
              ) : null}
            </div>
            <button
              type="button"
              className="btn btn-small"
              onClick={() => onChange(null)}
            >
              <X size={15} strokeWidth={2.25} aria-hidden="true" />
              {STR.refPickerClear}
            </button>
          </div>
        ) : (
          <div className="ref-picker-auto" aria-current="true">
            <span className="ref-picker-auto-icon" aria-hidden="true">
              <Sparkles size={20} strokeWidth={1.75} />
            </span>
            <span className="ref-picker-auto-text">
              <span className="name">{STR.refPickerAuto}</span>
              <span className="desc">{STR.refPickerAutoDesc}</span>
            </span>
          </div>
        )}

        <button
          type="button"
          className="btn btn-small ref-picker-toggle"
          aria-expanded={expanded}
          onClick={toggleExpand}
        >
          {expanded ? (
            <ChevronUp size={16} strokeWidth={2.25} aria-hidden="true" />
          ) : (
            <ChevronDown size={16} strokeWidth={2.25} aria-hidden="true" />
          )}
          {expanded ? STR.refPickerClose : STR.refPickerOpen}
        </button>
      </div>

      {expanded ? (
        <div className="ref-picker-gallery">
          {loading ? (
            <p className="ref-picker-loading">
              <span className="spinner" aria-hidden="true" />
              {STR.refPickerLoading}
            </p>
          ) : error ? (
            <p className="form-error">{error}</p>
          ) : groups.length === 0 ? (
            <p className="info-callout">{STR.refPickerEmpty}</p>
          ) : category === 'twitter' ? (
            groups.map(({ type, images }) => (
              <div key={type.id} className="ref-picker-group">
                <h3 className="ref-picker-group-title">{type.labelMr}</h3>
                <div className="ref-picker-grid">
                  {images.map((image) => (
                    <Thumb
                      key={image.id}
                      image={image}
                      label={type.labelMr}
                      selected={value === image.id}
                      onClick={() => pick(image.id)}
                    />
                  ))}
                </div>
              </div>
            ))
          ) : (
            <div className="ref-picker-grid ref-picker-grid-wide">
              {groups.flatMap(({ type, images }) =>
                images.map((image) => (
                  <Thumb
                    key={image.id}
                    image={image}
                    label={type.labelMr}
                    selected={value === image.id}
                    onClick={() => pick(image.id)}
                  />
                )),
              )}
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
