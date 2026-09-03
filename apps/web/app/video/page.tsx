'use client';

// Explainer-video entry: note mode writes narration from the supplied text;
// ready-script mode preserves supplied Marathi narration. Both divide it into
// as many five-second scenes as needed and keep expensive rendering behind the
// two review gates.

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  IMAGE_FILE_ACCEPT,
  NARRATION_AUDIO_ACCEPT,
  UPLOAD_FILE_MAX_BYTES,
  VIDEO_AI_PROMPT_MAX_CHARS,
  VIDEO_PROMPT_IMAGE_LIMIT,
  VIDEO_SCENE_MAX_SECONDS,
  estimateNarrationSeconds,
  isImageFileName,
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
import { FileName } from '../../components/FileName';

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
  // The officer's own direction, plus the pictures it refers to. Both are sent
  // to the planning model beside the lane's own task statement; neither is a
  // source of facts, which the field's hint and the prompt block both say.
  const [aiPrompt, setAiPrompt] = useState('');
  const [promptImages, setPromptImages] = useState<File[]>([]);
  const promptImageInputRef = useRef<HTMLInputElement | null>(null);
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
  // Shown, never enforced: a long script simply gets more five-second clips.
  // The line stays because the scene count is what gate 2 will be priced from.
  const scriptSceneCount = Math.max(
    1,
    Math.ceil(scriptEstimateSeconds / VIDEO_SCENE_MAX_SECONDS),
  );
  const scriptNotMarathi =
    inputMode === 'script' &&
    note.trim() !== '' &&
    !isMarathiVideoNarration(note);

  // Object URLs for the thumbnails, revoked when a picture leaves the list — a
  // create form can sit open for a long time while an officer writes the note.
  const promptImageUrls = useMemo(
    () => promptImages.map((file) => URL.createObjectURL(file)),
    [promptImages],
  );
  useEffect(
    () => () => {
      for (const url of promptImageUrls) URL.revokeObjectURL(url);
    },
    [promptImageUrls],
  );

  // The browser refuses what the route would refuse, so an oversized or
  // unsupported picture is reported before the upload starts (the /dlo picker
  // rule). The count is capped here too, because busboy's own `files` limit
  // silently STOPS emitting parts rather than rejecting.
  const addPromptImages = (files: readonly File[]) => {
    setError(null);
    const accepted: File[] = [];
    for (const file of files) {
      if (promptImages.length + accepted.length >= VIDEO_PROMPT_IMAGE_LIMIT) {
        setError(STR.videoPromptImagesFull(VIDEO_PROMPT_IMAGE_LIMIT));
        break;
      }
      if (!isImageFileName(file.name)) {
        setError(STR.videoPromptImageWrongType);
        continue;
      }
      if (file.size > UPLOAD_FILE_MAX_BYTES) {
        setError(STR.videoPromptImageTooBig);
        continue;
      }
      accepted.push(file);
    }
    if (accepted.length > 0) {
      setPromptImages((current) => [...current, ...accepted]);
    }
  };

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
          ...(aiPrompt.trim() ? { aiPrompt: aiPrompt.trim() } : {}),
          inputMode,
          orientation,
          tier: 'fast',
        },
        // Only ever with a ready script — a note run has no final words for a
        // recording to be of.
        inputMode === 'script' ? narrationAudio : null,
        promptImages,
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
                <FileName name={narrationAudio.name} className="hint" />
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
          htmlFor="video-ai-prompt"
          style={{ marginTop: 16 }}
        >
          {STR.videoAiPromptLabel}
        </label>
        <p className="hint" style={{ marginTop: 4 }}>
          {STR.videoAiPromptHint}
        </p>
        <textarea
          id="video-ai-prompt"
          className="note-input"
          style={{ marginTop: 8, minHeight: 90 }}
          value={aiPrompt}
          maxLength={VIDEO_AI_PROMPT_MAX_CHARS}
          placeholder={STR.videoAiPromptPlaceholder}
          disabled={submitting}
          onChange={(event) => setAiPrompt(event.target.value)}
        />
        <p className="field-label" style={{ marginTop: 12 }}>
          {STR.videoPromptImagesLabel}
        </p>
        <p className="hint" style={{ marginTop: 4 }}>
          {STR.videoPromptImagesHint}
        </p>
        {/* Hidden input driven by a button, so the control matches every other
            affordance on the page instead of the browser's default chrome. Its
            value is cleared after each pick, or re-choosing the SAME file fires
            no change event and nothing appears to happen. */}
        <input
          ref={promptImageInputRef}
          type="file"
          accept={IMAGE_FILE_ACCEPT}
          multiple
          style={{ display: 'none' }}
          onChange={(event) => {
            const files = [...(event.target.files ?? [])];
            event.target.value = '';
            addPromptImages(files);
          }}
        />
        {promptImages.length > 0 ? (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 10,
              marginTop: 10,
            }}
          >
            {promptImages.map((file, index) => (
              <figure
                key={`${file.name}-${index}`}
                style={{ margin: 0, width: 132 }}
              >
                <img
                  src={promptImageUrls[index]}
                  alt={STR.videoPromptImageAlt(index + 1)}
                  style={{
                    width: '100%',
                    height: 96,
                    objectFit: 'cover',
                    borderRadius: 8,
                    display: 'block',
                  }}
                />
                <figcaption>
                  <FileName name={file.name} className="hint" max={18} />
                  <button
                    type="button"
                    className="btn btn-small"
                    style={{ marginTop: 4 }}
                    disabled={submitting}
                    onClick={() =>
                      setPromptImages((current) =>
                        current.filter((_, at) => at !== index),
                      )
                    }
                  >
                    {STR.videoPromptImagesRemove}
                  </button>
                </figcaption>
              </figure>
            ))}
          </div>
        ) : null}
        <div className="btn-row" style={{ marginTop: 10 }}>
          <button
            type="button"
            className="btn btn-small"
            disabled={
              submitting || promptImages.length >= VIDEO_PROMPT_IMAGE_LIMIT
            }
            onClick={() => promptImageInputRef.current?.click()}
          >
            {STR.videoPromptImagesAdd}
          </button>
        </div>
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
