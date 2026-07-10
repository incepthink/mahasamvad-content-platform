'use client';

// Navbar "ongoing tasks" button + popover. Tracks Twitter/n8n background runs from
// TasksProvider: a staged progress bar while running, and on completion the finished
// poster + caption inline (copy / download / regenerate / open full). This is the
// primary surface for twitter runs — the create page never navigates for them.

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { GenerationDetail } from '@dgipr/schemas';
import { createGeneration, posterDownloadUrl } from '../lib/api';
import { useTasks } from '../lib/TasksProvider';
import { STR } from '../lib/strings';
import { StatusChip } from './StatusChip';
import { TaskProgressBar } from './TaskProgressBar';

function taskTitle(task: GenerationDetail): string {
  const heading = task.heading?.trim();
  if (heading) return heading;
  const note = task.note.trim();
  return note.length > 64 ? `${note.slice(0, 64)}…` : note;
}

export function TasksMenu() {
  const {
    tasks,
    activeCount,
    addTask,
    isPanelOpen,
    openPanel,
    closePanel,
  } = useTasks();
  const menuRef = useRef<HTMLDivElement>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState<string | null>(null);

  // Close on outside click / Escape while open.
  useEffect(() => {
    if (!isPanelOpen) return;
    const onPointer = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        closePanel();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closePanel();
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [isPanelOpen, closePanel]);

  const copyCaption = async (task: GenerationDetail) => {
    if (!task.article) return;
    try {
      await navigator.clipboard.writeText(task.article);
      setCopiedId(task.id);
      setTimeout(() => setCopiedId((id) => (id === task.id ? null : id)), 1800);
    } catch {
      /* clipboard blocked — ignore */
    }
  };

  const regenerate = async (task: GenerationDetail) => {
    setRegenerating(task.id);
    try {
      const newId = await createGeneration({
        note: task.note,
        heading: task.heading ?? undefined,
        category: 'twitter',
        outputType: 'poster',
        designMode: task.designMode ?? 'onbrand',
      });
      addTask(newId);
      openPanel();
    } finally {
      setRegenerating((id) => (id === task.id ? null : id));
    }
  };

  return (
    <div className="tasks-menu" ref={menuRef}>
      <button
        type="button"
        className="tasks-button"
        aria-expanded={isPanelOpen}
        aria-haspopup="dialog"
        onClick={() => (isPanelOpen ? closePanel() : openPanel())}
      >
        {STR.tasksButton}
        {activeCount > 0 ? (
          <span className="tasks-badge" aria-label={String(activeCount)}>
            {activeCount}
          </span>
        ) : null}
      </button>

      {isPanelOpen ? (
        <div className="tasks-popover" role="dialog" aria-label={STR.tasksTitle}>
          <div className="tasks-popover-header">
            <strong>{STR.tasksTitle}</strong>
            <button
              type="button"
              className="tasks-close"
              aria-label="बंद करा"
              onClick={closePanel}
            >
              ✕
            </button>
          </div>

          {tasks.length === 0 ? (
            <p className="tasks-empty">{STR.tasksEmpty}</p>
          ) : (
            <ul className="task-list">
              {tasks.map((task) => {
                const done = task.status === 'completed';
                const failed = task.status === 'failed';
                const isTwitter = task.category === 'twitter';
                return (
                  <li key={task.id} className="task-row">
                    <Link
                      className="task-row-title"
                      href={`/generations/${task.id}`}
                      onClick={closePanel}
                    >
                      {taskTitle(task)}
                    </Link>

                    {isTwitter ? (
                      <TaskProgressBar status={task.status} step={task.step} />
                    ) : (
                      <StatusChip status={task.status} />
                    )}

                    {failed ? (
                      <p className="task-error">{task.error ?? STR.failedHint}</p>
                    ) : null}

                    {/* Rich in-panel result + actions are the twitter surface; other
                        categories navigate to their detail page via the title link. */}
                    {isTwitter && done && task.posterUrl ? (
                      <div className="task-result">
                        <img
                          src={task.posterUrl}
                          alt={STR.posterTitle}
                          className="task-thumb"
                        />
                        {task.article ? (
                          <p className="task-caption">{task.article}</p>
                        ) : null}
                      </div>
                    ) : null}

                    {isTwitter && (done || failed) ? (
                      <div className="task-actions">
                        {done && task.article ? (
                          <button
                            type="button"
                            className="btn btn-small"
                            onClick={() => copyCaption(task)}
                          >
                            {copiedId === task.id
                              ? STR.copied
                              : STR.taskCopyCaption}
                          </button>
                        ) : null}
                        {done && task.posterUrl ? (
                          <a
                            className="btn btn-small"
                            href={posterDownloadUrl(task.id)}
                          >
                            {STR.taskDownloadPoster}
                          </a>
                        ) : null}
                        <button
                          type="button"
                          className="btn btn-small"
                          disabled={regenerating === task.id}
                          onClick={() => regenerate(task)}
                        >
                          {STR.taskRegenerate}
                        </button>
                        {done ? (
                          <Link
                            className="btn btn-small"
                            href={`/generations/${task.id}`}
                            onClick={closePanel}
                          >
                            {STR.taskViewFull}
                          </Link>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}

          <div className="tasks-popover-footer">
            <Link
              className="btn btn-small"
              href="/generations"
              onClick={closePanel}
            >
              {STR.navHistory}
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
