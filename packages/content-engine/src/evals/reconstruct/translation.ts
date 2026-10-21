// भाषांतर — STAND-IN. Ad-hoc /translate runs are not stored at all, so round 1 reviews the one
// translation the database does keep: a generated article's English and/or Hindi version. The
// trace says so in its name, its metadata and its notes, so it is never read as the page itself.

import type { GenerationRow } from '@dgipr/database';
import {
  activitySpans,
  compact,
  lastTimestamp,
  sortSpans,
  traceId,
  type ActivityLite,
  type ReconstructedTrace,
  type TraceSpan,
} from '../trace.js';

export const TRANSLATION_STAND_IN_NOTE =
  'Not the /translate page: ad-hoc translations are not stored. This is a generated article translated from its detail page.';

const TRANSLATE_ACTION = /translat/i;

export function buildTranslationTrace(
  row: GenerationRow,
  activity: readonly ActivityLite[],
): ReconstructedTrace {
  const languages = [
    ...(row.articleEnglish ? ['en'] : []),
    ...(row.articleHindi ? ['hi'] : []),
  ];
  // The activity log names a translation but not its language, so the earliest translate event
  // dates the first span; anything else falls back to the row's last update.
  const translateEvents = activity
    .filter((e) => TRANSLATE_ACTION.test(e.action))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const spans: TraceSpan[] = [];
  for (const [index, language] of languages.entries()) {
    const event = translateEvents[index];
    spans.push({
      key: `translation:${language}`,
      name: language === 'en' ? 'Marathi → English' : 'Marathi → Hindi',
      type: 'llm',
      startedAt: event?.settledAt ?? event?.createdAt ?? row.updatedAt,
      input: { marathi: row.article },
      output: {
        translation: language === 'en' ? row.articleEnglish : row.articleHindi,
      },
    });
  }
  spans.push(...activitySpans(activity));
  const sorted = sortSpans(spans);
  return {
    id: traceId('translate', row.id),
    feature: 'translate',
    rowId: row.id,
    name: `translate (article stand-in) · ${languages.join('+')}`,
    startedAt: row.createdAt,
    endedAt: lastTimestamp(row.updatedAt, sorted),
    input: { marathi: row.article },
    output: compact({ english: row.articleEnglish, hindi: row.articleHindi }),
    metadata: compact({
      feature: 'translate',
      lane: languages.join('+'),
      reconstructed: true,
      standIn: 'generation-article-translation',
      status: row.status,
      createdAt: row.createdAt,
      category: row.category,
      generationId: row.id,
      fromDlo: row.dloIntakeId ? true : null,
    }),
    spans: sorted,
    notes: [TRANSLATION_STAND_IN_NOTE],
  };
}
