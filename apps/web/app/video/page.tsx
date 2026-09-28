'use client';

// Storyboard entry (/video). Note mode writes a narration script from the
// supplied text; ready-script mode keeps the supplied Marathi narration word for
// word. Both divide it into as many five-second scenes as needed and stop at the
// review gates — nothing on this page spends on a video render.
//
// The layout follows Creative and Social (app/page.tsx) on purpose: one composer
// card holding the text, the tool row (attachments, the source choice, the frame
// shape) and the submit, then an optional AI-prompt card, then the history. The
// source choice is two check chips that behave as a pair — exactly one is always
// ticked — because that is the control officers already know from the home page.

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AudioLines, Image as ImageIcon } from 'lucide-react';
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
import { formatFileSize } from '../../lib/fileSize';
import { useFilePreviews } from '../../lib/useFilePreviews';
import { cn } from '../../lib/utils';
import { VideoStatusChip } from '../../components/VideoStatusChip';
import { ErrorNotice } from '../../components/ErrorNotice';
import { PageShell } from '../../components/common/PageShell';
import { FormCard } from '../../components/common/FormCard';
import { FieldLabel } from '../../components/common/FieldLabel';
import { PromptTextarea } from '../../components/common/PromptTextarea';
import { ComposerToolbarButton } from '../../components/common/ComposerToolbarButton';
import {
  AttachmentStrip,
  type AttachmentItem,
} from '../../components/common/AttachmentStrip';
import { CheckOption } from '../../components/media-room/NoteComposer';

const NOTE_MIN = 20;

const INPUT_MODE_OPTIONS: ReadonlyArray<{
  value: VideoInputMode;
  name: string;
  desc: string;
}> = [
  {
    value: 'note',
    name: STR.videoInputModeNote,
    desc: STR.videoInputModeNoteDesc,
  },
  {
    value: 'script',
    name: STR.videoInputModeScript,
    desc: STR.videoInputModeScriptDesc,
  },
];

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

// मागील स्टोरीबोर्ड shows the runs worth keeping, not every experiment the
// pipeline ever produced: the named projects below plus everything created from
// now on. A cutoff rather than a hide-list, so new runs need no code change — and
// the gate is presentational only, `activeProject` below still reads the FULL list
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
  const previews = useFilePreviews(promptImages);
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
  const [audioUnreadable, setAudioUnreadable] = useState(false);
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
  const isScript = inputMode === 'script';
  // With a recording in hand its measured length IS the storyboard's length, so
  // the char-rate estimate is not merely less precise — it is the wrong number,
  // and showing it beside the file would contradict what the server will do.
  const usingUploadedAudio = isScript && narrationAudio !== null;
  const scriptEstimateSeconds =
    usingUploadedAudio && audioSeconds !== null
      ? audioSeconds
      : estimateNarrationSeconds(normalizeVideoNarrationScript(note));
  // Shown, never enforced: a long script simply gets more five-second scenes.
  const scriptSceneCount = Math.max(
    1,
    Math.ceil(scriptEstimateSeconds / VIDEO_SCENE_MAX_SECONDS),
  );
  const scriptNotMarathi =
    isScript && note.trim() !== '' && !isMarathiVideoNarration(note);
  const canSubmit =
    !submitting && activeProject === null && !scriptNotMarathi;

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
    setAudioUnreadable(false);
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
    setAudioUnreadable(false);
    const url = URL.createObjectURL(file);
    const probe = new Audio();
    probe.preload = 'metadata';
    probe.onloadedmetadata = () => {
      const seconds = probe.duration;
      URL.revokeObjectURL(url);
      if (Number.isFinite(seconds) && seconds > 0) setAudioSeconds(seconds);
      else setAudioUnreadable(true);
    };
    probe.onerror = () => {
      URL.revokeObjectURL(url);
      setAudioUnreadable(true);
    };
    probe.src = url;
  };

  // The two source chips act as ONE choice: ticking one selects it, and
  // unticking the one already selected does nothing — there is always a source.
  const chooseMode = (mode: VideoInputMode) => {
    if (mode === inputMode) return;
    setInputMode(mode);
    setError(null);
    // A note run rewrites the narration, so a recording of the old words would
    // be silently wrong; drop it rather than carry it.
    if (mode === 'note') clearAudio();
  };

  const submit = async () => {
    if (note.trim().length < NOTE_MIN) {
      setError(isScript ? STR.videoScriptTooShort : STR.videoNoteTooShort);
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
        isScript ? narrationAudio : null,
        promptImages,
      );
      router.push(`/video/${id}`);
    } catch (e) {
      setError(errorMessage(e));
      setSubmitting(false);
    }
  };

  // ONE strip for everything attached — the recording first, then the pictures —
  // the same row the home composer and /dlo use.
  const attachments: AttachmentItem[] = [
    ...(isScript && narrationAudio
      ? [
          {
            id: 'narration-audio',
            name: narrationAudio.name,
            icon: AudioLines,
            meta: audioUnreadable
              ? STR.videoNarrationAudioUnreadable
              : formatFileSize(narrationAudio.size),
            removeLabel: `${STR.videoNarrationAudioRemove}: ${narrationAudio.name}`,
            onRemove: clearAudio,
          },
        ]
      : []),
    ...promptImages.map((file, index) => ({
      id: `image-${index}-${file.name}`,
      name: file.name,
      icon: ImageIcon,
      ...(previews.get(file) ? { previewUrl: previews.get(file) } : {}),
      meta: formatFileSize(file.size),
      removeLabel: `${STR.videoPromptImagesRemove}: ${file.name}`,
      onRemove: () =>
        setPromptImages((current) => current.filter((_, at) => at !== index)),
    })),
  ];

  const sourceHint = isScript
    ? `${STR.videoScriptInputHint} ${STR.videoNarrationAudioHint}`
    : STR.videoInputModeNoteDesc;

  return (
    <PageShell
      background="video"
      title={STR.videoTitle}
      subtitle={STR.videoIntro}
    >
      <div className="flex flex-col gap-5">
        <FormCard
          className="mr-note-composer"
          htmlFor="video-note"
          label={
            <FieldLabel
              helpId="video-note-help"
              label={isScript ? STR.videoScriptInputLabel : STR.videoNoteLabel}
              hint={sourceHint}
            />
          }
        >
          <div className="mt-4">
            <PromptTextarea
              id="video-note"
              value={note}
              disabled={submitting}
              onChange={(next) => {
                setNote(next);
                if (next.trim()) setError(null);
              }}
              placeholder={
                isScript ? STR.videoScriptPlaceholder : STR.videoNotePlaceholder
              }
              className="min-h-36"
            />
          </div>

          <AttachmentStrip
            items={attachments}
            disabled={submitting}
            className="mt-3"
          />

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <ComposerToolbarButton
              icon={ImageIcon}
              label={STR.videoPromptImagesAdd}
              disabled={
                submitting || promptImages.length >= VIDEO_PROMPT_IMAGE_LIMIT
              }
              onClick={() => promptImageInputRef.current?.click()}
            />
            {/* Only a ready script can have a recording of it: a note run writes
                its own narration. */}
            {isScript ? (
              <ComposerToolbarButton
                icon={AudioLines}
                label={STR.videoNarrationAudioLabel}
                disabled={submitting}
                onClick={() => audioInputRef.current?.click()}
              />
            ) : null}

            <div
              role="group"
              aria-label={STR.videoInputModeLabel}
              className="contents"
            >
              {INPUT_MODE_OPTIONS.map((option) => (
                <CheckOption
                  key={option.value}
                  checked={inputMode === option.value}
                  disabled={submitting}
                  onChange={() => chooseMode(option.value)}
                  label={option.name}
                  title={option.desc}
                />
              ))}
            </div>

            <OrientationControl
              value={orientation}
              disabled={submitting}
              onChange={setOrientation}
            />

            <button
              type="button"
              onClick={() => void submit()}
              disabled={!canSubmit}
              className={cn(
                'mr-submit-button text-primary-foreground ml-auto inline-flex h-9 shrink-0 items-center rounded-md px-5 text-sm font-bold transition-[filter]',
                'focus-visible:ring-ring/50 outline-none focus-visible:ring-[3px]',
                'disabled:cursor-not-allowed disabled:opacity-60',
                canSubmit
                  ? 'mr-submit-flow hover:saturate-110 hover:brightness-105'
                  : 'bg-primary',
              )}
            >
              {submitting
                ? STR.submitting
                : isScript
                  ? STR.videoCreateFromScript
                  : STR.videoCreate}
            </button>

            <input
              ref={promptImageInputRef}
              type="file"
              accept={IMAGE_FILE_ACCEPT}
              multiple
              hidden
              onChange={(event) => {
                const files = [...(event.target.files ?? [])];
                // Cleared so re-picking the SAME file still fires a change.
                event.target.value = '';
                addPromptImages(files);
              }}
            />
            <input
              ref={audioInputRef}
              type="file"
              accept={NARRATION_AUDIO_ACCEPT}
              hidden
              onChange={(event) => pickAudio(event.target.files?.[0] ?? null)}
            />
          </div>

          {/* Everything the press depends on is stated under the button. */}
          <p className="text-muted-foreground mt-2 text-sm">
            {STR.videoCreateHint}
          </p>
          {isScript && note.trim() !== '' && !scriptNotMarathi ? (
            usingUploadedAudio && audioSeconds === null ? null : (
              <p className="text-muted-foreground mt-1 text-sm">
                {usingUploadedAudio
                  ? STR.videoNarrationAudioMeasured
                  : STR.videoScriptEstimateLabel}
                :{' '}
                {videoReadyScriptEstimate(
                  scriptEstimateSeconds,
                  scriptSceneCount,
                )}
              </p>
            )
          ) : null}
          {activeProject ? (
            <p className="text-muted-foreground mt-2 text-sm">
              {STR.videoActiveBlocked}{' '}
              <Link
                href={`/video/${activeProject.id}`}
                className="underline"
              >
                {activeProject.title ??
                  activeProject.heading ??
                  activeProject.noteExcerpt}
              </Link>
            </p>
          ) : null}
          {scriptNotMarathi ? (
            <div className="mt-3">
              <ErrorNotice message={STR.videoScriptMarathiOnly} />
            </div>
          ) : null}
          {error ? (
            <div className="mt-3">
              <ErrorNotice message={error} />
            </div>
          ) : null}
        </FormCard>

        <FormCard
          htmlFor="video-ai-prompt"
          label={
            <FieldLabel
              helpId="video-ai-prompt-help"
              label={STR.videoAiPromptLabel}
              hint={`${STR.videoAiPromptHint} ${STR.videoPromptImagesHint}`}
            />
          }
        >
          <PromptTextarea
            id="video-ai-prompt"
            maxLength={VIDEO_AI_PROMPT_MAX_CHARS}
            placeholder={STR.videoAiPromptPlaceholder}
            value={aiPrompt}
            disabled={submitting}
            onChange={setAiPrompt}
            className="mt-4 max-h-60 min-h-20 w-full"
          />
        </FormCard>

        {listedProjects.length > 0 ? (
          <section className="glass-card rounded-2xl p-4 sm:p-5">
            <h2 className="text-foreground text-base font-semibold">
              {STR.videoRecent}
            </h2>
            {/* Chip and date share the first line on a phone with the title under
                them at full width; from `sm` up the three sit on one line. A title
                squeezed between the two fixed-width items was one glyph wide. */}
            <ul className="mt-3 flex list-none flex-col gap-2 p-0">
              {listedProjects.map((project) => (
                <li
                  key={project.id}
                  className="bg-card flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border px-3 py-2.5"
                >
                  <span className="order-1 shrink-0">
                    <VideoStatusChip status={project.status} />
                  </span>
                  <span className="text-muted-foreground order-2 ml-auto shrink-0 text-xs sm:order-3">
                    {formatDate(project.createdAt)}
                  </span>
                  <Link
                    href={`/video/${project.id}`}
                    className="text-foreground order-3 min-w-0 basis-full text-sm font-medium wrap-anywhere hover:underline sm:order-2 sm:flex-1 sm:basis-0"
                  >
                    {project.title ?? project.heading ?? project.noteExcerpt}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </PageShell>
  );
}

/**
 * आडवा / उभा as one segmented chip in the tool row — the home composer's slide-count
 * control (`mr-slide-count`, theme.css), so the row reads as one band of controls.
 */
function OrientationControl({
  value,
  disabled,
  onChange,
}: {
  value: VideoOrientation;
  disabled: boolean;
  onChange: (next: VideoOrientation) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={STR.videoOrientationLabel}
      className={cn(
        'mr-slide-count inline-flex h-9 shrink-0 items-center gap-1 rounded-md border p-1 text-sm',
        disabled && 'pointer-events-none opacity-50',
      )}
    >
      <span className="px-1.5 opacity-80">{STR.videoOrientationLabel}</span>
      {ORIENTATION_OPTIONS.map((option) => {
        const selected = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            title={option.desc}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              'h-7 rounded px-2 transition-colors',
              selected
                ? 'bg-primary text-primary-foreground font-semibold'
                : 'hover:bg-secondary',
            )}
          >
            {option.name}
          </button>
        );
      })}
    </div>
  );
}
