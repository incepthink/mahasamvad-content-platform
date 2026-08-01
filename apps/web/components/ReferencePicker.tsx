'use client';

// Optional template pin on the create form. Automatic mode lets the classifier
// choose; manual mode can pin either a whole Twitter type (with a fresh image
// roll per run) or one exact enabled library image.
//
// Types + images are fetched lazily the first time manual mode is chosen;
// enabled images only.

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Images, Sparkles } from 'lucide-react';
import type {
  ReferenceCategory,
  ReferenceImage,
  ReferenceType,
  TemplateBrand,
} from '@dgipr/schemas';
import { listReferenceImages, listReferenceTypes } from '../lib/api';
import {
  NO_FILTERS,
  highlightRanges,
  searchReferences,
  type ReferenceFilters,
  type SearchableReference,
} from '../lib/referenceSearch';
import {
  HighlightedText,
  ReferenceSearchBar,
  UnanalyzedNote,
} from './ReferenceSearchBar';
import { STR } from '../lib/strings';

// The three master libraries. 'twitter' is the only one with several types, so it is also
// the only one that offers a whole-TYPE pin (the API rejects a type pin on any other lane);
// 'article' and 'youtube' render as one flat grid of images.
type PickerCategory = ReferenceCategory;

export type ReferenceSelection =
  | { kind: 'image'; id: string }
  | { kind: 'type'; id: string };

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

// A search hit. Unlike Thumb (which lives under a type heading that names it), a hit is
// shown OUT of its group, so it has to carry its own type name and the line it matched
// on — otherwise a flat grid of thumbnails gives no reason why any of them is there.
function ResultTile({
  image,
  category,
  typeLabel,
  query,
  snippet,
  highlights,
  selected,
  onClick,
}: {
  image: ReferenceImage;
  category: PickerCategory;
  typeLabel: string;
  // The type name is marked as well as the subject line: a query like "quote" matches the
  // TYPE, and without a mark on it the tile gives no visible reason for being in the
  // results at all.
  query: string;
  snippet: string;
  highlights: readonly { start: number; end: number }[];
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <div className="ref-result">
      <Thumb
        image={image}
        category={category}
        label={typeLabel}
        selected={selected}
        onClick={onClick}
      />
      <div className="ref-result-meta">
        <span className="ref-result-type">
          <HighlightedText
            text={typeLabel}
            highlights={highlightRanges(typeLabel, query)}
          />
        </span>
        {snippet ? (
          <span className="ref-result-snippet" title={snippet}>
            <HighlightedText text={snippet} highlights={highlights} />
          </span>
        ) : null}
      </div>
    </div>
  );
}

export default function ReferencePicker({
  category,
  brand = 'dgipr',
  value,
  onChange,
  variant = 'card',
}: {
  category: PickerCategory;
  // Which template brand family to show. The DGIPR flow excludes CMO types and vice
  // versa, so a CMO template never appears in an ordinary Twitter run's gallery.
  brand?: TemplateBrand;
  value: ReferenceSelection | null;
  onChange: (selection: ReferenceSelection | null) => void;
  // 'card' is the standalone section; 'inline' drops the card chrome so the picker can
  // sit inside another card (e.g. the detail page's next-step panel) without a
  // nested-card look; 'disclosure' is that same gallery folded shut behind ONE optional
  // row — the create form, where the template is a secondary question and a closed fold
  // already means "let the platform choose", so the आपोआप / स्वतः निवडा card pair would
  // be asking a question the fold has answered.
  variant?: 'card' | 'inline' | 'disclosure';
}) {
  const isDisclosure = variant === 'disclosure';
  const [open, setOpen] = useState(isDisclosure && value !== null);
  const [mode, setMode] = useState<'auto' | 'manual'>(
    value ? 'manual' : 'auto',
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [library, setLibrary] = useState<Library | null>(null);
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<ReferenceFilters>(NO_FILTERS);

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
    setQuery('');
    setFilters(NO_FILTERS);
    onChange(null);
  };

  const chooseManual = () => {
    if (!library && !loading) void load();
    setMode('manual');
  };

  // Opening the fold IS choosing manual, so it does the same lazy load. Closing it drops
  // the query: the collapsed row states the PIN, and a query surviving out of sight would
  // silently narrow the gallery the next time it is opened.
  const toggleOpen = () => {
    setOpen((wasOpen) => {
      if (!wasOpen && !library && !loading) void load();
      if (wasOpen) {
        setQuery('');
        setFilters(NO_FILTERS);
      }
      return !wasOpen;
    });
  };

  // Enabled images of the relevant category, grouped under their type (types
  // with nothing enabled disappear — same rule the generation catalog applies).
  const groups = useMemo(() => {
    if (!library) return [];
    return library.types
      .filter((type) => type.category === category && type.brand === brand)
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
  }, [library, category, brand]);

  // Search runs over the SAME enabled-only pool the groups are built from, flattened —
  // so a hit can never be an image the gallery would refuse to show, and the counter
  // ("N पैकी M") counts the templates this run could actually use.
  const searchable = useMemo<SearchableReference[]>(
    () =>
      groups.flatMap(({ type, images }) =>
        images.map((image) => ({
          image,
          typeId: type.id,
          typeLabel: type.labelMr,
          typeDescription: type.description,
        })),
      ),
    [groups],
  );

  const search = useMemo(
    () => searchReferences(searchable, query, filters),
    [searchable, query, filters],
  );
  const searching = search.queryActive || search.filtersActive;

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

  // The gallery itself is variant-independent — the three variants differ only in what
  // wraps it and in what decides whether it is on screen.
  const gallery = (
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
          <span className="ref-picker-selected-type-icon" aria-hidden="true">
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

      {!loading && !error && groups.length > 0 ? (
        <ReferenceSearchBar
          query={query}
          onQueryChange={setQuery}
          filters={filters}
          onFiltersChange={setFilters}
          resultCount={search.matches.length}
          total={search.total}
          hint
        />
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
      ) : searching ? (
        // A query cuts ACROSS types: the whole point is finding a master when you do not
        // know which family holds it, so the type headings collapse into one ranked grid
        // and each tile names its own type instead.
        <>
          {search.matches.length === 0 ? (
            <div className="ref-search-empty">
              <p>{STR.refSearchNoResults}</p>
              <p className="hint">{STR.refSearchNoResultsHint}</p>
            </div>
          ) : (
            <div className="ref-result-grid">
              {search.matches.map(({ entry, snippet, highlights }) => (
                <ResultTile
                  key={entry.image.id}
                  image={entry.image}
                  category={category}
                  typeLabel={entry.typeLabel}
                  query={query}
                  snippet={snippet}
                  highlights={highlights}
                  selected={
                    value?.kind === 'image' && value.id === entry.image.id
                  }
                  onClick={() => pick(entry.image.id)}
                />
              ))}
            </div>
          )}
          <UnanalyzedNote count={search.unanalyzed.length} />
        </>
      ) : category === 'twitter' ? (
        groups.map(({ type, images }) => (
          <div key={type.id} className="ref-picker-group">
            <div className="ref-picker-group-header">
              <h3 className="ref-picker-group-title">{type.labelMr}</h3>
              {/* Checked = pin the whole type; the job then rolls one of its
                  enabled images at random. Picking a thumbnail below swaps the
                  type pin for an image pin, so this unchecks itself. */}
              <label className="ref-picker-check">
                <input
                  type="checkbox"
                  checked={value?.kind === 'type' && value.id === type.id}
                  onChange={() => pickType(type.id)}
                />
                <span>{STR.refPickerTypeSelect}</span>
              </label>
            </div>
            <div className="ref-picker-grid">
              {images.map((image) => (
                <Thumb
                  key={image.id}
                  image={image}
                  category={category}
                  label={type.labelMr}
                  selected={value?.kind === 'image' && value.id === image.id}
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
  );

  if (isDisclosure) {
    // What the collapsed row states about the run: the pinned template's own type name
    // when there is one, so folding it shut never hides the answer. The library may not
    // be loaded yet on a restored pin, hence the plain "निवडलेले टेम्पलेट" fallback.
    const summary = selectedType
      ? value?.kind === 'type'
        ? `${STR.refPickerTypeBadge} — ${selectedType.labelMr}`
        : selectedType.labelMr
      : value
        ? STR.refPickerSelected
        : STR.refPickerDisclosureNone;

    return (
      <div className="ref-picker ref-picker-disclosure">
        <button
          type="button"
          className="ref-picker-disclosure-head"
          aria-expanded={open}
          onClick={toggleOpen}
        >
          <span className="ref-picker-disclosure-chevron" aria-hidden="true">
            {open ? (
              <ChevronDown size={18} strokeWidth={2} />
            ) : (
              <ChevronRight size={18} strokeWidth={2} />
            )}
          </span>
          <span className="ref-picker-disclosure-label">
            {STR.refPickerDisclosureTitle}
          </span>
          <span
            className={
              value
                ? 'ref-picker-disclosure-summary ref-picker-disclosure-summary-set'
                : 'ref-picker-disclosure-summary'
            }
          >
            {summary}
          </span>
        </button>
        {open ? (
          <div className="ref-picker-disclosure-body">
            <p className="hint">{STR.refPickerDisclosureHint}</p>
            {value ? (
              <div className="ref-picker-disclosure-actions">
                <button
                  type="button"
                  className="btn btn-small"
                  onClick={() => onChange(null)}
                >
                  {STR.refPickerDisclosureClear}
                </button>
              </div>
            ) : null}
            {gallery}
          </div>
        ) : null}
      </div>
    );
  }

  const Wrapper = variant === 'card' ? 'section' : 'div';
  const Title = variant === 'card' ? 'h2' : 'h3';

  return (
    <Wrapper
      className={
        variant === 'card' ? 'card ref-picker' : 'ref-picker ref-picker-inline'
      }
    >
      <Title className="ref-picker-title">{STR.refPickerTitle}</Title>
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

      {mode === 'manual' ? gallery : null}
    </Wrapper>
  );
}
