'use client';

import React from 'react';
import Link from 'next/link';
import { AlertTriangle, Quote } from 'lucide-react';
import type { GenerationSummary } from '@dgipr/schemas';
import { aspectOf, hasArtwork, mediaKindOf } from '@/lib/mediaRoom';
import { GeneratingArtwork, GeneratingLines } from './GeneratingArtwork';

/**
 * One generation in the media room's gallery — the artwork, and nothing else.
 *
 * There is deliberately NO chrome on it — no caption strip (headline, status,
 * date) under the picture and no type badge over it. This is a gallery of
 * finished work, and a label on every tile turned the wall of posters into a
 * wall of forms; the poster carries its own headline in the image, and the
 * detail page is one click away for everything else. The one thing that cannot
 * be read off a picture — progress while it is still rendering — is shown in
 * place OF the picture, not on top of it.
 *
 * Three of the four output types deliver a picture and are shown as one, at
 * whatever shape they were actually rendered at. The fourth — Caption — renders
 * no poster at all, so it is shown as what it is: the text, on white. Giving it
 * a placeholder image tile would promise a picture that is never coming.
 */
export function MediaCard({ item }: { item: GenerationSummary }) {
  const kind = mediaKindOf(item);
  const generating = item.status === 'queued' || item.status === 'running';
  const failed = item.status === 'failed';

  return (
    <Link
      href={`/generations/${item.id}`}
      className="group relative block overflow-hidden bg-card no-underline shadow-sm transition-[transform,box-shadow] duration-150 hover:-translate-y-0.5 hover:shadow-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none motion-reduce:hover:translate-y-0"
    >
      {hasArtwork(kind) ? (
        <ArtworkSlot item={item} generating={generating} failed={failed} />
      ) : (
        <CaptionSlot
          text={item.headline ?? item.noteExcerpt}
          generating={generating}
          failed={failed}
        />
      )}
    </Link>
  );
}

/**
 * The picture, at its own size.
 *
 * The tile opens at the kind's EXPECTED ratio (so the masonry column is packed
 * to roughly the right height before any bytes arrive) and then adopts the
 * image's REAL ratio the moment it loads. That self-correction is what makes the
 * grid safe against a renderer whose output size changes: nothing here has to be
 * kept in step with the poster pipeline for the image to stay uncropped.
 */
function ArtworkSlot({
  item,
  generating,
  failed,
}: {
  item: GenerationSummary;
  generating: boolean;
  failed: boolean;
}) {
  const kind = mediaKindOf(item);
  const [measured, setMeasured] = React.useState<number | null>(null);

  if (generating) {
    return (
      <GeneratingArtwork
        aspect={aspectOf(kind)}
        status={item.status}
        step={item.step}
      />
    );
  }

  if (!item.posterUrl) {
    return (
      <EmptySlot
        aspect={aspectOf(kind)}
        failed={failed}
        message={failed ? 'Generation failed' : 'No image'}
      />
    );
  }

  return (
    <img
      src={item.posterUrl}
      alt=""
      loading="lazy"
      decoding="async"
      onLoad={(event) => {
        const image = event.currentTarget;
        if (image.naturalWidth > 0 && image.naturalHeight > 0) {
          setMeasured(image.naturalWidth / image.naturalHeight);
        }
      }}
      className="block w-full bg-accent object-cover"
      style={{ aspectRatio: measured ?? aspectOf(kind) }}
    />
  );
}

/**
 * The caption lane's tile: a white box with the text in it, which is the whole
 * output of that run. It keeps its text where the artwork cards lost theirs —
 * here the text IS the artwork, not a label describing one.
 */
function CaptionSlot({
  text,
  generating,
  failed,
}: {
  text: string;
  generating: boolean;
  failed: boolean;
}) {
  return (
    <div
      className="flex w-full flex-col justify-center bg-white px-5 py-7"
      style={{ minHeight: 240 }}
    >
      <Quote
        className="mb-3 size-5 shrink-0 text-primary/35"
        aria-hidden
        strokeWidth={2.4}
      />
      {generating ? (
        <GeneratingLines />
      ) : failed ? (
        <p className="m-0 flex items-center gap-2 text-sm font-medium text-destructive">
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
          Generation failed
        </p>
      ) : (
        <p className="m-0 line-clamp-[9] text-[0.95rem] leading-7 text-foreground">
          {text}
        </p>
      )}
    </div>
  );
}

/** A finished run with nothing to show — a failure, or a poster that never landed. */
function EmptySlot({
  aspect,
  failed,
  message,
}: {
  aspect: number;
  failed: boolean;
  message: string;
}) {
  return (
    <div
      className="flex w-full items-center justify-center bg-accent px-4 text-center"
      style={{ aspectRatio: aspect }}
    >
      <span
        className={`inline-flex items-center gap-2 text-sm font-medium ${
          failed ? 'text-destructive' : 'text-muted-foreground'
        }`}
      >
        {failed ? (
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
        ) : null}
        {message}
      </span>
    </div>
  );
}

/** Loading placeholder for the gallery itself, before the first list arrives. */
export function MediaCardSkeleton({ aspect }: { aspect: number }) {
  return (
    <div className="overflow-hidden bg-card shadow-sm" aria-hidden>
      <div
        className="skeleton w-full rounded-none"
        style={{ aspectRatio: aspect }}
      />
    </div>
  );
}
