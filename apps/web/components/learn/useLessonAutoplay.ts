'use client';

// /learn's autoplay: a spoken explanation at the start of each step, then the lesson does the
// step itself, with a pointer gliding to what it presses.
//
// The lesson stays state-derived. This hook never decides WHICH step is current; it is told
// the current clip (from the step) and asks `nextAction()` (from the step and facts) what to do
// once the clip has been heard. So a learner who acts first just moves the lesson on: the clip
// for the finished step stops and the next one starts. The exception is a WAIT clip ("the
// poster is being made…"), which plays to the end even if the sandbox is faster.
//
// Imperative on purpose: one audio element, a few timers, and a `sync()` that looks at where
// things stand and takes the next small step. Driving this through React state would turn
// every timer into an effect dependency and every clip end into a re-render race.
//
// Browsers only play sound after a user gesture. The intro's ▶ button calls
// `unlockLessonAudio()` inside its click, which plays silence through the ONE shared element
// and so unlocks it for the rest of the page's life (Safari tracks this per element). After a
// reload there has been no gesture yet, so autoplay resumes paused and the learner presses ▶.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { FeedbackRegion } from '@dgipr/schemas';
import type { AutoAction } from '../../lib/learn/creativeAutoplay';

export type NarrationClip = Readonly<{
  // Committed audio for the line, or undefined until it has been generated.
  src: string | undefined;
  // How long to wait when there is no audio file.
  fallbackSeconds: number;
  // Plays to the end even when its step finishes first.
  wait: boolean;
}>;

export type AutoplayPointer = Readonly<{
  x: number;
  y: number;
  visible: boolean;
  // Bumped at each "press", for the ripple.
  press: number;
}>;

// Half a second of silence, to unlock the element inside a click.
const SILENCE =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=';

let sharedAudio: HTMLAudioElement | null = null;
function lessonAudio(): HTMLAudioElement {
  if (!sharedAudio) {
    sharedAudio = new Audio();
    sharedAudio.preload = 'auto';
  }
  return sharedAudio;
}

// Call synchronously inside the click that starts autoplay.
export function unlockLessonAudio() {
  try {
    const audio = lessonAudio();
    audio.onended = null;
    audio.src = SILENCE;
    void audio.play().catch(() => {});
  } catch {
    // No audio support: autoplay still runs on the fallback timings.
  }
}

const READ_PAUSE_MS = 700; // after a clip, before the pointer moves
const REPEAT_PAUSE_MS = 1200; // between two actions in one step
const GLIDE_MS = 750; // the pointer's travel (matches the CSS transition)
const AFTER_PRESS_MS = 300;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  );
}

function onScreen(rect: DOMRect): boolean {
  return (
    rect.bottom > 0 &&
    rect.right > 0 &&
    rect.top < window.innerHeight &&
    rect.left < window.innerWidth
  );
}

export function useLessonAutoplay({
  initialPlaying,
  clipKey,
  clip,
  factsKey,
  nextAction,
  locate,
  perform,
  stopAtEnd,
}: {
  initialPlaying: boolean;
  // The current step's clip; null when the step has none.
  clipKey: string | null;
  clip: NarrationClip | null;
  // Changes whenever the lesson's facts do, so the next action is reconsidered.
  factsKey: string;
  nextAction: () => AutoAction | null;
  // Where on the screen an action happens: an element (scrolled into view first), or a
  // region of one (the headline is part of the poster image). Null: no pointer.
  locate: (
    action: AutoAction,
  ) => Readonly<{ element: Element; region?: FeedbackRegion }> | null;
  perform: (action: AutoAction) => void;
  // A clip after which autoplay stops (the recap).
  stopAtEnd: string;
}) {
  const [playing, setPlayingState] = useState(initialPlaying);
  const [muted, setMuted] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [pointer, setPointer] = useState<AutoplayPointer>({
    x: 0,
    y: 0,
    visible: false,
    press: 0,
  });

  // Everything sync() reads, current at all times.
  const live = useRef({ playing, clipKey, clip, factsKey, nextAction, locate, perform });
  live.current = { playing, clipKey, clip, factsKey, nextAction, locate, perform };

  const run = useRef({
    active: null as string | null, // the clip that owns the speaker
    activeWait: false,
    audioClip: false, // the active clip is a real audio file (not a fallback timer)
    started: false, // the active clip has begun (audio or timer)
    done: false, // …and has been heard to the end
    clipTimer: null as ReturnType<typeof setTimeout> | null,
    actionTimer: null as ReturnType<typeof setTimeout> | null,
    acting: false,
    lastDone: '', // action + facts at the last action, so a no-op is not repeated
    acted: false, // an action has run during this clip
    generation: 0, // bumped on pause/unmount to abandon an action mid-glide
  });

  const setPlaying = useCallback((next: boolean) => {
    live.current.playing = next;
    setPlayingState(next);
  }, []);

  const clearTimers = () => {
    const r = run.current;
    if (r.clipTimer) clearTimeout(r.clipTimer);
    if (r.actionTimer) clearTimeout(r.actionTimer);
    r.clipTimer = null;
    r.actionTimer = null;
  };

  // sync() and the helpers call each other; a ref keeps them from being stale closures.
  const syncRef = useRef<() => void>(() => {});

  const startClip = (key: string | null, clip: NarrationClip | null) => {
    const r = run.current;
    clearTimers();
    r.active = key;
    r.activeWait = clip?.wait ?? false;
    r.audioClip = Boolean(clip?.src);
    r.done = false;
    r.started = true;
    r.acted = false;
    r.lastDone = '';
    const audio = lessonAudio();
    audio.pause();
    if (!key || !clip) {
      r.done = true;
      return;
    }
    const finish = () => {
      if (run.current.active !== key) return;
      run.current.done = true;
      syncRef.current();
    };
    if (!clip.src) {
      r.clipTimer = setTimeout(finish, clip.fallbackSeconds * 1000);
      return;
    }
    audio.onended = finish;
    audio.src = clip.src;
    audio.currentTime = 0;
    void audio.play().catch(() => {
      // No gesture yet (a reload): pause, and let the learner press ▶.
      if (run.current.active !== key) return;
      run.current.started = false;
      setBlocked(true);
      setPlaying(false);
    });
  };

  const act = async () => {
    const r = run.current;
    r.actionTimer = null;
    const action = live.current.nextAction();
    if (!action || !live.current.playing) return;
    r.acting = true;
    const generation = r.generation;
    const stillOn = () =>
      run.current.generation === generation && live.current.playing;
    try {
      const where = live.current.locate(action);
      if (where) {
        const { element, region } = where;
        if (!onScreen(element.getBoundingClientRect())) {
          element.scrollIntoView({ block: 'center', behavior: 'smooth' });
          await sleep(450);
          if (!stillOn()) return;
        }
        const box = element.getBoundingClientRect();
        const x = region
          ? box.left + (region.x + region.width / 2) * box.width
          : box.left + box.width / 2;
        const y = region
          ? box.top + (region.y + region.height / 2) * box.height
          : box.top + box.height / 2;
        setPointer((p) => ({ ...p, x, y, visible: true }));
        await sleep(prefersReducedMotion() ? 150 : GLIDE_MS);
        if (!stillOn()) return;
        setPointer((p) => ({ ...p, press: p.press + 1 }));
      }
      r.lastDone = JSON.stringify(action) + live.current.factsKey;
      r.acted = true;
      live.current.perform(action);
      await sleep(AFTER_PRESS_MS);
    } finally {
      r.acting = false;
      setTimeout(() => {
        if (!run.current.acting) setPointer((p) => ({ ...p, visible: false }));
      }, 900);
    }
    // Even when paused and resumed mid-glide: the resume's sync found this action still
    // running and stood back, so this is where the lesson picks up again.
    if (live.current.playing) syncRef.current();
  };

  syncRef.current = () => {
    const r = run.current;
    const { playing, clipKey, clip, factsKey } = live.current;
    if (!playing) return;
    if (clipKey !== r.active || !r.started) {
      // A wait clip that is still being heard keeps the speaker; its end calls sync again.
      if (r.started && r.activeWait && !r.done && clipKey !== r.active) return;
      startClip(clipKey, clip);
      if (!run.current.done) return;
    }
    if (!r.done) return;
    if (r.acting || r.actionTimer) return;
    const action = live.current.nextAction();
    if (!action) {
      if (r.active === stopAtEnd) setPlaying(false);
      return;
    }
    // The last action changed nothing (a refusal, say): do not press it again and again.
    if (JSON.stringify(action) + factsKey === r.lastDone) return;
    r.actionTimer = setTimeout(
      () => void act(),
      r.acted ? REPEAT_PAUSE_MS : READ_PAUSE_MS,
    );
  };

  // A new clip, new facts, or ▶/⏸: take the next step.
  useEffect(() => {
    if (!playing) {
      const r = run.current;
      r.generation += 1;
      clearTimers();
      lessonAudio().pause();
      // A fallback timer cannot be resumed part-way: replay that clip on ▶.
      if (!r.done && !r.audioClip) r.started = false;
      setPointer((p) => ({ ...p, visible: false }));
      return;
    }
    syncRef.current();
  }, [playing, clipKey, factsKey]);

  useEffect(() => {
    lessonAudio().muted = muted;
  }, [muted]);

  useEffect(
    () => () => {
      run.current.generation += 1;
      clearTimers();
      const audio = lessonAudio();
      audio.onended = null;
      audio.pause();
    },
    [],
  );

  // ▶ / ⏸. Called from a click, so ▶ may start audio directly (the gesture a reload needs).
  const toggle = useCallback(() => {
    const r = run.current;
    if (live.current.playing) {
      setPlaying(false);
      return;
    }
    setBlocked(false);
    setPlaying(true);
    const audio = lessonAudio();
    if (r.started && !r.done && r.audioClip && audio.paused) {
      void audio.play().catch(() => {
        setBlocked(true);
        setPlaying(false);
      });
    } else if (!r.started) {
      // First play after a reload: start inside the gesture.
      unlockLessonAudio();
    }
  }, [setPlaying]);

  const toggleMute = useCallback(() => setMuted((m) => !m), []);

  return { playing, muted, blocked, pointer, toggle, toggleMute };
}
