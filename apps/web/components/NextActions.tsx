'use client';

// "पुढील पाऊल" panel on a finished generation. Two blocks remain:
//   - attach-poster: for an article run that has no poster yet, add one to THIS row
//     (no new generation). Doubles as the retry when the poster phase failed.
//   - edit-note: reopen the note prefilled, tweak it, re-run with the same settings.
//
// The cross-format folds that used to live here (ट्विटर/फेसबुक from this note) were
// replaced on 2026-07-28 by the links under the poster itself (CrossFormatLinks),
// which open Creative and Social prefilled instead of asking the template and
// caption questions a second time on this page. The "make an article from this
// note" fold went earlier — articles start from Creative and Social or /dlo.
//
// Article runs navigate to the new run's progress page; social runs are background
// tasks (track + open the panel, no navigation) — same conventions as the home
// form's submit.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { isSocialCategory } from '@dgipr/schemas';
import type { Category, GenerationDetail } from '@dgipr/schemas';
import { createGeneration, requestArticlePoster } from '../lib/api';
import { useTasks } from '../lib/TasksProvider';
import { STR } from '../lib/strings';
import ReferencePicker, { type ReferenceSelection } from './ReferencePicker';

// Every block reports a successful spawn so the page can refresh the thread
// strip — essential for the social paths, which never navigate away.
type BlockProps = {
  detail: GenerationDetail;
  onSpawned?: (() => void) | undefined;
};

// The two social lanes are one flow with different labels (and, for now, one
// shared n8n workflow), so the "started" copy is read per platform from here.
const SOCIAL_STARTED: Record<'twitter' | 'facebook', string> = {
  twitter: STR.nextTwitterStarted,
  facebook: STR.nextFacebookStarted,
};

// Narrows a run's category to its social label (null for news/scheme), so callers
// read the platform copy without casting the widened Category.
function socialStartedOf(category: Category): string | null {
  return category === 'twitter' || category === 'facebook'
    ? SOCIAL_STARTED[category]
    : null;
}

// Article run without a poster → attach the article poster to THIS run (no new
// generation): article-only runs, DLO runs, and poster-phase-failure retries.
// After the 202 the row is running again, so onPosterStarted must refresh the
// detail poll; the whole NextActions panel then unmounts (non-terminal) and the
// page shows the poster skeleton. No addTask/lane gating — nothing new to track.
function CreatePosterBlock({
  detail,
  onPosterStarted,
}: {
  detail: GenerationDetail;
  onPosterStarted?: (() => void) | undefined;
}) {
  const [reference, setReference] = useState<ReferenceSelection | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await requestArticlePoster(
        detail.id,
        reference?.kind === 'image' ? reference.id : undefined,
      );
      onPosterStarted?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : STR.genericError);
      setSubmitting(false);
    }
  };

  return (
    <details className="fold">
      <summary>{STR.nextPosterTitle}</summary>
      <div className="fold-body">
        <p className="hint">
          {detail.status === 'failed'
            ? STR.nextPosterRetryHint
            : STR.nextPosterHint}
        </p>
        <ReferencePicker
          variant="inline"
          category="article"
          value={reference}
          onChange={setReference}
        />
        <div className="btn-row" style={{ marginTop: 16 }}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={submit}
            disabled={submitting}
          >
            {submitting ? STR.submitting : STR.nextPosterCta}
          </button>
        </div>
        {error ? <p className="form-error">{error}</p> : null}
      </div>
    </details>
  );
}

// Edit the note (and heading) and start a fresh run with this run's own
// settings. Reference pins are deliberately NOT carried over — the pinned image
// may since have been deleted or disabled, so automatic rotation is the safe
// default for the re-run.
function EditNoteBlock({ detail, onSpawned }: BlockProps) {
  const router = useRouter();
  const { addTask, openPanel, hasActiveSocialTask, hasActiveArticleTask } =
    useTasks();
  const socialStarted = socialStartedOf(detail.category);
  const isSocial = socialStarted !== null;
  const laneBusy = isSocial ? hasActiveSocialTask : hasActiveArticleTask;
  const [note, setNote] = useState(detail.note);
  const [heading, setHeading] = useState(detail.heading ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [started, setStarted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (note.trim().length < 20) {
      setError(STR.noteTooShort);
      return;
    }
    if (laneBusy) {
      setError(STR.busyError);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const id = await createGeneration({
        note: note.trim(),
        heading: heading.trim(),
        category: detail.category,
        outputType: detail.outputType,
        designMode: detail.designMode ?? undefined,
        sourceGenerationId: detail.id,
        // Same inference as the detail page's retry: a social run that ended up with a
        // caption gets one again (the preference is per run, not stored).
        ...(isSocial ? { generateCaption: detail.article !== null } : {}),
      });
      addTask(id);
      onSpawned?.();
      if (isSocial) {
        openPanel();
        setStarted(true);
        setSubmitting(false);
      } else {
        router.push(`/generations/${id}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : STR.genericError);
      setSubmitting(false);
    }
  };

  return (
    <details className="fold">
      <summary>{STR.editNoteTitle}</summary>
      <div className="fold-body">
        <p className="hint">{STR.editNoteHint}</p>
        <textarea
          className="note-input"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          style={{ marginTop: 10 }}
        />
        <input
          type="text"
          placeholder={STR.headingPlaceholder}
          value={heading}
          onChange={(e) => setHeading(e.target.value)}
          style={{ marginTop: 10 }}
        />
        <div className="btn-row" style={{ marginTop: 16 }}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={submit}
            disabled={submitting || laneBusy}
          >
            {submitting ? STR.submitting : STR.editNoteCta}
          </button>
        </div>
        {started && socialStarted && hasActiveSocialTask ? (
          <p className="form-success">{socialStarted}</p>
        ) : laneBusy ? (
          <p className="info-callout">
            {isSocial ? STR.socialBusyInfo : STR.articleBusyInfo}
          </p>
        ) : null}
        {error ? <p className="form-error">{error}</p> : null}
      </div>
    </details>
  );
}

export function NextActions({
  detail,
  onSpawned,
  onPosterStarted,
}: BlockProps & { onPosterStarted?: (() => void) | undefined }) {
  const terminal = detail.status === 'completed' || detail.status === 'failed';
  if (!terminal) return null;

  const isSocial = isSocialCategory(detail.category);

  return (
    <section className="card next-actions">
      <h2>{STR.nextActionsTitle}</h2>
      <p className="hint">{STR.nextActionsHint}</p>
      {/* Outside the completed-only gate: on a failed row with an article the
          failure was the poster phase, so this doubles as the cheap retry. */}
      {!isSocial && detail.article && !detail.posterUrl ? (
        <CreatePosterBlock detail={detail} onPosterStarted={onPosterStarted} />
      ) : null}
      <EditNoteBlock detail={detail} onSpawned={onSpawned} />
    </section>
  );
}
