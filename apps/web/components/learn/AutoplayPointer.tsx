'use client';

// The pointer /learn's autoplay moves across the screen: it glides to the control the demo is
// about to press, then "presses" it (a ripple). Pure drawing — `pointer-events: none`, so it
// never takes a click, and portalled to <body> for the same reason as Spotlight (a glass card's
// backdrop-filter would make `position: fixed` relative to the card).

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AutoplayPointer as Pointer } from './useLessonAutoplay';

export function AutoplayPointer({ pointer }: { pointer: Pointer }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(
    <div
      className={'learn-pointer' + (pointer.visible ? ' is-visible' : '')}
      aria-hidden="true"
      style={{ transform: `translate(${pointer.x}px, ${pointer.y}px)` }}
    >
      {pointer.press > 0 ? (
        <span key={pointer.press} className="learn-pointer-ripple" />
      ) : null}
      <svg viewBox="0 0 24 24" width="28" height="28">
        <path
          d="M4 2.5 L4 19 L8.6 14.9 L11.6 21.5 L14.4 20.3 L11.4 13.8 L17.6 13.8 Z"
          fill="#fff"
          stroke="#1f1a17"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
      </svg>
    </div>,
    document.body,
  );
}
