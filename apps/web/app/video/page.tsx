'use client';

// Explainer-video entry: the create form (note + total length + orientation
// + quality tier) and the recent-project list. Submitting only writes the
// script (a text call — no video spend); the expensive steps sit behind the two
// review gates on the project page. One project renders at a time (the API
// enforces it server-side; the form reads the same fact from the list and says
// so instead of letting the submit bounce).

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type {
  VideoDurationBucket,
  VideoOrientation,
  VideoProjectSummary,
  VideoTier,
} from '@dgipr/schemas';
import {
  VIDEO_TIER_PRICE_PER_SECOND_USD,
  VIDEO_TOTAL_SECONDS,
} from '@dgipr/schemas';
import { createVideoProject, listVideoProjects } from '../../lib/api';
import { formatCost, formatDate, STR } from '../../lib/strings';
import { VideoStatusChip } from '../../components/VideoStatusChip';

const NOTE_MIN = 20;
const NOTE_MAX = 60_000;

const DURATION_OPTIONS: ReadonlyArray<{
  value: VideoDurationBucket;
  name: string;
  desc: string;
}> = [
  {
    value: 'short',
    name: STR.videoDurationShort,
    desc: STR.videoDurationShortHint,
  },
  {
    value: 'long',
    name: STR.videoDurationLong,
    desc: STR.videoDurationLongHint,
  },
];

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

// No 'lite': Veo's lite preview cannot interpolate between a start and an end
// frame — its reviewed end frames would be silently ignored. The schema keeps
// the value for legacy rows.
const TIER_OPTIONS: ReadonlyArray<{
  value: VideoTier;
  name: string;
  desc: string;
}> = [
  { value: 'fast', name: STR.videoTierFast, desc: STR.videoTierFastHint },
  {
    value: 'standard',
    name: STR.videoTierStandard,
    desc: STR.videoTierStandardHint,
  },
];

// A single figure rather than the old scene-count range: clips are billed per
// second and their lengths now add up to the selected TOTAL, so the total is
// the estimate — however the planner splits it into scenes. Gate 2 still shows
// the exact number, computed from the real per-scene windows.
function tierEstimate(bucket: VideoDurationBucket, tier: VideoTier): string {
  return formatCost(
    VIDEO_TOTAL_SECONDS[bucket] * VIDEO_TIER_PRICE_PER_SECOND_USD[tier],
  );
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
  const [note, setNote] = useState('');
  const [heading, setHeading] = useState('');
  const [durationBucket, setDurationBucket] =
    useState<VideoDurationBucket>('short');
  const [orientation, setOrientation] = useState<VideoOrientation>('landscape');
  const [tier, setTier] = useState<VideoTier>('fast');
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

  const submit = async () => {
    if (note.trim().length < NOTE_MIN) {
      setError(STR.videoNoteTooShort);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const id = await createVideoProject({
        note: note.trim(),
        ...(heading.trim() ? { heading: heading.trim() } : {}),
        durationBucket,
        orientation,
        tier,
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
        <label
          className="field-label"
          htmlFor="video-note"
          style={{ marginTop: 16 }}
        >
          {STR.videoNoteLabel}
        </label>
        <textarea
          id="video-note"
          className="note-input"
          value={note}
          maxLength={NOTE_MAX}
          onChange={(event) => setNote(event.target.value)}
          style={{ marginTop: 10 }}
        />
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
        <h2>{STR.videoDurationLabel}</h2>
        <div className="output-picker">
          {DURATION_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className="output-option"
              aria-pressed={durationBucket === option.value}
              onClick={() => setDurationBucket(option.value)}
            >
              <span className="name">{option.name}</span>
              <span className="desc">{option.desc}</span>
            </button>
          ))}
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
              onClick={() => setOrientation(option.value)}
            >
              <span className="name">{option.name}</span>
              <span className="desc">{option.desc}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="card">
        <h2>{STR.videoTierLabel}</h2>
        <div className="output-picker">
          {TIER_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className="output-option"
              aria-pressed={tier === option.value}
              onClick={() => setTier(option.value)}
            >
              <span className="name">{option.name}</span>
              <span className="desc">
                {option.desc}
                {' · '}
                {STR.videoAnimateEstimate}:{' '}
                {tierEstimate(durationBucket, option.value)}
              </span>
            </button>
          ))}
        </div>
        <p className="hint" style={{ marginTop: 8 }}>
          {STR.videoEstimateApprox}
        </p>
      </section>

      <section className="card">
        <div className="btn-row">
          <button
            type="button"
            className="btn btn-primary"
            onClick={submit}
            disabled={submitting || activeProject !== null}
          >
            {submitting ? STR.submitting : STR.videoCreate}
          </button>
        </div>
        <p className="hint" style={{ marginTop: 8 }}>
          {STR.videoCreateHint}
        </p>
        {error ? <p className="form-error">{error}</p> : null}
      </section>

      {projects.length > 0 ? (
        <section className="card">
          <h2>{STR.videoRecent}</h2>
          <ul className="file-list" style={{ marginTop: 10 }}>
            {projects.map((project) => (
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
                  {project.costUsd !== null
                    ? ` · ${formatCost(project.costUsd)}`
                    : ''}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
