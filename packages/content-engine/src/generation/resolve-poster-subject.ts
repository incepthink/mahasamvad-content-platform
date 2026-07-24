// Decide whether an article poster's text should be a NAMED SUBJECT — the proper name of the
// scheme, award, campaign, service, portal or project the news is about — and if so return that
// name in full, exactly as the officer's note spells it.
//
// Why this exists: an article poster carries exactly one Marathi headline, written by
// generate-copy.ts as an EDITORIAL line ("शेतकऱ्यांना कर्जमुक्ती"). When the news has a named
// subject, that is the wrong artifact: an official poster about
// "पुण्यश्लोक अहिल्यादेवी होळकर शेतकरी कर्जमुक्ती योजना" must show that name, in full, character for
// character — a shortened or paraphrased official name on a government poster is a factual error,
// not an editorial choice. The trailing year is part of the name and is exactly the kind of token
// an editorial rewrite drops first.
//
// The rule is CONTENT-driven, not category-driven: a `news` article announcing one scheme gets the
// same treatment as a `scheme` one. What matters is whether the news HAS a named subject.
//
// HISTORY — this file used to be resolve-scheme-subject.ts and recognised only schemes, gated
// behind a free token pre-filter (योजना/अभियान/कार्यक्रम/…). Three real posters showed why that was
// too narrow, and each failed differently:
//   - 'दिव्यांग सशक्तीकरण राष्ट्रीय पुरस्कार-२०२६' — an AWARD carries none of the scheme tokens, so
//     the pre-filter returned null before a token was spent. The pre-filter is now GONE: no token
//     list can enumerate every kind of named thing (टॅक्सी, पुरस्कार, पोर्टल…), and one cheap call
//     against a paid image render was never worth the false negatives.
//   - '‘भारत टॅक्सी’' — a named SERVICE/model, which "scheme, programme or campaign" excluded.
//   - 'पुण्यश्लोक अहिल्यादेवी होळकर शेतकरी कर्जमुक्ती योजना' — an ANNOUNCEMENT in the विधानसभा naming
//     TWO schemes (the older ज्योतिराव फुले… as comparison). The old prompt refused both shapes
//     explicitly ("an announcement that merely MENTIONS a scheme", "several different schemes").
// The accept rules below name those three shapes directly; keep them.
//
// THE GUARANTEE IS DETERMINISTIC, NOT INSTRUCTED — the pattern this repo uses everywhere precision
// matters (proof-read.ts's verbatim-excerpt filter, translate-article.ts's locked-name repair,
// lock-scheme-names.ts, the video planner's fact_index grounding). The model only NOMINATES a name
// and must cite the sentence it read it from; code then requires both to occur in the source
// before the name goes anywhere near a poster. A name that cannot be accounted for is discarded
// and the poster falls back to its normal editorial headline — the pipeline never invents, so the
// failure mode is a plain headline, never a fabricated name.
//
// Cost: exactly ONE poster-copy-tier call per article poster run (skipped entirely when the
// officer typed the poster text by hand — see generations.poster_heading).

import { pathToFileURL } from 'node:url';
import { chatComplete } from './openai-chat.js';
import { POSTER_COPY_MODEL } from './classify-poster-type.js';
import {
  lockSchemeNames,
  validateDeclaredSchemeNames,
} from './lock-scheme-names.js';

// What kind of named thing the subject is. Reported for the job log only — every kind is
// treated identically downstream — but asking for it measurably steadies the judgement, and it
// makes a wrong pick readable in the logs afterwards.
export const SUBJECT_KINDS = [
  'scheme',
  'campaign',
  'mission',
  'award',
  'service',
  'portal',
  'fund',
  'project',
  'initiative',
] as const;

export type SubjectKind = (typeof SUBJECT_KINDS)[number];

export type PosterSubject = Readonly<{
  // The subject's complete name, exactly as it is written in the source.
  name: string;
  // What kind of named thing it is (log/observability only).
  kind: SubjectKind;
  // How the name was established, for the job log.
  source: 'model+verbatim' | 'model+glossary-expanded';
  // Whether the model's cited sentence was found verbatim in the source. False means the name
  // still passed the (stricter) name check but the citation did not match — worth a log line.
  evidenceMatched: boolean;
}>;

export type ResolvePosterSubjectInput = Readonly<{
  // The officer's original note — the authoritative spelling of every name, and what the
  // officer's expectation is expressed against. On a media-room run this IS the article.
  note: string;
  // The finished Marathi article, when it differs from the note (a note→article run). Used as a
  // second place a name may be accounted for; the note's spelling still wins.
  article?: string | undefined;
  // Full scheme/org names known to occur verbatim in the source (verified glossary rows found by
  // findGlossaryTermsInText). Used to expand a truncation the model returned; may be empty, in
  // which case the verbatim check alone decides.
  knownSchemeNames?: readonly string[] | undefined;
}>;

// Enough of each text to judge from — the subject and the framing that identifies it are near the
// top of a press note. Cheap enough to be unremarkable.
const SOURCE_MAX_CHARS = 6000;

// Marathi/English quotation marks and stray edge punctuation a nominated name arrives wrapped in.
// ‘भारत टॅक्सी’ must become भारत टॅक्सी or nothing downstream can match it.
const EDGE_JUNK = /^[\s'"‘’“”«»‚„‘’“”()[\]{}:;,.\-–—]+|[\s'"‘’“”«»‚„()[\]{}:;,.\-–—]+$/gu;

export function stripEdgePunctuation(text: string): string {
  return text.replace(EDGE_JUNK, '').trim();
}

function normalizeSpace(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}

const SYSTEM_PROMPT = [
  'You read Marathi (Devanagari) government press material and answer ONE question: does this news have a NAMED SUBJECT — one specific, officially named thing that the news is about?',
  '',
  'A named subject is the proper name of any of these: a government scheme (योजना), campaign or drive (अभियान/मोहीम), mission (मिशन), award (पुरस्कार/सन्मान), service or model (सेवा/मॉडेल), portal or app (पोर्टल/ॲप), fund (निधी), or project/initiative (प्रकल्प/उपक्रम).',
  '',
  'Answer TRUE whenever the news centres on ONE such named thing. In particular, ALL of these are true cases:',
  '- A minister or officer makes a STATEMENT, ANNOUNCEMENT, LAUNCH, INAUGURATION or REVIEW concerning one named thing — the named thing is the subject, NOT the meeting or the speech.',
  '- Applications, nominations or entries are INVITED for a named award, scheme or programme — the award/scheme name is the subject.',
  '- A CHANGE, expansion, extension, relaxation of conditions or new benefit under one named scheme is announced — that scheme is the subject, even if the article also names an older or related scheme for comparison or background. Choose the one the news ACTS ON, not the one cited as history.',
  '- The name appears inside Marathi quotation marks (‘…’ or “…”) — that is how these notes mark an official name, and it is a strong signal.',
  '',
  'Answer FALSE only when:',
  '- No proper name appears at all — only generic wording ("ही योजना", "शासकीय योजना", "विविध उपक्रम").',
  '- The article is a genuine ROUNDUP of several different named things with no single one at its centre (a list of schemes, a department\'s annual review).',
  '- A named thing appears only as a passing mention in an article that is really about something else entirely.',
  '',
  'When the answer is TRUE:',
  '- Set subject_name to the COMPLETE official name copied VERBATIM from the source — character for character, in Devanagari.',
  '- Include EVERY word of the name: honorific and personal-name prefixes (e.g. "पुण्यश्लोक अहिल्यादेवी होळकर", "मुख्यमंत्री माझी"), the descriptive middle, the head noun (योजना / अभियान / पुरस्कार / सेवा), AND any year or phase that is part of the name (e.g. "२०२६", "-२०२६", "टप्पा २").',
  '- Do NOT include the surrounding quotation marks. Take the name from INSIDE ‘ ’ or “ ”.',
  '- Do NOT shorten it, do NOT abbreviate it, do NOT drop leading words, do NOT translate or transliterate it, and do NOT re-spell it.',
  '- Prefer the fullest form that appears in the source. If the source writes the name with a grammatical case ending (योजनेच्या, अभियानाला, पुरस्कारासाठी), give the plain nominative form of that same name.',
  '- Set subject_kind to the closest of: ' + SUBJECT_KINDS.join(', ') + '.',
  '- Set evidence to ONE sentence copied VERBATIM from the source that contains the name. Copy it exactly; do not paraphrase, shorten or join sentences.',
  '',
  'When the answer is FALSE, set subject_name and evidence to empty strings and subject_kind to "initiative".',
  'Respond with STRICT JSON only.',
].join('\n');

type SubjectAnswer = {
  has_named_subject?: unknown;
  subject_name?: unknown;
  subject_kind?: unknown;
  evidence?: unknown;
};

function parseJson(raw: string): SubjectAnswer {
  try {
    return JSON.parse(raw) as SubjectAnswer;
  } catch {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start !== -1 && end > start) {
      return JSON.parse(raw.slice(start, end + 1)) as SubjectAnswer;
    }
    throw new Error(`Poster-subject check did not return JSON: ${raw.slice(0, 300)}`);
  }
}

function asKind(value: unknown): SubjectKind {
  return SUBJECT_KINDS.includes(value as SubjectKind)
    ? (value as SubjectKind)
    : 'initiative';
}

// A passing mention is shaped differently from a subject: it appears ONCE, late. A subject is
// named in the opening paragraph, usually more than once. This is the only rule here that can
// REJECT a name the model was confident about, so it is deliberately lenient — it fires only on a
// long source where the single occurrence sits in the last quarter. Short sources are exempt
// (there is no "late" in four sentences).
const PROMINENCE_MIN_CHARS = 800;
const PROMINENCE_LATE_FRACTION = 0.75;

export function isProminent(source: string, name: string): boolean {
  if (source.length < PROMINENCE_MIN_CHARS) return true;
  const first = source.indexOf(name);
  // Not found verbatim (an inflected-only mention) — the name check already vouched for it and
  // we cannot locate occurrences reliably, so do not second-guess it.
  if (first === -1) return true;
  if (source.indexOf(name, first + name.length) !== -1) return true; // occurs more than once
  return first / source.length < PROMINENCE_LATE_FRACTION;
}

// The deterministic half, exported so it can be tested without a model call. Takes whatever the
// model nominated and decides whether it may be used.
//
// Three ways a name earns its place, all anchored in the source:
//   1. VERBATIM (or inflected) — validateDeclaredSchemeNames already encodes the Marathi rule that
//      the head noun declines as a suffix, so a nominative "…योजना" is present in a source that
//      writes "…योजनेच्या". That is the same check generate-poster-copy.ts uses.
//   2. EXPANDED — the model returned a truncation of a verified glossary name that IS in the
//      source; lockSchemeNames repairs it, and that repair can only ever lengthen a name toward
//      its source spelling, never invent one or change a digit.
//   3. Neither, in which case null.
// Plus the prominence backstop above.
export function validatePosterSubject(
  source: string,
  candidate: string,
  options: Readonly<{
    kind?: SubjectKind;
    knownSchemeNames?: readonly string[];
    evidenceMatched?: boolean;
  }> = {},
): PosterSubject | null {
  const name = normalizeSpace(stripEdgePunctuation(candidate));
  // A one-word "name" is never an official name and is far too risky to put on a poster alone.
  if (name.split(' ').filter((w) => w.length > 0).length < 2) return null;

  // Expand a truncation against the verified full names first, so the verbatim check below runs
  // against the fullest form we can justify.
  const known = [...new Set(options.knownSchemeNames ?? [])].filter(
    (n) => n.trim().length > 0,
  );
  const { copy: expanded } = lockSchemeNames({ name }, known);
  const finalName = (expanded as { name: string }).name.trim();

  const { valid } = validateDeclaredSchemeNames(source, [finalName]);
  if (valid.length === 0) return null;
  if (!isProminent(source, finalName)) return null;

  return {
    name: finalName,
    kind: options.kind ?? 'initiative',
    source: finalName === name ? 'model+verbatim' : 'model+glossary-expanded',
    evidenceMatched: options.evidenceMatched ?? false,
  };
}

// Resolve the poster's named subject, or null. NEVER throws: a failure here must fall back to the
// ordinary editorial headline, not sink an article poster run that has already been paid for.
export async function resolvePosterSubject(
  input: ResolvePosterSubjectInput,
): Promise<PosterSubject | null> {
  const note = input.note.trim();
  const article = (input.article ?? '').trim();
  if (note.length === 0 && article.length === 0) return null;

  // The note is the authoritative spelling; the article (when it is a different text) is a second
  // place a name may be accounted for. On a media-room run they are identical, so only one block
  // is sent and nothing is paid twice.
  const primary = note.length > 0 ? note : article;
  const secondary = article.length > 0 && article !== note ? article : '';
  // What the name must be accountable in.
  const source = secondary ? `${primary}\n\n${secondary}` : primary;

  const userBlocks = [`<NOTE>\n${primary.slice(0, SOURCE_MAX_CHARS)}\n</NOTE>`];
  if (secondary) {
    userBlocks.push(
      `<ARTICLE_WRITTEN_FROM_THE_NOTE>\n${secondary.slice(0, SOURCE_MAX_CHARS)}\n</ARTICLE_WRITTEN_FROM_THE_NOTE>`,
      'Spell the name exactly as the NOTE writes it whenever it appears there.',
    );
  }

  try {
    const raw = await chatComplete(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userBlocks.join('\n\n') },
      ],
      {
        // The poster-copy tier (gpt-5.6-terra, env OPENAI_COPY_MODEL), NOT the cheaper utility
        // tier. Only half of this call is mechanical: the NAME it returns is re-checked
        // deterministically below, but the JUDGEMENT — does this news have a named subject, or
        // does it merely mention one — is not re-checkable by code, and it decides the entire
        // visible text of an official poster. That is the same reasoning that moved
        // POSTER_COPY_MODEL from luna to terra, so this call travels with it.
        model: POSTER_COPY_MODEL,
        reasoningEffort: 'medium',
        // The evidence sentence shares this budget with the name; Devanagari is token-hungry.
        maxTokens: 600,
        jsonSchema: {
          name: 'poster_subject',
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              has_named_subject: { type: 'boolean' },
              subject_name: { type: 'string' },
              subject_kind: { type: 'string', enum: [...SUBJECT_KINDS] },
              evidence: { type: 'string' },
            },
            required: [
              'has_named_subject',
              'subject_name',
              'subject_kind',
              'evidence',
            ],
          },
        },
      },
    );

    const answer = parseJson(raw);
    if (answer.has_named_subject !== true) {
      console.log('[poster-subject] no named subject in this note — editorial headline stands');
      return null;
    }
    const candidate =
      typeof answer.subject_name === 'string' ? answer.subject_name : '';
    if (stripEdgePunctuation(candidate).length === 0) {
      console.log('[poster-subject] model answered true but named nothing — ignoring');
      return null;
    }

    // Evidence grounding: the cited sentence must really occur in the source AND carry the name.
    // Whitespace-normalised on both sides — a press note wraps lines wherever it likes. This is a
    // report, not a gate: the name check below is strictly stronger, so an evidence miss is
    // logged and the decision continues.
    const evidence =
      typeof answer.evidence === 'string' ? normalizeSpace(answer.evidence) : '';
    const flatSource = normalizeSpace(source);
    const cleanCandidate = normalizeSpace(stripEdgePunctuation(candidate));
    const evidenceMatched =
      evidence.length > 0 &&
      flatSource.includes(evidence) &&
      evidence.includes(cleanCandidate);

    const kind = asKind(answer.subject_kind);
    const resolved = validatePosterSubject(source, candidate, {
      kind,
      knownSchemeNames: input.knownSchemeNames ?? [],
      evidenceMatched,
    });
    if (!resolved) {
      console.warn(
        `[poster-subject] nominated ${kind} not accountable in the source, ignoring: «${cleanCandidate.slice(0, 120)}»`,
      );
      return null;
    }
    console.log(
      `[poster-subject] ${resolved.kind}: «${resolved.name}» (${resolved.source}${resolved.evidenceMatched ? '' : ', evidence unmatched'})`,
    );
    return resolved;
  } catch (error) {
    console.warn(
      '[poster-subject] check failed (using the editorial headline):',
      error,
    );
    return null;
  }
}

// --- CLI harness -----------------------------------------------------------
//   tsx src/generation/resolve-poster-subject.ts              # offline assertions, free
//   tsx --env-file=../../.env src/generation/resolve-poster-subject.ts --file=note.txt
//
// Pass --file for anything multi-line: npx on Windows truncates a multi-line argv at the first
// newline, which silently checks only the headline.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const fileArg = process.argv.find((a) => a.startsWith('--file='));

  if (fileArg) {
    const note = (await import('node:fs')).readFileSync(
      fileArg.slice('--file='.length),
      'utf8',
    );
    console.log(`note: ${note.length} chars, ${note.split('\n').length} lines`);
    const result = await resolvePosterSubject({ note });
    console.log(JSON.stringify(result, null, 2));
  } else {
    // Offline: the validation half only — no model call, no spend.
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

    const FULL = 'पुण्यश्लोक अहिल्यादेवी होळकर शेतकरी कर्जमुक्ती योजना २०२६';

    // 1. The name occurs verbatim, YEAR INCLUDED — accepted whole.
    {
      const article = `राज्य शासनाने ${FULL} जाहीर केली आहे. या योजनेतून शेतकऱ्यांना दिलासा मिळणार आहे.`;
      const got = validatePosterSubject(article, FULL, { kind: 'scheme' });
      check('verbatim name with year accepted', got?.name === FULL, got);
      check('kind carried through', got?.kind === 'scheme', got?.kind);
    }

    // 2. The source DECLINES the head noun (योजनेच्या); the nominative nomination is still valid.
    {
      const NAME = 'मुख्यमंत्री माझी लाडकी बहीण योजना';
      const article =
        'पुणे येथे मुख्यमंत्री माझी लाडकी बहीण योजनेच्या दुसऱ्या टप्प्याचे उद्घाटन झाले.';
      check('inflected mention accepted', validatePosterSubject(article, NAME)?.name === NAME);
    }

    // 3. A TRUNCATION is expanded against a verified glossary full name.
    {
      const article = `${FULL} अंतर्गत अर्ज मागविण्यात आले आहेत.`;
      const got = validatePosterSubject(article, 'शेतकरी कर्जमुक्ती योजना २०२६', {
        knownSchemeNames: [FULL],
      });
      check('truncation expanded to the full name', got?.name === FULL, got);
      check(
        'expansion reported as its own source',
        got?.source === 'model+glossary-expanded',
        got?.source,
      );
    }

    // 4. A name with NO basis in the source is refused outright.
    {
      const article = `${FULL} जाहीर करण्यात आली.`;
      check(
        'invented name refused',
        validatePosterSubject(article, 'प्रधानमंत्री आवास योजना') === null,
      );
    }

    // 5. The year must not be silently dropped: a nomination missing it is repaired, not accepted
    //    short, when the glossary knows the full form.
    {
      const article = `${FULL} ला मंजुरी मिळाली.`;
      const got = validatePosterSubject(
        article,
        'पुण्यश्लोक अहिल्यादेवी होळकर शेतकरी कर्जमुक्ती योजना',
        { knownSchemeNames: [FULL] },
      );
      check('missing year restored from the glossary', got?.name === FULL, got);
    }

    // 6. A single word is never an official name.
    {
      check(
        'single-word nomination refused',
        validatePosterSubject('योजना जाहीर झाली.', 'योजना') === null,
      );
    }

    // 7. QUOTED names — the real shape of these notes. The quotes must come off, and the
    //    two-word service name must survive (the ‘भारत टॅक्सी’ case).
    {
      const article =
        'सहकाराची नवी क्रांती ‘भारत टॅक्सी’मुळे प्रवासी आणि चालकांसाठी प्रवासाचा नवा अध्याय असून ही ‘भारत टॅक्सी’ संकल्पना रास्त भाड्यात सुरक्षित प्रवास देणारी ठरेल.';
      const got = validatePosterSubject(article, '‘भारत टॅक्सी’', { kind: 'service' });
      check('quotes stripped from the nominated name', got?.name === 'भारत टॅक्सी', got);
      check(
        'plain double quotes stripped too',
        validatePosterSubject(article, '"भारत टॅक्सी"')?.name === 'भारत टॅक्सी',
      );
      check(
        'stripEdgePunctuation leaves interior text alone',
        stripEdgePunctuation('‘दिव्यांग सशक्तीकरण राष्ट्रीय पुरस्कार-२०२६’') ===
          'दिव्यांग सशक्तीकरण राष्ट्रीय पुरस्कार-२०२६',
      );
    }

    // 8. An AWARD with a hyphen-attached year — the case the old token pre-filter never even
    //    sent to the model. The hyphen must survive; the name must not be split at it.
    {
      const AWARD = 'दिव्यांग सशक्तीकरण राष्ट्रीय पुरस्कार-२०२६';
      const article = `भारत सरकारच्या वतीने दिले जाणारे ‘${AWARD}’ साठी ऑनलाईन अर्ज सादर करण्याचे आवाहन करण्यात आले आहे. ${AWARD} दरवर्षी ३ डिसेंबर रोजी प्रदान केले जातात.`;
      const got = validatePosterSubject(article, AWARD, { kind: 'award' });
      check('hyphenated-year award accepted whole', got?.name === AWARD, got);
      check('the year survives', got?.name.includes('२०२६') === true);
    }

    // 9. PROMINENCE backstop: a passing mention (once, in the last quarter of a long note) is
    //    rejected; the same name named early, or named twice, is kept.
    {
      const NAME = 'मुख्यमंत्री माझी लाडकी बहीण योजना';
      const filler = 'जिल्हाधिकारी यांनी पूरग्रस्त भागाची पाहणी केली आणि मदतकार्याचा आढावा घेतला. '.repeat(
        20,
      );
      check(
        'single late mention rejected',
        validatePosterSubject(`${filler} याप्रसंगी ${NAME} चा उल्लेख झाला.`, NAME) === null,
      );
      check(
        'early mention in the same long text kept',
        validatePosterSubject(`${NAME} बाबत बैठक झाली. ${filler}`, NAME)?.name === NAME,
      );
      check(
        'two mentions kept even when one is late',
        validatePosterSubject(`${NAME} बाबत बैठक. ${filler} ${NAME} पुन्हा.`, NAME)?.name ===
          NAME,
      );
      check(
        'short source is exempt from the prominence rule',
        validatePosterSubject(`आढावा बैठक झाली. ${NAME} चा उल्लेख झाला.`, NAME)?.name === NAME,
      );
    }

    // 10. The name may be accounted for in EITHER text: a note→article run passes both,
    //     concatenated, and a name present only in the note is still valid.
    {
      const NAME = 'भारत टॅक्सी';
      const note = 'नवी मुंबई: ‘भारत टॅक्सी’ ही सहकार क्षेत्रातील नवी संकल्पना आहे.';
      const written = 'सहकार क्षेत्रात नव्या सेवेचा प्रारंभ झाला आहे.';
      check(
        'name found in the note half of the source',
        validatePosterSubject(`${note}\n\n${written}`, NAME)?.name === NAME,
      );
    }

    console.log(
      failures === 0
        ? '\nAll poster-subject validation checks passed.'
        : `\n${failures} check(s) FAILED.`,
    );
    process.exitCode = failures === 0 ? 0 : 1;
  }
}
