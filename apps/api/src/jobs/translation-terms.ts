// Builds the pre-flight name lists shown before a text is processed: the text's proper
// nouns (mined by the existing extractor) merged with any glossary rows whose Marathi form
// appears in it.
//
// TWO reviews are built from the SAME merge, because they ask the same question of the same
// text and only differ in which answer they want:
//   - the pre-TRANSLATION check ("is this name's English/Hindi spelling right?")
//   - the pre-GENERATION पदनाम check ("what designation should this person be named with?")
// Sharing the merge is what keeps them from drifting apart, and means the designation card
// inherits the extractor's existing person detection rather than adding a second one.

import { pathToFileURL } from 'node:url';
import { extractGlossaryCandidates } from '@dgipr/content-engine';
import {
  findGlossaryTermsInText,
  listGlossaryTerms,
  mapDesignationsToPersons,
  type SupabaseClient,
  type TermType,
} from '@dgipr/database';
import type {
  PreparedName,
  PrepareDesignationsResponse,
  PrepareTranslationResponse,
} from '@dgipr/schemas';

type PreparedTerm = PrepareTranslationResponse['terms'][number];

// One name found in the text, from the glossary and/or the extractor.
type MergedTerm = Readonly<{
  marathi: string;
  english: string;
  hindi: string;
  // The stored पदनाम for a person row; '' when unset or unknown.
  designation: string;
  termType: TermType;
  verified: boolean;
  // Whether the dictionary already knew this name (vs. the extractor just finding it).
  inGlossary: boolean;
}>;

// The shared merge. One OpenAI call (the extractor) plus one free glossary scan, run
// concurrently. Unverified glossary rows are included: the user is about to review them
// anyway, which doubles as the verification the /glossary page would do.
async function mergeTextTerms(
  client: SupabaseClient,
  text: string,
): Promise<MergedTerm[]> {
  const [candidates, glossaryRows] = await Promise.all([
    extractGlossaryCandidates(text),
    findGlossaryTermsInText(client, text, { verifiedOnly: false }),
  ]);

  // Merge by Marathi surface form; an existing glossary row wins over a freshly extracted
  // candidate (its English form may already be human-corrected, and only it can carry a
  // stored designation). `hindi` is pre-filled with the stored Hindi spelling, or the Marathi
  // form when none is set — the Marathi form is exactly what the Hindi lock produces today,
  // so the reviewer sees the real Hindi output and only edits where it should differ.
  const byMarathi = new Map<string, MergedTerm>();
  for (const row of glossaryRows) {
    byMarathi.set(row.marathi, {
      marathi: row.marathi,
      english: row.english,
      hindi: row.hindi ?? row.marathi,
      designation: row.designation ?? '',
      termType: row.termType,
      verified: row.verified,
      inGlossary: true,
    });
  }
  for (const candidate of candidates) {
    if (byMarathi.has(candidate.marathi)) continue;
    byMarathi.set(candidate.marathi, {
      marathi: candidate.marathi,
      english: candidate.english,
      hindi: candidate.marathi,
      designation: '',
      termType: candidate.termType,
      verified: false,
      inGlossary: false,
    });
  }

  // A one-word dictionary person can be the surname inside a different, longer person found by
  // the extractor. In the real STPI transcript, "हरी मुंडे" caused the verified "मुंडे" row for
  // an unrelated minister to appear as a second person and its title was later enforced. Keep
  // the short row only when it also occurs independently outside every longer person mention.
  const withoutNestedPeople = dropNestedPersonRows(text, [
    ...byMarathi.values(),
  ]);

  // Unverified first — those are the rows that actually need the user's eyes.
  return withoutNestedPeople.sort(
    (a, b) => Number(a.verified) - Number(b.verified),
  );
}

export function dropNestedPersonRows<
  T extends Readonly<{ marathi: string; termType: TermType }>,
>(text: string, terms: readonly T[]): T[] {
  const people = terms.filter((term) => term.termType === 'person');
  return terms.filter((term) => {
    if (term.termType !== 'person') return true;
    const name = term.marathi.trim();
    if (!name) return true;

    const containers = people
      .map((person) => person.marathi.trim())
      .filter(
        (candidate) =>
          candidate.length > name.length &&
          candidate.split(/\s+/u).includes(name) &&
          text.includes(candidate),
      );
    if (containers.length === 0) return true;

    const outsideLongerNames = containers.reduce(
      (remaining, candidate) => remaining.split(candidate).join(' '),
      text,
    );
    return mentionsWord(outsideLongerNames, name);
  });
}

export async function prepareTranslationTerms(
  client: SupabaseClient,
  text: string,
): Promise<PrepareTranslationResponse> {
  const merged = await mergeTextTerms(client, text);
  const terms: PreparedTerm[] = merged.map((term) => ({
    marathi: term.marathi,
    english: term.english,
    hindi: term.hindi,
    termType: term.termType,
    verified: term.verified,
  }));
  return { terms };
}

// Propose the office-holder when the text names an OFFICE but not the person.
//
// A DLO transcript routinely keeps the title and loses the name — a real run reached the article
// generator with "मुख्यमंत्री पोत" and no person at all, so the whole article came out in
// agentless passive ("निर्देश देण्यात आले") because there was nobody to attribute a directive to.
// Meanwhile the dictionary held, verified, that मुख्यमंत्री is देवेंद्र फडणवीस.
//
// Portfolio ministers have one additional, common surface form: the note may name the department
// rather than its minister ("उच्च व तंत्रशिक्षण विभागाकडे"). For a verified title ending in
// " मंत्री", that department phrase is treated as an alias of the title. This lets the prompt
// receive "चंद्रकांत पाटील → उच्च व तंत्रशिक्षण मंत्री" and write the accountable person rather
// than leaving "निर्देश देण्यात आले" agentless, while preserving the department as the proposal's
// institutional recipient.
//
// This is a LOOKUP, not an inference, and that distinction keeps the name grounded: the answer
// comes only from a verified person → designation row in the dictionary. The row is applied by
// default; the review card still shows it and lets an officer remove it when the source genuinely
// refers to the institution rather than the office-holder.
//
// Four rules, each guarding a way this could go wrong:
//   1. exactly ONE verified holder — Maharashtra has two उपमुख्यमंत्री, and guessing between
//      them would put the wrong person's name on a government article;
//   2. the LONGEST matching mention wins — "उपमुख्यमंत्री" contains "मुख्यमंत्री" as a substring,
//      and one portfolio department name may contain a shorter one;
//   3. never propose someone the text already names, or already suggested (dedupe);
//   4. `suggested: true`, so the card labels the dictionary-supplied name and keeps it reversible.
//
// Generic minister titles do not describe a portfolio department. "केंद्रीय मंत्री" must never
// manufacture "केंद्रीय विभाग", for example. Only a substantive portfolio prefix gets the alias.
const NON_PORTFOLIO_MINISTER_PREFIXES = new Set([
  'केंद्रीय',
  'कॅबिनेट',
  'राज्य',
  'प्रभारी',
]);

// Common code-mixed STT output for portfolio names. These aliases resolve only to the official
// portfolio title; the current holder still comes dynamically from the verified dictionary.
// Keeping the person out of this map means an office-holder change needs only a dictionary edit.
function normalizePortfolioMentions(text: string): string {
  return text.replace(
    /(?:हायर|हायअर)\s+(?:अँड|एंड|आणि|व)\s+टेक्निकल\s+एज्यु[\p{L}\p{M}]*/giu,
    'उच्च व तंत्रशिक्षण',
  );
}

export function designationMentionForms(designation: string): string[] {
  const title = designation.trim();
  if (!title) return [];

  const forms = [title];
  const match = /^(.+?)\s+मंत्री$/u.exec(title);
  const portfolio = match?.[1]?.trim() ?? '';
  if (
    portfolio &&
    !NON_PORTFOLIO_MINISTER_PREFIXES.has(portfolio) &&
    !portfolio.endsWith('राज्य')
  ) {
    forms.push(`${portfolio} विभाग`, portfolio);
  }
  return forms;
}

export function suggestOfficeHolders(
  text: string,
  existing: readonly { marathi: string }[],
  personsByDesignation: ReadonlyMap<string, readonly string[]>,
): PreparedName[] {
  const searchableText = normalizePortfolioMentions(text);
  // Longest surface form first — rule 2. This covers both title substrings and overlapping
  // department aliases. `title` remains the official designation emitted into the article;
  // `mention` is only the source phrase that caused the lookup.
  const mentions = [...personsByDesignation.keys()]
    .flatMap((title) =>
      designationMentionForms(title).map((mention) => ({ title, mention })),
    )
    .sort((a, b) => b.mention.length - a.mention.length);

  const taken = new Set(existing.map((name) => name.marathi.trim()));
  const suggestions: PreparedName[] = [];

  // Rule 2 is enforced by CONSUMING each matched span: once "उपमुख्यमंत्री" has matched, its
  // occurrences are masked out before the shorter "मुख्यमंत्री" is tested. Masking per occurrence
  // rather than suppressing the shorter title outright is what keeps a note that genuinely names
  // BOTH offices from silently losing the Chief Minister. `split`/`join` matches literally, so a
  // title containing regex metacharacters needs no escaping.
  let remaining = searchableText;

  for (const { title, mention } of mentions) {
    if (!remaining.includes(mention)) continue;
    remaining = remaining.split(mention).join(' ');

    const holders = personsByDesignation.get(title) ?? [];
    // Rule 1 — ambiguous or empty means propose nothing. Silence is the correct answer here;
    // the officer can still add the name by hand, which the card has always supported.
    if (holders.length !== 1) continue;

    const name = (holders[0] ?? '').trim();
    // Rule 3 — the extractor already found them, so their row exists with its own designation.
    if (!name || taken.has(name) || text.includes(name)) continue;
    taken.add(name);

    suggestions.push({
      marathi: name,
      designation: title,
      inGlossary: true,
      verified: true,
      suggested: true,
      // The title came from the dictionary's reverse lookup, not from a title standing beside
      // a name in the note — by definition, since the note does not name this person at all.
      fromText: false,
    });
  }

  return suggestions;
}

// Resolve a bare SURNAME against the dictionary's full-name person rows.
//
// The complaint this answers: a note says "फडणवीस यांनी" and the article published it bare,
// because `designation` is only ever read off a row whose Marathi form matches the text
// verbatim — and "फडणवीस" is not "देवेंद्र फडणवीस". The answer was in the dictionary the whole
// time, one row away, exactly as it was for suggestOfficeHolders. Same shape of fix: a LOOKUP
// against a verified row, presented as a suggestion the officer sees before anything is paid for.
//
// The pair produced names the SURNAME, not the full name — the note's own string. Substituting
// the dictionary's first name would be adding a name the source does not have, which is a
// different (and unasked-for) decision from adding an approved title.
//
// Rules, each guarding a way this goes wrong:
//   1. only a WHOLE-word surname mention counts, so "फडणवीसांनी" (inflected) and any longer word
//      ending in the surname are not matches;
//   2. a person whose FULL name is already in the text is skipped — their own row carries the
//      designation, and the deterministic pass extends it to their surname mentions from there;
//   3. when several dictionary people share the surname, the CONTEXT decides: exactly one of
//      them must have their stored title written somewhere in the text. Otherwise nothing is
//      proposed, because attributing a directive to the wrong official is the failure this
//      whole feature exists to prevent — and the officer can still type the title on the card.
const SURNAME_BOUNDARY = /[\p{L}\p{M}\p{N}]/u;

function mentionsWord(text: string, word: string): boolean {
  let from = 0;
  for (;;) {
    const at = text.indexOf(word, from);
    if (at < 0) return false;
    from = at + word.length;
    const before = text[at - 1];
    const after = text[at + word.length];
    if (
      (before === undefined || !SURNAME_BOUNDARY.test(before)) &&
      (after === undefined || !SURNAME_BOUNDARY.test(after))
    ) {
      return true;
    }
  }
}

export function resolveSurnameDesignations(
  text: string,
  personsByDesignation: ReadonlyMap<string, readonly string[]>,
): Map<string, string> {
  // Invert to full name → title, and group by surname.
  const bySurname = new Map<string, { name: string; designation: string }[]>();
  for (const [designation, holders] of personsByDesignation) {
    for (const holder of holders) {
      const name = holder.trim();
      const words = name.split(/\s+/).filter(Boolean);
      // A one-word dictionary row IS already matched verbatim by the normal merge.
      if (words.length < 2) continue;
      const surname = words[words.length - 1] ?? '';
      if (!surname) continue;
      const bucket = bySurname.get(surname);
      if (bucket) bucket.push({ name, designation });
      else bySurname.set(surname, [{ name, designation }]);
    }
  }

  const resolved = new Map<string, string>();
  for (const [surname, candidates] of bySurname) {
    // Rule 1.
    if (!mentionsWord(text, surname)) continue;
    // Rule 2 — the full name is present, so this is not the surname-only case.
    const usable = candidates.filter(
      (candidate) => !text.includes(candidate.name),
    );
    if (usable.length === 0) continue;

    if (usable.length === 1) {
      resolved.set(surname, usable[0]?.designation ?? '');
      continue;
    }

    // Rule 3 — context. The note that says "महसूल मंत्री" and then "बावनकुळे" has told us which
    // बावनकुळे it means; a note that says neither has not.
    const byTitle = usable.filter((candidate) =>
      text.includes(candidate.designation),
    );
    if (byTitle.length === 1) {
      resolved.set(surname, byTitle[0]?.designation ?? '');
    }
  }

  return resolved;
}

// Honorifics that legitimately stand BETWEEN a title and a name ("मुख्यमंत्री श्री. देवेंद्र
// फडणवीस"). Skipped when looking backwards, so an honorific does not hide the title behind it.
// Longest first, since 'श्री.' contains 'श्री'.
const HONORIFICS = [
  'श्रीमती',
  'अॅड.',
  'ॲड.',
  'श्री.',
  'श्री',
  'डॉ.',
  'प्रा.',
  'ना.',
  'मा.',
  'कु.',
];

// Characters that may sit immediately before a title. Anything else — in practice a Devanagari
// letter — means the "title" is only the tail of a longer word, which is the उपमुख्यमंत्री /
// मुख्यमंत्री trap: without this check a note naming only the Deputy Chief Minister would have
// "मुख्यमंत्री" attached to the name beside it.
const TITLE_BOUNDARY = /[\s,.;:।(){}[\]"'“”‘’«»\-–—/|]/;

function stripHonorificsAtEnd(before: string): string {
  let out = before.replace(/[\s,–—-]+$/u, '');
  let changed = true;
  while (changed) {
    changed = false;
    for (const honorific of HONORIFICS) {
      if (out.endsWith(honorific)) {
        out = out.slice(0, -honorific.length).replace(/[\s,–—-]+$/u, '');
        changed = true;
        break;
      }
    }
  }
  return out;
}

// Read each person's designation OFF THE NOTE, when the note writes it immediately before the
// name: "उपमुख्यमंत्री एकनाथ शिंदे", "केंद्रीय मंत्री नितीन गडकरी".
//
// This is the gap the card had. `designation` used to come ONLY from the person's stored
// glossary row, so a note that spells the title out in full still showed an EMPTY field — and
// the officer had to retype what their own text already said. The titles were even detected
// (they arrive as `designation`-typed terms in the same merge); nothing linked one to the name
// standing next to it.
//
// It does not weaken the never-invent rule. Nothing is guessed from context or from outside
// knowledge: the exact title string is taken verbatim from the officer's own text, only where
// it directly precedes the name, and only to fill a field that would otherwise be blank. The
// officer still reviews and can clear it before anything is generated.
//
// Deliberately FIRST occurrence: a person is introduced with their title and referred to bare
// afterwards, so the first mention is where the title lives.
export function designationsFromText(
  text: string,
  names: readonly string[],
  titles: readonly string[],
): Map<string, string> {
  // Longest title first, so "केंद्रीय मंत्री" wins over a bare "मंत्री" the dictionary may also
  // hold, and "उपमुख्यमंत्री" over "मुख्यमंत्री".
  const ordered = [
    ...new Set(titles.map((t) => t.trim()).filter(Boolean)),
  ].sort((a, b) => b.length - a.length);
  const found = new Map<string, string>();
  if (ordered.length === 0) return found;

  for (const name of names) {
    if (!name) continue;
    let from = 0;
    // Walk every occurrence: the first mention may be the bare surname elsewhere in the note,
    // and the titled one may come later.
    for (;;) {
      const at = text.indexOf(name, from);
      if (at < 0) break;
      from = at + name.length;

      const before = stripHonorificsAtEnd(text.slice(0, at));
      const title = ordered.find((candidate) => {
        if (!before.endsWith(candidate)) return false;
        const prev = before[before.length - candidate.length - 1];
        return prev === undefined || TITLE_BOUNDARY.test(prev);
      });
      if (title) {
        found.set(name, title);
        break;
      }
    }
  }

  return found;
}

// The pre-generation "व्यक्ती व पदनाम" card: every PERSON the note names, with the designation
// the article will print before their name. A blank designation is the normal state for a
// person the dictionary has not met — the card shows an empty field and the officer fills it
// in, because a designation is NEVER inferred from the note (the invention rule is absolute).
//
// `knownDesignations` is the autocomplete list: 0010 seeds 19 verified titles, so the common
// case is picking rather than typing, and picking is what keeps "मुख्यमंत्री" spelled one way
// across every officer and every article.
export async function prepareDesignations(
  client: SupabaseClient,
  text: string,
): Promise<PrepareDesignationsResponse> {
  const [merged, designationRows, personsByDesignation] = await Promise.all([
    mergeTextTerms(client, text),
    listGlossaryTerms(client, {
      type: 'designation',
      verifiedOnly: true,
      limit: 500,
    }),
    // Best-effort: on a database without 0032 the column is absent and every person maps to
    // nothing, which simply means no suggestions. It must never cost the card itself.
    mapDesignationsToPersons(client).catch((error: unknown) => {
      console.warn(
        '[designations] reverse lookup unavailable (is 0032 applied?):',
        error,
      );
      return new Map<string, string[]>();
    }),
  ]);

  const persons = merged.filter((term) => term.termType === 'person');

  const knownDesignations = designationRows
    .map((row) => ({ marathi: row.marathi, english: row.english }))
    .sort((a, b) => a.marathi.localeCompare(b.marathi, 'mr'));

  // Exact designation strings found in THIS text, including a newly encountered title
  // that is not in the verified autocomplete list yet. The post-generation read-only
  // display uses these only when the title occurs directly beside an extracted person.
  const mentionedDesignations = merged
    .filter((term) => term.termType === 'designation')
    .map((term) => term.marathi);

  // Titles to look for beside a name: the ones this very note uses, plus the dictionary's
  // verified list (which catches a title the extractor happened not to type as `designation`).
  const besideName = designationsFromText(
    text,
    persons.map((term) => term.marathi),
    [...mentionedDesignations, ...knownDesignations.map((row) => row.marathi)],
  );

  // "फडणवीस" → the देवेंद्र फडणवीस row's title. Best-effort like the reverse lookup it sits
  // beside: an empty map simply means no surname was resolvable.
  const bySurname = resolveSurnameDesignations(text, personsByDesignation);

  const names = persons.map((term) => {
    // The dictionary wins where it has an answer — it is the reviewed, cross-article spelling.
    // Its surname resolution comes next (the row exists, only under the full name), and the note
    // itself only ever fills a field the dictionary left blank.
    const fromSurname = term.designation
      ? ''
      : (bySurname.get(term.marathi) ?? '');
    const fromText =
      term.designation || fromSurname
        ? ''
        : (besideName.get(term.marathi) ?? '');
    return {
      marathi: term.marathi,
      designation: term.designation || fromSurname || fromText,
      inGlossary: term.inGlossary,
      verified: term.verified,
      // A surname resolved through a full-name row is a dictionary SUGGESTION, so the card
      // labels it and the officer can untick it — the same treatment as the reverse lookup.
      suggested: fromSurname.length > 0,
      fromText: fromText.length > 0,
    };
  });

  // A surname the extractor did not report as a person at all still gets proposed: the
  // dictionary knows the name, and the alternative is losing the title silently.
  for (const [surname, designation] of bySurname) {
    if (names.some((name) => name.marathi === surname)) continue;
    names.push({
      marathi: surname,
      designation,
      inGlossary: true,
      verified: true,
      suggested: true,
      fromText: false,
    });
  }

  names.push(...suggestOfficeHolders(text, names, personsByDesignation));

  return { names, knownDesignations, mentionedDesignations };
}

// Every verified designation's Marathi form. The article pipeline uses this ONLY to recognise
// a wrong title the model may have written in front of an approved name, so it can be replaced
// rather than duplicated ("उपमुख्यमंत्री देवेंद्र फडणवीस" → "मुख्यमंत्री देवेंद्र फडणवीस").
export async function listKnownDesignations(
  client: SupabaseClient,
): Promise<string[]> {
  const rows = await listGlossaryTerms(client, {
    type: 'designation',
    verifiedOnly: true,
    limit: 500,
  });
  return rows.map((row) => row.marathi);
}

// ---------------------------------------------------------------------------
// Free harness: `tsx src/jobs/translation-terms.ts`
// No key, no database, no network. Covers suggestOfficeHolders, whose substring and ambiguity
// rules are the only place in this change where a wrong answer would put the wrong person's
// name on a government article.
// ---------------------------------------------------------------------------

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  let failures = 0;
  const check = (label: string, condition: boolean): void => {
    if (!condition) {
      failures += 1;
      console.error(`  FAIL  ${label}`);
    } else {
      console.log(`  ok    ${label}`);
    }
  };

  const dictionary = new Map<string, string[]>([
    ['मुख्यमंत्री', ['देवेंद्र फडणवीस']],
    ['उपमुख्यमंत्री', ['एकनाथ शिंदे', 'अजित पवार']],
    ['जिल्हाधिकारी', ['सुहास दिवसे']],
    ['उच्च व तंत्रशिक्षण मंत्री', ['चंद्रकांत पाटील']],
  ]);

  console.log('\n=== the real failing case: a title with no name ===');
  const realNote =
    'त्या वेळेला आपल्याला असा एक मुख्यमंत्री पोत आणि एस सी एम टी आर रिंग रोड ' +
    'यावर बैठक घेण्यात आली. निर्देश देण्यात आलेले आहे.';
  const proposed = suggestOfficeHolders(realNote, [], dictionary);
  check('exactly one suggestion', proposed.length === 1);
  check(
    'it is the verified office-holder',
    proposed[0]?.marathi === 'देवेंद्र फडणवीस',
  );
  check(
    'carrying the matched title',
    proposed[0]?.designation === 'मुख्यमंत्री',
  );
  check('flagged as suggested', proposed[0]?.suggested === true);
  check(
    'marked verified + inGlossary (it came from a verified row)',
    proposed[0]?.verified === true && proposed[0]?.inGlossary === true,
  );

  console.log(
    '\n=== a portfolio department resolves to its verified minister ===',
  );
  const departmentMention = suggestOfficeHolders(
    'प्रस्ताव उच्च व तंत्रशिक्षण विभागाकडे सादर करावा.',
    [],
    dictionary,
  );
  check('department mention yields one holder', departmentMention.length === 1);
  check(
    'department mention yields the verified full name',
    departmentMention[0]?.marathi === 'चंद्रकांत पाटील',
  );
  check(
    'the emitted designation stays the minister title, not the department alias',
    departmentMention[0]?.designation === 'उच्च व तंत्रशिक्षण मंत्री',
  );
  check(
    'portfolio aliases include the department form',
    designationMentionForms('उच्च व तंत्रशिक्षण मंत्री').includes(
      'उच्च व तंत्रशिक्षण विभाग',
    ),
  );
  const codeMixedDepartmentMention = suggestOfficeHolders(
    'युनिव्हर्सिटी करत आहे म्हणून हायर अँड टेक्निकल एज्युक्लेशन कडे प्रस्ताव पाठवा.',
    [],
    dictionary,
  );
  check(
    'code-mixed STT portfolio resolves through the verified dictionary row',
    codeMixedDepartmentMention.length === 1 &&
      codeMixedDepartmentMention[0]?.marathi === 'चंद्रकांत पाटील' &&
      codeMixedDepartmentMention[0]?.designation ===
        'उच्च व तंत्रशिक्षण मंत्री',
  );
  check(
    'generic minister titles do not manufacture departments',
    designationMentionForms('केंद्रीय मंत्री').length === 1 &&
      designationMentionForms('राज्य मंत्री').length === 1,
  );

  console.log(
    '\n=== a surname inside a different full name is not a second person ===',
  );
  const nestedPeople = dropNestedPersonRows(
    'जी मंत्री महोदय, मी डॉक्टर हरी मुंडे, मला काही बोलायचे आहे.',
    [
      { marathi: 'हरी मुंडे', termType: 'person' as const },
      { marathi: 'मुंडे', termType: 'person' as const },
      { marathi: 'अमरावती', termType: 'place' as const },
    ],
  );
  check(
    'the unrelated one-word dictionary row is removed',
    nestedPeople.some((term) => term.marathi === 'हरी मुंडे') &&
      !nestedPeople.some((term) => term.marathi === 'मुंडे'),
  );
  const independentSurname = dropNestedPersonRows(
    'हरी मुंडे बोलले. त्यानंतर मंत्री मुंडे यांनी आढावा घेतला.',
    [
      { marathi: 'हरी मुंडे', termType: 'person' as const },
      { marathi: 'मुंडे', termType: 'person' as const },
    ],
  );
  check(
    'an independent short-name occurrence is retained for officer review',
    independentSurname.some((term) => term.marathi === 'मुंडे'),
  );

  console.log('\n=== ambiguity proposes NOTHING ===');
  check(
    'a title held by two people is skipped',
    suggestOfficeHolders('उपमुख्यमंत्री यांनी आढावा घेतला.', [], dictionary)
      .length === 0,
  );
  check(
    'a title held by nobody is skipped',
    suggestOfficeHolders('राज्यपाल यांनी सांगितले.', [], dictionary).length ===
      0,
  );

  console.log('\n=== the substring trap ===');
  check(
    'उपमुख्यमंत्री does NOT also propose the मुख्यमंत्री',
    suggestOfficeHolders(
      'उपमुख्यमंत्री यांच्या अध्यक्षतेखाली बैठक झाली.',
      [],
      dictionary,
    ).length === 0,
  );
  check(
    'both titles present still proposes only the unambiguous one',
    (() => {
      const both = suggestOfficeHolders(
        'मुख्यमंत्री व उपमुख्यमंत्री उपस्थित होते.',
        [],
        dictionary,
      );
      return both.length === 1 && both[0]?.marathi === 'देवेंद्र फडणवीस';
    })(),
  );

  console.log('\n=== never duplicate someone already on the card ===');
  check(
    'a person the extractor already found is not re-proposed',
    suggestOfficeHolders(
      'मुख्यमंत्री देवेंद्र फडणवीस यांनी निर्देश दिले.',
      [{ marathi: 'देवेंद्र फडणवीस' }],
      dictionary,
    ).length === 0,
  );
  check(
    'a name present in the text is not proposed even if the card missed it',
    suggestOfficeHolders(
      'मुख्यमंत्री देवेंद्र फडणवीस यांनी निर्देश दिले.',
      [],
      dictionary,
    ).length === 0,
  );

  console.log('\n=== degrades quietly ===');
  check(
    'an empty dictionary proposes nothing',
    suggestOfficeHolders(realNote, [], new Map()).length === 0,
  );
  check(
    'a text naming no office proposes nothing',
    suggestOfficeHolders('रिंग रोडचे भूसंपादन सुरू आहे.', [], dictionary)
      .length === 0,
  );
  check(
    'empty text proposes nothing',
    suggestOfficeHolders('', [], dictionary).length === 0,
  );

  console.log('\n=== several distinct offices ===');
  check(
    'two unambiguous titles yield two suggestions',
    (() => {
      const many = suggestOfficeHolders(
        'मुख्यमंत्री यांनी जिल्हाधिकारी यांना निर्देश दिले.',
        [],
        dictionary,
      );
      return (
        many.length === 2 &&
        many.some((n) => n.marathi === 'देवेंद्र फडणवीस') &&
        many.some((n) => n.marathi === 'सुहास दिवसे')
      );
    })(),
  );

  console.log('\n=== a bare SURNAME resolved through the dictionary ===');
  {
    const surnames = new Map<string, string[]>([
      ['मुख्यमंत्री', ['देवेंद्र फडणवीस']],
      ['महसूल मंत्री', ['चंद्रशेखर बावनकुळे']],
      ['जिल्हाधिकारी', ['सुहास दिवसे']],
    ]);
    check(
      'फडणवीस → the देवेंद्र फडणवीस row’s title',
      resolveSurnameDesignations(
        'असल्याचे सांगत फडणवीस यांनी उपक्रमाला मान्यता दिली.',
        surnames,
      ).get('फडणवीस') === 'मुख्यमंत्री',
    );
    check(
      'बावनकुळे → महसूल मंत्री',
      resolveSurnameDesignations('बावनकुळे यांनी आढावा घेतला.', surnames).get(
        'बावनकुळे',
      ) === 'महसूल मंत्री',
    );
    check(
      'the FULL name in the text is left to its own row',
      resolveSurnameDesignations(
        'देवेंद्र फडणवीस यांनी सांगितले. नंतर फडणवीस यांनी पाहणी केली.',
        surnames,
      ).size === 0,
    );
    check(
      'an inflected form is not a mention',
      resolveSurnameDesignations('फडणवीसांनी सांगितले.', surnames).size === 0,
    );
    check(
      'a surname the dictionary does not hold yields nothing',
      resolveSurnameDesignations('शिंदे यांनी सांगितले.', surnames).size === 0,
    );
    check(
      'an empty dictionary yields nothing',
      resolveSurnameDesignations('फडणवीस यांनी सांगितले.', new Map()).size ===
        0,
    );
  }

  console.log(
    '\n=== a shared surname is decided by CONTEXT, or not at all ===',
  );
  {
    const twoPawars = new Map<string, string[]>([
      ['उपमुख्यमंत्री', ['अजित पवार']],
      ['जिल्हाधिकारी', ['सुप्रिया पवार']],
    ]);
    check(
      'no context ⇒ nothing proposed',
      resolveSurnameDesignations('पवार यांनी बैठक घेतली.', twoPawars).size ===
        0,
    );
    check(
      'the title written in the note picks the right पवार',
      resolveSurnameDesignations(
        'उपमुख्यमंत्री यांच्या अध्यक्षतेखाली बैठक झाली. पवार यांनी निर्देश दिले.',
        twoPawars,
      ).get('पवार') === 'उपमुख्यमंत्री',
    );
    check(
      'BOTH titles present ⇒ still nothing, the surname is genuinely ambiguous',
      resolveSurnameDesignations(
        'उपमुख्यमंत्री व जिल्हाधिकारी उपस्थित होते. पवार यांनी सांगितले.',
        twoPawars,
      ).size === 0,
    );
  }

  console.log('\n=== the designation the NOTE writes beside the name ===');
  const titles = [
    'उपमुख्यमंत्री',
    'केंद्रीय मंत्री',
    'महसूल मंत्री',
    'मुख्यमंत्री',
    'मंत्री',
    'जिल्हाधिकारी',
  ];
  const realCase =
    'बैठकीस उपमुख्यमंत्री एकनाथ शिंदे उपस्थित होते. केंद्रीय मंत्री नितीन गडकरी ' +
    'यांनी सांगितले की, महसूल मंत्री चंद्रशेखर बावनकुळे यांनी आढावा घेतला.';
  const beside = designationsFromText(
    realCase,
    ['एकनाथ शिंदे', 'नितीन गडकरी', 'चंद्रशेखर बावनकुळे'],
    titles,
  );
  check(
    'उपमुख्यमंत्री एकनाथ शिंदे',
    beside.get('एकनाथ शिंदे') === 'उपमुख्यमंत्री',
  );
  check(
    'केंद्रीय मंत्री नितीन गडकरी — the LONGER title wins over "मंत्री"',
    beside.get('नितीन गडकरी') === 'केंद्रीय मंत्री',
  );
  check(
    'महसूल मंत्री चंद्रशेखर बावनकुळे',
    beside.get('चंद्रशेखर बावनकुळे') === 'महसूल मंत्री',
  );

  check(
    'the उपमुख्यमंत्री/मुख्यमंत्री substring trap: no मुख्यमंत्री is attached',
    designationsFromText(
      'उपमुख्यमंत्री अजित पवार यांनी',
      ['अजित पवार'],
      ['मुख्यमंत्री'],
    ).size === 0,
  );
  check(
    'an honorific between title and name is skipped',
    designationsFromText(
      'मुख्यमंत्री श्री. देवेंद्र फडणवीस यांनी निर्देश दिले.',
      ['देवेंद्र फडणवीस'],
      ['मुख्यमंत्री'],
    ).get('देवेंद्र फडणवीस') === 'मुख्यमंत्री',
  );
  check(
    'a title elsewhere in the sentence is NOT attached',
    designationsFromText(
      'मुख्यमंत्री यांच्या अध्यक्षतेखाली झालेल्या बैठकीत सुनीता पवार यांनी माहिती दिली.',
      ['सुनीता पवार'],
      ['मुख्यमंत्री'],
    ).size === 0,
  );
  check(
    'a later titled mention is found when the first is bare',
    designationsFromText(
      'गडकरी यांनी भेट दिली. नंतर केंद्रीय मंत्री गडकरी यांनी सांगितले.',
      ['गडकरी'],
      ['केंद्रीय मंत्री'],
    ).get('गडकरी') === 'केंद्रीय मंत्री',
  );
  check(
    'no titles at all yields nothing',
    designationsFromText(realCase, ['एकनाथ शिंदे'], []).size === 0,
  );
  check(
    'a name the text never uses yields nothing',
    designationsFromText(realCase, ['सुहास दिवसे'], titles).size === 0,
  );

  if (failures > 0) {
    console.error(`\n${failures} check(s) failed.`);
    process.exitCode = 1;
  } else {
    console.log('\nAll checks passed.');
  }
}
