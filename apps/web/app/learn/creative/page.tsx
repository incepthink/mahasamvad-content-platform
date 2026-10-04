'use client';

// /learn/creative — the first practice lesson: make a Creative and change it.
//
// The page looks exactly like the real Creative and Social screen, sidebar included; the
// lesson (components/learn/LessonRunner) lights the one control each step teaches, attaches
// the coach's help to it, and leaves everything else inert. The whole workspace sits inside
// the sandbox API, so nothing is saved, published or charged, the URL never changes and no
// /generations link appears — the run does not exist anywhere but here.
//
// Autoplay (spoken explanations, the lesson doing each step) is chosen on the intro or with ▶
// in the coach head. The choice is saved too; after a reload it resumes PAUSED, because a
// browser plays no sound before the learner's first click on the page.
//
// Progress is kept in localStorage so a reload resumes at the same stage. Read after mount,
// never during render (the server has no localStorage, and a first render that differs from
// the server's is a hydration mismatch), which is why nothing renders until `boot` is known.

import { useCallback, useEffect, useRef, useState } from 'react';
import { editChatStorageKey } from '../../../components/EditChat';
import {
  LessonRunner,
  type AutoplayStart,
} from '../../../components/learn/LessonRunner';
import {
  parseSandboxState,
  SAMPLE_ID,
  type SandboxState,
} from '../../../lib/learn/creativeSandbox';

const STORAGE_KEY = 'dgipr.learn.creative';

type Saved = Readonly<{
  started: boolean;
  autoplay: boolean;
  sandbox: SandboxState | null;
}>;

const EMPTY: Saved = { started: false, autoplay: false, sandbox: null };

function load(): Saved {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as {
      started?: unknown;
      autoplay?: unknown;
      sandbox?: unknown;
    };
    return {
      started: parsed.started === true,
      autoplay: parsed.autoplay === true,
      sandbox: parseSandboxState(parsed.sandbox),
    };
  } catch {
    return EMPTY;
  }
}

function save(saved: Saved) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  } catch {
    // Storage blocked: the lesson still works, it just will not survive a reload.
  }
}

function clearSaved() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    // The sample run's edit-assistant conversation, so a new lesson starts with none.
    window.localStorage.removeItem(editChatStorageKey(SAMPLE_ID, 'social'));
  } catch {
    // Nothing to clear.
  }
}

export default function CreativeLessonPage() {
  const [boot, setBoot] = useState<Saved | null>(null);
  // Bumped to start over: remounts the runner, whose sandbox and form are its own state.
  const [run, setRun] = useState(0);

  // Read by `persist`, which is stable: nothing to keep until the lesson has begun.
  const started = useRef(false);
  started.current = boot?.started === true;
  // The latest saved pieces, so each writer keeps the other's.
  const autoplay = useRef(false);
  autoplay.current = boot?.autoplay === true;
  const sandboxRef = useRef<SandboxState | null>(null);

  useEffect(() => {
    // Opened from the /learn list (`?fresh=1`): a new practice from the beginning, not the
    // one left half-done last time. The flag is removed from the URL straight away, so a
    // reload after that still resumes where the learner is.
    const url = new URL(window.location.href);
    if (url.searchParams.has('fresh')) {
      clearSaved();
      url.searchParams.delete('fresh');
      window.history.replaceState(window.history.state, '', url);
    }
    setBoot(load());
  }, []);

  const start = (withAutoplay: boolean) => {
    clearSaved();
    sandboxRef.current = null;
    const next: Saved = { started: true, autoplay: withAutoplay, sandbox: null };
    save(next);
    setBoot(next);
    setRun((n) => n + 1);
  };

  const persist = useCallback((sandbox: SandboxState) => {
    sandboxRef.current = sandbox;
    if (started.current)
      save({ started: true, autoplay: autoplay.current, sandbox });
  }, []);

  const persistAutoplay = useCallback((on: boolean) => {
    autoplay.current = on;
    if (started.current)
      save({ started: true, autoplay: on, sandbox: sandboxRef.current });
  }, []);

  if (boot === null) return null;
  // On this mount: just chosen on the intro (playing), or restored from storage (paused).
  const autoplayStart: AutoplayStart = !boot.autoplay
    ? 'off'
    : run > 0
      ? 'playing'
      : 'paused';
  return (
    <LessonRunner
      key={run}
      started={boot.started}
      onStart={start}
      initial={run === 0 ? (boot.sandbox ?? undefined) : undefined}
      onStateChange={persist}
      onRestart={start}
      autoplayStart={autoplayStart}
      onAutoplayChange={persistAutoplay}
    />
  );
}
