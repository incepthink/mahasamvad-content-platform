'use client';

// Next.js preserves layouts between client-side navigations, but it unmounts
// route pages. The DLO flow contains local files, corrected OCR text, page
// selections, and in-flight jobs that must survive moving to another app tab.
// Mount it once in the root layout, hide it while another route is active, and
// reveal the same component instance when the officer returns.

import dynamic from 'next/dynamic';
import { useEffect, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';

const DloWorkspace = dynamic(() => import('./DloWorkspace'), {
  ssr: false,
});

export function PersistentAppContent({
  children,
}: Readonly<{ children: ReactNode }>) {
  const pathname = usePathname();
  const isDlo = pathname === '/dlo' || pathname.startsWith('/dlo/');
  const [hasMountedDlo, setHasMountedDlo] = useState(isDlo);

  useEffect(() => {
    if (isDlo) setHasMountedDlo(true);
  }, [isDlo]);

  return (
    <>
      {hasMountedDlo ? (
        <div style={{ display: isDlo ? 'contents' : 'none' }}>
          <DloWorkspace />
        </div>
      ) : null}
      <div style={{ display: isDlo ? 'none' : 'contents' }}>{children}</div>
    </>
  );
}
