'use client';

// The detail-page view of a कॅरोसेल run (migration 0059): the slides as a swipeable strip, one
// slide per view on a phone and a scrolling row on a desktop, with a १/N counter and dots.
//
// Per slide: one edit button on the card, which opens the slide in a modal holding everything
// that can be done to it — the two downloads (with and without the chrome), "हा स्लाइड पुन्हा
// तयार करा", and a marker round using the same PosterAnnotator + PosterImageFeedbackBox the
// single poster uses. A slide still being drawn is a placeholder with a spinner, so the first
// slides are visible while the rest render.
//
// Deliberately absent in v1: publishing and Canva (a multi-image post needs its own call on
// both), and version switching (each slide keeps its history, but there is no restore route).

import { useEffect, useRef, useState } from 'react';
import type {
  CarouselSlideDetail,
  GenerationDetail,
  PosterImageFeedbackRequest,
} from '@dgipr/schemas';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ImageDown,
  RotateCw,
  SquareDashed,
  SquarePen,
} from 'lucide-react';
import {
  carouselSlideDownloadUrl,
  regenerateCarouselSlide,
  sendCarouselSlideFeedback,
} from '../lib/api';
import { STR } from '../lib/strings';
import { errorMessage } from '../lib/errorMessage';
import { usePosterMarkers } from '../lib/usePosterMarkers';
import { PosterAnnotator, type AnnotatorMode } from './PosterAnnotator';
import { PosterImageFeedbackBox } from './PosterImageFeedbackBox';
import { SocialCaptionEditor } from './SocialCaptionEditor';
import { ErrorNotice } from './ErrorNotice';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';

export function CarouselView({
  detail,
  onChanged,
  onImageWorkStarted,
}: {
  detail: GenerationDetail;
  onChanged: () => Promise<void>;
  // Hands a started render to the navbar's tasks panel, like the poster cards do. Called
  // AFTER the await: these routes flip the row to running before their 202.
  onImageWorkStarted?: (() => void) | undefined;
}) {
  const slides = detail.carouselSlides;
  const total = slides.length;
  const running = detail.status === 'queued' || detail.status === 'running';
  const busySlides = new Set(detail.carouselBusySlides);
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  // The slide (1-based) open in the edit modal; null = none.
  const [editing, setEditing] = useState<number | null>(null);
  // Edits need an idle row: every slide job rewrites the same carousel column.
  const editable =
    (detail.status === 'completed' || detail.status === 'failed') && !pending;

  // Which slide the strip is showing, from its scroll position — so the counter and the dots
  // follow a swipe as well as a button press.
  const stripRef = useRef<HTMLOListElement>(null);
  const [active, setActive] = useState(0);
  // Whether the strip actually scrolls. On a wide screen every slide can be on view at once,
  // and then the arrows, dots and counter would be controls that move nothing — so they are
  // shown only while there is somewhere to scroll to. Measured, not guessed from the viewport,
  // because it depends on the card's width and the number of slides alike.
  const [overflows, setOverflows] = useState(false);
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const measure = () =>
      setOverflows(strip.scrollWidth > strip.clientWidth + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(strip);
    return () => observer.disconnect();
  }, [total]);
  const onScroll = () => {
    const strip = stripRef.current;
    if (!strip) return;
    const children = [...strip.children] as HTMLElement[];
    // Scrolled all the way along, the LAST slide is the one just brought into view, even when
    // an earlier one still starts nearer the left edge.
    if (strip.scrollLeft >= strip.scrollWidth - strip.clientWidth - 2) {
      setActive(children.length - 1);
      return;
    }
    let nearest = 0;
    let best = Number.POSITIVE_INFINITY;
    children.forEach((child, i) => {
      const distance = Math.abs(
        child.offsetLeft - strip.offsetLeft - strip.scrollLeft,
      );
      if (distance < best) {
        best = distance;
        nearest = i;
      }
    });
    setActive(nearest);
  };
  const goTo = (index: number) => {
    const strip = stripRef.current;
    const child = strip?.children[index] as HTMLElement | undefined;
    if (!strip || !child) return;
    strip.scrollTo({
      left: child.offsetLeft - strip.offsetLeft,
      behavior: 'smooth',
    });
    setActive(index);
  };

  // A slide that loses its render closes the modal — there is nothing left in it to edit.
  const editingSlide = editing !== null ? (slides[editing - 1] ?? null) : null;
  useEffect(() => {
    if (editing !== null && !editingSlide?.posterUrl) setEditing(null);
  }, [editing, editingSlide?.posterUrl]);

  const redo = async (slide: number | 'all') => {
    setPending(true);
    setActionError(null);
    setConfirmAll(false);
    try {
      await regenerateCarouselSlide(detail.id, slide);
      onImageWorkStarted?.();
      await onChanged();
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="card carousel-card">
      <h2>{STR.carouselTitle}</h2>

      {total > 0 ? (
        <>
          <ol
            ref={stripRef}
            className="carousel-strip"
            onScroll={onScroll}
            aria-label={STR.carouselTitle}
          >
            {slides.map((slide) => (
              <SlideCard
                key={slide.index}
                detail={detail}
                slide={slide}
                total={total}
                drawing={
                  busySlides.has(slide.index) || (running && !slide.posterUrl)
                }
                editable={editable}
                onRedo={() => void redo(slide.index)}
                onEdit={() => {
                  setActionError(null);
                  setEditing(slide.index);
                }}
              />
            ))}
          </ol>

          {total > 1 && overflows ? (
            <div className="carousel-nav">
              <button
                type="button"
                className="icon-btn"
                title={STR.carouselPrev}
                aria-label={STR.carouselPrev}
                disabled={active === 0}
                onClick={() => goTo(active - 1)}
              >
                <ChevronLeft size={18} strokeWidth={1.9} aria-hidden="true" />
              </button>
              <div className="carousel-dots">
                {slides.map((slide, i) => (
                  <button
                    key={slide.index}
                    type="button"
                    className="carousel-dot"
                    aria-label={STR.carouselGoTo(slide.index)}
                    aria-current={i === active}
                    onClick={() => goTo(i)}
                  />
                ))}
              </div>
              <span className="carousel-counter" aria-live="polite">
                {STR.carouselSlideOf(active + 1, total)}
              </span>
              <button
                type="button"
                className="icon-btn"
                title={STR.carouselNext}
                aria-label={STR.carouselNext}
                disabled={active >= total - 1}
                onClick={() => goTo(active + 1)}
              >
                <ChevronRight size={18} strokeWidth={1.9} aria-hidden="true" />
              </button>
            </div>
          ) : null}

          {/* Re-rendering the cover alone gives the post a look the other slides no longer
              share, so the all-slides redo sits here. Two-step, because it is several paid
              renders. */}
          <div className="carousel-actions">
            {confirmAll ? (
              <div className="info-callout">
                <p>{STR.carouselRedoAllConfirm}</p>
                <div className="btn-row" style={{ marginTop: 8 }}>
                  <button
                    type="button"
                    className="btn btn-primary btn-small"
                    disabled={!editable}
                    onClick={() => void redo('all')}
                  >
                    {STR.carouselRedoAll}
                  </button>
                  <button
                    type="button"
                    className="btn btn-small"
                    onClick={() => setConfirmAll(false)}
                  >
                    {STR.publishCancel}
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="btn btn-small"
                disabled={!editable}
                onClick={() => setConfirmAll(true)}
              >
                <RotateCw size={16} strokeWidth={1.9} aria-hidden="true" />
                {STR.carouselRedoAll}
              </button>
            )}
          </div>
          {actionError && editing === null ? (
            <ErrorNotice message={actionError} />
          ) : null}

          <Dialog
            open={editingSlide?.posterUrl != null}
            onOpenChange={(open) => {
              if (!open) setEditing(null);
            }}
          >
            {editingSlide?.posterUrl ? (
              <SlideEditor
                // Keyed by the slide, so marks never carry over from one slide to another.
                key={editingSlide.index}
                detail={detail}
                slide={editingSlide}
                total={total}
                busy={busySlides.has(editingSlide.index) || running}
                editable={editable}
                redoError={actionError}
                onRedo={() => void redo(editingSlide.index)}
                onChanged={onChanged}
                onImageWorkStarted={onImageWorkStarted}
              />
            ) : null}
          </Dialog>
        </>
      ) : null}

      <SocialCaptionEditor
        detail={detail}
        onChanged={onChanged}
        busy={running || pending}
        revision
      />
    </section>
  );
}

function SlideCard({
  detail,
  slide,
  total,
  drawing,
  editable,
  onRedo,
  onEdit,
}: {
  detail: GenerationDetail;
  slide: CarouselSlideDetail;
  total: number;
  drawing: boolean;
  editable: boolean;
  onRedo: () => void;
  onEdit: () => void;
}) {
  const label = STR.carouselSlideOf(slide.index, total);
  return (
    <li className="carousel-slide">
      <div className="poster-frame carousel-frame">
        {slide.posterUrl ? (
          <img
            src={slide.posterUrl}
            alt={`${label} — ${slide.title}`}
            className="poster-image"
            draggable={false}
          />
        ) : (
          <div className="carousel-placeholder" aria-busy={drawing}>
            {drawing ? <span className="spinner spinner-lg" /> : null}
            <span className="hint">
              {drawing ? STR.carouselSlidePending : STR.carouselSlideMissing}
            </span>
            {/* A slide that never rendered has no picture to open in the editor, so its
                redo is offered here instead. */}
            {!drawing ? (
              <button
                type="button"
                className="btn btn-small"
                disabled={
                  !editable ||
                  (slide.index > 1 && !detail.carouselSlides[0]?.posterUrl)
                }
                onClick={onRedo}
              >
                <RotateCw size={16} strokeWidth={1.9} aria-hidden="true" />
                {STR.carouselRedoSlide}
              </button>
            ) : null}
          </div>
        )}
        {drawing && slide.posterUrl ? (
          <div className="poster-loading" aria-live="polite" aria-busy="true">
            <span className="spinner spinner-lg" />
          </div>
        ) : null}
        {slide.posterUrl ? (
          <button
            type="button"
            className="icon-btn carousel-edit-btn"
            title={STR.carouselEditSlide}
            aria-label={`${STR.carouselEditSlide} — ${label}`}
            onClick={onEdit}
          >
            <SquarePen size={18} strokeWidth={1.9} aria-hidden="true" />
          </button>
        ) : null}
      </div>
      <p className="carousel-slide-title">
        <span className="carousel-slide-number">{label}</span>
        {slide.role === 'cover' ? STR.carouselCover : slide.title}
      </p>
      {slide.versions.length > 1 ? (
        <p className="hint carousel-slide-versions">
          {STR.carouselVersions(slide.versions.length)}
        </p>
      ) : null}
    </li>
  );
}

// One slide opened in a modal: the slide centred and large enough to mark, its icon actions
// under it (downloads, redo, and the two marking gestures), and the poster's own feedback box
// full width below — everything that used to sit under the card. It opens even while the row is busy (the downloads still work); the edits inside are
// what wait for an idle row.
function SlideEditor({
  detail,
  slide,
  total,
  busy,
  editable,
  redoError,
  onRedo,
  onChanged,
  onImageWorkStarted,
}: {
  detail: GenerationDetail;
  slide: CarouselSlideDetail;
  total: number;
  busy: boolean;
  editable: boolean;
  redoError: string | null;
  onRedo: () => void;
  onChanged: () => Promise<void>;
  onImageWorkStarted?: (() => void) | undefined;
}) {
  const [pending, setPending] = useState(false);
  // Armed from the start: the officer opened this to mark the slide.
  const [annotMode, setAnnotMode] = useState<AnnotatorMode | null>('mark');
  const {
    markers,
    submittedMarkers,
    addMarker,
    removeMarker,
    setNote,
    clearRegions,
    submittedClearRegions,
    addClearRegion,
    removeClearRegion,
    setClearNote,
    setClearAction,
    markSubmitted,
    dismissSubmitted,
  } = usePosterMarkers({ posterUrl: slide.posterUrl, status: detail.status });
  const showSpinner = busy || pending;
  const label = STR.carouselSlideOf(slide.index, total);

  const submit = async (payload: PosterImageFeedbackRequest) => {
    setPending(true);
    try {
      await sendCarouselSlideFeedback(detail.id, slide.index, payload);
      markSubmitted();
      onImageWorkStarted?.();
      await onChanged();
    } finally {
      setPending(false);
    }
  };

  return (
    // No description line: the icons and the change box below say what can be done here.
    <DialogContent
      className="max-w-[min(96vw,640px)]"
      aria-describedby={undefined}
    >
      <DialogHeader>
        <DialogTitle>{STR.carouselEditingTitle(slide.index)}</DialogTitle>
      </DialogHeader>

      <div className="carousel-dialog-slide">
        <div className="poster-frame">
          <img
            src={slide.posterUrl ?? ''}
            alt={label}
            className="poster-image"
            draggable={false}
          />
          <PosterAnnotator
            markers={markers}
            onAdd={addMarker}
            onRemove={removeMarker}
            active={annotMode !== null && !showSpinner && editable}
            disabled={showSpinner || !editable}
            submittedMarkers={submittedMarkers}
            onDismissSubmitted={dismissSubmitted}
            mode={annotMode ?? 'mark'}
            clearRegions={clearRegions}
            onAddClear={addClearRegion}
            onRemoveClear={removeClearRegion}
            submittedClearRegions={submittedClearRegions}
          />
          {showSpinner ? (
            <div className="poster-loading" aria-live="polite" aria-busy="true">
              <span className="spinner spinner-lg" />
            </div>
          ) : null}
        </div>
      </div>

      {/* Icon-only actions under the slide, as on the single poster: the two downloads, the
          redo, and the two marking gestures (red = change what is here, blue = free this
          space). The marking modes live here rather than inside the change box. */}
      <div className="poster-icon-actions carousel-dialog-actions">
        <a
          className="icon-btn"
          href={carouselSlideDownloadUrl(detail.id, slide.index)}
          title={STR.iconDownloadPoster}
          aria-label={`${STR.iconDownloadPoster} — ${label}`}
        >
          <Download size={18} strokeWidth={1.9} aria-hidden="true" />
        </a>
        <a
          className="icon-btn"
          href={carouselSlideDownloadUrl(detail.id, slide.index, true)}
          title={STR.iconDownloadPosterPlain}
          aria-label={`${STR.iconDownloadPosterPlain} — ${label}`}
        >
          <ImageDown size={18} strokeWidth={1.9} aria-hidden="true" />
        </a>
        <button
          type="button"
          className="icon-btn"
          title={STR.carouselRedoSlide}
          aria-label={`${STR.carouselRedoSlide} — ${label}`}
          disabled={
            !editable ||
            showSpinner ||
            (slide.index > 1 && !detail.carouselSlides[0]?.posterUrl)
          }
          onClick={onRedo}
        >
          <RotateCw size={18} strokeWidth={1.9} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-pressed={annotMode === 'mark'}
          title={
            annotMode === 'mark' ? STR.iconEditPosterOn : STR.iconEditPoster
          }
          aria-label={
            annotMode === 'mark' ? STR.iconEditPosterOn : STR.iconEditPoster
          }
          disabled={showSpinner || !editable}
          onClick={() =>
            setAnnotMode((current) => (current === 'mark' ? null : 'mark'))
          }
        >
          <SquarePen size={18} strokeWidth={1.9} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="icon-btn icon-btn-clear"
          aria-pressed={annotMode === 'clear'}
          title={
            annotMode === 'clear' ? STR.iconClearSpaceOn : STR.iconClearSpace
          }
          aria-label={
            annotMode === 'clear' ? STR.iconClearSpaceOn : STR.iconClearSpace
          }
          disabled={showSpinner || !editable}
          onClick={() =>
            setAnnotMode((current) => (current === 'clear' ? null : 'clear'))
          }
        >
          <SquareDashed size={18} strokeWidth={1.9} aria-hidden="true" />
        </button>
      </div>
      {redoError ? <ErrorNotice message={redoError} /> : null}

      <PosterImageFeedbackBox
        markers={markers}
        onNoteChange={setNote}
        onRemoveMarker={removeMarker}
        onOpenChange={(open) =>
          setAnnotMode((current) => (open ? (current ?? 'mark') : current))
        }
        disabled={showSpinner || !editable}
        submittedMarkers={submittedMarkers}
        mode={annotMode ?? 'mark'}
        clearRegions={clearRegions}
        onClearNoteChange={setClearNote}
        onClearActionChange={setClearAction}
        onRemoveClearRegion={removeClearRegion}
        submittedClearRegions={submittedClearRegions}
        onSubmit={submit}
      />
    </DialogContent>
  );
}
