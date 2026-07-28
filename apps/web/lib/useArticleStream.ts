'use client';

// Watch one run's article being written, so the officer reads it appearing instead of
// watching a progress bar for minutes.
//
// This is a VIEW, never a source of truth. The article lands on the row exactly as before and
// the ordinary useGeneration poll delivers it; everything here can fail — a restarted API, a
// proxy that will not pass an event stream, a browser without EventSource — and the only cost
// is that the officer sees the existing progress steps instead of the text. So there is no
// error state to render and nothing to retry by hand.
//
// The protocol's one rule: `snapshot` REPLACES, `delta` APPENDS. EventSource reconnects on its
// own after any drop and the server replays everything written so far as a snapshot — if that
// replay appended, a single blip would double the article on screen.

import { useEffect, useState } from 'react';
import { API_URL } from './api';

export function useArticleStream(
  id: string | null,
  // Off once the finished article is in hand: there is nothing left to watch, and holding the
  // connection open would only wait out the poster render.
  enabled: boolean,
): string {
  const [text, setText] = useState('');

  useEffect(() => {
    if (!id || !enabled) return;
    if (typeof EventSource === 'undefined') return;

    setText('');
    const source = new EventSource(
      `${API_URL}/api/generations/${id}/article/stream`,
    );

    // Both payloads are JSON strings — the article is full of newlines, which an SSE frame
    // cannot carry raw.
    const read = (event: Event): string => {
      const data = (event as MessageEvent<string>).data;
      try {
        const parsed: unknown = JSON.parse(data);
        return typeof parsed === 'string' ? parsed : '';
      } catch {
        return '';
      }
    };

    source.addEventListener('snapshot', (event) => setText(read(event)));
    source.addEventListener('delta', (event) => {
      const chunk = read(event);
      if (chunk) setText((previous) => previous + chunk);
    });
    // Close on `end` rather than letting the server's hang-up look like a failure: EventSource
    // treats any close as retryable and would reconnect to a run that is over.
    source.addEventListener('end', () => source.close());

    return () => source.close();
  }, [id, enabled]);

  return text;
}
