'use client';

// Optional template pin on the create form. Manual mode pins one exact enabled library image.
//
// WHAT AN EMPTY SELECTION MEANS IS THE CALLER'S, NOT THIS COMPONENT'S — pass noneLabel/noneHint
// to say so. On लेख and यूट्यूब it still means "the platform picks a template for you", which is
// the default wording. On क्रिएटिव्ह (since 2026-08-07) it means NO template is used at all and
// the poster is designed from scratch, so the default wording would state the opposite of what
// happens. That is lane semantics, which is why it arrives as props rather than as a
// `category === 'twitter'` branch in here.
//
// THE GALLERY IS ORGANISED BY SIZE BAND, exactly as /references is — एकच संदेश / थोडे
// मुद्दे / मध्यम यादी / मोठी यादी, each opening on two rows with an आणखी दाखवा control.
// It used to group Twitter by `reference_type`, whose labels describe what the
// placeholder artwork is ABOUT rather than what the template can hold; a run's real
// question is "does my note fit this", which is what the bands answer.
//
// The whole-TYPE pin went with those headings: a band is not a type, so there is no
// reference_type_id to send, and pinning is now always one exact image. A restored
// `{ kind: 'type' }` value (an older link, a re-run of an earlier generation) still
// RENDERS correctly — nothing on this form can create one any more.
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
import {
  BAND_HINTS,
  BAND_LABELS,
  SHAPE_BANDS,
  groupByBand,
} from '../lib/referenceGroups';
import { STR } from '../lib/strings';
import { errorMessage } from '../lib/errorMessage';
import { ErrorNotice } from './ErrorNotice';

// A band opens on two rows' worth of thumbnails. Count-based rather than measured (the
// library page measures its resolved grid tracks): this gallery sits inside a fold on a
// form, where "about two rows" is close enough and a ResizeObserver per band is not worth
// what it buys.
const BAND_PAGE = 8;

// How many more each आणखी दाखवा press reveals. Deliberately bigger than the opening page:
// the first view is a glance, and someone who presses it is browsing the band rather than
// scanning it, so a second press should rarely be needed.
const BAND_MORE = 15;

// The three master libraries. 'twitter' is the only one with several types, so it is also
// the only one that offers a whole-TYPE pin (the API rejects a type pin on any other lane);
// 'article' and 'youtube' render as one flat grid of images.
type PickerCategory = ReferenceCategory;

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

// One size section of the gallery: heading, count, and a grid that reveals itself two
// rows at a time so a band holding thirty masters does not push the next heading off the
// fold. The reveal is local state, so opening one band leaves the others as they were.
function BandSection({
  label,
  hint,
  images,
  children,
}: {
  label: string;
  hint: string;
  images: readonly ReferenceImage[];
  children: (image: ReferenceImage) => React.ReactNode;
}) {
  const [shown, setShown] = useState(BAND_PAGE);
  const visible = images.slice(0, shown);
  const hidden = images.length - visible.length;

  return (
    <div className="ref-picker-group">
      <div className="ref-picker-group-header">
        <h3 className="ref-picker-group-title">{label}</h3>
        <span className="ref-picker-group-count">
          {STR.refBandCount(images.length)}
        </span>
      </div>
      <p className="hint ref-picker-group-hint">{hint}</p>
      <div className="ref-picker-grid">{visible.map(children)}</div>
      {hidden > 0 || shown > BAND_PAGE ? (
        <div className="ref-thumb-more">
          {hidden > 0 ? (
            <button
              type="button"
              className="btn btn-small"
              onClick={() => setShown((current) => current + BAND_MORE)}
            >
              {STR.refShowMore}
              <span className="ref-thumb-more-count">
                {STR.refHiddenCount(hidden)}
              </span>
            </button>
          ) : null}
          {shown > BAND_PAGE ? (
            <button
              type="button"
              className="btn btn-small"
              onClick={() => setShown(BAND_PAGE)}
            >
              {STR.refShowLess}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default function ReferencePicker({
  category,
  brand = 'dgipr',
  value,
  onChange,
  variant = 'card',
  noneLabel,
  noneHint,
}: {
  category: PickerCategory;
  // Which template brand family to show. The DGIPR flow excludes CMO types and vice
  // versa, so a CMO template never appears in an ordinary Twitter run's gallery.
  brand?: TemplateBrand;
  value: ReferenceSelection | null;
  onChange: (selection: ReferenceSelection | null) => void;
  // What "nothing selected" MEANS on this surface, for the disclosure variant's collapsed
  // summary and its open hint. Props rather than a `category === 'twitter'` branch, because
  // the meaning is the caller's lane semantics, not this component's: on the क्रिएटिव्ह lane
  // an empty selection means no template is used at all (a fully-AI render), while the लेख and
  // यूट्यूब lanes still auto-select one. Defaults keep the auto-select wording.
  noneLabel?: string;
  noneHint?: string;
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
      setError(errorMessage(caught));
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

  // The browse view: the same enabled-only pool, re-bucketed by what each master can
  // hold. Built off `groups` rather than `library.images` so the brand and category
  // filters above still decide the pool — a CMO master must not appear in a DGIPR run.
  //
  // SORTED BEFORE GROUPING (groupByBand preserves input order), with the SAME comparator
  // /references uses, so a band reads identically on both pages: newest first, and a
  // library page's disabled masters last. The pool here is enabled-only, so the isActive
  // term is inert — it is kept so the two orderings cannot drift. Without the sort the
  // band inherited `groups`' order, which is clustered by reference TYPE, so the same
  // library came out arranged one way on this form and another way on /references.
  const bands = useMemo(
    () =>
      groupByBand(
        groups
          .flatMap((group) => group.images)
          .sort(
            (a, b) =>
              Number(b.isActive) - Number(a.isActive) ||
              b.createdAt.localeCompare(a.createdAt),
          ),
      ),
    [groups],
  );

  // A thumbnail still needs its type's name for its tooltip/alt text, which is the one
  // thing the type is still good for here.
  const typeLabelOf = useMemo(() => {
    const labels = new Map<string, string>();
    for (const { type, images } of groups) {
      for (const image of images) labels.set(image.id, type.labelMr);
    }
    return labels;
  }, [groups]);

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
        <ErrorNotice message={error} />
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
      ) : (
        // Browsing, by what each template HOLDS. Every library gets the same sections —
        // the shape question is the same one whether the output is a social poster, a
        // लेख banner or a thumbnail. An empty band renders nothing: "no templates of this
        // size" is not information anyone needs while choosing one.
        SHAPE_BANDS.map((band) => {
          const own = bands.get(band.id) ?? [];
          if (own.length === 0) return null;
          return (
            <BandSection
              key={band.id}
              label={BAND_LABELS[band.id]}
              hint={BAND_HINTS[band.id]}
              images={own}
            >
              {(image) => (
                <Thumb
                  key={image.id}
                  image={image}
                  category={category}
                  label={typeLabelOf.get(image.id) ?? image.subtype}
                  selected={value?.kind === 'image' && value.id === image.id}
                  onClick={() => pick(image.id)}
                />
              )}
            </BandSection>
          );
        })
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
        : (noneLabel ?? STR.refPickerDisclosureNone);

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
            <p className="hint">{noneHint ?? STR.refPickerDisclosureHint}</p>
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
