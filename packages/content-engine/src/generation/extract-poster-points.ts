// Choose WHAT GOES ON THE POSTER, out of everything the officer wrote — and do it BEFORE any
// other decision about the poster is taken.
//
// THE PROBLEM THIS EXISTS FOR. Nothing in the social lane ever asked "which of these facts
// belong on a poster?". The point count was arrived at mechanically, in three places that each
// did their job correctly:
//   - analyzeInformationShape (select-by-information.ts) counts every bullet line and every
//     prose SENTENCE as one display item, deliberately lexical so a model cannot inflate it;
//   - enforceSourceStructure then picks the smallest master that can hold ALL of them, and the
//     largest available when none can;
//   - generatePosterCopy is then pinned to that master's slot count ("EXACTLY N — produce
//     exactly that many"), and on the fresh lane contentLed removes the ceiling outright.
// So a ten-sentence press note deterministically became a ten-row poster. Every step honoured
// the note; no step ever asked whether a poster should carry it.
//
// WHAT THIS CHANGES. The officer's whole input goes to one model call whose ONLY job is
// editorial selection: read all of it, decide what the poster is about, and return the headline
// plus the few points that carry it. Everything downstream then works from that curated text
// instead of the raw note — which is why this must run BEFORE resolveSocialReference: run it
// after, and the template has already been chosen for ten items and the image model is left
// inventing filler for the empty rows (exactly the failure enforceSourceStructure was written
// to prevent).
//
// SCOPE. The AI-copy lanes only ('fresh', 'adaptive', CMO) — i.e. exactly where
// जसाच्या तसा मजकूर is UNTICKED and generatePosterCopy already runs. The verbatim lanes are a
// promise that the officer's words are printed unchanged, and curating them would break it.
//
// BEST-EFFORT, NEVER A GATE. Any failure returns the raw note and today's behaviour, because a
// selection step that can refuse to produce a poster is worse than one that occasionally
// declines to help (the shorten-narration.ts rule).

import { pathToFileURL } from 'node:url';
import { chatComplete } from './openai-chat.js';
import { POSTER_COPY_MODEL } from './classify-poster-type.js';

// A deterministic safety ceiling on the model's returned array. This is deliberately not part of
// the editorial prompt: it protects downstream poster layout without telling the model how many
// points it should normally choose.
export const POSTER_POINT_LIMIT = 6;

export type ExtractPosterPointsInput = Readonly<{
  // Everything the officer typed and attached, unedited. Deliberately the WHOLE thing: the
  // selection is the point, so trimming the input first would be pre-empting it.
  note: string;
}>;

export type PosterSource = Readonly<{
  headline: string | null;
  points: readonly string[];
  // What the model reports it deliberately left off the poster. Log/debug only — never shown to
  // the officer and never sent onward, but it is the cheapest way to see whether the selection
  // is dropping the right things.
  leftOut: readonly string[];
  // The curated note, formatted so analyzeInformationShape counts it exactly: a short standalone
  // headline block, then one bullet line per point. This is what the reference selector and the
  // copy call receive in place of the raw note.
  text: string;
  // false = the call failed or produced nothing usable and `text` is the raw note, i.e. this
  // run behaves exactly as it did before this step existed.
  curated: boolean;
}>;

const POSTER_CRAFT =
  'Extract points that would go on a DGIPR Maharashtra twitter poster';

export function buildExtractionSystem(): string {
  return POSTER_CRAFT;
}

const EXTRACTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    headline: { type: 'string' },
    points: { type: 'array', items: { type: 'string' } },
    left_out: { type: 'array', items: { type: 'string' } },
  },
  required: ['headline', 'points', 'left_out'],
} as const;

const DEVANAGARI_DIGITS = '०१२३४५६७८९';

function toLatinDigits(text: string): string {
  return text.replace(/[०-९]/gu, (d) => String(DEVANAGARI_DIGITS.indexOf(d)));
}

// Every digit run the model wrote must occur in the source, compared in ONE script so a figure
// the officer wrote as ४९० is accepted however the model re-scripts it. This is the video
// key-point guard (generate-video-script.ts) one lane over, and it is deterministic on purpose:
// a fabricated figure on a government poster is the one selection error that cannot be reviewed
// away, so an ungrounded line is DROPPED rather than warned about.
function digitsAreGrounded(candidate: string, note: string): boolean {
  const haystack = toLatinDigits(note);
  const runs = toLatinDigits(candidate).match(/[0-9]+/gu) ?? [];
  return runs.every((run) => haystack.includes(run));
}

// Strip anything the model added to make its line look like a list item — the formatting is
// this file's job, and a stray '• ' would be counted a second time by LIST_ITEM_PREFIX.
function cleanLine(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/^\s*(?:[-*•▪◦–—]|\(?[0-9०-९]+[.)])\s+/u, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === 'string')
    : [];
}

// Formatted so analyzeInformationShape reads back EXACTLY the points chosen here: a standalone
// first block under 120 characters with no sentence terminator is its `shortStandaloneFirstBlock`
// headline test, and '• ' is its LIST_ITEM_PREFIX. Keep the two in step — if this ever emits
// prose, every sentence in it becomes a display item again and the whole step is undone.
export function formatPosterSource(
  headline: string | null,
  points: readonly string[],
): string {
  const lines: string[] = [];
  if (headline && headline.length > 0) lines.push(headline, '');
  for (const point of points) lines.push(`• ${point}`);
  return lines.join('\n').trim();
}

function parseJson(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start !== -1 && end > start) {
      return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
    }
    throw new Error(`Poster point JSON parse failed: ${raw.slice(0, 400)}`);
  }
}

export async function extractPosterPoints(
  input: ExtractPosterPointsInput,
): Promise<PosterSource> {
  const note = input.note.trim();
  const fallback: PosterSource = {
    headline: null,
    points: [],
    leftOut: [],
    text: input.note,
    curated: false,
  };
  if (note.length === 0) return fallback;

  let parsed: Record<string, unknown>;
  try {
    const raw = await chatComplete(
      [
        { role: 'system', content: buildExtractionSystem() },
        {
          role: 'user',
          content: `Everything the officer wrote for this poster:\n${note}`,
        },
      ],
      {
        model: POSTER_COPY_MODEL,
        // This call decides the poster's entire visible content, and the judgement it makes —
        // which facts serve a citizen reading for five seconds — is not re-checkable by code.
        // Same reasoning that put resolve-poster-subject.ts on this tier.
        reasoningEffort: 'medium',
        maxTokens: 2048,
        jsonSchema: { name: 'poster_points', schema: EXTRACTION_SCHEMA },
      },
    );
    parsed = parseJson(raw);
  } catch (error) {
    console.warn(
      `[poster-points] selection failed, using the whole note as before: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return fallback;
  }

  let headline: string | null = cleanLine(parsed.headline) || null;
  if (headline && !digitsAreGrounded(headline, note)) {
    console.warn(
      `[poster-points] dropped a headline carrying a figure that is not in the note: ${headline}`,
    );
    headline = null;
  }

  const seen = new Set<string>();
  const points: string[] = [];
  for (const candidate of asStringArray(parsed.points)) {
    const point = cleanLine(candidate);
    if (point.length === 0 || seen.has(point)) continue;
    if (!digitsAreGrounded(point, note)) {
      console.warn(
        `[poster-points] dropped a point carrying a figure that is not in the note: ${point}`,
      );
      continue;
    }
    seen.add(point);
    points.push(point);
    if (points.length === POSTER_POINT_LIMIT) break;
  }

  // Nothing usable came back. Falling through to the raw note is right: it is what this run
  // would have done yesterday, and an empty poster is not an improvement on a crowded one.
  if (headline === null && points.length === 0) return fallback;

  return {
    headline,
    points,
    leftOut: asStringArray(parsed.left_out)
      .map((s) => s.trim())
      .filter(Boolean),
    text: formatPosterSource(headline, points),
    curated: true,
  };
}

// --- CLI harness -----------------------------------------------------------
//   tsx src/generation/extract-poster-points.ts --check        (free — deterministic half)
//   tsx --env-file=../../.env src/generation/extract-poster-points.ts --file=note.txt   (cents)
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const { analyzeInformationShape } =
    await import('../references/select-by-information.js');

  if (process.argv.includes('--check')) {
    let failures = 0;
    const check = (label: string, ok: boolean) => {
      if (!ok) {
        failures += 1;
        console.error(`FAIL: ${label}`);
      }
    };

    // The formatted text must count back as exactly the points chosen — the contract that makes
    // the template capacity match the curated content.
    const text = formatPosterSource('१४ ऑगस्टचा निर्णय रद्द', [
      'शासन निर्णय २५ ऑगस्ट रोजी रद्द करण्यात आला आहे',
      'राज्यात ४९० शासकीय आदिवासी वसतिगृहे चालवली जातात',
      'पुणे विद्यापीठ परिसरात नवे वसतिगृह बांधण्यात येणार आहे',
    ]);
    const shape = analyzeInformationShape(text);
    check('headline is recognised as a headline', shape.hasExplicitHeadline);
    check(
      `curated text counts 3 items (got ${shape.itemCount})`,
      shape.itemCount === 3,
    );

    const noHeadline = analyzeInformationShape(
      formatPosterSource(null, ['एक मुद्दा', 'दुसरा मुद्दा']),
    );
    check(
      `headline-less text counts 2 items (got ${noHeadline.itemCount})`,
      noHeadline.itemCount === 2,
    );

    check(
      'a model-added bullet character is stripped',
      cleanLine('• ४९० वसतिगृहे') === '४९० वसतिगृहे',
    );
    check(
      'a numbered prefix is stripped',
      cleanLine('3. तिसरा मुद्दा') === 'तिसरा मुद्दा',
    );

    check(
      'Devanagari figure in the note grounds a Latin figure in the point',
      digitsAreGrounded('490 hostels', 'राज्यात ४९० वसतिगृहे आहेत.'),
    );
    check(
      'a figure absent from the note is refused',
      !digitsAreGrounded('५०० वसतिगृहे', 'राज्यात ४९० वसतिगृहे आहेत.'),
    );
    check(
      'a point with no figures is always grounded',
      digitsAreGrounded(
        'निर्णय रद्द करण्यात आला',
        'राज्यात ४९० वसतिगृहे आहेत.',
      ),
    );

    check(
      'the extraction prompt is the requested sentence exactly',
      buildExtractionSystem() ===
        'Extract points that would go on a DGIPR Maharashtra twitter poster',
    );

    console.log(
      failures === 0
        ? 'extract-poster-points: all checks passed'
        : `${failures} FAILED`,
    );
    process.exitCode = failures === 0 ? 0 : 1;
  } else {
    const fileArg = process.argv.find((a) => a.startsWith('--file='));
    const note = fileArg
      ? (await import('node:fs')).readFileSync(
          fileArg.slice('--file='.length),
          'utf8',
        )
      : [
          'शासकीय आदिवासी वसतिगृहांच्या प्रवेशासंदर्भातील १४ ऑगस्टचा शासन निर्णय २५ ऑगस्ट रोजी रद्द करण्यात आला आहे.',
          'राज्यात ४९० शासकीय आदिवासी वसतिगृहे चालविण्यात येतात.',
          'पुणे विद्यापीठ परिसरात आदिवासी मुला-मुलींसाठी वसतिगृह बांधण्यात येणार आहे.',
          'छोट्या संवर्गातील बिंदूनामावलीच्या प्रश्नासाठी समिती गठित करण्यात आली आहे.',
          'पेसा अंतर्गत उर्वरित सहा पदसंवर्गाची नोकरभरती त्वरित सुरू करण्याच्या सूचना देण्यात आल्या आहेत.',
          'विद्यार्थ्यांनी उपोषण व आंदोलन मागे घेऊन नियमित शिक्षणाकडे लक्ष द्यावे, असे आवाहन करण्यात आले आहे.',
        ].join('\n');

    const result = await extractPosterPoints({ note });
    console.log(JSON.stringify(result, null, 2));
    console.log(
      `\nitems the reference selector will count: ${analyzeInformationShape(result.text).itemCount}`,
    );
  }
}
