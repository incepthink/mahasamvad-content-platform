'use client';

// The detail-page view of a कॅरोसेल run (migration 0059): the slides as a swipeable strip, one
// slide per view on a phone and a scrolling row on a desktop, with a १/N counter and dots.
//
// Per slide: the two downloads (with and without the chrome), "हा स्लाइड पुन्हा तयार करा", and
// the pencil that opens a marker round on THAT slide — shown below the strip at full width,
// using the same PosterAnnotator + PosterImageFeedbackBox the single poster uses, one slide at a
// time. A slide still being drawn is a placeholder with a spinner, so the first slides are
// visible while the rest render.
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
  // The slide (1-based) whose marker round is open below the strip; null = none.
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

  // A slide whose render is replaced closes its open marker round — the marks point at pixels
  // that are gone.
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
                editingThis={editing === slide.index}
                onRedo={() => void redo(slide.index)}
                onToggleEdit={() =>
                  setEditing((current) =>
                    current === slide.index ? null : slide.index,
                  )
                }
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
              share, so the all-slides redo sits here, beside a line saying why. Two-step,
              because it is several paid renders. */}
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
            <p className="hint">{STR.carouselRedoCoverHint}</p>
          </div>
          {actionError ? <ErrorNotice message={actionError} /> : null}

          {editingSlide?.posterUrl ? (
            <SlideEditor
              // Keyed by the slide AND its render, so marks never carry over to another slide
              // or onto a render they were not drawn on.
              key={`${editingSlide.index}:${editingSlide.posterUrl}`}
              detail={detail}
              slide={editingSlide}
              total={total}
              busy={busySlides.has(editingSlide.index) || running}
              onClose={() => setEditing(null)}
              onChanged={onChanged}
              onImageWorkStarted={onImageWorkStarted}
            />
          ) : null}
        </>
      ) : null}

      <p className="info-callout carousel-publish-note">
        {STR.carouselPublishPending}
      </p>

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
  editingThis,
  onRedo,
  onToggleEdit,
}: {
  detail: GenerationDetail;
  slide: CarouselSlideDetail;
  total: number;
  drawing: boolean;
  editable: boolean;
  editingThis: boolean;
  onRedo: () => void;
  onToggleEdit: () => void;
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
          </div>
        )}
        {drawing && slide.posterUrl ? (
          <div className="poster-loading" aria-live="polite" aria-busy="true">
            <span className="spinner spinner-lg" />
          </div>
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
      <div className="poster-icon-actions">
        {slide.posterUrl ? (
          <>
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
          </>
        ) : null}
        <button
          type="button"
          className="icon-btn"
          title={STR.carouselRedoSlide}
          aria-label={`${STR.carouselRedoSlide} — ${label}`}
          disabled={
            !editable ||
            (slide.index > 1 && !detail.carouselSlides[0]?.posterUrl)
          }
          onClick={onRedo}
        >
          <RotateCw size={18} strokeWidth={1.9} aria-hidden="true" />
        </button>
        {slide.posterUrl ? (
          <button
            type="button"
            className="icon-btn"
            aria-pressed={editingThis}
            title={
              editingThis ? STR.carouselEditSlideOn : STR.carouselEditSlide
            }
            aria-label={`${editingThis ? STR.carouselEditSlideOn : STR.carouselEditSlide} — ${label}`}
            disabled={!editable}
            onClick={onToggleEdit}
          >
            <SquarePen size={18} strokeWidth={1.9} aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </li>
  );
}

// One slide's marker round, at full width under the strip — marking needs the slide large,
// not at thumbnail size. The poster's own annotator and feedback box, unchanged.
function SlideEditor({
  detail,
  slide,
  total,
  busy,
  onClose,
  onChanged,
  onImageWorkStarted,
}: {
  detail: GenerationDetail;
  slide: CarouselSlideDetail;
  total: number;
  busy: boolean;
  onClose: () => void;
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
    <div className="carousel-editor">
      <div className="carousel-editor-head">
        <h3>{STR.carouselEditingTitle(slide.index)}</h3>
        <button type="button" className="btn btn-small" onClick={onClose}>
          {STR.carouselEditClose}
        </button>
      </div>
      <div className="poster-layout">
        <div className="poster-frame">
          <img
            src={slide.posterUrl ?? ''}
            alt={STR.carouselSlideOf(slide.index, total)}
            className="poster-image"
            draggable={false}
          />
          <PosterAnnotator
            markers={markers}
            onAdd={addMarker}
            onRemove={removeMarker}
            active={annotMode !== null && !showSpinner}
            disabled={showSpinner}
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
        <div>
          <PosterImageFeedbackBox
            markers={markers}
            onNoteChange={setNote}
            onRemoveMarker={removeMarker}
            onOpenChange={(open) =>
              setAnnotMode((current) => (open ? (current ?? 'mark') : current))
            }
            disabled={showSpinner}
            submittedMarkers={submittedMarkers}
            mode={annotMode ?? 'mark'}
            onModeChange={setAnnotMode}
            clearRegions={clearRegions}
            onClearNoteChange={setClearNote}
            onClearActionChange={setClearAction}
            onRemoveClearRegion={removeClearRegion}
            submittedClearRegions={submittedClearRegions}
            onSubmit={submit}
          />
        </div>
      </div>
    </div>
  );
}
