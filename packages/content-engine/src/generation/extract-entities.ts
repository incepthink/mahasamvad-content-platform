// Auto-extract glossary candidates (proper nouns) from a Marathi article.
//
// Companion to translate-article.ts: every time we translate, we mine the Marathi article
// for proper nouns — person names, designations, scheme names, places, organizations —
// and their correct English rendering. Candidates are stored UNVERIFIED (source 'auto')
// for a human to review; once verified they lock into future translations. This grows the
// glossary automatically without inventing facts — it only MAPS terms already in the text.
//
// Uses OpenAI (deterministic, temperature 0) with strict-JSON output. JSON parsing is
// defensive (code-fence stripping + array-span extraction), mirroring the guard-and-throw
// style of generate-copy.ts — the translate job treats extraction as best-effort.

import { pathToFileURL } from 'node:url';
import type { TermType } from '@dgipr/database';
import { chatComplete, type ChatMessage } from './openai-chat.js';

// One extracted candidate. termType is always a valid TermType (clamped below), so it
// drops straight into NewGlossaryTerm when the caller persists it.
export type GlossaryCandidate = Readonly<{
  marathi: string;
  english: string;
  termType: TermType;
}>;

const TERM_TYPES: readonly TermType[] = [
  'person',
  'designation',
  'scheme',
  'place',
  'org',
  'other',
];

const SYSTEM_PROMPT = [
  'You extract proper nouns from a Marathi (Devanagari) article so they can be added to a',
  'Marathi→English glossary. You only MAP terms that already appear in the article — you',
  'invent nothing.',
  '',
  'Extract every proper noun and classify each one:',
  '- person: a person’s name (e.g. from "मुख्यमंत्री एकनाथ शिंदे", the name "एकनाथ शिंदे")',
  '- designation: an official title / post (e.g. मुख्यमंत्री, जिल्हाधिकारी, सचिव)',
  '- scheme: a named government scheme or programme',
  '- place: a city, district, taluka, village, or state',
  '- org: an organization, department, ministry, board, or committee',
  '- other: a proper noun that fits none of the above',
  '',
  'For each, give the correct STANDARD English rendering as `english`:',
  '- personal names → standard English transliteration. A name is a name, NEVER its',
  '  literal meaning (e.g. the surname "वाघ" is "Wagh", not "Tiger").',
  '- schemes / organizations / designations / places → the official or conventional',
  '  English name if one exists, otherwise a faithful transliteration.',
  '',
  'Rules:',
  '- Return ONLY a strict JSON array and nothing else, in this exact shape:',
  '  [{ "marathi": "...", "english": "...", "type": "person|designation|scheme|place|org|other" }]',
  '- Use the exact Marathi surface form from the article for `marathi`.',
  '- Proper nouns only — exclude common words, generic phrases, dates, amounts and',
  '  ordinary nouns.',
  '- If the article contains no proper nouns, return [].',
].join('\n');

function buildMessages(marathiArticle: string): ChatMessage[] {
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        'Article (Marathi):',
        '',
        marathiArticle,
        '',
        'Return the proper nouns as a JSON array.',
      ].join('\n'),
    },
  ];
}

// Models sometimes wrap JSON in ```json ... ``` fences despite instructions; unwrap them.
function stripCodeFences(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return (fenced?.[1] ?? raw).trim();
}

// Parse the model reply into a raw array of items, tolerating code fences, surrounding
// prose, and a wrapper object like { "candidates": [...] }.
function parseCandidateArray(raw: string): unknown[] {
  const cleaned = stripCodeFences(raw);
  // Narrow to the bracketed span so stray prose on either side is ignored.
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  const jsonText =
    start !== -1 && end > start ? cleaned.slice(start, end + 1) : cleaned;

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (error) {
    throw new Error(
      `Entity extraction returned invalid JSON: ${(error as Error).message}\n---\n${raw}`,
    );
  }

  if (Array.isArray(parsed)) return parsed;
  // Tolerate an object wrapper (e.g. { "candidates": [...] }): use its first array value.
  if (parsed && typeof parsed === 'object') {
    const arr = Object.values(parsed as Record<string, unknown>).find(
      Array.isArray,
    );
    if (arr) return arr;
  }
  throw new Error(`Entity extraction did not return a JSON array.\n---\n${raw}`);
}

// Any type the model emits outside the allowed enum collapses to 'other', so a candidate
// is never dropped just because it was mislabeled.
function clampTermType(value: unknown): TermType {
  return typeof value === 'string' &&
    (TERM_TYPES as readonly string[]).includes(value)
    ? (value as TermType)
    : 'other';
}

// Extracts proper-noun glossary candidates from a Marathi article. De-duplicates by
// Marathi surface form within this single extraction (the DB upsert handles cross-run
// duplicates). Returns [] for empty input or an article with no proper nouns.
export async function extractGlossaryCandidates(
  marathiArticle: string,
): Promise<GlossaryCandidate[]> {
  if (marathiArticle.trim().length === 0) return [];

  const raw = await chatComplete(buildMessages(marathiArticle), {
    temperature: 0,
  });
  const items = parseCandidateArray(raw);

  const seen = new Set<string>();
  const candidates: GlossaryCandidate[] = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const marathi =
      typeof record.marathi === 'string' ? record.marathi.trim() : '';
    const english =
      typeof record.english === 'string' ? record.english.trim() : '';
    if (marathi.length === 0 || english.length === 0) continue;
    if (seen.has(marathi)) continue;
    seen.add(marathi);
    candidates.push({ marathi, english, termType: clampTermType(record.type) });
  }
  return candidates;
}

// Run directly to eyeball extraction in isolation (needs OPENAI_API_KEY):
//
//   tsx --env-file=../../.env src/generation/extract-entities.ts
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const SAMPLE_ARTICLE = [
    'मुख्यमंत्री एकनाथ शिंदे यांच्या हस्ते आज मुंबईत नमो शेतकरी महासन्मान निधी योजनेचा',
    'शुभारंभ झाला. जिल्हाधिकारी श्री. वाघ यांनी कार्यक्रमाचे आयोजन केले होते. महसूल',
    'विभागाच्या वतीने ही योजना राबवली जाणार आहे.',
  ].join('\n');

  extractGlossaryCandidates(SAMPLE_ARTICLE)
    .then((candidates) => {
      console.log(JSON.stringify(candidates, null, 2));
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
