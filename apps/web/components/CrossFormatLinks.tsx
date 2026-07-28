'use client';

// "Make this for another platform" — one icon link per social format this run is NOT.
// A ट्विटर run offers फेसबुक, a फेसबुक run offers ट्विटर, and a लेख run offers both.
//
// Renders a FRAGMENT of bare links, with no wrapper of its own, so it slots straight
// into whichever action row a surface already has (the poster's icon row, the article's
// button row). Each reads platform mark → platform name → arrow, and carries the full
// Marathi sentence as title + aria-label.
//
// These are LINKS, not actions: they open Creative and Social with the run's note
// prefilled and the target format preselected (`?from=<id>&format=<platform>`), and the
// officer still presses तयार करा there. That is deliberate — the create form is where the
// template pin, the caption toggle and the note itself are decided, and duplicating those
// questions in a fold on this page (what the old NextActions cross-format blocks did)
// meant two surfaces had to agree about what a social run can be.

import type { ComponentType } from 'react';
import Link from 'next/link';
import { ArrowRight, ThumbsUp } from 'lucide-react';
import type { Category } from '@dgipr/schemas';
import { STR } from '../lib/strings';
import { XLogo } from './XLogo';

const SOCIAL_PLATFORMS = ['twitter', 'facebook'] as const;
type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

// The X mark is a hand-drawn glyph, not a Lucide icon, so the table is typed on the
// props both accept rather than on LucideIcon (the media room's FORMATS does the same).
type PlatformIcon = ComponentType<{ size?: number; strokeWidth?: number }>;

const PLATFORM_COPY: Record<
  SocialPlatform,
  { name: string; label: string; icon: PlatformIcon }
> = {
  twitter: {
    name: STR.crossFormatTwitterShort,
    label: STR.crossFormatToTwitter,
    icon: XLogo,
  },
  facebook: {
    name: STR.crossFormatFacebookShort,
    label: STR.crossFormatToFacebook,
    icon: ThumbsUp,
  },
};

export function CrossFormatLinks({
  generationId,
  category,
}: {
  generationId: string;
  category: Category;
}) {
  const targets = SOCIAL_PLATFORMS.filter((platform) => platform !== category);
  if (targets.length === 0) return null;

  return (
    <>
      {targets.map((platform) => {
        const { name, label, icon: Icon } = PLATFORM_COPY[platform];
        return (
          <Link
            key={platform}
            className="icon-btn cross-format-link"
            href={`/?from=${encodeURIComponent(generationId)}&format=${platform}`}
            // The visible name is only the platform; the sentence stays the accessible
            // name, so what the button DOES is never shape- or context-only.
            title={label}
            aria-label={label}
          >
            <Icon size={17} strokeWidth={1.9} />
            <span>{name}</span>
            <ArrowRight size={15} strokeWidth={2.2} aria-hidden="true" />
          </Link>
        );
      })}
    </>
  );
}
