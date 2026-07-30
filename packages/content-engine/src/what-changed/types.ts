export const CHANGE_LABELS = [
  'पहिली नोंद',
  'संग्रहित नोंद',
  'नवीन निर्णय',
  'आकड्यात बदल',
  'मुदत बदल',
  'अंमलबजावणी',
  'काम पूर्ण',
  'स्थिती कायम',
  'प्रलंबित',
  'विसंगती',
  'पुढील टप्पा',
] as const;

export type ChangeLabel = (typeof CHANGE_LABELS)[number];

export type StoredNewsArticle = Readonly<{
  articleId: number;
  title: string;
  url: string;
  publishedTime: string | null;
  text: string;
}>;

export type TopicCandidate = Readonly<{
  article: StoredNewsArticle;
  lexicalScore: number;
  semanticSimilarity: number | null;
  preview: string;
}>;

export type CitedSummary = Readonly<{
  title: string;
  detail: string;
  citations: readonly number[];
}>;

export type ChangeSummary = Readonly<{
  label: ChangeLabel;
  title: string;
  before: string;
  now: string;
  explanation: string;
  citations: readonly number[];
}>;

export type ConflictSummary = Readonly<{
  title: string;
  earlier: string;
  later: string;
  status: string;
  citations: readonly number[];
}>;

export type TimelineEntry = Readonly<{
  articleId: number;
  label: ChangeLabel;
  title: string;
  summary: string;
  citations: readonly number[];
}>;

export type WhatChangedAnalysis = Readonly<{
  heading: string;
  summary: string;
  latest: CitedSummary;
  changes: readonly ChangeSummary[];
  unchanged: readonly CitedSummary[];
  conflicts: readonly ConflictSummary[];
  nextSteps: readonly CitedSummary[];
  timeline: readonly TimelineEntry[];
}>;

export type WhatChangedResult = Readonly<{
  subject: string;
  scannedArticleCount: number;
  candidateCount: number;
  articles: readonly StoredNewsArticle[];
  latestArticleId: number;
  analysis: WhatChangedAnalysis;
}>;
