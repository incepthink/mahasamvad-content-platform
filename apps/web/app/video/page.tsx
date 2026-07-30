'use client';

// Explainer-video entry: note mode writes a 30-second narration; ready-script
// mode preserves supplied Marathi narration and estimates its natural duration
// for free. Both keep expensive rendering behind the two review gates.

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  VIDEO_CLIP_MAX_SECONDS,
  VIDEO_SCRIPT_MAX_SECONDS,
  estimateNarrationSeconds,
  isMarathiVideoNarration,
  normalizeVideoNarrationScript,
  type VideoInputMode,
  type VideoProjectSummary,
} from '@dgipr/schemas';
import { createVideoProject, listVideoProjects } from '../../lib/api';
import { formatDate, STR, videoReadyScriptEstimate } from '../../lib/strings';
import { VideoStatusChip } from '../../components/VideoStatusChip';

const NOTE_MIN = 20;

// मागील व्हिडिओ shows the runs worth keeping, not every experiment the pipeline
// ever produced: the named projects below plus everything created from now on.
// A cutoff rather than a hide-list, so new runs need no code change — and the
// gate is presentational only, `activeProject` below still reads the FULL list
// so a hidden run that is still working keeps blocking a second project.
const KEEP_PROJECT_IDS = new Set([
  '45384823-133e-49d2-85db-b1018556884b',
  '1fcbb83c-ad77-45ba-a5e1-9847a97cb5bd',
  'f1f4e3bd-6645-4c2f-9053-c85fb51a0774',
  '873f4600-b783-46a5-a1f8-65b7e54a088a',
]);
const LIST_FROM = Date.parse('2026-07-30T05:00:00Z');

function isListed(project: VideoProjectSummary): boolean {
  if (KEEP_PROJECT_IDS.has(project.id)) return true;
  const created = Date.parse(project.createdAt);
  // An unparseable date must not disappear silently.
  return Number.isNaN(created) || created >= LIST_FROM;
}

function isWorking(status: VideoProjectSummary['status']): boolean {
  return (
    status === 'scripting' ||
    status === 'storyboarding' ||
    status === 'animating'
  );
}

export default function VideoPage() {
  const router = useRouter();
  const [inputMode, setInputMode] = useState<VideoInputMode>('note');
  const [note, setNote] = useState('');
  const [heading, setHeading] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [projects, setProjects] = useState<VideoProjectSummary[]>([]);

  useEffect(() => {
    let cancelled = false;
    void listVideoProjects()
      .then((rows) => {
        if (!cancelled) setProjects(rows);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const activeProject = useMemo(
    () => projects.find((project) => isWorking(project.status)) ?? null,
    [projects],
  );
  const listedProjects = useMemo(() => projects.filter(isListed), [projects]);
  const scriptEstimateSeconds = estimateNarrationSeconds(
    normalizeVideoNarrationScript(note),
  );
  const scriptSceneCount = Math.max(
    1,
    Math.ceil(scriptEstimateSeconds / VIDEO_CLIP_MAX_SECONDS),
  );
  const scriptTooLong =
    inputMode === 'script' && scriptEstimateSeconds > VIDEO_SCRIPT_MAX_SECONDS;
  const scriptNotMarathi =
    inputMode === 'script' &&
    note.trim() !== '' &&
    !isMarathiVideoNarration(note);

  const submit = async () => {
    if (note.trim().length < NOTE_MIN) {
      setError(
        inputMode === 'script'
          ? STR.videoScriptTooShort
          : STR.videoNoteTooShort,
      );
      return;
    }
    if (scriptTooLong) {
      setError(STR.videoScriptEstimateOver);
      return;
    }
    if (scriptNotMarathi) {
      setError(STR.videoScriptMarathiOnly);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const id = await createVideoProject({
        note: note.trim(),
        ...(heading.trim() ? { heading: heading.trim() } : {}),
        inputMode,
        durationBucket: 'short',
        orientation: 'landscape',
        tier: 'fast',
      });
      router.push(`/video/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : STR.genericError);
      setSubmitting(false);
    }
  };

  return (
    <main className="page">
      <h1 className="page-title">{STR.videoTitle}</h1>

      <section className="card">
        <p className="hint">{STR.videoIntro}</p>
        {activeProject ? (
          <div className="info-callout" style={{ marginTop: 12 }}>
            <p>
              {STR.videoActiveBlocked}{' '}
              <Link href={`/video/${activeProject.id}`}>
                {activeProject.title ??
                  activeProject.heading ??
                  activeProject.noteExcerpt}
              </Link>
            </p>
          </div>
        ) : null}
        <p className="field-label" style={{ marginTop: 16 }}>
          {STR.videoInputModeLabel}
        </p>
        <div className="segmented" style={{ marginTop: 10 }}>
          <button
            type="button"
            className="output-option"
            aria-pressed={inputMode === 'note'}
            onClick={() => {
              setInputMode('note');
              setError(null);
            }}
          >
            <span className="name">{STR.videoInputModeNote}</span>
            <span className="desc">{STR.videoInputModeNoteDesc}</span>
          </button>
          <button
            type="button"
            className="output-option"
            aria-pressed={inputMode === 'script'}
            onClick={() => {
              setInputMode('script');
              setError(null);
            }}
          >
            <span className="name">{STR.videoInputModeScript}</span>
            <span className="desc">{STR.videoInputModeScriptDesc}</span>
          </button>
        </div>
        <label
          className="field-label"
          htmlFor="video-note"
          style={{ marginTop: 16 }}
        >
          {inputMode === 'script'
            ? STR.videoScriptInputLabel
            : STR.videoNoteLabel}
        </label>
        {inputMode === 'script' ? (
          <p className="hint" style={{ marginTop: 4 }}>
            {STR.videoScriptInputHint}
          </p>
        ) : null}
        <textarea
          id="video-note"
          className="note-input"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          style={{ marginTop: 10 }}
        />
        {inputMode === 'script' && note.trim() !== '' ? (
          <>
            <p
              className={scriptTooLong ? 'form-error' : 'hint'}
              style={{ marginTop: 8 }}
            >
              {STR.videoScriptEstimateLabel}:{' '}
              {videoReadyScriptEstimate(
                scriptEstimateSeconds,
                scriptSceneCount,
              )}
              {scriptTooLong ? ` · ${STR.videoScriptEstimateOver}` : ''}
            </p>
            {scriptNotMarathi ? (
              <p className="form-error">{STR.videoScriptMarathiOnly}</p>
            ) : null}
          </>
        ) : null}
        <label
          className="field-label"
          htmlFor="video-heading"
          style={{ marginTop: 12 }}
        >
          {STR.videoHeadingLabel}
        </label>
        <input
          id="video-heading"
          type="text"
          value={heading}
          maxLength={200}
          onChange={(event) => setHeading(event.target.value)}
          style={{ marginTop: 8 }}
        />
      </section>

      <section className="card">
        <div className="btn-row">
          <button
            type="button"
            className="btn btn-primary"
            onClick={submit}
            disabled={
              submitting ||
              activeProject !== null ||
              scriptTooLong ||
              scriptNotMarathi
            }
          >
            {submitting
              ? STR.submitting
              : inputMode === 'script'
                ? STR.videoCreateFromScript
                : STR.videoCreate}
          </button>
        </div>
        <p className="hint" style={{ marginTop: 8 }}>
          {STR.videoCreateHint}
        </p>
        {error ? <p className="form-error">{error}</p> : null}
      </section>

      {listedProjects.length > 0 ? (
        <section className="card">
          <h2>{STR.videoRecent}</h2>
          <ul className="file-list" style={{ marginTop: 10 }}>
            {listedProjects.map((project) => (
              <li key={project.id} className="file-row">
                <VideoStatusChip status={project.status} />
                <Link
                  href={`/video/${project.id}`}
                  className="file-name"
                  style={{ whiteSpace: 'normal' }}
                >
                  {project.title ?? project.heading ?? project.noteExcerpt}
                </Link>
                <span className="file-size">
                  {formatDate(project.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
