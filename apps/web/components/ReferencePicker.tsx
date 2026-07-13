'use client';

// Optional template pin on the create form. Automatic mode lets the classifier
// choose; manual mode can pin either a whole Twitter type (with a fresh image
// roll per run) or one exact enabled library image.
//
// Types + images are fetched lazily the first time manual mode is chosen;
// enabled images only.

import { useMemo, useState } from 'react';
import { Images, Sparkles } from 'lucide-react';
import type { ReferenceImage, ReferenceType } from '@dgipr/schemas';
import { listReferenceImages, listReferenceTypes } from '../lib/api';
import { STR } from '../lib/strings';

type PickerCategory = 'twitter' | 'article';

export type ReferenceSelection =
  { kind: 'image'; id: string } | { kind: 'type'; id: string };

type Library = Readonly<{
  types: ReferenceType[];
  images: ReferenceImage[];
}>;

function Thumb({
  image,
  category,
  label,
  selected,
  onClick,
}: {
  image: ReferenceImage;
  category: PickerCategory;
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  // The tile reserves the master's aspect box via CSS, so the shimmer sits in
  // the image's final size and nothing resizes when the bitmap decodes.
  const [loaded, setLoaded] = useState(false);

  return (
    <button
      type="button"
      className={`ref-picker-thumb ref-picker-thumb-${category}`}
      aria-pressed={selected}
      onClick={onClick}
      title={label}
    >
      {loaded ? null : (
        <span
          className="ref-picker-thumb-skeleton skeleton"
          aria-hidden="true"
        />
      )}
      {/* Immutable library URLs are safe to render directly. */}
      <img
        src={image.url}
        alt={label}
        loading="lazy"
        onLoad={() => setLoaded(true)}
        onError={() => setLoaded(true)}
      />
      {selected ? (
        <span className="ref-picker-thumb-badge">{STR.refPickerBadge}</span>
      ) : null}
    </button>
  );
}

export default function ReferencePicker({
  category,
  value,
  onChange,
}: {
  category: PickerCategory;
  value: ReferenceSelection | null;
  onChange: (selection: ReferenceSelection | null) => void;
}) {
  const [mode, setMode] = useState<'auto' | 'manual'>(
    value ? 'manual' : 'auto',
  );
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

  const chooseAuto = () => {
    setMode('auto');
    onChange(null);
  };

  const chooseManual = () => {
    if (!library && !loading) void load();
    setMode('manual');
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

  const selectedImage =
    value?.kind === 'image' && library
      ? (library.images.find((image) => image.id === value.id) ?? null)
      : null;
  const selectedType =
    value && library
      ? (library.types.find(
          (type) =>
            type.category === category &&
            (value.kind === 'type'
              ? type.id === value.id
              : type.slug === selectedImage?.subtype),
        ) ?? null)
      : null;
  const selectedGroup = selectedType
    ? (groups.find((group) => group.type.id === selectedType.id) ?? null)
    : null;

  const pick = (id: string) =>
    onChange(
      value?.kind === 'image' && value.id === id ? null : { kind: 'image', id },
    );
  const pickType = (id: string) =>
    onChange(
      value?.kind === 'type' && value.id === id ? null : { kind: 'type', id },
    );

  return (
    <section className="card ref-picker">
      <h2>{STR.refPickerTitle}</h2>
      <p className="hint">{STR.refPickerHint}</p>

      <div className="output-picker output-picker-two">
        <button
          type="button"
          className="output-option"
          aria-pressed={mode === 'auto'}
          onClick={chooseAuto}
        >
          <span className="icon" aria-hidden="true">
            <Sparkles size={30} strokeWidth={1.75} />
          </span>
          <span className="name">{STR.refPickerAuto}</span>
          <span className="desc">{STR.refPickerAutoDesc}</span>
        </button>
        <button
          type="button"
          className="output-option"
          aria-pressed={mode === 'manual'}
          onClick={chooseManual}
        >
          <span className="icon" aria-hidden="true">
            <Images size={30} strokeWidth={1.75} />
          </span>
          <span className="name">{STR.refPickerManual}</span>
          <span className="desc">{STR.refPickerManualDesc}</span>
        </button>
      </div>

      {mode === 'manual' ? (
        <div className="ref-picker-gallery">
          {selectedImage ? (
            <div className="ref-picker-selected">
              <img src={selectedImage.url} alt="" aria-hidden="true" />
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
            </div>
          ) : value?.kind === 'type' && selectedType ? (
            <div className="ref-picker-selected ref-picker-selected-type">
              <span
                className="ref-picker-selected-type-icon"
                aria-hidden="true"
              >
                <Images size={26} strokeWidth={1.75} />
              </span>
              <div className="ref-picker-selected-info">
                <span className="ref-picker-selected-label">
                  {STR.refPickerTypeSelected} — {selectedType.labelMr}
                </span>
                <span className="ref-picker-selected-hint">
                  {STR.refPickerTypeHint}
                </span>
                <span className="ref-picker-selected-count">
                  {STR.refPickerTypeBadge} · {selectedGroup?.images.length ?? 0}{' '}
                  चित्रे
                </span>
              </div>
            </div>
          ) : null}

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
                <button
                  type="button"
                  className="ref-picker-group-header"
                  aria-pressed={value?.kind === 'type' && value.id === type.id}
                  onClick={() => pickType(type.id)}
                >
                  <span className="ref-picker-group-title">{type.labelMr}</span>
                  <span className="ref-picker-group-action">
                    {value?.kind === 'type' && value.id === type.id
                      ? STR.refPickerTypeBadge
                      : STR.refPickerTypeSelect}
                  </span>
                </button>
                <div className="ref-picker-grid">
                  {images.map((image) => (
                    <Thumb
                      key={image.id}
                      image={image}
                      category={category}
                      label={type.labelMr}
                      selected={
                        value?.kind === 'image' && value.id === image.id
                      }
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
                    category={category}
                    label={type.labelMr}
                    selected={value?.kind === 'image' && value.id === image.id}
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
