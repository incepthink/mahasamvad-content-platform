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

import { extractGlossaryCandidates } from '@dgipr/content-engine';
import {
  findGlossaryTermsInText,
  listGlossaryTerms,
  type SupabaseClient,
  type TermType,
} from '@dgipr/database';
import type {
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

  // Unverified first — those are the rows that actually need the user's eyes.
  return [...byMarathi.values()].sort(
    (a, b) => Number(a.verified) - Number(b.verified),
  );
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
  const [merged, designationRows] = await Promise.all([
    mergeTextTerms(client, text),
    listGlossaryTerms(client, {
      type: 'designation',
      verifiedOnly: true,
      limit: 500,
    }),
  ]);

  const names = merged
    .filter((term) => term.termType === 'person')
    .map((term) => ({
      marathi: term.marathi,
      designation: term.designation,
      inGlossary: term.inGlossary,
      verified: term.verified,
    }));

  const knownDesignations = designationRows
    .map((row) => ({ marathi: row.marathi, english: row.english }))
    .sort((a, b) => a.marathi.localeCompare(b.marathi, 'mr'));

  return { names, knownDesignations };
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
