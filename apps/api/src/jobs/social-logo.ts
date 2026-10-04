// Which महाराष्ट्र शासन badge a social poster run carries (the 2026-10-03 logo rotation — the
// card, a circle or a quarter-circle tab, in the top-left or top-right corner; see
// SOCIAL_LOGO_STYLES in @dgipr/schemas).
//
// TWO QUESTIONS, TWO ANSWERS:
//
//   - What a NEW render should carry (initial run, a redo, every carousel slide):
//     socialLogoStyleFor(row). Deterministic from the generation id, so every slide of one post
//     and every redo of one run agree with no column to store it in.
//   - What an EXISTING poster carries (a feedback round, the Canva layer export):
//     currentSocialLogoStyle(poster, row). Read off the poster's own pixels first, because a
//     feedback round must erase exactly the badge that is there; the row-derived answer is only
//     the fallback when the pixels match none of our styles.
//
// Rows created before the rotation keep the card in the top-right, so a redo or a carousel slide
// of an older run still matches what that run already published.

import {
  DEFAULT_SOCIAL_LOGO_STYLE,
  isSocialLogoStyle,
  pickSocialLogoStyle,
  type SocialLogoStyle,
} from '@dgipr/schemas';
import { detectSocialLogoStyle } from '@dgipr/poster-renderer';

// Runs created before this instant keep the pre-rotation card. Override with
// SOCIAL_LOGO_ROTATION_SINCE (an ISO timestamp) if the deploy lands later than this.
const DEFAULT_ROTATION_SINCE = '2026-10-03T00:00:00.000Z';

let warnedSetting = false;

/**
 * SOCIAL_LOGO_STYLE: unset / 'rotate' (default) rotates through every style; one style name
 * (e.g. 'card-right') pins every new run to it; 'off' is the same as 'card-right'.
 */
export function socialLogoStyleFor(
  row: Readonly<{ id: string; createdAt: string }>,
): SocialLogoStyle {
  const setting = (process.env.SOCIAL_LOGO_STYLE ?? '').trim().toLowerCase();
  if (isSocialLogoStyle(setting)) return setting;
  if (setting === 'off') return DEFAULT_SOCIAL_LOGO_STYLE;
  if (setting !== '' && setting !== 'rotate' && !warnedSetting) {
    warnedSetting = true;
    console.warn(
      `[social-logo] unknown SOCIAL_LOGO_STYLE "${setting}" — rotating. Use rotate, off, or one of the style names.`,
    );
  }
  const since = Date.parse(
    process.env.SOCIAL_LOGO_ROTATION_SINCE?.trim() || DEFAULT_ROTATION_SINCE,
  );
  const created = Date.parse(row.createdAt);
  if (Number.isFinite(since) && Number.isFinite(created) && created < since) {
    return DEFAULT_SOCIAL_LOGO_STYLE;
  }
  return pickSocialLogoStyle(row.id);
}

/** The badge a finished poster actually carries; falls back to the run's own style. */
export async function currentSocialLogoStyle(
  poster: Buffer,
  row: Readonly<{ id: string; createdAt: string }>,
): Promise<SocialLogoStyle> {
  try {
    const detected = await detectSocialLogoStyle(poster);
    if (detected) return detected;
  } catch (error) {
    console.warn(
      '[social-logo] could not read the badge off the poster:',
      error,
    );
  }
  return socialLogoStyleFor(row);
}
