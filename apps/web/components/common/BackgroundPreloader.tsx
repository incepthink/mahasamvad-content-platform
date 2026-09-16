'use client';

/**
 * BackgroundPreloader — fetches every route's photograph once, on the first page
 * an officer opens, so switching lanes never paints a bare canvas first.
 *
 * Without it each background is requested the moment its route first renders, and
 * these are big files: the four distinct photographs in lib/pageBackgrounds.ts are
 * ~9.8 MB together, the largest 2.7 MB. On the department's connection that is a
 * visible blank-then-photo on every lane an officer has not visited yet.
 *
 * FOUR THINGS THAT KEEP "PRELOAD EVERYTHING" FROM COSTING MORE THAN IT BUYS, and
 * they are the whole design — a naive <link rel="preload"> for all four in <head>
 * would make the FIRST page slower to finish painting, which is the page the
 * officer is actually looking at:
 *
 * 1. IT WAITS FOR THE PAGE TO BE DONE. Nothing starts until `load` has fired and
 *    the browser reports idle time, so the current route's own background, the
 *    font and every API call have already had the connection to themselves. The
 *    current route's file is in the list too, and that costs nothing: it is the
 *    same URL, so it is a cache hit rather than a second download.
 *
 * 2. ONE AT A TIME. Four parallel multi-megabyte downloads saturate a thin
 *    connection and starve the polling requests /dlo and /video run while a job
 *    is in flight. Sequential keeps the warming in the background where it belongs.
 *
 * 3. IT ASKS FOR THE LOWEST PRIORITY IT CAN. `fetchPriority = 'low'` tells the
 *    browser these lose to anything the officer is waiting on.
 *
 * 4. IT RESPECTS A METERED CONNECTION. Data Saver or a 2g/slow-2g effective type
 *    means the officer is on a phone tariff, and spending 10 MB of it on wallpaper
 *    for pages they may never open is the wrong trade. There each background still
 *    loads on arrival, exactly as it did before this component existed.
 *
 * The warming is best-effort in every direction: a failed request is ignored (the
 * route will request it again normally) and nothing here can delay or break a page.
 * The `new Image()` route is used rather than <link rel="prefetch"> because it
 * populates the IMAGE cache in every browser the department uses, where prefetch
 * support and its cache semantics still vary.
 */

import { useEffect } from 'react';
import { PAGE_BACKGROUND_FILES } from '../../lib/pageBackgrounds';

// Module scope, not state: a route change remounts the tree, and re-running this
// on every navigation is the one thing that would turn a background task into a
// recurring one. Survives every navigation, resets on a real page load.
let warmed = false;

function connectionIsMetered(): boolean {
  const connection = (
    navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
    }
  ).connection;
  if (!connection) return false;
  if (connection.saveData) return true;
  return (
    connection.effectiveType === 'slow-2g' || connection.effectiveType === '2g'
  );
}

function warmSequentially(urls: readonly string[], index = 0): void {
  const url = urls[index];
  if (url === undefined) return;

  const image = new Image();
  // Both are hints, and an older browser simply ignores them rather than failing.
  image.fetchPriority = 'low';
  image.decoding = 'async';
  // Failure is as good as success here: either way we move on, and the route that
  // needs the file will request it itself.
  const next = () => warmSequentially(urls, index + 1);
  image.addEventListener('load', next, { once: true });
  image.addEventListener('error', next, { once: true });
  image.src = url;
}

export function BackgroundPreloader() {
  useEffect(() => {
    if (warmed) return;
    warmed = true;

    if (connectionIsMetered()) return;

    const start = () => {
      const idle = (
        window as Window & {
          requestIdleCallback?: (
            cb: () => void,
            opts?: { timeout: number },
          ) => void;
        }
      ).requestIdleCallback;
      // Safari has no requestIdleCallback; a short timer is the same intent —
      // after the page has settled, never during it.
      if (idle)
        idle(() => warmSequentially(PAGE_BACKGROUND_FILES), { timeout: 4000 });
      else
        window.setTimeout(() => warmSequentially(PAGE_BACKGROUND_FILES), 1500);
    };

    // `load`, not mount: React hydrates well before the page's own images and
    // fonts have finished, and starting there would put this back in their way.
    if (document.readyState === 'complete') start();
    else window.addEventListener('load', start, { once: true });
  }, []);

  return null;
}
