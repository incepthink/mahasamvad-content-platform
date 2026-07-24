// Remove colour language from a master template's layout description.
//
// Why this exists: the fully-AI-generated ("fresh") social poster is anchored to an assigned
// colour palette (poster-palettes.ts), but the prompt ALSO carries the selected master's
// vision-derived `layoutSummary` as structure inspiration — and analyze-template.ts explicitly
// asks that summary to end with "the dominant colour theme". The DGIPR master library is
// overwhelmingly saffron/maroon/cream, so every fresh render was handed the house palette in
// prose right next to its assigned one, under nothing stronger than "IGNORE any colours it
// mentions". Telling a model to ignore words you just gave it is not a mechanism.
//
// So the colour words are removed before the summary is ever shown to the image model. This is
// the same "structural, not instructed" move as lock-scheme-names.ts (validate, don't ask) and
// proof-read.ts's verbatim-excerpt filter: a deterministic pass that cannot be argued with.
//
// What it must NOT do is damage the structural content, which is the only reason the summary is
// in the prompt at all. "five white advisory cards" must become "five advisory cards", not
// disappear. So colour PHRASES are excised in place, and only a sentence that was *about* colour
// (a "Theme: ..." tail, or one left with nothing but connective tissue) is dropped whole.
//
// The stored layout_spec is never modified — this filters one prompt, so /references still shows
// the operator the full analysis and the edit-mode prompts (which legitimately want the master's
// colours, since they repaint that very master) are untouched.

import { pathToFileURL } from 'node:url';

// Colour nouns/adjectives that appear in template analyses. Deliberately generous: a false
// positive costs a word of structural description, a false negative costs a saffron poster.
const COLOUR_TERMS = [
  'amber',
  'aqua',
  'aubergine',
  'beige',
  'black',
  'blue',
  'blush',
  'bone',
  'brass',
  'bronze',
  'brown',
  'burgundy',
  'charcoal',
  'chocolate',
  'copper',
  'coral',
  'cream',
  'crimson',
  'cyan',
  'ebony',
  'emerald',
  'fuchsia',
  'gold',
  'golden',
  'graphite',
  'gray',
  'green',
  'grey',
  'indigo',
  'ivory',
  'jade',
  'khaki',
  'lavender',
  'lilac',
  'lime',
  'magenta',
  'maroon',
  'mauve',
  'mint',
  'mustard',
  'navy',
  'ochre',
  'olive',
  'orange',
  'peach',
  'pink',
  'plum',
  'porcelain',
  'purple',
  'red',
  'rose',
  'ruby',
  'rust',
  'saffron',
  'sage',
  'salmon',
  'sand',
  'sapphire',
  'scarlet',
  'sepia',
  'silver',
  'slate',
  'steel',
  'stone',
  'tan',
  'teal',
  'terracotta',
  'turquoise',
  'violet',
  'white',
  'wine',
  'yellow',
];

// Modifiers that only ever qualify a colour here ("deep teal", "off-white", "pale blue"). Matched
// as an optional prefix so they leave with the colour rather than stranding "a deep card".
const COLOUR_MODIFIERS = [
  'bright',
  'dark',
  'deep',
  'dull',
  'faded',
  'light',
  'muted',
  'near',
  'off',
  'pale',
  'rich',
  'soft',
  'vivid',
  'warm',
  'cool',
  'bold',
  'jewel',
  'earthy',
  'pastel',
  'neon',
  'dusty',
  'burnt',
  'antique',
];

const TERMS = COLOUR_TERMS.join('|');
const MODS = COLOUR_MODIFIERS.join('|');

// One colour token, optionally hyphen-compounded ("blue-grey", "saffron-orange") and optionally
// carrying a modifier ("deep teal", "off-white"). `-?` covers both "off white" and "off-white".
const COLOUR_TOKEN = `(?:(?:${MODS})[\\s-]+)?(?:${TERMS})(?:[\\s-]+(?:${TERMS}))*`;

// A colour phrase: one or more colour tokens joined by "and" / "&" / commas, plus an optional
// trailing "tones"/"shades"/"theme" noun. A leading article is CAPTURED rather than consumed, so
// "a soft orange panel" reduces to "a panel" and not to "panel" — the phrase is the colour, the
// article belongs to the noun that survives.
const COLOUR_PHRASE = new RegExp(
  `\\b((?:a|an|the)\\s+)?${COLOUR_TOKEN}(?:\\s*(?:,|and|&|or|\\/)\\s*${COLOUR_TOKEN})*` +
    `(?:\\s+(?:tone|tones|shade|shades|hue|hues|tint|tints|colour|color|colours|colors|palette|theme|scheme|accent|accents))?`,
  'gi',
);

// A clause whose whole job was colour ("Theme: navy, red and yellow.", "the dominant colour
// theme is warm saffron", "; the palette is cream and deep teal"). Dropped outright rather than
// reduced to a stub — real analyses end on exactly these, because analyze-template.ts asks for
// "the dominant colour theme" last.
const COLOUR_CLAUSE =
  /^\s*(?:and\s+|but\s+|while\s+|with\s+)?(?:the\s+|its\s+)?(?:dominant\s+|overall\s+|primary\s+|main\s+|general\s+)*(?:colour|color)?\s*(?:theme|palette|scheme|colours|colors)\b/i;

// Colour vocabulary that is not itself a colour name and so survives phrase removal.
const LOOSE_COLOUR_WORDS =
  /\b(?:monochrome|duotone|two-tone|multicoloured|multicolored|colourful|colorful)\b/gi;

// "colour palette" / "colour theme" as a bare noun phrase, once its colours have been cut out.
const COLOUR_NOUN_PHRASE =
  /\b(?:a|an|the)?\s*(?:dominant|overall|primary|main)?\s*(?:colour|color)\s+(?:palette|theme|scheme|tones?|accents?)\b/gi;

// Words that only qualified the colour that has just been removed ("a warm rural theme" ->
// "a rural theme"). Left in place they still steer the image model's palette, which is the whole
// thing this file exists to prevent.
const ORPHAN_MODIFIER = new RegExp(`\\b(?:${MODS})\\s+(?=[,.;:]|$)`, 'gi');

// A clause that still names colour vocabulary but has lost its substance — what remains of
// "the overall theme is agricultural green with deep maroon typography".
const RESIDUAL_COLOUR_WORD =
  /\b(?:palette|colour|color|theme|tone|tones|shade|shades|hue|hues|type|typography)\b/i;

// "saffron-and-cream", "black-and-green" — two colours the phrase matcher would otherwise see as
// one unrecognised hyphenated word. Anchored on a colour term either side so "call-to-action"
// and "left-to-right" are left alone.
const HYPHENATED_COMPOUND = new RegExp(`\\b(${TERMS})-(and|or)-(${TERMS})\\b`, 'gi');

// Connectives left dangling once a colour phrase is cut from the end of a clause
// ("a soft agricultural-field background in ," -> "a soft agricultural-field background").
const DANGLING_TAIL =
  /[\s,]*\b(?:in|on|with|of|over|against|using|and|or|is|are|uses?|and\s+the|a|an|the)\s*$/i;

function tidy(text: string): string {
  return (
    text
      // "in , a" / " ." left by an excision
      .replace(/\s*,\s*,+/g, ',')
      .replace(/\(\s*\)/g, '')
      .replace(/\s+([,.;:])/g, '$1')
      .replace(/([,;:])\s*\./g, '.')
      // "on a ." / "in the ." — an article stranded by the removal
      .replace(/\b(?:a|an|the)\s+([.,;])/gi, '$1')
      .replace(/\s{2,}/g, ' ')
      .trim()
  );
}

// Split on sentence boundaries, keeping the terminator so rejoining does not invent punctuation.
function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0);
}

function wordCount(text: string): number {
  return text.replace(/[^A-Za-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean).length;
}

// Trim connectives left hanging where a colour phrase used to sit, repeatedly ("background in
// green and yellow" -> "background in and" -> "background").
function trimDangling(text: string): string {
  let body = text;
  let previous = '';
  while (body !== previous) {
    previous = body;
    body = body.replace(DANGLING_TAIL, '');
  }
  return body;
}

type ClauseResult =
  // The clause was a colour statement ("the dominant palette is …"). Its continuation clauses
  // are the rest of the same statement, so the caller abandons the remainder of the sentence.
  | Readonly<{ kind: 'colour' }>
  // Nothing structural survived this clause alone; later clauses may still be fine.
  | Readonly<{ kind: 'empty' }>
  | Readonly<{ kind: 'kept'; text: string }>;

// Remove colour language from ONE clause.
function stripClause(clause: string): ClauseResult {
  if (COLOUR_CLAUSE.test(clause)) return { kind: 'colour' };

  const before = wordCount(clause);
  // The article is put back by `$1`, so "a soft orange panel" reduces to "a panel", not "panel".
  let out = clause
    .replace(COLOUR_PHRASE, (_m, article: string | undefined) => ` ${article ?? ''}`)
    .replace(COLOUR_NOUN_PHRASE, ' ')
    .replace(LOOSE_COLOUR_WORDS, ' ');
  out = tidy(trimDangling(tidy(out)).replace(ORPHAN_MODIFIER, ''));

  const after = wordCount(out);
  if (after === 0) return { kind: 'empty' };
  // A clause still naming colour vocabulary but stripped of its substance was a colour clause in
  // disguise ("the overall theme is agricultural green with deep maroon typography").
  if (RESIDUAL_COLOUR_WORD.test(out) && after < 5) return { kind: 'empty' };
  // The clause lost its subject to the removal and what remains is a fragment — "blue and white
  // dominate the design" leaves "dominate the design", which describes nothing structural.
  if (before - after >= 2 && after < 5) return { kind: 'empty' };
  // The removal ate most of it — whatever is left is not a useful structural description.
  if (after < before / 3) return { kind: 'empty' };
  return { kind: 'kept', text: out };
}

// Strip every colour mention from a layout description, keeping its structural content.
//
// Works clause by clause (`;` and `,` delimited), because a real analysis puts the colour theme
// in a trailing CLAUSE rather than its own sentence — "…icons run down the left, while a portrait
// occupies the lower-right; the palette is navy, white and yellow." Only whole clauses are
// dropped and the original separators are preserved, so no list is ever re-punctuated.
//
// Returns '' when nothing structural survives; the caller then omits the hint entirely, which is
// correct — an all-colour summary has nothing to contribute to a from-scratch composition.
export function stripColourMentions(text: string | null | undefined): string {
  // Hyphen-joined compounds ("saffron-and-cream", "white-and-yellow") must read as two colours.
  // Anchored on colour terms BOTH sides, or this also unpicks "call-to-action".
  const input = (text ?? '').replace(HYPHENATED_COMPOUND, '$1 $2 $3').trim();
  if (input.length === 0) return '';

  const sentences: string[] = [];
  for (const sentence of splitSentences(input)) {
    const terminator = /[.!?]$/.test(sentence) ? sentence.slice(-1) : '';
    const body = terminator ? sentence.slice(0, -1) : sentence;

    // Split into clauses, KEEPING the separator that introduced each one.
    const parts = body.split(/([;,])/);
    const kept: string[] = [];
    for (let i = 0; i < parts.length; i += 2) {
      const clause = (parts[i] ?? '').trim();
      if (clause.length === 0) continue;
      const separator = i === 0 ? '' : ((parts[i - 1] as string | undefined) ?? ',');
      const result = stripClause(clause);
      // "The dominant palette is navy, yellow, white, and red card accents." is ONE statement
      // spread over five clauses; once its head is recognised, the tail belongs to it too.
      if (result.kind === 'colour') break;
      if (result.kind === 'empty') continue;
      kept.push(kept.length === 0 ? result.text : `${separator} ${result.text}`);
    }
    if (kept.length === 0) continue;

    const rebuilt = tidy(trimDangling(tidy(kept.join(''))));
    if (wordCount(rebuilt) < 3) continue;
    sentences.push(rebuilt + terminator);
  }

  return tidy(sentences.join(' '));
}

// --- CLI harness -----------------------------------------------------------
//   tsx src/generation/strip-colour-words.ts
// Offline assertions over realistic layoutSummary strings: no colour word may survive, and the
// structural nouns/counts must. No model call, no spend.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  type Case = Readonly<{
    input: string;
    mustKeep: readonly string[];
  }>;

  const CASES: readonly Case[] = [
    {
      input:
        'A large stacked, high-contrast headline over a dark stormy sky, a yellow warning strip, and five white advisory cards. Theme: navy, alert red and yellow.',
      mustKeep: ['headline', 'five', 'advisory cards', 'strip'],
    },
    {
      input:
        'A friendly headline on a soft orange panel with five rounded benefit cards and a smiling portrait at the lower right. Theme: warm orange and white.',
      mustKeep: ['headline', 'five', 'benefit cards', 'portrait'],
    },
    {
      input:
        'A calm clinical headline on a teal band with five stat callouts and a hospital photo zone on the right. The dominant colour theme is teal, white and blue.',
      mustKeep: ['headline', 'five', 'stat callouts', 'photo zone'],
    },
    {
      input:
        'The headline sits on a solid deep maroon panel across the top third. Below it are three numbered bullet rows with circular icons, a date field, and a call-to-action bar in saffron. A portrait photograph occupies the lower right quadrant. The dominant colour theme is maroon, cream and gold.',
      mustKeep: ['headline', 'three', 'bullet rows', 'date field', 'call-to-action', 'photograph'],
    },
    {
      input:
        'A quotation in large off-white quotation marks over a faded background wash, with the attribution in a dark band beneath and four supporting points as icon rows. Colour palette: earthy brown, cream and gold.',
      mustKeep: ['quotation', 'attribution', 'four', 'supporting points', 'icon rows'],
    },
    {
      input:
        'A vertical timeline of six dated milestones down the left, a bold side label rotated on the left edge, and an intro paragraph at the top. Theme: blue-grey and white with orange accents.',
      mustKeep: ['timeline', 'six', 'milestones', 'side label', 'intro'],
    },
    {
      input: 'Theme: saffron and cream.',
      mustKeep: [],
    },
  ];

  const failures: string[] = [];
  // Every colour term and modifier that must not survive anywhere in an output.
  const forbidden = new RegExp(`\\b(?:${TERMS})\\b`, 'i');

  for (const [i, c] of CASES.entries()) {
    const out = stripColourMentions(c.input);
    console.log(`\n[${i}] in : ${c.input}`);
    console.log(`     out: ${out || '(empty)'}`);

    const leak = forbidden.exec(out);
    if (leak) failures.push(`case ${i}: colour word "${leak[0]}" survived — ${out}`);

    for (const keep of c.mustKeep) {
      if (!out.toLowerCase().includes(keep.toLowerCase())) {
        failures.push(`case ${i}: lost structural text "${keep}" — ${out}`);
      }
    }
    if (c.mustKeep.length === 0 && out.length > 0) {
      failures.push(`case ${i}: expected an empty result, got — ${out}`);
    }
    // No stranded punctuation or doubled spaces.
    if (/\s[,.;]|,\s*\.|\s{2,}/.test(out)) {
      failures.push(`case ${i}: untidy output — ${JSON.stringify(out)}`);
    }
  }

  // Edge cases.
  if (stripColourMentions('') !== '') failures.push('empty input must return empty');
  if (stripColourMentions(null) !== '') failures.push('null input must return empty');
  if (stripColourMentions(undefined) !== '') failures.push('undefined input must return empty');

  if (failures.length > 0) {
    console.error(`\n${failures.length} FAILURE(S):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exitCode = 1;
  } else {
    console.log(`\nAll ${CASES.length} colour-strip cases passed.`);
  }
}
