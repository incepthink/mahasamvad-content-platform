// Decide WHOSE face a YouTube thumbnail should carry, from the officer's own text.
//
// Why this exists: the thumbnail lane renders by EDITING a reference template, and the
// templates in the library are finished posters that happen to carry a cut-out portrait of
// whichever official that post was about. Nothing ever told the model who the NEW thumbnail is
// about, and the live prompt went further — it called the attached template "the attached
// minister's photo" and said to preserve that face exactly. So a thumbnail about the Chief
// Minister shipped with the face of whoever stood on the template. The model was obeying us.
//
// The fix is to name the person explicitly. The reference then supplies STYLE and STRUCTURE
// only — which is what every other rule in build-youtube-thumbnail-prompt.ts already says it
// supplies — and the person is rendered from the identity we name, not inherited from the
// pixels we happened to hand over.
//
// THE GUARANTEE IS DETERMINISTIC, NOT INSTRUCTED — the pattern this repo uses wherever
// precision matters (resolve-poster-subject.ts, lock-scheme-names.ts, proof-read.ts's
// verbatim-excerpt filter, the video planner's fact_index grounding). The model only
// NOMINATES; code then requires every name to be accountable in the source before it goes
// anywhere near a paid render. Putting the wrong official's face on a government thumbnail is
// the failure being fixed, so a fabricated name must not be reachable by a better-sounding
// model answer.
//
// A name earns its place two ways, both anchored outside the model:
//   1. VERBATIM in the note. Marathi inflects by SUFFIX (फडणवीस → फडणवीसांनी), so a plain
//      substring test on the nominative form is inflection-tolerant for free — the same
//      property findGlossaryTermsInText relies on.
//   2. From the VERIFIED GLOSSARY, when the note names only the office ("मुख्यमंत्री यांच्या
//      हस्ते…"). The dictionary already carries designation → person (migration 0032), and it
//      must map to EXACTLY ONE holder — Maharashtra has two उपमुख्यमंत्री, and guessing which
//      one is on the thumbnail is precisely the error we are removing. Ambiguity resolves to
//      nobody, which is prepareDesignations' stance on the same data.
//
// Cost: exactly ONE poster-copy-tier call per thumbnail render, against a paid image call it
// guards. Failure is never fatal — it returns [] and the thumbnail is rendered without a
// portrait, which is the correct failure for a government product: no face beats a wrong face.

import { pathToFileURL } from 'node:url';
import { chatComplete } from './openai-chat.js';
import { POSTER_COPY_MODEL } from './classify-poster-type.js';

/**
 * How many faces a thumbnail may carry. A 1280x656 frame read at ~320px wide holds one
 * portrait comfortably and two at a push; past that nobody is recognisable, which defeats the
 * purpose of naming them. The model is asked to rank, so a truncation drops the least
 * prominent.
 */
export const THUMBNAIL_MAX_PEOPLE = 2;

export type ThumbnailPerson = Readonly<{
  /** The person's name in Marathi, spelled as the note spells it (or as the glossary does). */
  name: string;
  /** Their office, used as an identity hint to the image model. Empty when none is supported. */
  designation: string;
  /** How the name was established, for the job log. */
  source: 'note' | 'glossary-office';
}>;

export type ResolveThumbnailPeopleInput = Readonly<{
  /** The officer's information — the thumbnail's content and the authoritative spelling. */
  information: string;
  /**
   * Verified designation → holder(s), from mapDesignationsToPersons. Used ONLY to resolve an
   * office the note names without a person. A title with several holders resolves to nobody.
   */
  officeHolders?: ReadonlyMap<string, readonly string[]> | undefined;
}>;

// Enough of a press note to judge from: who the event is about is established in its opening,
// exactly as resolve-poster-subject.ts assumes for the subject.
const SOURCE_MAX_CHARS = 6000;

// Marathi/English quotation marks and stray edge punctuation a nominated name arrives wrapped
// in. Shared shape with resolve-poster-subject.ts's stripEdgePunctuation.
const EDGE_JUNK =
  /^[\s'"‘’“”«»‚„()[\]{}:;,.\-–—]+|[\s'"‘’“”«»‚„()[\]{}:;,.\-–—]+$/gu;

function clean(text: string): string {
  return text.replace(EDGE_JUNK, '').replace(/\s+/gu, ' ').trim();
}

// Honorifics a note attaches to a name. Stripped before the accountability check so that
// "श्री. देवेंद्र फडणवीस" nominated against a note writing "देवेंद्र फडणवीस" still matches, and so
// that an honorific alone can never pass as a name.
const HONORIFICS = [
  'श्री.',
  'श्री',
  'श्रीमती',
  'सौ.',
  'सौ',
  'डॉ.',
  'डॉ',
  'मा.',
  'ना.',
];

function stripHonorifics(name: string): string {
  let out = name;
  let changed = true;
  while (changed) {
    changed = false;
    for (const honorific of HONORIFICS) {
      if (out.startsWith(`${honorific} `)) {
        out = out.slice(honorific.length + 1).trim();
        changed = true;
      }
    }
  }
  return out;
}

const SYSTEM_PROMPT = [
  'You read Marathi (Devanagari) government press material and answer ONE question: whose PHOTOGRAPH should appear on the YouTube thumbnail made from this text?',
  '',
  'These thumbnails carry a cut-out portrait of the official the video is about — the person whose presence, decision, announcement or inauguration IS the news.',
  '',
  'Choose the person the video is ABOUT, in this order of preference:',
  '- the official whose presence the text announces (यांच्या हस्ते, यांच्या प्रमुख उपस्थितीत, यांच्या अध्यक्षतेखाली) — that is the headline face;',
  '- the official who makes the announcement, decision, direction or statement the text reports;',
  '- the official who inaugurates, launches or presides over the event.',
  '',
  `Return at most ${THUMBNAIL_MAX_PEOPLE} people, MOST IMPORTANT FIRST. Return a second person only when the text gives them comparable prominence — a list of attendees (उपस्थित होते) is NOT prominence, and neither is a person mentioned once in passing.`,
  '',
  'Return an EMPTY list when the text is about a scheme, a deadline, an advisory, a department or a process with no one official at its centre. A thumbnail with no face is correct in that case. NEVER pick someone merely because they are mentioned.',
  '',
  'For each person:',
  '- Set "name" to their personal name copied VERBATIM from the text, in Devanagari, in its plain nominative form (from "फडणवीसांनी" give "फडणवीस"; from "देवेंद्र फडणवीस यांच्या" give "देवेंद्र फडणवीस"). Give the FULLEST form the text uses — both the first name and the surname when both appear. Do NOT include honorifics (श्री., मा., ना.), and do NOT include their designation in this field.',
  '- If the text names the OFFICE but not the person ("मुख्यमंत्र्यांच्या हस्ते", "जिल्हाधिकारी यांच्या अध्यक्षतेखाली"), set "name" to an empty string and fill "designation" only. Do NOT supply a name from your own knowledge — you will be given the wrong one and it will be printed on an official government thumbnail.',
  '- Set "designation" to their office as the text writes it (मुख्यमंत्री, उपमुख्यमंत्री, पालकमंत्री, मंत्री, जिल्हाधिकारी, महापौर, आयुक्त …), in Devanagari. Leave it an empty string if the text does not give one.',
  '- Set "evidence" to ONE phrase copied VERBATIM from the text that names them or their office. Copy it exactly.',
  '',
  'Never invent a person, a name or an office. Never add anyone the text does not mention.',
  'Respond with STRICT JSON only.',
].join('\n');

type PeopleAnswer = {
  people?: unknown;
};

type NominatedPerson = {
  name?: unknown;
  designation?: unknown;
  evidence?: unknown;
};

function parseJson(raw: string): PeopleAnswer {
  try {
    return JSON.parse(raw) as PeopleAnswer;
  } catch {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start !== -1 && end > start) {
      return JSON.parse(raw.slice(start, end + 1)) as PeopleAnswer;
    }
    throw new Error(
      `Thumbnail-people check did not return JSON: ${raw.slice(0, 300)}`,
    );
  }
}

/**
 * The deterministic half, exported so it can be tested without a model call.
 *
 * Takes whatever the model nominated and decides who may actually be rendered. Every returned
 * person is accountable in the source or in the verified dictionary; nothing else survives.
 */
export function validateThumbnailPeople(
  source: string,
  nominated: readonly {
    name: string;
    designation?: string | undefined;
  }[],
  options: Readonly<{
    officeHolders?: ReadonlyMap<string, readonly string[]> | undefined;
  }> = {},
): ThumbnailPerson[] {
  const officeHolders = options.officeHolders;
  const out: ThumbnailPerson[] = [];
  const seen = new Set<string>();

  for (const candidate of nominated) {
    if (out.length >= THUMBNAIL_MAX_PEOPLE) break;

    const designation = clean(candidate.designation ?? '');
    const name = stripHonorifics(clean(candidate.name));

    let resolved: ThumbnailPerson | null = null;

    if (name.length > 0) {
      // 1. Accountable in the note. Marathi inflects by suffix, so the nominative form is a
      //    substring of its own inflected mention — no morphology needed.
      if (source.includes(name)) {
        resolved = {
          name,
          // A designation is an identity hint, not printed text, but it must still be
          // supported: an office the note never gives is exactly the kind of plausible detail
          // that turns into a wrong face.
          designation:
            designation.length > 0 && source.includes(designation)
              ? designation
              : '',
          source: 'note',
        };
      }
    } else if (designation.length > 0 && source.includes(designation)) {
      // 2. The note names only the office. The verified dictionary supplies the person — and
      //    only when it maps to exactly one, because two उपमुख्यमंत्री is the ambiguity that
      //    produces the wrong face rather than no face.
      const holders = officeHolders?.get(designation) ?? [];
      if (holders.length === 1 && (holders[0] ?? '').trim().length > 0) {
        resolved = {
          name: (holders[0] as string).trim(),
          designation,
          source: 'glossary-office',
        };
      }
    }

    if (!resolved) continue;
    const key = resolved.name;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(resolved);
  }

  return out;
}

/**
 * Resolve whose face the thumbnail should carry, or an empty list.
 *
 * NEVER throws: a failure here must render a portrait-free thumbnail, not sink a run. No face
 * is a correct outcome; a wrong face is not.
 */
export async function resolveThumbnailPeople(
  input: ResolveThumbnailPeopleInput,
): Promise<ThumbnailPerson[]> {
  const source = input.information.trim();
  if (source.length === 0) return [];

  try {
    const raw = await chatComplete(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: `<INFORMATION>\n${source.slice(0, SOURCE_MAX_CHARS)}\n</INFORMATION>`,
        },
      ],
      {
        // The poster-copy tier (gpt-5.6-terra), not the utility tier — the same reasoning as
        // resolve-poster-subject.ts. The NAMES are re-checked deterministically below, but the
        // JUDGEMENT (who is this video about, versus who is merely listed as present) is not
        // re-checkable by code and decides the most prominent element of the finished frame.
        model: POSTER_COPY_MODEL,
        reasoningEffort: 'medium',
        // Two people plus their evidence phrases; Devanagari is token-hungry.
        maxTokens: 700,
        jsonSchema: {
          name: 'thumbnail_people',
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              people: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    name: { type: 'string' },
                    designation: { type: 'string' },
                    evidence: { type: 'string' },
                  },
                  required: ['name', 'designation', 'evidence'],
                },
              },
            },
            required: ['people'],
          },
        },
      },
    );

    const answer = parseJson(raw);
    const nominated = Array.isArray(answer.people)
      ? (answer.people as NominatedPerson[])
      : [];
    if (nominated.length === 0) {
      console.log(
        '[thumbnail-people] no principal official in this text — rendering without a portrait',
      );
      return [];
    }

    const people = validateThumbnailPeople(
      source,
      nominated.map((person) => ({
        name: typeof person.name === 'string' ? person.name : '',
        designation:
          typeof person.designation === 'string' ? person.designation : '',
      })),
      { officeHolders: input.officeHolders },
    );

    if (people.length === 0) {
      console.warn(
        `[thumbnail-people] ${nominated.length} nominated, none accountable in the text — rendering without a portrait`,
      );
      return [];
    }
    console.log(
      `[thumbnail-people] ${people
        .map(
          (p) =>
            `${p.designation ? `${p.designation} ` : ''}${p.name} (${p.source})`,
        )
        .join(', ')}`,
    );
    return people;
  } catch (error) {
    console.warn(
      '[thumbnail-people] check failed (rendering without a portrait):',
      error,
    );
    return [];
  }
}

// --- CLI harness -----------------------------------------------------------
//   tsx src/generation/resolve-thumbnail-people.ts                       # offline, free
//   tsx --env-file=../../.env src/generation/resolve-thumbnail-people.ts --file=note.txt
//
// Pass --file for anything multi-line: npx on Windows truncates a multi-line argv at the first
// newline, which silently checks only the headline.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const fileArg = process.argv.find((a) => a.startsWith('--file='));

  if (fileArg) {
    const note = (await import('node:fs')).readFileSync(
      fileArg.slice('--file='.length),
      'utf8',
    );
    console.log(`note: ${note.length} chars, ${note.split('\n').length} lines`);
    const holders = new Map<string, readonly string[]>([
      ['मुख्यमंत्री', ['देवेंद्र फडणवीस']],
      ['उपमुख्यमंत्री', ['एकनाथ शिंदे', 'अजित पवार']],
    ]);
    console.log(
      JSON.stringify(
        await resolveThumbnailPeople({
          information: note,
          officeHolders: holders,
        }),
        null,
        2,
      ),
    );
  } else {
    let failures = 0;
    const check = (label: string, ok: boolean, detail?: unknown): void => {
      if (ok) console.log(`  ok   ${label}`);
      else {
        failures += 1;
        console.log(
          `  FAIL ${label}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`,
        );
      }
    };

    const HOLDERS = new Map<string, readonly string[]>([
      ['मुख्यमंत्री', ['देवेंद्र फडणवीस']],
      ['उपमुख्यमंत्री', ['एकनाथ शिंदे', 'अजित पवार']],
    ]);

    // The reported thumbnail's own text.
    const NOTE =
      'मुख्यमंत्री देवेंद्र फडणवीस यांच्या प्रमुख उपस्थितीत प्रो-गोविंदा लीग सीझन-४ चे उद्घाटन. तारीख २५ ऑगस्ट, २०२६, वेळ दुपारी ४ वाजता, स्थळ एसव्हीपी स्टेडियम, वरळी, मुंबई.';

    console.log('\n=== a name the text carries is accepted ===');
    {
      const got = validateThumbnailPeople(NOTE, [
        { name: 'देवेंद्र फडणवीस', designation: 'मुख्यमंत्री' },
      ]);
      check(
        'the named official is returned',
        got[0]?.name === 'देवेंद्र फडणवीस',
        got,
      );
      check(
        'their designation is carried',
        got[0]?.designation === 'मुख्यमंत्री',
        got,
      );
      check('reported as read from the note', got[0]?.source === 'note', got);
    }

    console.log('\n=== an inflected mention still resolves ===');
    {
      const inflected =
        'या निर्णयाला मुख्यमंत्री देवेंद्र फडणवीसांनी मान्यता दिली.';
      const got = validateThumbnailPeople(inflected, [
        { name: 'देवेंद्र फडणवीस', designation: 'मुख्यमंत्री' },
      ]);
      check(
        'suffix inflection does not block the match',
        got.length === 1,
        got,
      );
    }

    console.log('\n=== an honorific is stripped, not treated as the name ===');
    {
      const got = validateThumbnailPeople(NOTE, [
        { name: 'श्री. देवेंद्र फडणवीस', designation: 'मुख्यमंत्री' },
      ]);
      check(
        'honorific stripped and the name still matches',
        got[0]?.name === 'देवेंद्र फडणवीस',
        got,
      );
      check(
        'an honorific alone is not a person',
        validateThumbnailPeople(NOTE, [{ name: 'श्री.' }]).length === 0,
      );
    }

    console.log('\n=== a person the text never names is refused ===');
    {
      check(
        'invented official refused',
        validateThumbnailPeople(NOTE, [
          { name: 'अजित पवार', designation: 'उपमुख्यमंत्री' },
        ]).length === 0,
      );
    }

    console.log(
      '\n=== an unsupported designation is dropped, the name survives ===',
    );
    {
      const plain = 'देवेंद्र फडणवीस यांच्या हस्ते उद्घाटन झाले.';
      const got = validateThumbnailPeople(plain, [
        { name: 'देवेंद्र फडणवीस', designation: 'पालकमंत्री' },
      ]);
      check('the name is kept', got[0]?.name === 'देवेंद्र फडणवीस', got);
      check(
        'the unsupported office is not asserted',
        got[0]?.designation === '',
        got,
      );
    }

    console.log(
      '\n=== office named without a person resolves from the dictionary ===',
    );
    {
      const officeOnly =
        'मुख्यमंत्री यांच्या हस्ते प्रकल्पाचे लोकार्पण होणार आहे.';
      const got = validateThumbnailPeople(
        officeOnly,
        [{ name: '', designation: 'मुख्यमंत्री' }],
        { officeHolders: HOLDERS },
      );
      check(
        'the single verified holder is used',
        got[0]?.name === 'देवेंद्र फडणवीस',
        got,
      );
      check(
        'reported as a dictionary lookup',
        got[0]?.source === 'glossary-office',
        got,
      );
    }

    console.log('\n=== an office with SEVERAL holders resolves to nobody ===');
    {
      const officeOnly = 'उपमुख्यमंत्री यांच्या अध्यक्षतेखाली बैठक झाली.';
      check(
        'ambiguous office proposes no one',
        validateThumbnailPeople(
          officeOnly,
          [{ name: '', designation: 'उपमुख्यमंत्री' }],
          { officeHolders: HOLDERS },
        ).length === 0,
      );
      check(
        'and without a dictionary at all, still nobody',
        validateThumbnailPeople(officeOnly, [
          { name: '', designation: 'उपमुख्यमंत्री' },
        ]).length === 0,
      );
    }

    console.log('\n=== the cap and de-duplication hold ===');
    {
      const many =
        'मुख्यमंत्री देवेंद्र फडणवीस, मंत्री दादाजी भुसे आणि मंत्री गणेश नाईक उपस्थित होते.';
      const got = validateThumbnailPeople(many, [
        { name: 'देवेंद्र फडणवीस', designation: 'मुख्यमंत्री' },
        { name: 'दादाजी भुसे', designation: 'मंत्री' },
        { name: 'गणेश नाईक', designation: 'मंत्री' },
      ]);
      check(
        `never more than ${THUMBNAIL_MAX_PEOPLE}`,
        got.length === THUMBNAIL_MAX_PEOPLE,
        got,
      );
      check(
        'ranking preserved — the principal is first',
        got[0]?.name === 'देवेंद्र फडणवीस',
        got,
      );
      const dupes = validateThumbnailPeople(NOTE, [
        { name: 'देवेंद्र फडणवीस', designation: 'मुख्यमंत्री' },
        { name: 'देवेंद्र फडणवीस', designation: 'मुख्यमंत्री' },
      ]);
      check('the same person is not returned twice', dupes.length === 1, dupes);
    }

    console.log('\n=== an empty nomination list is an empty answer ===');
    check(
      'no people, no portrait',
      validateThumbnailPeople(NOTE, []).length === 0,
    );

    console.log(
      failures === 0
        ? '\nAll thumbnail-people checks passed.'
        : `\n${failures} check(s) FAILED.`,
    );
    if (failures > 0) process.exitCode = 1;
  }
}
