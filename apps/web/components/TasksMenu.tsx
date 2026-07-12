'use client';

// Navbar "ongoing tasks" button + centered modal. Tracks every generation started this
// session from TasksProvider and lists them compactly: a one-line heading + a status
// dot/label, with a small poster thumbnail for twitter runs. Each row is a link to its
// detail page (/generations/{id}), where the full result and all actions already live.

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import type { GenerationDetail } from '@dgipr/schemas';
import { useTasks } from '../lib/TasksProvider';
import { STATUS_LABELS, STEP_LABELS, STR } from '../lib/strings';

// One-line title: user heading → twitter poster headline → truncated source note.
function taskTitle(task: GenerationDetail): string {
  const heading = task.heading?.trim();
  if (heading) return heading;
  const posterHeadline = task.copy?.headline?.trim();
  if (posterHeadline) return posterHeadline;
  const note = task.note.trim();
  return note.length > 80 ? `${note.slice(0, 80)}…` : note;
}

export function TasksMenu() {
  const { tasks, activeCount, isPanelOpen, openPanel, closePanel } = useTasks();
  const [mounted, setMounted] = useState(false);

  // Portal targets document.body, which only exists on the client.
  useEffect(() => setMounted(true), []);

  // While open: close on Escape and lock background scroll.
  useEffect(() => {
    if (!isPanelOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closePanel();
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [isPanelOpen, closePanel]);

  return (
    <div className="tasks-menu">
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

      {mounted && isPanelOpen
        ? createPortal(
            <div className="tasks-backdrop" onClick={closePanel}>
              <div
                className="tasks-modal"
                role="dialog"
                aria-modal="true"
                aria-label={STR.tasksTitle}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="tasks-modal-header">
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
                      const failed = task.status === 'failed';
                      const isTwitter = task.category === 'twitter';
                      const active =
                        task.status === 'queued' || task.status === 'running';
                      // Active runs show the fine-grained step; otherwise the status.
                      const statusLabel =
                        active && task.step
                          ? STEP_LABELS[task.step]
                          : STATUS_LABELS[task.status];
                      return (
                        <li key={task.id}>
                          <Link
                            className="task-row"
                            href={`/generations/${task.id}`}
                            onClick={closePanel}
                          >
                            {isTwitter ? (
                              task.posterUrl ? (
                                <img
                                  src={task.posterUrl}
                                  alt=""
                                  className="task-thumb"
                                />
                              ) : (
                                <span
                                  className="task-thumb task-thumb--pending"
                                  aria-hidden
                                />
                              )
                            ) : null}

                            <span className="task-row-body">
                              <span className="task-row-title">
                                {taskTitle(task)}
                              </span>
                              <span
                                className={`task-status task-status-${task.status}`}
                              >
                                <span
                                  className={`dot${active ? ' dot--pulse' : ''}`}
                                  aria-hidden
                                />
                                {statusLabel}
                              </span>
                              {failed ? (
                                <span className="task-error">
                                  {task.error ?? STR.failedHint}
                                </span>
                              ) : null}
                            </span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
