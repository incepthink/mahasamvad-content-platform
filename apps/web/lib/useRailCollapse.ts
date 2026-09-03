'use client';

// Whether the conversation rail is collapsed to an icon strip.
//
// ONE KEY FOR EVERY CONVERSATION SURFACE (/chat and /new-video-workflow), which is the
// decision worth knowing: an officer who has put the list away has expressed a preference
// about how they want to work, not about one page, and finding it expanded again after
// switching surfaces would read as the setting not sticking. It is the same stance — and the
// same localStorage shape — as the app sidebar's own `sidebar-collapsed`.
//
// Read in an effect rather than in the initial state, so the server-rendered markup and the
// first client render agree; the strip appears a frame later, which is what the sidebar
// already does.

import { useCallback, useEffect, useState } from 'react';

const COLLAPSED_KEY = 'dgipr.rail-collapsed';

export function useRailCollapse(): {
  collapsed: boolean;
  toggle: () => void;
} {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(COLLAPSED_KEY) === '1') {
        setCollapsed(true);
      }
    } catch {
      // A disabled or full localStorage costs the remembered state, never the control.
    }
  }, []);

  const toggle = useCallback(() => {
    setCollapsed((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0');
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  return { collapsed, toggle };
}
