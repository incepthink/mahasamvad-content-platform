// Which महाराष्ट्र शासन badge a social poster run carries.
//
// THE DEFAULT IS THE WHITE CARD IN THE TOP-RIGHT CORNER (card-right), as it was before the
// 2026-10-03 logo rotation. The rotation (a card, a circle or a quarter-circle tab, top-left or
// top-right; see SOCIAL_LOGO_STYLES in @dgipr/schemas) was turned OFF by default on 2026-10-15
// and is now opt-in with SOCIAL_LOGO_STYLE=rotate. Every prompt builder and the chrome stamp treat
// card-right as "no style", so with the default they are byte-for-byte the pre-rotation output.
//
// TWO QUESTIONS, TWO ANSWERS:
//
//   - What a NEW render should carry (initial run, a redo, every carousel slide):
//     socialLogoStyleFor(row). card-right unless the env says otherwise; under `rotate` it is
//     deterministic from the generation id, so every slide of one post and every redo of one run
//     agree with no column to store it in.
//   - What an EXISTING poster carries (a feedback round, the Canva layer export):
//     currentSocialLogoStyle(poster, row). Read off the poster's own pixels first, because a
//     feedback round must erase exactly the badge that is there. KEEP THIS even with rotation
//     off: posters rendered while it was on carry a left, circle or quarter badge, and describing
//     the wrong badge to the edit model leaves the old one beside the re-stamped card.

import {
  DEFAULT_SOCIAL_LOGO_STYLE,
  isSocialLogoStyle,
  pickSocialLogoStyle,
  type SocialLogoStyle,
} from '@dgipr/schemas';
import { detectSocialLogoStyle } from '@dgipr/poster-renderer';

// Under `rotate`, runs created before this instant keep the pre-rotation card. Override with
// SOCIAL_LOGO_ROTATION_SINCE (an ISO timestamp).
const DEFAULT_ROTATION_SINCE = '2026-10-03T00:00:00.000Z';

let warnedSetting = false;

/**
 * SOCIAL_LOGO_STYLE: unset / 'off' (default) = card-right, the top-right card; one style name
 * (e.g. 'circle-left') pins every new run to it; 'rotate' rotates through every style.
 */
export function socialLogoStyleFor(
  row: Readonly<{ id: string; createdAt: string }>,
): SocialLogoStyle {
  const setting = (process.env.SOCIAL_LOGO_STYLE ?? '').trim().toLowerCase();
  if (isSocialLogoStyle(setting)) return setting;
  if (setting !== 'rotate') {
    if (setting !== '' && setting !== 'off' && !warnedSetting) {
      warnedSetting = true;
      console.warn(
        `[social-logo] unknown SOCIAL_LOGO_STYLE "${setting}" — using card-right. Use off, rotate, or one of the style names.`,
      );
    }
    return DEFAULT_SOCIAL_LOGO_STYLE;
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
