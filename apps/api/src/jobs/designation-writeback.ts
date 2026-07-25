// Persist the designations an officer chose to remember, so the next article about the same
// person starts pre-filled instead of blank. Called by both create paths (/dlo generate and
// the media room) just before the generation is inserted.
//
// Two writes per pair, and the SECOND is the one that makes translation work:
//
//   1. The PERSON's row gets `designation` (0032). setPersonDesignation patches in place and
//      only inserts when the dictionary has never met the person — it must never clobber a
//      human-reviewed English/Hindi spelling, because the officer confirmed the पदनाम here,
//      not the spelling.
//   2. The DESIGNATION itself is ensured to exist as its own `designation`-typed row. That row
//      is what puts "मुख्यमंत्री → Chief Minister" into the English LOCKED TERMS table, which is
//      why the English translation renders the title correctly with no translation-side code
//      at all. Skipping this step is what would silently break the English output.
//
// Best-effort throughout: a write-back failure must never cost the officer their generation,
// which is already fully specified by the pairs travelling on the request.

import {
  insertGlossaryCandidates,
  setPersonDesignation,
  type SupabaseClient,
} from '@dgipr/database';
import type { NameDesignation } from '@dgipr/schemas';

export async function rememberDesignations(
  client: SupabaseClient,
  pairs: readonly NameDesignation[],
): Promise<void> {
  // Only the pairs the officer explicitly ticked. An untickled pair still applies to THIS
  // article — it just does not become the dictionary's answer for every future one.
  const cleaned = pairs
    .filter((pair) => pair.remember === true)
    .map((pair) => ({
      name: pair.name.trim(),
      designation: pair.designation.trim(),
    }))
    .filter((pair) => pair.name.length > 0 && pair.designation.length > 0);
  if (cleaned.length === 0) return;

  // Step 2 first and in one batch: ignoreDuplicates means an existing (possibly
  // human-corrected) title row is never touched. `english` defaults to the Marathi form and
  // the row stays unverified, so a brand-new title surfaces on /glossary as a to-do rather
  // than silently locking a wrong English spelling into translations.
  const titles = [...new Set(cleaned.map((pair) => pair.designation))];
  try {
    await insertGlossaryCandidates(
      client,
      titles.map((marathi) => ({
        marathi,
        english: marathi,
        termType: 'designation' as const,
        verified: false,
        source: 'auto' as const,
      })),
    );
  } catch (error) {
    console.warn('[designations] could not save designation terms:', error);
  }

  for (const pair of cleaned) {
    try {
      await setPersonDesignation(
        client,
        pair.name,
        pair.designation,
        // The English fallback for a person the dictionary has never seen. The Marathi form
        // is deliberate: this row is written UNVERIFIED, and the pre-translation name check
        // is where an English spelling is actually confirmed.
        pair.name,
      );
    } catch (error) {
      console.warn(
        `[designations] could not remember "${pair.name}" → "${pair.designation}":`,
        error,
      );
    }
  }
}
