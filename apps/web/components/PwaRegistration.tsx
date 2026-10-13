'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { rememberShareDestination } from '../lib/sharedAudio';

export function PwaRegistration() {
  const pathname = usePathname();

  // The officer leaves the page to share from WhatsApp or the recorder, so the share itself
  // carries no hint of where it came from — the service worker reads this instead.
  useEffect(() => {
    if (pathname) void rememberShareDestination(pathname);
  }, [pathname]);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    void navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .catch((error) => {
        // A registration failure must never block the ordinary website. HTTPS/localhost is
        // required by the platform, so a plain-LAN development URL can legitimately land here.
        console.error('[pwa] Service worker registration failed:', error);
      });
  }, []);

  return null;
}
