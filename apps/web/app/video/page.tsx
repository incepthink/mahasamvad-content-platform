'use client';

// Explainer-video entry: note mode writes a 30-second narration; ready-script
// mode preserves supplied Marathi narration and estimates its natural duration
// for free. Both keep expensive rendering behind the two review gates.

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  NARRATION_AUDIO_ACCEPT,
  UPLOAD_FILE_MAX_BYTES,
  VIDEO_CLIP_MAX_SECONDS,
  estimateNarrationSeconds,
  isMarathiVideoNarration,
  normalizeVideoNarrationScript,
  type VideoInputMode,
  type VideoOrientation,
  type VideoProjectSummary,
} from '@dgipr/schemas';
import { createVideoProject, listVideoProjects } from '../../lib/api';
import { formatDate, STR, videoReadyScriptEstimate } from '../../lib/strings';
import { errorMessage } from '../../lib/errorMessage';
import { VideoStatusChip } from '../../components/VideoStatusChip';
import { ErrorNotice } from '../../components/ErrorNotice';

const NOTE_MIN = 20;

// Landscape stays the default; vertical (9:16) is the reels/status shape. The
// frame provider takes an ASPECT rather than a pixel size, so this is the only
// thing an officer has to choose for it.
const ORIENTATION_OPTIONS: ReadonlyArray<{
  value: VideoOrientation;
  name: string;
  desc: string;
}> = [
  {
    value: 'landscape',
    name: STR.videoOrientationLandscape,
    desc: STR.videoOrientationLandscapeHint,
  },
  {
    value: 'vertical',
    name: STR.videoOrientationVertical,
    desc: STR.videoOrientationVerticalHint,
  },
];

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
  const [orientation, setOrientation] = useState<VideoOrientation>('landscape');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [projects, setProjects] = useState<VideoProjectSummary[]>([]);
  // The officer's own voiceover (ready-script mode). `audioSeconds` is what the
  // BROWSER measured — null when the container has no decoder here, which is not
  // a refusal: the server decodes with ffmpeg and is the authority. Measuring at
  // all is what lets an over-long file be refused before it is uploaded.
  const [narrationAudio, setNarrationAudio] = useState<File | null>(null);
  const [audioSeconds, setAudioSeconds] = useState<number | null>(null);
  const audioInputRef = useRef<HTMLInputElement | null>(null);

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
  // With a recording in hand its measured length IS the video's length, so the
  // char-rate estimate is not merely less precise — it is the wrong number, and
  // showing it beside the file would contradict what the server will do.
  const usingUploadedAudio = inputMode === 'script' && narrationAudio !== null;
  const scriptEstimateSeconds =
    usingUploadedAudio && audioSeconds !== null
      ? audioSeconds
      : estimateNarrationSeconds(normalizeVideoNarrationScript(note));
  // Shown, never enforced (2026-08-12): the two-minute ceiling this used to be
  // measured against is gone, so a long script simply gets more clips. The line
  // stays because the scene count is what gate 2 will be priced from.
  const scriptSceneCount = Math.max(
    1,
    Math.ceil(scriptEstimateSeconds / VIDEO_CLIP_MAX_SECONDS),
  );
  const scriptNotMarathi =
    inputMode === 'script' &&
    note.trim() !== '' &&
    !isMarathiVideoNarration(note);

  const clearAudio = () => {
    setNarrationAudio(null);
    setAudioSeconds(null);
    if (audioInputRef.current) audioInputRef.current.value = '';
  };

  // Read the file's duration locally before anything is uploaded. A container
  // this browser cannot decode leaves `audioSeconds` null and the file is still
  // sent — ffmpeg on the server reads more formats than any one browser does.
  const pickAudio = (file: File | null) => {
    setError(null);
    if (!file) {
      clearAudio();
      return;
    }
    if (file.size > UPLOAD_FILE_MAX_BYTES) {
      setError(STR.videoNarrationAudioTooBig);
      clearAudio();
      return;
    }
    setNarrationAudio(file);
    setAudioSeconds(null);
    const url = URL.createObjectURL(file);
    const probe = new Audio();
    probe.preload = 'metadata';
    probe.onloadedmetadata = () => {
      const seconds = probe.duration;
      URL.revokeObjectURL(url);
      if (Number.isFinite(seconds) && seconds > 0) setAudioSeconds(seconds);
    };
    probe.onerror = () => {
      URL.revokeObjectURL(url);
    };
    probe.src = url;
  };

  const submit = async () => {
    if (note.trim().length < NOTE_MIN) {
      setError(
        inputMode === 'script'
          ? STR.videoScriptTooShort
          : STR.videoNoteTooShort,
      );
      return;
    }
    if (scriptNotMarathi) {
      setError(STR.videoScriptMarathiOnly);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const id = await createVideoProject(
        {
          note: note.trim(),
          ...(heading.trim() ? { heading: heading.trim() } : {}),
          inputMode,
          durationBucket: 'short',
          orientation,
          tier: 'fast',
        },
        // Only ever with a ready script — a note run has no final words for a
        // recording to be of.
        inputMode === 'script' ? narrationAudio : null,
      );
      router.push(`/video/${id}`);
    } catch (e) {
      setError(errorMessage(e));
      setSubmitting(false);
    }
  };

  return (
    <main className="page">
      <header className="page-head">
        <div className="page-head-text">
          <h1 className="page-title">{STR.videoTitle}</h1>
          <p className="page-sub">{STR.videoIntro}</p>
        </div>
      </header>

      <section className="card">
        {activeProject ? (
          <div className="info-callout" style={{ marginBottom: 20 }}>
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
        <p className="field-label">{STR.videoInputModeLabel}</p>
        <div className="segmented" style={{ marginTop: 10 }}>
          <button
            type="button"
            className="output-option"
            aria-pressed={inputMode === 'note'}
            onClick={() => {
              setInputMode('note');
              setError(null);
              // A note run rewrites the narration, so a recording of the old
              // words would be silently wrong; drop it rather than carry it.
              clearAudio();
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
            {usingUploadedAudio && audioSeconds === null ? null : (
              <p className="hint" style={{ marginTop: 8 }}>
                {usingUploadedAudio
                  ? STR.videoNarrationAudioMeasured
                  : STR.videoScriptEstimateLabel}
                :{' '}
                {videoReadyScriptEstimate(
                  scriptEstimateSeconds,
                  scriptSceneCount,
                )}
              </p>
            )}
            {scriptNotMarathi ? (
              <ErrorNotice message={STR.videoScriptMarathiOnly} />
            ) : null}
          </>
        ) : null}
        {inputMode === 'script' ? (
          <>
            <p className="field-label" style={{ marginTop: 16 }}>
              {STR.videoNarrationAudioLabel}
            </p>
            <p className="hint" style={{ marginTop: 4 }}>
              {STR.videoNarrationAudioHint}
            </p>
            <input
              ref={audioInputRef}
              type="file"
              accept={NARRATION_AUDIO_ACCEPT}
              disabled={submitting}
              onChange={(event) => pickAudio(event.target.files?.[0] ?? null)}
              style={{ marginTop: 8 }}
            />
            {narrationAudio ? (
              <div className="btn-row" style={{ marginTop: 8 }}>
                <span className="hint">{narrationAudio.name}</span>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={submitting}
                  onClick={clearAudio}
                >
                  {STR.videoNarrationAudioRemove}
                </button>
              </div>
            ) : null}
            {narrationAudio && audioSeconds === null ? (
              <p className="hint" style={{ marginTop: 6 }}>
                {STR.videoNarrationAudioUnreadable}
              </p>
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
        <h2>{STR.videoOrientationLabel}</h2>
        <div className="output-picker">
          {ORIENTATION_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className="output-option"
              aria-pressed={orientation === option.value}
              disabled={submitting}
              onClick={() => setOrientation(option.value)}
            >
              <span className="name">{option.name}</span>
              <span className="desc">{option.desc}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="card card-action">
        <div className="btn-row">
          <button
            type="button"
            className="btn btn-primary"
            onClick={submit}
            disabled={submitting || activeProject !== null || scriptNotMarathi}
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
        {error ? <ErrorNotice message={error} /> : null}
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
