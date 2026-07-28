// INFORMATION-FIRST reference selection for social (twitter/facebook) posters.
//
// This replaces the classify → point_count → wants_photo → select-within-type flow on the
// ordinary DGIPR social path. That flow decided things ABOUT the note before it had chosen a
// reference — which post type it was, how many bullets it supported, whether it wanted a
// photograph — and every one of those predictions then constrained the pool. A wrong
// point_count excluded the right template; a wrong post_type excluded a whole family of them.
//
// The order is now the other way round:
//
//   raw note → the reference whose SUBJECT (then information structure) fits it best → the
//   copy arranged to fit that reference
//
// Nothing is predicted first. The note is compared, exactly as the officer wrote it, against
// EVERY enabled social master of the brand (across all types) using the vision-derived
// descriptions already cached on reference_images.layout_spec (migration 0016) —
// `contentSummary` (what that poster is about) and `layoutSummary` (how it arranges
// information). The winner's own type is then resolved from its `subtype`, and the existing
// copy step arranges the note's information into the sections that reference actually has
// (copyStyle, bulletSlots, hasPhotoZone) — the same mechanism the CMO path has always used.
//
// SUBJECT IS THE DECIDING FACTOR, not a co-equal one. A note about mosquitoes must land on the
// dengue master even if a different template would arrange its points more neatly: a reference
// on the right subject with an imperfect layout beats a well-arranged reference about something
// else. So the prompt is staged — narrow by subject, then choose within that set on structure —
// rather than asking for a single blended judgement, which is what let a strong structural fit
// out-argue the right topic. `contentSummary` is therefore the primary key and leads each
// candidate line; it is operator-editable for exactly that reason, and a master without one
// announces itself as having no subject to match on.
//
// When the library genuinely holds nothing on the note's subject, the model must SAY SO
// (`subject_match: false`) and fall back to structure alone, rather than stretching a link — a
// road-tender note must not become "public-health adjacent" because the dengue poster is the
// nearest thing available. That flag lands in the selection reason, so a missing master shows up
// in the job log instead of as a quietly wrong poster.
//
// Tone/mood/colour are deliberately NOT criteria here (rank-master.ts's tone-based tie-break
// is a different job for a different flow). Colour is additionally stripped from the
// descriptions on a 'fresh' render, where the palette is assigned separately and the master
// contributes structure only.
//
// RECENCY IS A TIE-BREAK, NEVER A FILTER. Recently-used masters used to be removed from the pool
// before ranking, which — with subject deciding — removed the RIGHT ANSWER: one mosquito master
// used last run meant the next mosquito note could not see it at all (the old guard only stepped
// aside when the whole library would empty, not when the subject-appropriate subset would). The
// recent ids are now handed to the model as a lowest-priority preference between candidates of
// EQUAL subject fit, and the pool it ranks over is always complete. They still filter the SEEDED
// FALLBACK pick, where no subject reasoning is happening and across-run variety is free.
//
// Ranking is a QUALITY step over a pool that is already correct: an un-analysed library, a
// bad model read or a failed call all fall back to the seeded hash pick, so a render never
// depends on it succeeding.

import { pathToFileURL } from 'node:url';
import {
  publicUrl,
  type ReferenceImageRow,
  type SupabaseClient,
} from '@dgipr/database';
import { chatComplete } from '../generation/openai-chat.js';
import { POSTER_COPY_MODEL } from '../generation/classify-poster-type.js';
import { stripColourMentions } from '../generation/strip-colour-words.js';
import {
  analyzeAndPersist,
  hashString,
  type SelectedMaster,
} from './select-master.js';

// One reference as the ranker sees it. `id` is opaque to the model (it answers with an
// index); the two summaries plus the structural facts are what it reasons over.
export type InformationCandidate = Readonly<{
  id: string;
  // The type this reference belongs to, named so the model can see that the library offers
  // genuinely different formats — NOT so it classifies the note into one first.
  typeLabel: string;
  layoutSummary: string;
  contentSummary?: string | undefined;
  hasPhotoZone: boolean;
  bulletSlots: number;
}>;

export type InformationRanking = Readonly<{
  // The chosen candidate's id (mapped back from the model's index).
  id: string;
  // A short Marathi (Devanagari) working title for the post. This is the run's
  // `referenceTitle`, previously produced by the classifier this step replaces.
  title: string;
  // One short English sentence on why it fits (log/debug only).
  reason: string;
  // False when NO reference in the library was on the note's subject, so the pick was made on
  // structure alone. Not a failure — the render proceeds — but it is the signal that the
  // library has a gap, so it is surfaced in the selection reason rather than swallowed.
  subjectMatch: boolean;
}>;

export type SelectedByInformation = Readonly<{
  master: SelectedMaster;
  // Null when the pick fell back to the seeded hash (no ranking happened, so no title).
  title: string | null;
}>;

// The note is the whole input to this decision, so it is sent generously rather than
// summarised — but a 60,000-char DLO note would dominate the prompt for no gain, and the
// subject of a press note is established early. Bounded, not sampled.
const NOTE_MAX_CHARS = 6000;

function buildSystemPrompt(
  candidates: readonly InformationCandidate[],
  ignoreColour: boolean,
  // Indices of candidates the last few posts already used. Lowest-priority preference only.
  recentIndices: readonly number[],
): string {
  const lines = candidates.map((c, i) => {
    // SUBJECT LEADS THE LINE. It is the primary key of the decision, so it must not sit in a
    // trailing clause the model can skim past — and an undescribed master must announce that
    // it cannot be judged on subject rather than silently reading as "no particular subject".
    const subject = c.contentSummary ?? 'not described';
    const photo = c.hasPhotoZone
      ? 'has a photograph area'
      : 'text-only (no photograph area)';
    const slots =
      c.bulletSlots > 0
        ? `${c.bulletSlots} repeating content slot(s)`
        : 'no repeating content list';
    // On a from-scratch run the master's colours are irrelevant AND misleading: the palette
    // is assigned separately, and the DGIPR library is overwhelmingly saffron/maroon/cream,
    // so a colour-carrying description is a live channel for the house look to re-enter a
    // poster meant to be in a different family.
    const layout = ignoreColour ? stripColourMentions(c.layoutSummary) : c.layoutSummary;
    return [
      `- index ${i} [group: ${c.typeLabel}]`,
      `  SUBJECT: ${subject}`,
      `  STRUCTURE: ${photo}, ${slots}. ${layout}`,
    ].join('\n');
  });

  const variety =
    recentIndices.length > 0
      ? [
          '',
          'VARIETY (lowest priority, applies only after the two stages above):',
          `- Recent posts already used: ${recentIndices.map((i) => `index ${i}`).join(', ')}.`,
          '- Between references that fit the subject EQUALLY well, prefer one that is not in that list.',
          '- NEVER reject a better subject match to satisfy this. Repeating a reference for a repeated topic is correct.',
        ]
      : [];

  return [
    'You are a designer for DGIPR Maharashtra (Directorate General of Information & Public Relations).',
    "You are given a raw government note and the department's library of existing poster reference templates.",
    'Choose the ONE reference that best fits this note.',
    '',
    'SUBJECT IS THE DECIDING FACTOR. Work in two stages, strictly in this order.',
    '',
    'STAGE 1 — SUBJECT (decides).',
    '- Read the note first, as written. Do not decide what kind of post it is before looking at the references.',
    '- Identify what the note is ABOUT: its topic and its domain (health, disease and prevention, agriculture, roads and transport, welfare, education, disaster, employment, awards, civic services...).',
    '- Keep every reference whose own SUBJECT line is the same topic, or clearly the same domain. Judge this from the SUBJECT line first and the group name second.',
    '- A reference whose SUBJECT is "not described" cannot be judged on subject. Keep it only if nothing else matches.',
    '',
    'STAGE 2 — STRUCTURE (chooses among the ones stage 1 kept).',
    '- ONLY among the references kept by stage 1, pick the one whose arrangement can actually hold the information this note contains: how much of it there is, whether it is one message or a set of points, whether it carries a quotation with a speaker, a date/time/venue, figures or amounts, eligibility or a call to action.',
    '- A reference with a photograph area suits a note about an event, place, people or built thing; a text-only reference suits an advisory, a rule list or a plain statement. Judge this from the note, not as a rule.',
    '- If stage 1 kept exactly one reference, CHOOSE IT, even if its arrangement is not ideal. A reference on the right subject with an imperfect layout is a better choice than a well-arranged reference about something else.',
    '',
    'IF NOTHING MATCHES THE SUBJECT:',
    '- Do not stretch a link and do not rationalise a weak one. A note about road tenders is not "public-health adjacent" merely because a dengue poster is the nearest thing in the library.',
    '- Set "subject_match" to false and choose purely on structure (stage 2 over ALL references).',
    '- Otherwise set "subject_match" to true.',
    '',
    'NEVER choose on tone, mood or colour, and never because a reference is visually attractive.',
    ...variety,
    '',
    'Also return a short Marathi (Devanagari) working title for the post, taken from the note. Never invent a name, figure or date that is not in the note.',
    '',
    'Respond with STRICT JSON only: {"index": <one of the candidate indices>, "subject_match": <true|false>, "title": "<short Marathi title>", "reason": "<one short English sentence naming the subject link, or its absence>"}.',
    '',
    'Reference templates:',
    ...lines,
  ].join('\n');
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
    throw new Error(`Reference ranker did not return JSON: ${raw.slice(0, 400)}`);
  }
}

// Rank every candidate against the note and return the winner, or null when ranking could not
// produce a usable answer (the caller then falls back to the seeded hash pick). Never throws
// for a model slip — a bad read must not sink a render.
export async function rankReferenceByInformation(
  note: string,
  candidates: readonly InformationCandidate[],
  options: Readonly<{
    ignoreColour?: boolean | undefined;
    // Master ids the last few runs used. A PREFERENCE handed to the model, never a filter —
    // see the recency note in the module header.
    recentIds?: readonly string[] | undefined;
  }> = {},
): Promise<InformationRanking | null> {
  const trimmed = note.trim();
  if (trimmed.length === 0 || candidates.length === 0) return null;

  const indices = candidates.map((_, i) => i);
  const recent = new Set(options.recentIds ?? []);
  const recentIndices = indices.filter((i) =>
    recent.has((candidates[i] as InformationCandidate).id),
  );
  try {
    const raw = await chatComplete(
      [
        {
          role: 'system',
          content: buildSystemPrompt(
            candidates,
            options.ignoreColour === true,
            recentIndices,
          ),
        },
        { role: 'user', content: `Government note:\n${trimmed.slice(0, NOTE_MAX_CHARS)}` },
      ],
      {
        // This is now the DECISIVE routing call on the social path — it replaces the
        // classifier, and the reference it picks determines the poster's whole information
        // structure. It therefore inherits the classifier's authoring tier and deliberation
        // rather than the utility tier rank-master.ts uses for a tie-break inside an
        // already-filtered band. maxTokens is the ANSWER budget; reasoning gets its own
        // headroom in openai-chat.ts.
        model: POSTER_COPY_MODEL,
        reasoningEffort: 'medium',
        maxTokens: 400,
        jsonSchema: {
          name: 'reference_selection',
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              index: { type: 'integer', enum: indices },
              subject_match: { type: 'boolean' },
              title: { type: 'string' },
              reason: { type: 'string' },
            },
            required: ['index', 'subject_match', 'title', 'reason'],
          },
        },
      },
    );
    const parsed = parseJson(raw);
    const index = Number(parsed.index);
    if (!Number.isInteger(index) || index < 0 || index >= candidates.length) {
      return null;
    }
    return {
      id: (candidates[index] as InformationCandidate).id,
      title: typeof parsed.title === 'string' ? parsed.title : '',
      reason: typeof parsed.reason === 'string' ? parsed.reason : '',
      // Only an explicit true is a subject match. A model that omits the field or answers with
      // something other than a boolean has not asserted one, and the honest reading of that is
      // "unclaimed" — which logs the library gap rather than hiding it behind a default.
      subjectMatch: parsed.subject_match === true,
    };
  } catch (error) {
    console.warn(
      '[select-by-information] ranking failed (falling back to seeded pick):',
      error,
    );
    return null;
  }
}

// A candidate the ranker can reason over: it must already carry vision-derived summaries (a
// null-spec master has nothing to match on, so it is invisible to an information-first pick —
// which is why one un-analysed master is warmed per run below, filling the library over time).
function candidateFor(
  image: ReferenceImageRow,
  typeLabelFor: (image: ReferenceImageRow) => string,
): InformationCandidate | null {
  const spec = image.layoutSpec;
  if (!spec) return null;
  if (!spec.layoutSummary && !spec.contentSummary) return null;
  return {
    id: image.id,
    typeLabel: typeLabelFor(image),
    layoutSummary: spec.layoutSummary,
    contentSummary: spec.contentSummary,
    hasPhotoZone: spec.hasPhotoZone,
    bulletSlots: spec.bulletSlots,
  };
}

// Choose ONE reference for this note from a pool spanning every enabled type of the brand.
//
// At most ONE vision analysis is spent per call, exactly as select-master.ts does it: the
// picked master is analysed if it has no spec (so copy/prompt get real structure); otherwise
// one other un-analysed image is warmed opportunistically, so an un-described library becomes
// rankable over successive runs instead of needing a bulk backfill first.
export async function selectReferenceByInformation(
  client: SupabaseClient,
  images: readonly ReferenceImageRow[],
  // Names the type each image belongs to, for the candidate lines.
  typeLabelFor: (image: ReferenceImageRow) => string,
  // Seed for the deterministic fallback pick (the generation id) — a retry re-renders the
  // same template rather than rolling a new one.
  seed: string,
  note: string,
  // Master ids used by the last few runs of this brand (across-run variety). Best-effort,
  // in-process on the caller's side. NOT a filter on the ranked pool — it reaches the model as
  // a lowest-priority tie-break between equal subject fits, and only narrows the SEEDED
  // fallback pick. See the recency note in the module header for why.
  avoidIds?: readonly string[],
  options: Readonly<{ ignoreColour?: boolean | undefined }> = {},
): Promise<SelectedByInformation> {
  if (images.length === 0) {
    throw new Error('selectReferenceByInformation called with no enabled images.');
  }

  // Deterministic ordering (newest first) so the seeded fallback and the candidate indices
  // are stable across calls. THE RANKED POOL IS ALWAYS THE WHOLE LIBRARY — recency must not
  // remove a master before the subject has been considered, or the one reference on the note's
  // topic disappears exactly when it is used twice running.
  const pool = [...images].sort((a, b) =>
    a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0,
  );
  const reasonPrefix = `information-first (pool=${pool.length})`;

  // The seeded fallback keeps the old spread behaviour: no subject reasoning happens on that
  // path, so across-run variety is free there and costs nothing correct.
  let fallbackPool = pool;
  let fallbackNote = 'seeded';
  if (avoidIds && avoidIds.length > 0) {
    const avoid = new Set(avoidIds);
    const spread = pool.filter((image) => !avoid.has(image.id));
    if (spread.length > 0 && spread.length < pool.length) {
      fallbackPool = spread;
      fallbackNote = `seeded +spread(-${avoid.size})`;
    }
  }

  let picked = fallbackPool[hashString(seed) % fallbackPool.length] as ReferenceImageRow;
  let pickMethod = fallbackNote;
  let title: string | null = null;

  const candidates = pool
    .map((image) => candidateFor(image, typeLabelFor))
    .filter((c): c is InformationCandidate => c !== null);
  // With fewer than two described references there is nothing to compare, so the model call
  // would only be a rubber stamp on a pool of one.
  if (candidates.length >= 2) {
    const ranked = await rankReferenceByInformation(note, candidates, {
      ignoreColour: options.ignoreColour,
      recentIds: avoidIds,
    });
    const match = ranked && pool.find((img) => img.id === ranked.id);
    if (match && ranked) {
      picked = match;
      // A structure-only pick is named as such: it means the library holds nothing on this
      // note's subject, which is a gap to fill rather than a normal outcome.
      const gap = ranked.subjectMatch ? '' : ' [NO SUBJECT MATCH — structure only]';
      pickMethod = `information-ranked${gap} (${ranked.reason})`;
      title = ranked.title.trim() === '' ? null : ranked.title.trim();
      if (!ranked.subjectMatch) {
        console.warn(
          '[select-by-information] no reference matched the subject of this note; picked on ' +
            `structure alone (${picked.storagePath}). Consider adding a master for this topic.`,
        );
      }
    }
  }

  let layoutSpec = picked.layoutSpec;
  let analysisSpent = false;
  if (!layoutSpec) {
    layoutSpec = await analyzeAndPersist(client, picked);
    analysisSpent = true;
  }
  if (!analysisSpent) {
    const stale = pool.find((img) => img.id !== picked.id && !img.layoutSpec);
    if (stale) await analyzeAndPersist(client, stale);
  }

  return {
    master: {
      id: picked.id,
      url: publicUrl(client, picked.storagePath),
      layoutSpec,
      reason: `${reasonPrefix} → ${pickMethod} → ${picked.storagePath}`,
    },
    title,
  };
}

// --- CLI harness -----------------------------------------------------------
//   tsx --env-file=../../.env src/references/select-by-information.ts
// Live (cents per case): ranks a real-shaped library against three notes and ASSERTS the
// properties this module exists for, rather than printing output to be eyeballed:
//   1. SUBJECT WINS over a neater structural fit  (mosquito note -> the dengue master, not the
//      stat-callout master, even though the note carries figures the latter would arrange well)
//   2. RECENCY DOES NOT VETO A SUBJECT MATCH      (same note, dengue master marked as recently
//      used -> still chosen)
//   3. NO FORCED MATCH                            (road-tender note -> subject_match false)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const CANDIDATES: InformationCandidate[] = [
    {
      id: 'alert-storm',
      typeLabel: 'सूचना / इशारा',
      hasPhotoZone: true,
      bulletSlots: 5,
      layoutSummary:
        'A large stacked headline over a full-bleed sky image, a warning strip, and five advisory cards below.',
      contentSummary: 'अतिवृष्टीबाबत नागरिकांसाठी सार्वजनिक सुरक्षा सूचना.',
    },
    {
      id: 'quote-leader',
      typeLabel: 'वक्तव्य',
      hasPhotoZone: true,
      bulletSlots: 0,
      layoutSummary:
        'A single large quotation block with an attribution line and a portrait at the lower right; no repeating list.',
      contentSummary: 'मंत्र्यांचे वक्तव्य.',
    },
    {
      id: 'health-stats',
      typeLabel: 'माहिती',
      hasPhotoZone: true,
      bulletSlots: 4,
      layoutSummary:
        'A headline on a panel, four stat callouts with figures and short labels, a facility photo zone on the right, and a footer call-to-action.',
      contentSummary: 'सार्वजनिक आरोग्य सुविधांच्या विस्ताराची आकडेवारी.',
    },
    {
      // The subject match for case 1 — deliberately the WEAKER structural fit (3 slots for a
      // note carrying more than three points), so a pass proves subject outranked structure.
      id: 'dengue-mosquito',
      typeLabel: 'Information about insects, reptiles, animals, etc',
      hasPhotoZone: true,
      bulletSlots: 3,
      layoutSummary:
        'A large stylised headline across the upper content area, a circular illustration of the insect, and three short explanatory callouts joined by arrows.',
      contentSummary:
        'डेंग्यूबाबत जनजागृती पोस्टर — एडिस डास, त्यांची उत्पत्ती आणि प्रसार टाळण्याचे उपाय.',
    },
  ];

  const MOSQUITO_NOTE = [
    'राज्यात डासांमुळे पसरणाऱ्या डेंग्यू आजाराच्या रुग्णसंख्येत वाढ झाल्याने आरोग्य विभागाने जनजागृती मोहीम सुरू केली आहे.',
    'घराभोवती साचलेल्या स्वच्छ पाण्यात एडिस डासांची उत्पत्ती होते, त्यामुळे आठवड्यातून एकदा पाणीसाठे रिकामे करावेत.',
    'जुलै अखेरपर्यंत १.०८ लाख घरांची तपासणी करण्यात आली असून ४ जिल्ह्यांत मोहीम राबवली जात आहे.',
  ].join(' ');

  const ROAD_NOTE = [
    'मुंबई-पुणे महामार्गाच्या रुंदीकरणासाठी निविदा प्रक्रिया सुरू करण्यास मान्यता देण्यात आली आहे.',
    'या कामासाठी ४५० कोटी रुपयांची तरतूद करण्यात आली असून काम २०२८ पर्यंत पूर्ण होणार आहे.',
  ].join(' ');

  const failures: string[] = [];
  const check = (ok: boolean, label: string, got: unknown) => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}\n      ${JSON.stringify(got)}`);
    if (!ok) failures.push(label);
  };

  (async () => {
    const subjectWins = await rankReferenceByInformation(MOSQUITO_NOTE, CANDIDATES);
    check(
      subjectWins?.id === 'dengue-mosquito' && subjectWins.subjectMatch,
      'subject outranks a neater structural fit',
      subjectWins,
    );

    const despiteRecency = await rankReferenceByInformation(MOSQUITO_NOTE, CANDIDATES, {
      recentIds: ['dengue-mosquito'],
    });
    check(
      despiteRecency?.id === 'dengue-mosquito',
      'recency does not veto the only subject match',
      despiteRecency,
    );

    const noMatch = await rankReferenceByInformation(ROAD_NOTE, CANDIDATES);
    check(
      noMatch !== null && !noMatch.subjectMatch,
      'an unmatched subject is reported, not stretched',
      noMatch,
    );

    if (failures.length > 0) {
      console.error(`\n${failures.length} check(s) failed.`);
      process.exitCode = 1;
    } else {
      console.log('\nAll checks passed.');
    }
  })().catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  });
}
