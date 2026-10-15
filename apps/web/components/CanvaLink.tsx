'use client';

// "Open this poster in Canva". Always a plain link: the link carries no account key, so the
// API hands off through its default Canva integration. The officer still signs in to Canva
// as themselves and the poster lands in their own account.

import { useApi } from '../lib/apiContext';
import { STR } from '../lib/strings';

export function CanvaLink({ generationId }: { generationId: string }) {
  const { posterCanvaUrl } = useApi();
  // Null = this surface offers no Canva handoff at all (the /learn practice).
  const href = posterCanvaUrl(generationId);
  if (href === null) return null;

  return (
    <a
      className="icon-btn canva-link"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={STR.iconOpenPosterInCanva}
      aria-label={STR.iconOpenPosterInCanva}
    >
      <img src="/canva.png" alt="" width={18} height={18} aria-hidden="true" />
      <span>Canva</span>
    </a>
  );
}
