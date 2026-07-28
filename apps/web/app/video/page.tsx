'use client';

// Explainer-video entry: the create form and recent-project list. New projects
// always use the 30-second, landscape, balanced configuration. Submitting only
// writes the script (a text call — no video spend); the expensive steps sit
// behind the two review gates on the project page. One project renders at a
// time (the API enforces it server-side; the form reads the same fact from the
// list and says so instead of letting the submit bounce).

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { VideoProjectSummary } from '@dgipr/schemas';
import { createVideoProject, listVideoProjects } from '../../lib/api';
import { formatCost, formatDate, STR } from '../../lib/strings';
import { VideoStatusChip } from '../../components/VideoStatusChip';

const NOTE_MIN = 20;
const NOTE_MAX = 60_000;

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
