// Write a social poster's copy (headline + body) from the note, for a resolved poster type
// and a chosen master template. Ported verbatim from the n8n `Build Copy Request` +
// `Generate Copy L1` nodes so the copy does not change character, then moved into code so it
// runs on the gpt-5.6 authoring tier (POSTER_COPY_MODEL), is metered inside the job's cost
// scope, and can enforce full scheme names (lock-scheme-names.ts) — none of which was
// expressible while the prompt lived in the image workflow.
//
// The master's layout_spec (read off its pixels at upload, cached on the reference_images
// row) decides structure: a text-only master drops scene_brief entirely and locks out
// imagery; the master's bulletSlots pins how many body items to produce.

import { pathToFileURL } from 'node:url';
import type { ReferenceLayoutSpec } from '@dgipr/database';
import { chatComplete } from './openai-chat.js';
import { POSTER_COPY_MODEL } from './classify-poster-type.js';
import {
  lockSchemeNames,
  validateDeclaredSchemeNames,
} from './lock-scheme-names.js';

export type TemplateBrand = 'dgipr' | 'cmo';

// The poster copy object. Its exact keys vary by copy_style (bullets vs stats vs milestones
// vs points, attribution, schedule, …), so it is typed as an open record — the same shape
// the downstream build-poster-prompt.ts consumes and the n8n Decode step returned.
export type PosterCopy = Record<string, unknown>;

export type GeneratePosterCopyInput = Readonly<{
  note: string;
  postType: string;
  // The resolved type's copy layout ('info_bullets' | 'alert' | 'campaign' | 'quote' |
  // 'timeline' | 'generic'; unknown falls back to 'generic').
  copyStyle: string;
  // The operator's type description — an editorial-intent steer for tone/selection, never a
  // structural signal.
  description?: string | undefined;
  brand: TemplateBrand;
  // The CHOSEN master's layout spec. null = un-analysed → the legacy photo-zone assumption.
  layoutSpec: ReferenceLayoutSpec | null;
  // Full scheme/org names known to occur verbatim in the note (verified glossary rows). Used
  // both to instruct the model (LOCKED NAMES) and to deterministically repair a truncation.
  lockedSchemeNames?: readonly string[] | undefined;
}>;

export type GeneratePosterCopyResult = Readonly<{
  copy: PosterCopy;
  copyStyle: string;
  // Whether this poster carries a photograph (drives build-poster-prompt.ts + CMO photo gen).
  hasPhoto: boolean;
  // Scheme names the copy could not be made to carry in full (ambiguous). Reported, not fatal.
  unpreservedSchemeNames: readonly string[];
}>;

const str = { type: 'string' } as const;
const strArray = { type: 'array', items: str } as const;
const bulletItem = {
  type: 'object',
  additionalProperties: false,
  properties: { text: str, emphasis: strArray },
  required: ['text', 'emphasis'],
} as const;
const obj = (props: Record<string, unknown>, required: string[]) => ({
  type: 'object',
  additionalProperties: false,
  properties: props,
  required,
});

// One copy_style: the system-prompt field list plus the strict json_schema for that layout.
type Registry = { system: string[]; schema: ReturnType<typeof obj> };

const REG: Record<string, Registry> = {
  alert: {
    system: [
      'ALERT poster. Fields:',
      '- kicker: 1-2 word Marathi alert tag (e.g. सावधान, सूचना, इशारा).',
      '- headline: punchy Marathi headline, 3-6 words.',
      '- subhead: one supporting Marathi line, about 8-12 words.',
      '- bullets: EXACTLY 3 items; each text is a short Marathi action (<=10 words); emphasis = 1-2 substrings copied VERBATIM from that same text.',
      '- scene_brief: one English sentence describing only the background imagery.',
    ],
    schema: obj(
      {
        kicker: str,
        headline: str,
        subhead: str,
        bullets: { type: 'array', items: bulletItem },
        scene_brief: str,
      },
      ['kicker', 'headline', 'subhead', 'bullets', 'scene_brief'],
    ),
  },
  campaign: {
    system: [
      'CAMPAIGN / DRIVE / SERVICE poster. Fields:',
      '- kicker: 1-2 word Marathi tag (e.g. मोहीम, लसीकरण, सेवा).',
      '- headline: the Marathi campaign/event name, 3-7 words.',
      '- subhead: one Marathi line on the purpose or target.',
      '- schedule.date and schedule.time: Marathi date and time strings if the notes give them, else empty strings.',
      '- audience: Marathi eligibility/audience line, else empty string.',
      '- cta: a strong Marathi call-to-action, else empty string.',
      '- stats: 2-4 items, each { value (figure as given), label (short Marathi), icon_hint (1-3 English words naming an icon) }. Use only figures present in the notes.',
      '- scene_brief: one English sentence, background/hero imagery only.',
    ],
    schema: obj(
      {
        kicker: str,
        headline: str,
        subhead: str,
        schedule: obj({ date: str, time: str }, ['date', 'time']),
        audience: str,
        cta: str,
        stats: {
          type: 'array',
          items: obj({ value: str, label: str, icon_hint: str }, [
            'value',
            'label',
            'icon_hint',
          ]),
        },
        scene_brief: str,
      },
      ['kicker', 'headline', 'subhead', 'schedule', 'audience', 'cta', 'stats', 'scene_brief'],
    ),
  },
  info_bullets: {
    system: [
      'INFORMATIONAL poster (headline + points). Fields:',
      '- kicker: short Marathi tag, else empty string.',
      '- headline: Marathi headline, 3-8 words.',
      '- subhead: one supporting Marathi line.',
      '- bullets: 4 to 6 items; each text a concise Marathi point; emphasis = 0-2 substrings copied VERBATIM from that text.',
      '- scene_brief: one English sentence, background imagery only.',
    ],
    schema: obj(
      {
        kicker: str,
        headline: str,
        subhead: str,
        bullets: { type: 'array', items: bulletItem },
        scene_brief: str,
      },
      ['kicker', 'headline', 'subhead', 'bullets', 'scene_brief'],
    ),
  },
  quote: {
    system: [
      'QUOTE / STATEMENT poster. Fields:',
      '- topic_label: short Marathi tag (e.g. चर्चा, गुंतवणूक).',
      '- headline: Marathi subject line (what the statement is about).',
      '- quote_text: the main Marathi quote (one or two sentences).',
      '- attribution.name and attribution.title: Marathi name and designation of the speaker.',
      '- points: 2-3 supporting items, each { text (short Marathi), icon_hint (1-3 English words) }.',
      '- scene_brief: one English sentence, thematic background imagery only.',
    ],
    schema: obj(
      {
        topic_label: str,
        headline: str,
        quote_text: str,
        attribution: obj({ name: str, title: str }, ['name', 'title']),
        points: {
          type: 'array',
          items: obj({ text: str, icon_hint: str }, ['text', 'icon_hint']),
        },
        scene_brief: str,
      },
      ['topic_label', 'headline', 'quote_text', 'attribution', 'points', 'scene_brief'],
    ),
  },
  timeline: {
    system: [
      'TIMELINE / ACHIEVEMENTS poster. Fields:',
      '- headline: Marathi headline.',
      '- intro: one Marathi line introducing the sequence, else empty string.',
      '- side_label: a longer Marathi phrase used as a bold side/emphasis label, else empty string.',
      '- milestones: 3-4 items in chronological order, each { date (Marathi date/period), text (short Marathi description) }.',
      '- scene_brief: one English sentence, background imagery only.',
    ],
    schema: obj(
      {
        headline: str,
        intro: str,
        side_label: str,
        milestones: {
          type: 'array',
          items: obj({ date: str, text: str }, ['date', 'text']),
        },
        scene_brief: str,
      },
      ['headline', 'intro', 'side_label', 'milestones', 'scene_brief'],
    ),
  },
  generic: {
    system: [
      'GENERIC poster (headline + supporting points). Fields:',
      '- kicker: short Marathi tag, else empty string.',
      '- headline: Marathi headline, 3-8 words.',
      '- subhead: one supporting Marathi line.',
      '- bullets: 3 to 6 items; each text a concise Marathi point; emphasis = 0-2 substrings copied VERBATIM from that text.',
      '- scene_brief: one English sentence, background imagery only.',
    ],
    schema: obj(
      {
        kicker: str,
        headline: str,
        subhead: str,
        bullets: { type: 'array', items: bulletItem },
        scene_brief: str,
      },
      ['kicker', 'headline', 'subhead', 'bullets', 'scene_brief'],
    ),
  },
};

const COMMON = [
  'You are a senior bilingual (Marathi/English) creative director for DGIPR Maharashtra. You write copy for an OFFICIAL government poster. Respond with STRICT JSON only, no commentary.',
  'All on-poster copy MUST be natural Marathi in the Devanagari script. The scene_brief is ENGLISH only and describes ONLY background imagery (never any text, words, letters, numbers or logos).',
  'Base everything strictly on the supplied notes; do not invent facts. If a field is not supported by the notes, use an empty string (and keep arrays to only what the notes support).',
].join('\n');

// The list field that carries the master's repeating body slots, per copy_style.
function listFieldFor(copyStyle: string): string {
  if (copyStyle === 'quote') return 'points';
  if (copyStyle === 'timeline') return 'milestones';
  if (copyStyle === 'campaign') return 'stats';
  return 'bullets';
}

function parseJson(raw: string): PosterCopy {
  try {
    return JSON.parse(raw) as PosterCopy;
  } catch {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start !== -1 && end > start) {
      return JSON.parse(raw.slice(start, end + 1)) as PosterCopy;
    }
    throw new Error(`Copy JSON parse failed: ${raw.slice(0, 400)}`);
  }
}

export async function generatePosterCopy(
  input: GeneratePosterCopyInput,
): Promise<GeneratePosterCopyResult> {
  const spec = input.layoutSpec;
  const hasPhoto = spec?.hasPhotoZone !== false;
  const slotCount =
    spec && Number.isFinite(spec.bulletSlots) && spec.bulletSlots > 0
      ? Math.round(spec.bulletSlots)
      : 0;

  // Custom types render with the generic layout; unknown copy_styles fall back too.
  const copyStyle = REG[input.copyStyle] ? input.copyStyle : 'generic';
  const reg = REG[copyStyle] as Registry;

  // Deep-copy the schema before mutating (the text-only branch strips a field).
  const schema = JSON.parse(JSON.stringify(reg.schema)) as ReturnType<typeof obj>;
  let systemLines = [...reg.system];
  const props = schema.properties as Record<string, unknown>;

  if (!hasPhoto) {
    // No photo zone → drop scene_brief from properties AND required (strict json_schema
    // rejects a required key that is not a property), and forbid describing imagery.
    delete props.scene_brief;
    schema.required = schema.required.filter((k: string) => k !== 'scene_brief');
    systemLines = systemLines.filter((line) => line.indexOf('- scene_brief:') !== 0);
    systemLines.push(
      'This poster is TEXT-ONLY: it carries no photograph or illustration. Do not describe any imagery.',
    );
  }

  // Pin the body-slot count to the master's real capacity so copy cannot over/under-fill.
  if (slotCount > 0) {
    systemLines.push(
      `The master template has room for EXACTLY ${slotCount} ${listFieldFor(copyStyle)}. Produce exactly that many.`,
    );
  }

  const description = (input.description ?? '').trim();
  if (description) {
    systemLines.push(`POSTER TYPE INTENT (from the operator): ${description}`);
  }

  if (input.brand === 'cmo') {
    systemLines.push(
      'This is an OFFICIAL मंत्रिमंडळ निर्णय (Cabinet Decision) poster. Match the density of a real government decision poster: OVERRIDE any earlier bullet-count range and prefer 2-4 SUBSTANTIAL bullets, each a FULL Marathi sentence (occasionally two) that packs several related facts together — figures, eligibility, benefits, timelines, the responsible department — rather than many short fragments. Include every concrete fact the notes support (names, numbers, dates, scheme and department names) VERBATIM; never invent any. If the notes are thin, produce fewer bullets rather than padding.',
    );
  }

  // Full scheme/org names must survive in full. Add a LOCKED NAMES block, relax the word-count
  // pressure on any field carrying one, and add a declared-names field the code then checks
  // against the note. The deterministic repair below is the real guarantee (lock-scheme-names).
  const lockedNames = [...new Set(input.lockedSchemeNames ?? [])].filter(
    (n) => n.trim().length > 0,
  );
  if (lockedNames.length > 0) {
    systemLines.push(
      'LOCKED NAMES — if the poster mentions any of the following scheme/organisation names, write it IN FULL, character for character, exactly as listed. Never shorten, abbreviate, or drop leading words (e.g. do not reduce "मुख्यमंत्री माझी लाडकी बहीण योजना" to "लाडकी बहीण योजना"). This overrides the word-count guidance above for any headline/point that carries such a name — let that field run longer rather than truncate the name:',
      ...lockedNames.map((n) => `  • ${n}`),
    );
  }
  // Always request the declared list so the invention guard runs even with no locked names.
  systemLines.push(
    'ALSO return "scheme_names_used": an array of every government scheme or programme name you wrote anywhere in the copy, each copied VERBATIM from the notes exactly as it appears there (complete name, no truncation). Empty array if none.',
  );
  props.scheme_names_used = strArray;
  schema.required = [...schema.required, 'scheme_names_used'];

  const system = `${COMMON}\n\n${systemLines.join('\n')}`;
  const notes = input.note;

  const raw = await chatComplete(
    [
      { role: 'system', content: system },
      { role: 'user', content: `Notes for the ${input.postType} poster:\n${notes}` },
    ],
    {
      model: POSTER_COPY_MODEL,
      // The headline is the most-read text the product ships and must hold a scheme name
      // verbatim while fitting a slot count — worth deliberating over.
      reasoningEffort: 'medium',
      maxTokens: 2048,
      jsonSchema: { name: `${copyStyle}_copy`, schema },
    },
  );

  const parsed = parseJson(raw);

  // Pull the declared list out of the copy object before it flows downstream (it is a
  // reporting signal, not a poster field).
  const declared = Array.isArray(parsed.scheme_names_used)
    ? (parsed.scheme_names_used as unknown[]).filter(
        (s): s is string => typeof s === 'string',
      )
    : [];
  delete parsed.scheme_names_used;

  const { invented } = validateDeclaredSchemeNames(notes, declared);
  if (invented.length > 0) {
    console.warn(
      `[poster-copy] declared scheme names not found verbatim in the note (invented/misspelt): ${invented.join(', ')}`,
    );
  }

  // Deterministic truncation repair against the known full names.
  const { copy, unpreserved } = lockSchemeNames(parsed, lockedNames);
  if (unpreserved.length > 0) {
    console.warn(
      `[poster-copy] scheme names left truncated (ambiguous, not auto-fixed): ${unpreserved.join(', ')}`,
    );
  }

  return {
    copy,
    copyStyle,
    hasPhoto,
    unpreservedSchemeNames: [...unpreserved, ...invented],
  };
}

// How many content items a finished copy object actually carries — the longest array among its
// values, which is the list field whatever the registry called it (`points` / `stats` /
// `milestones`; see listFieldFor). Deliberately registry-AGNOSTIC rather than switching on
// copyStyle: a custom type renders on the generic registry, a future registry would add a fourth
// name, and this only ever needs the count.
//
// Used by the arrangement rotation (poster-placements.ts) to bar an anchor that cannot hold this
// much content. Reading it off the WRITTEN COPY rather than off the note is what makes it right:
// the generic registry self-bounds to 3-6 points, so a twelve-sentence note produces six items,
// and counting the note would have excluded every capped anchor for no reason.
export function posterCopyItemCount(copy: PosterCopy): number {
  let longest = 0;
  for (const value of Object.values(copy)) {
    if (Array.isArray(value)) longest = Math.max(longest, value.length);
  }
  return longest;
}

// --- CLI harness -----------------------------------------------------------
//   tsx --env-file=../../.env src/generation/generate-poster-copy.ts [--file=note.txt]
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const fileArg = process.argv.find((a) => a.startsWith('--file='));
  const note = fileArg
    ? (await import('node:fs')).readFileSync(fileArg.slice('--file='.length), 'utf8')
    : [
        'मुख्यमंत्री यांच्या हस्ते आज पुणे येथे मुख्यमंत्री माझी लाडकी बहीण योजनेच्या दुसऱ्या टप्प्याचे उद्घाटन झाले.',
        'या टप्प्यात राज्यातील ५०० कुटुंबांना थेट लाभ मिळणार असून त्यासाठी एकूण २ कोटी रुपयांची तरतूद करण्यात आली आहे.',
        'अर्ज करण्याची अंतिम मुदत ३१ ऑगस्ट २०२६ आहे.',
      ].join(' ');

  generatePosterCopy({
    note,
    postType: 'info_bullets',
    copyStyle: 'info_bullets',
    brand: 'dgipr',
    layoutSpec: { hasPhotoZone: true, bulletSlots: 5, layoutSummary: '' },
    lockedSchemeNames: ['मुख्यमंत्री माझी लाडकी बहीण योजना'],
  })
    .then((r) => {
      console.log(JSON.stringify(r, null, 2));
    })
    .catch((e: unknown) => {
      console.error(e);
      process.exitCode = 1;
    });
}
