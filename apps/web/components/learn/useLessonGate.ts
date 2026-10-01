'use client';

// /learn's page looks exactly like the real Creative screen — sidebar, format menu, template
// picker and all — but only the ONE control the coach is teaching may be used. Everything
// else is made inert here, at the window's capture phase, before React (which listens on the
// root container, below the window) or any library sees the event.
//
// Why a gate rather than `disabled` props: the screens are the REAL components, and a lesson
// that threaded "disable everything but X" through NoteComposer, SocialPostView, the sidebar
// and every card would be changing production code for a practice page. The gate needs no
// prop at all: an element is usable when it (or an ancestor) matches one of the step's
// selectors, or carries `data-learn-allow` (the coach's own callout).
//
// What is blocked, and what deliberately is not:
//   - clicks, pointer/mouse presses, context menus, drags and drops — the ways a control is
//     used with a pointer. A keyboard Enter/Space on a focused button arrives as a `click`,
//     so it is caught by the same rule;
//   - `beforeinput`/`paste`/`cut`/`drop` — typing into a box that is not being taught;
//   - activation keys on a focused control (Enter, Space, arrows), which is how a Radix menu
//     trigger opens without a click. Tab and Escape stay, so focus is never trapped.
//   - NOT scrolling (wheel, touch, the scrollbar): a page you cannot scroll is a page you
//     cannot read. Touch events are left alone for the same reason.

import { useEffect, useRef } from 'react';

const POINTER_EVENTS = [
  'click',
  'auxclick',
  'dblclick',
  'pointerdown',
  'mousedown',
  'contextmenu',
  'dragstart',
  'drop',
  'submit',
] as const;

const INPUT_EVENTS = ['beforeinput', 'paste', 'cut'] as const;

const PASS_KEYS = new Set(['Tab', 'Escape', 'Shift', 'Alt', 'Control', 'Meta']);

export function useLessonGate(
  allowed: readonly string[],
  // Called when a press is swallowed, so the coach can say why nothing happened.
  onBlocked?: () => void,
) {
  const allowedRef = useRef(allowed);
  allowedRef.current = allowed;
  const onBlockedRef = useRef(onBlocked);
  onBlockedRef.current = onBlocked;

  useEffect(() => {
    const permitted = (target: EventTarget | null): boolean => {
      // Not an element (the window, a text node's document): nothing to protect. The root
      // element and body are where scrollbar presses land.
      if (!(target instanceof Element)) return true;
      if (target === document.documentElement || target === document.body)
        return true;
      if (target.closest('[data-learn-allow]')) return true;
      return allowedRef.current.some(
        (selector) => target.closest(selector) !== null,
      );
    };

    const block = (event: Event, notify: boolean) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (notify) onBlockedRef.current?.();
    };

    const onPointer = (event: Event) => {
      if (permitted(event.target)) return;
      // One nudge per gesture: pointerdown, mousedown and click all arrive for one press.
      block(event, event.type === 'click');
    };
    const onInput = (event: Event) => {
      if (permitted(event.target)) return;
      block(event, true);
    };
    const onKey = (event: KeyboardEvent) => {
      if (PASS_KEYS.has(event.key) || permitted(event.target)) return;
      // Typing is caught by beforeinput; here only the keys that ACTIVATE a control.
      const activates =
        event.key === 'Enter' ||
        event.key === ' ' ||
        event.key.startsWith('Arrow');
      const inText =
        event.target instanceof HTMLElement &&
        (event.target.isContentEditable ||
          event.target instanceof HTMLTextAreaElement ||
          event.target instanceof HTMLInputElement);
      if (activates && !(inText && event.key.startsWith('Arrow')))
        block(event, true);
    };

    for (const type of POINTER_EVENTS)
      window.addEventListener(type, onPointer, true);
    for (const type of INPUT_EVENTS)
      window.addEventListener(type, onInput, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      for (const type of POINTER_EVENTS)
        window.removeEventListener(type, onPointer, true);
      for (const type of INPUT_EVENTS)
        window.removeEventListener(type, onInput, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, []);
}
