'use client';

// Master-template library. Every image marked "वापरात" (enabled) can be picked for a
// generation, so several may be enabled at once.
//
// THE PAGE IS ORGANISED BY SHAPE, NOT BY TOPIC. It used to render one card per
// `reference_type` — 15 groups for 84 twitter masters, labelled by what their placeholder
// art is ABOUT ("Information about insects, reptiles, animals, etc"), with one builtin
// renamed प्रायोगिक holding 17 images whose slot counts run 0 to 10. That taxonomy described
// nothing an operator could see in the picture, and it had stopped steering anything:
// capacity-first selection ranks the WHOLE library and gates on `bulletSlots`, so the group
// an image sits in has not decided a poster since 2026-07-31.
//
// Sections now come from `layoutSpec` (see lib/referenceGroups.ts) — the same axis the picker
// reasons over — with छायाचित्र/मजकूर as a filter rather than a second level of nesting.
// NOTHING IS STORED: `reference_types`, `subtype`, `copy_style` and every storage path are
// untouched, so this is a presentation change with no effect on any render. The types survive
// as the upload destination (the dropdown on the add form) and as the create-form pin target.
//
// Creating, renaming and deleting a type therefore has no home on this page any more. The
// API routes still exist; put the control back here if that need returns.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ImageIcon,
  Plus,
  RefreshCw,
  Trash2,
  Type,
  Upload,
  X,
} from 'lucide-react';
import type {
  ReferenceCategory,
  ReferenceImage,
  ReferenceType,
} from '@dgipr/schemas';
import {
  analyzeReferenceImage,
  deleteReferenceImage,
  listReferenceImages,
  listReferenceTypes,
  setReferenceImageEnabled,
  setReferenceImagePhotoZone,
  updateReferenceImageLayoutSpec,
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
import {
  SHAPE_BANDS,
  groupByBand,
  type ShapeBandId,
} from '../../lib/referenceGroups';
import { STR } from '../../lib/strings';

const ACCEPTED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
// A band opens on one row and grows by this many rows per press.
const ROWS_PER_STEP = 2;
const DATE_FORMAT = new Intl.DateTimeFormat('mr-IN', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

// Section order on the page; each is its own library serving its own feature.
const CATEGORIES: readonly ReferenceCategory[] = [
  'twitter',
  'article',
  'youtube',
];

const CATEGORY_TABS: Record<ReferenceCategory, string> = {
  twitter: STR.refTabTwitter,
  article: STR.refTabArticle,
  youtube: STR.refTabYoutube,
};

const BAND_LABELS: Record<ShapeBandId, string> = {
  unanalyzed: STR.refBandUnanalyzed,
  single: STR.refBandSingle,
  few: STR.refBandFew,
  medium: STR.refBandMedium,
  many: STR.refBandMany,
};

const BAND_HINTS: Record<ShapeBandId, string> = {
  unanalyzed: STR.refBandUnanalyzedHint,
  single: STR.refBandSingleHint,
  few: STR.refBandFewHint,
  medium: STR.refBandMediumHint,
  many: STR.refBandManyHint,
};

// Remembering the last group per category is what makes the dropdown a formality rather
// than a decision — an operator uploading ten masters answers it once. Ordering only; the
// API is never told about it.
const LAST_GROUP_KEY = 'dgipr.references.lastGroup';

function readLastGroup(category: ReferenceCategory): string | null {
  try {
    return window.localStorage.getItem(`${LAST_GROUP_KEY}.${category}`);
  } catch {
    return null;
  }
}

function writeLastGroup(category: ReferenceCategory, slug: string): void {
  try {
    window.localStorage.setItem(`${LAST_GROUP_KEY}.${category}`, slug);
  } catch {
    // A blocked localStorage costs the default, never the upload.
  }
}

function errText(error: unknown): string {
  return error instanceof Error ? error.message : STR.genericError;
}

// What the vision pass read off this master. Two fields here are consequential and
// therefore surfaced (not buried) and correctable by hand: hasPhotoZone, which stops
// the image model painting a hero photograph onto a text-only template; and the
// subject line, which is searchable — a vague read there makes the master hard to find.
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

// How many tiles the grid currently fits on one row. It cannot be a constant: the grid
// is `repeat(auto-fill, minmax(200px, 1fr))`, so the count follows the viewport — and it
// is read off the RESOLVED track list rather than computed from the card's width, which
// would mean writing the gap and the minimum down a second time. `auto-fill` (unlike
// `auto-fit`) keeps its empty tracks, so this reports the true column count even while
// the band is showing a single tile — which is what lets one row stay one row.
function useGridColumns(ref: React.RefObject<HTMLDivElement | null>): number {
  // Assumed until measured; the correction lands in the effect below on first paint.
  const [columns, setColumns] = useState(4);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const measure = () => {
      const tracks = window
        .getComputedStyle(element)
        .gridTemplateColumns.split(' ')
        .filter((track) => track.length > 0);
      if (tracks.length > 0) setColumns(tracks.length);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return columns;
}

// One image tile: preview + date + layout reading + enable/disable/delete actions.
function ImageTile({
  image,
  groupLabel,
  isCmo,
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
  groupLabel: string;
  isCmo: boolean;
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
        <img src={image.url} alt={groupLabel} loading="lazy" />
        {image.isActive ? (
          <span className="ref-thumb-badge">{STR.refEnabled}</span>
        ) : null}
      </div>
      <div className="ref-thumb-meta">
        <span className="ref-thumb-date">
          {STR.refUploadedOn}: {DATE_FORMAT.format(new Date(image.createdAt))}
          {/* The CMO brand is NOT taxonomy noise — it renders a different lockup and is
              filtered on at selection time, so it stays visible on the tile. */}
          {isCmo ? (
            <span className="chip chip-completed">{STR.refBrandChip}</span>
          ) : null}
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
        {/* Which group this master was filed under. Recorded, not organising — it is the
            last line of the tile for exactly that reason. */}
        <span className="ref-thumb-group">
          {STR.refGroupLine}: {groupLabel}
        </span>
      </div>
    </div>
  );
}

// A grid of tiles that opens on one row and grows two rows at a time, so a band holding
// thirty masters does not push everything below it off the page.
function ImageGrid({
  images,
  resetKey,
  render,
}: {
  images: readonly ReferenceImage[];
  // A new result set folds back to one row — otherwise a band left expanded on a previous
  // query keeps showing rows nobody asked to see. Deliberately NOT the image count: an
  // upload or a toggle must not collapse the rows the operator is working in.
  resetKey: string;
  render: (image: ReferenceImage) => React.ReactNode;
}) {
  const gridRef = useRef<HTMLDivElement>(null);
  const columns = useGridColumns(gridRef);
  const [rows, setRows] = useState(1);

  useEffect(() => {
    setRows(1);
  }, [resetKey]);

  const visible = images.slice(0, columns * rows);
  const hidden = images.length - visible.length;

  return (
    <>
      <div className="ref-thumb-grid" ref={gridRef}>
        {visible.map((image) => render(image))}
      </div>
      {hidden > 0 || rows > 1 ? (
        <div className="ref-thumb-more">
          {hidden > 0 ? (
            <button
              type="button"
              className="btn btn-small"
              onClick={() => setRows((current) => current + ROWS_PER_STEP)}
            >
              {STR.refShowMore}
              <span className="ref-thumb-more-count">
                {STR.refHiddenCount(hidden)}
              </span>
            </button>
          ) : null}
          {rows > 1 ? (
            <button
              type="button"
              className="btn btn-small"
              onClick={() => setRows(1)}
            >
              {STR.refShowLess}
            </button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

// The page's one upload control. The group is a field here rather than a card you must
// find first, which is the whole point of the change — and it defaults to the last one
// used, so a run of uploads answers it once.
function UploadPanel({
  category,
  types,
  busy,
  onClose,
  onUpload,
}: {
  category: ReferenceCategory;
  types: readonly ReferenceType[];
  busy: boolean;
  onClose: () => void;
  onUpload: (slug: string, file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [slug, setSlug] = useState('');

  // Re-seeded per category, since each library has its own groups and its own last choice.
  useEffect(() => {
    const remembered = readLastGroup(category);
    const known = types.some((type) => type.slug === remembered);
    setSlug(known && remembered ? remembered : (types[0]?.slug ?? ''));
  }, [category, types]);

  if (types.length === 0) return null;

  return (
    <div className="card card-compact ref-add">
      <div className="ref-add-head">
        <h2 className="card-eyebrow">{STR.refAddTitle}</h2>
        <button
          type="button"
          className="btn-ghost ref-add-close"
          onClick={onClose}
          aria-label={STR.refAddCancel}
        >
          <X size={18} strokeWidth={2.25} aria-hidden="true" />
        </button>
      </div>
      <div className="ref-add-row">
        {/* A single-type library (लेख, यूट्यूब) has nothing to ask, so it asks nothing. */}
        {types.length > 1 ? (
          <div className="ref-add-group">
            <label className="field-label" htmlFor="ref-add-group">
              {STR.refAddGroupLabel}
            </label>
            <select
              id="ref-add-group"
              value={slug}
              disabled={busy}
              onChange={(event) => setSlug(event.target.value)}
            >
              {types.map((type) => (
                <option key={type.id} value={type.slug}>
                  {type.labelMr}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <button
          type="button"
          className="btn btn-primary ref-add-pick"
          disabled={busy || slug === ''}
          onClick={() => inputRef.current?.click()}
        >
          <Upload size={18} strokeWidth={2} aria-hidden="true" />
          {busy ? STR.refUploading : STR.refAddPick}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file && slug) {
              writeLastGroup(category, slug);
              onUpload(slug, file);
            }
          }}
        />
      </div>
      <p className="hint">{STR.refAddHint}</p>
      {types.length > 1 ? <p className="hint">{STR.refAddGroupHint}</p> : null}
    </div>
  );
}

export default function ReferencesPage() {
  const [types, setTypes] = useState<ReferenceType[] | null>(null);
  const [images, setImages] = useState<ReferenceImage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [category, setCategory] = useState<ReferenceCategory>('twitter');
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

  // Reports whether the action succeeded, so a caller holding an open editor (the
  // subject-line one) keeps the operator's draft on screen after a failure instead of
  // closing over it.
  const run = useCallback(
    async (fn: () => Promise<unknown>): Promise<boolean> => {
      setBusy(true);
      setError(null);
      try {
        await fn();
        await refresh();
        return true;
      } catch (caught) {
        setError(errText(caught));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const typeByKey = useMemo(() => {
    const map = new Map<string, ReferenceType>();
    for (const type of types ?? [])
      map.set(`${type.category}:${type.slug}`, type);
    return map;
  }, [types]);

  const typeOf = useCallback(
    (image: ReferenceImage) =>
      typeByKey.get(`${image.category}:${image.subtype}`),
    [typeByKey],
  );

  const categoryTypes = useMemo(
    () => (types ?? []).filter((type) => type.category === category),
    [types, category],
  );

  const categoryCounts = useMemo(() => {
    const counts = new Map<ReferenceCategory, number>(
      CATEGORIES.map((key) => [key, 0]),
    );
    for (const image of images ?? []) {
      counts.set(image.category, (counts.get(image.category) ?? 0) + 1);
    }
    return counts;
  }, [images]);

  // Unlike the picker, this page searches DISABLED masters too: it is where a template is
  // brought back into rotation, so hiding the ones that are out of it would hide exactly
  // the ones being looked for. Scoped to the open library, because that is what is on screen.
  const searchable = useMemo<SearchableReference[]>(() => {
    return (images ?? []).flatMap((image) => {
      if (image.category !== category) return [];
      const type = typeOf(image);
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
  }, [images, category, typeOf]);

  const search = useMemo(
    () => searchReferences(searchable, query, filters),
    [searchable, query, filters],
  );
  const searching = search.queryActive || search.filtersActive;

  // Bands are for browsing; a search has its own relevance order and re-bucketing it would
  // bury the best hit under a size heading. So a search renders one flat ranked list.
  const bands = useMemo(
    () => groupByBand(searchable.map((entry) => entry.image)),
    [searchable],
  );

  const loaded = types !== null && images !== null;
  const resetKey = `${category}|${query}|${filters.photo}|${filters.minSlots}`;

  const tileFor = (image: ReferenceImage, dimmed = false) => {
    const type = typeOf(image);
    return (
      <ImageTile
        key={image.id}
        image={image}
        groupLabel={type?.labelMr ?? image.subtype}
        isCmo={type?.brand === 'cmo'}
        disabled={busy}
        query={query}
        dimmed={dimmed}
        onToggle={() =>
          void run(() => setReferenceImageEnabled(image.id, !image.isActive))
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
    );
  };

  return (
    <main className="page">
      <header className="page-head">
        <div className="page-head-text">
          <h1 className="page-title">{STR.refTitle}</h1>
          <p className="page-sub">{STR.refIntro}</p>
        </div>
        <div className="page-head-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setAdding((open) => !open)}
          >
            <Plus size={18} strokeWidth={2.25} aria-hidden="true" />
            {STR.refAddOpen}
          </button>
        </div>
      </header>

      {error ? <p className="form-error">{error}</p> : null}

      {loaded && adding ? (
        <UploadPanel
          category={category}
          types={categoryTypes}
          busy={busy}
          onClose={() => setAdding(false)}
          onUpload={(slug, file) => {
            if (!ACCEPTED_TYPES.has(file.type)) {
              setError(STR.refFileTypeError);
              return;
            }
            void run(() => uploadReferenceImage(category, slug, file));
          }}
        />
      ) : null}

      {loaded ? (
        <div className="ref-tabs" role="group" aria-label={STR.refTitle}>
          {CATEGORIES.map((key) => (
            <button
              key={key}
              type="button"
              className="ref-tab"
              aria-pressed={category === key}
              onClick={() => setCategory(key)}
            >
              {CATEGORY_TABS[key]}
              <span className="ref-tab-count">
                {categoryCounts.get(key) ?? 0}
              </span>
            </button>
          ))}
        </div>
      ) : null}

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

      {loaded && searching && search.matches.length > 0 ? (
        <section className="ref-band">
          <div className="ref-band-head">
            <h2 className="ref-band-title">{STR.refSearchResultsTitle}</h2>
            <span className="ref-band-count">
              {STR.refBandCount(search.matches.length)}
            </span>
          </div>
          <ImageGrid
            images={search.matches.map((match) => match.entry.image)}
            resetKey={resetKey}
            render={(image) => tileFor(image)}
          />
        </section>
      ) : null}

      {loaded && !searching
        ? SHAPE_BANDS.map((band) => {
            const own = bands.get(band.id) ?? [];
            // An empty band is not rendered: five headings over four populated grids is
            // the clutter this page is escaping, and "no templates of this size" is
            // information nobody needs while browsing.
            if (own.length === 0) return null;
            const sorted = [...own].sort(
              (a, b) =>
                Number(b.isActive) - Number(a.isActive) ||
                b.createdAt.localeCompare(a.createdAt),
            );
            return (
              <section className={`ref-band ref-band-${band.id}`} key={band.id}>
                <div className="ref-band-head">
                  <h2 className="ref-band-title">{BAND_LABELS[band.id]}</h2>
                  <span className="ref-band-count">
                    {STR.refBandCount(sorted.length)}
                  </span>
                  <p className="ref-band-hint">{BAND_HINTS[band.id]}</p>
                </div>
                <ImageGrid
                  images={sorted}
                  resetKey={resetKey}
                  render={(image) => tileFor(image, band.id === 'unanalyzed')}
                />
              </section>
            );
          })
        : null}

      {loaded && !searching && searchable.length === 0 ? (
        <div className="empty-state">
          <p>{STR.refEmpty}</p>
        </div>
      ) : null}
    </main>
  );
}
