// Pick the best-fit master template within an already-good band, using each master's
// vision-derived descriptions (contentSummary + layoutSummary, migration 0016).
//
// Why this exists: the structural scorer in select-master.ts narrows the pool to masters
// that FIT the note's shape (slot count, photo zone), but within that band it used to pick by
// hashing the generation id — so a note about a positive announcement could still land on an
// alarming advisory master as long as the two were structurally interchangeable. This step
// reads the band's descriptions and picks the one whose SUBJECT and TONE match the note.
//
// It emits only an INDEX, never any content, so the never-invent rule is not at risk. A
// failure (bad JSON, out-of-range index) returns null and the caller degrades to the hash
// pick — ranking is a quality lever over an already-correct band, never a gate.

import { pathToFileURL } from 'node:url';
import { chatComplete, UTILITY_MODEL } from '../generation/openai-chat.js';
import { stripColourMentions } from '../generation/strip-colour-words.js';

// One candidate master, as the ranker sees it. `id` is opaque to the model (it ranks by
// index); the summaries + structural facts are what it reasons over.
export type MasterCandidate = Readonly<{
  id: string;
  layoutSummary: string;
  contentSummary?: string | undefined;
  hasPhotoZone: boolean;
  bulletSlots: number;
}>;

export type MasterRanking = Readonly<{
  // The chosen candidate's id (mapped back from the model's index).
  id: string;
  // One short English sentence on why it fits (log/debug only).
  reason: string;
}>;

// Keep the note bounded — the classifier already read the whole thing; the ranker only needs
// enough to judge subject/tone. The utility tier is cheap, but there's no reason to send a
// booklet.
const NOTE_MAX_CHARS = 2000;

function buildSystemPrompt(
  candidates: readonly MasterCandidate[],
  ignoreColour: boolean,
): string {
  const lines = candidates.map((c, i) => {
    const about = c.contentSummary ? ` | about: ${c.contentSummary}` : '';
    const photo = c.hasPhotoZone ? 'has a photo zone' : 'text-only (no photo zone)';
    // On a from-scratch run the master's colours are irrelevant AND misleading, so the summary
    // it is ranked on is filtered too — the ranker must not be able to prefer a template for a
    // colour theme that will never be used.
    const layout = ignoreColour ? stripColourMentions(c.layoutSummary) : c.layoutSummary;
    return `- index ${i}: ${photo}, ${c.bulletSlots} body slot(s). Layout: ${layout}${about}`;
  });
  // The match criterion depends on what the master is FOR. In edit modes it becomes the poster,
  // so its colour theme is a real signal. In 'fresh' mode it is structure inspiration only and
  // the palette is assigned separately — ranking on colour there actively re-creates the
  // convergence the palette rotation exists to prevent, because the DGIPR master library is
  // overwhelmingly saffron/maroon/cream and similar notes fetch similar-looking masters.
  const criterion = ignoreColour
    ? 'The template is used only as STRUCTURAL inspiration for a poster that will be designed from scratch in a separately-assigned colour palette. Match on SUBJECT DOMAIN, TONE and the shape of the content (health, agriculture, roads, welfare; advisory vs celebratory; how the points are organised). COLOUR IS NOT A CRITERION — ignore it entirely, and never prefer a candidate for its colours or theme.'
    : "The template will be repainted with the new post's text and imagery, so match on mood, colour theme and topic — not on the placeholder wording.";
  return [
    'You are a designer for DGIPR Maharashtra choosing which existing poster MASTER TEMPLATE best fits a new post.',
    'Every candidate below already fits the post structurally (right number of slots, right photo/no-photo). Your ONLY job is to pick the one whose SUBJECT and TONE match the note best — e.g. an alarming advisory look for a warning, a warm/celebratory look for an achievement, a matching topic domain (health, agriculture, roads, welfare).',
    criterion,
    'Respond with STRICT JSON only: {"index": <one of the candidate indices>, "reason": "<one short English sentence>"}.',
    '',
    'Candidate masters:',
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
    throw new Error(`Ranker did not return JSON: ${raw.slice(0, 400)}`);
  }
}

// Rank the candidates against the note and return the winner, or null if ranking could not
// produce a usable answer (the caller then falls back to the seeded hash pick). Never throws
// for a model slip — a bad read must not sink a render.
export async function rankMasterByNote(
  note: string,
  candidates: readonly MasterCandidate[],
  // Set on a from-scratch ('fresh') render: the master contributes structure only, so colour must
  // play no part in choosing it and is filtered out of what the ranker reads.
  options: Readonly<{ ignoreColour?: boolean | undefined }> = {},
): Promise<MasterRanking | null> {
  const trimmed = note.trim();
  if (trimmed.length === 0 || candidates.length === 0) return null;
  // With a single candidate there is nothing to rank.
  if (candidates.length === 1) {
    return { id: (candidates[0] as MasterCandidate).id, reason: 'only candidate' };
  }

  const indices = candidates.map((_, i) => i);
  try {
    const raw = await chatComplete(
      [
        {
          role: 'system',
          content: buildSystemPrompt(candidates, options.ignoreColour === true),
        },
        {
          role: 'user',
          content: `Meeting notes:\n${trimmed.slice(0, NOTE_MAX_CHARS)}`,
        },
      ],
      {
        // Utility tier + light reasoning: this is a tie-break inside a band that
        // selectMaster has ALREADY filtered to structurally-fitting masters, and a wrong
        // pick costs variety, not correctness. It also falls back to the seeded hash pick
        // on any failure, so it is the one poster-path call that does not need the
        // authoring model.
        model: UTILITY_MODEL,
        reasoningEffort: 'low',
        maxTokens: 200,
        jsonSchema: {
          name: 'master_ranking',
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              index: { type: 'integer', enum: indices },
              reason: { type: 'string' },
            },
            required: ['index', 'reason'],
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
      id: (candidates[index] as MasterCandidate).id,
      reason: typeof parsed.reason === 'string' ? parsed.reason : '',
    };
  } catch (error) {
    console.warn('[rank-master] ranking failed (falling back to seeded pick):', error);
    return null;
  }
}

// --- CLI harness -----------------------------------------------------------
//   tsx --env-file=../../.env src/references/rank-master.ts
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const CANDIDATES: MasterCandidate[] = [
    {
      id: 'alert-storm',
      hasPhotoZone: true,
      bulletSlots: 5,
      layoutSummary:
        'A large stacked, high-contrast headline over a dark stormy sky, a yellow warning strip, and five white advisory cards. Theme: navy, alert red and yellow.',
      contentSummary: 'A heavy-rainfall public-safety advisory.',
    },
    {
      id: 'welfare-warm',
      hasPhotoZone: true,
      bulletSlots: 5,
      layoutSummary:
        'A friendly headline on a soft orange panel with five rounded benefit cards and a smiling portrait at the lower right. Theme: warm orange and white.',
      contentSummary: 'A welfare scheme announcement for citizens.',
    },
    {
      id: 'health-clean',
      hasPhotoZone: true,
      bulletSlots: 5,
      layoutSummary:
        'A calm clinical headline on a teal band with five stat callouts and a hospital photo zone on the right. Theme: teal, white and blue.',
      contentSummary: 'A public-health facility expansion.',
    },
  ];
  const NOTE = [
    'मुंबई महानगरपालिकेने चार प्रमुख रुग्णालयांमध्ये अत्याधुनिक एमआरआय केंद्रे सुरू करण्यास मान्यता दिली आहे.',
    'सायन, कूपर, नायर आणि केईएम या रुग्णालयांत महापालिका दरात तपासणी उपलब्ध होणार आहे.',
  ].join(' ');
  rankMasterByNote(NOTE, CANDIDATES)
    .then((r) => console.log(JSON.stringify(r, null, 2)))
    .catch((e: unknown) => {
      console.error(e);
      process.exitCode = 1;
    });
}
