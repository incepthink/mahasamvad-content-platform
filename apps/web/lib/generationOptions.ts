// Option cards for the generation forms (home page + the detail page's
// "next step" panel), so both surfaces present identical choices.

import {
  Bird,
  ClipboardList,
  FileText,
  Files,
  Image as ImageIcon,
  Newspaper,
  Palette,
  Sparkles,
  Target,
  type LucideIcon,
} from 'lucide-react';
import type { Category, DesignMode, OutputType } from '@dgipr/schemas';
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
];

// The two article voices only — for surfaces where a twitter run is not a choice
// (e.g. creating an article from a finished twitter post).
export const ARTICLE_CATEGORY_OPTIONS: ReadonlyArray<
  GenerationOption<Category>
> = CATEGORY_OPTIONS.filter((option) => option.value !== 'twitter');

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
