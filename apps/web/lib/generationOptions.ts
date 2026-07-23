// Option cards for the generation forms (home page + the detail page's
// "next step" panel), so both surfaces present identical choices.

import {
  Bird,
  Building2,
  ClipboardList,
  FileText,
  Files,
  Image as ImageIcon,
  Landmark,
  Newspaper,
  Palette,
  Sparkles,
  Target,
  ThumbsUp,
  type LucideIcon,
} from 'lucide-react';
import { isSocialCategory } from '@dgipr/schemas';
import type {
  Category,
  DesignMode,
  OutputType,
  TemplateBrand,
} from '@dgipr/schemas';
import { STR } from './strings';

export type GenerationOption<Value extends string> = Readonly<{
  value: Value;
  icon: LucideIcon;
  name: string;
  desc: string;
}>;

export const CATEGORY_OPTIONS: ReadonlyArray<GenerationOption<Category>> = [
  {
    value: 'scheme',
    icon: ClipboardList,
    name: STR.categoryScheme,
    desc: STR.categorySchemeDesc,
  },
  {
    value: 'news',
    icon: Newspaper,
    name: STR.categoryNews,
    desc: STR.categoryNewsDesc,
  },
  {
    value: 'twitter',
    icon: Bird,
    name: STR.categoryTwitter,
    desc: STR.categoryTwitterDesc,
  },
  // Same pipeline as ट्विटर पोस्ट (see isSocialCategory); lucide dropped its brand
  // glyphs, so ThumbsUp stands in — as Bird does for Twitter.
  {
    value: 'facebook',
    icon: ThumbsUp,
    name: STR.categoryFacebook,
    desc: STR.categoryFacebookDesc,
  },
];

// The two article voices only — for surfaces where a social run is not a choice
// (e.g. creating an article from a finished twitter/facebook post, or the DLO page).
export const ARTICLE_CATEGORY_OPTIONS: ReadonlyArray<
  GenerationOption<Category>
> = CATEGORY_OPTIONS.filter((option) => !isSocialCategory(option.value));

export const OUTPUT_OPTIONS: ReadonlyArray<GenerationOption<OutputType>> = [
  {
    value: 'article',
    icon: FileText,
    name: STR.outputArticle,
    desc: STR.outputArticleDesc,
  },
  {
    value: 'poster',
    icon: ImageIcon,
    name: STR.outputPoster,
    desc: STR.outputPosterDesc,
  },
  {
    value: 'both',
    icon: Files,
    name: STR.outputBoth,
    desc: STR.outputBothDesc,
  },
];

// What text a social follow-up (twitter/facebook) spawned from a finished article
// run is built from: the run's generated article (default) or the user's original note.
export type SocialSource = 'article' | 'note';

export const SOCIAL_SOURCE_OPTIONS: ReadonlyArray<
  GenerationOption<SocialSource>
> = [
  {
    value: 'article',
    icon: FileText,
    name: STR.sourceArticle,
    desc: STR.sourceArticleDesc,
  },
  {
    value: 'note',
    icon: ClipboardList,
    name: STR.sourceNote,
    desc: STR.sourceNoteDesc,
  },
];

// विभाग (template brand) cards — shown only for the social flows. DGIPR is the
// default department; CMO renders the fixed मंत्रिमंडळ निर्णय template.
export const BRAND_OPTIONS: ReadonlyArray<GenerationOption<TemplateBrand>> = [
  {
    value: 'dgipr',
    icon: Building2,
    name: STR.brandDgipr,
    desc: STR.brandDgiprDesc,
  },
  {
    value: 'cmo',
    icon: Landmark,
    name: STR.brandCmo,
    desc: STR.brandCmoDesc,
  },
];

export const DESIGN_OPTIONS: ReadonlyArray<GenerationOption<DesignMode>> = [
  {
    value: 'onbrand',
    icon: Target,
    name: STR.designOnbrand,
    desc: STR.designOnbrandDesc,
  },
  {
    value: 'adaptive',
    icon: Palette,
    name: STR.designAdaptive,
    desc: STR.designAdaptiveDesc,
  },
  {
    value: 'fresh',
    icon: Sparkles,
    name: STR.designFresh,
    desc: STR.designFreshDesc,
  },
];
