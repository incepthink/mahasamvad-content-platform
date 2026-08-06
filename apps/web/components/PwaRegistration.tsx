'use client';

import { useEffect } from 'react';

export function PwaRegistration() {
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
