'use client';

// Thumbnail strip of every stored poster render for a generation. Renders are
// immutable versioned PNGs, so older versions stay viewable/downloadable — the
// strip appears once a revision produced a second version. Clicking a thumbnail
// opens the full-size PNG in a new tab (the download proxy only serves the
// latest version; the public storage URLs are the canonical older copies).

import type { GenerationDetail } from '@dgipr/schemas';
import { STR, formatDate } from '../lib/strings';

export function PosterVersionStrip({ detail }: { detail: GenerationDetail }) {
  const versions = detail.posterVersions;
  if (versions.length < 2) return null;

  return (
    <div className="poster-versions">
      <h3 className="poster-versions-title">{STR.posterVersionsTitle}</h3>
      <div className="poster-versions-strip">
        {versions.map((version, index) => {
          const isCurrent = index === versions.length - 1;
          const tag = isCurrent
            ? STR.posterVersionCurrent
            : index === 0
              ? STR.posterVersionOriginal
              : `${STR.posterVersionLabel} ${index + 1}`;
          return (
            <a
              key={version.posterUrl}
              className="poster-versions-thumb"
              href={version.posterUrl}
              target="_blank"
              rel="noreferrer"
              title={`${tag} · ${formatDate(version.createdAt)} — ${STR.posterVersionOpen}`}
              aria-current={isCurrent ? 'true' : undefined}
            >
              <img src={version.posterUrl} alt={tag} loading="lazy" />
              <span className="poster-versions-tag">{tag}</span>
            </a>
          );
        })}
      </div>
    </div>
  );
}
