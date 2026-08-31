/**
 * The one catalog of formats the create form offers, and the only place a URL
 * `?format=` value is turned into something this form can hold.
 *
 * It lives beside the components rather than inside the page so the dropdown,
 * the submit logic and the lane predicates all read the same list — a second
 * name table beside it could disagree with the control the officer looked at.
 *
 * Every value except 'video' and 'caption' IS a Category value, so the request
 * needs essentially no mapping table. 'video' is a shortcut to /video, which runs
 * its own two-gate flow and cannot be submitted from here. 'caption' is the ONE
 * genuine pseudo-format: the caption-only lane is not a category at all, it is a
 * social run carrying outputType 'article' (which means "renders no poster" on
 * both lanes), so it submits as 'facebook' — see `submitCategoryOf` for why that
 * platform and not the other.
 */
import type { Category } from '@dgipr/schemas';
import { STR } from '@/lib/strings';

export type Format = Category | 'video' | 'caption';

/**
 * What the picker can actually leave selected. 'video' navigates away on click,
 * so it is never held in state.
 */
export type SelectableFormat = Extract<
  Format,
  'twitter' | 'scheme' | 'youtube' | 'caption'
>;

export type FormatOption = {
  value: Format;
  name: string;
  desc: string;
};

export const FORMATS: readonly FormatOption[] = [
  // ONE social entry. ट्विटर पोस्ट and फेसबुक पोस्ट were two options producing the
  // identical poster: both are social categories, so both take the ठरलेले टेम्पलेट
  // path (isSimpleTemplateEdit in the runner keys off isSocialCategory), the same
  // twitter master library (referenceCategoryOf), the same chrome and the same image
  // tier. It submits 'twitter' — the X on-brand lane — which is also what makes the
  // published post go to X. Facebook remains a real category everywhere else
  // (history, the detail page's cross-format fold, /dlo); it is only this picker
  // that stops asking.
  //
  // First in the list because it is the default and by far the most-used format.
  {
    value: 'twitter',
    name: STR.mediaFormatCreative,
    desc: STR.mediaFormatCreativeDesc,
  },
  {
    value: 'youtube',
    name: STR.mediaFormatYoutube,
    desc: STR.mediaFormatYoutubeDesc,
  },
  // The caption-only lane. NOT the same thing as the कॅप्शनही तयार करा checkbox under
  // क्रिएटिव्ह: that one adds a caption to a poster, this one produces a caption
  // INSTEAD of a poster — one model call, no image spend, no template, no design
  // question.
  {
    value: 'caption',
    name: STR.mediaFormatCaption,
    desc: STR.mediaFormatCaptionDesc,
  },
  { value: 'scheme', name: 'बॅनर', desc: STR.mediaFormatArticlePosterDesc },
  {
    value: 'video',
    name: STR.mediaOutputVideo,
    desc: STR.mediaOutputVideoDesc,
  },
] as const;

export const DEFAULT_FORMAT: SelectableFormat = 'twitter';

/** The label shown on the closed dropdown. Found, never mapped a second time. */
export function formatName(value: Format): string {
  return FORMATS.find((option) => option.value === value)?.name ?? '';
}

/**
 * Only the formats this picker can actually leave selected are honoured as a
 * `?format=` target, so a stale or hand-typed link can never put the form into a
 * state the picker cannot show.
 */
export function selectableFormatOf(
  value: string | null,
): SelectableFormat | null {
  // ?format=facebook still arrives from a finished Facebook run's cross-format link,
  // and the picker no longer has an entry for it — it folds into the one क्रिएटिव्ह
  // entry, which renders the same poster.
  if (value === 'facebook') return 'twitter';
  return value === 'twitter' || value === 'scheme' || value === 'youtube'
    ? value
    : null;
}

/**
 * What actually goes on the wire. 'caption' is not a Category, and the platform it
 * maps to is a real choice rather than a formality: generateSocialCaption branches on
 * it, and the twitter branch carries X's 280-character rule while the facebook branch
 * writes the long multi-paragraph caption. This lane is the long one — it is easier to
 * cut a caption down by hand than to expand one — so it submits 'facebook'.
 */
export function submitCategoryOf(format: SelectableFormat): Category {
  return format === 'caption' ? 'facebook' : format;
}
