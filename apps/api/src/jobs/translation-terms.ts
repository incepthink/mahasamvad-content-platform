// Builds the "check the names" list shown before a translation starts: the text's
// proper nouns (mined by the existing extractor) merged with any glossary rows whose
// Marathi form appears in the text. The user corrects/confirms the English spellings in
// place; the confirmed set is then saved verified and locked into the translation — so a
// name is never mistranslated first and fixed after. Shared by the per-generation
// prepare route and the standalone /translate prepare route.

import { extractGlossaryCandidates } from '@dgipr/content-engine';
import { findGlossaryTermsInText, type SupabaseClient } from '@dgipr/database';
import type { PrepareTranslationResponse } from '@dgipr/schemas';

type PreparedTerm = PrepareTranslationResponse['terms'][number];

export async function prepareTranslationTerms(
  client: SupabaseClient,
  text: string,
): Promise<PrepareTranslationResponse> {
  // Extraction (one OpenAI call) and the glossary scan are independent; run both at
  // once. Unverified glossary rows are included too — the user is about to review
  // them anyway, which doubles as the verification the /glossary page would do.
  const [candidates, glossaryRows] = await Promise.all([
    extractGlossaryCandidates(text),
    findGlossaryTermsInText(client, text, { verifiedOnly: false }),
  ]);

  // Merge by Marathi surface form; an existing glossary row wins over a freshly
  // extracted candidate (its English form may already be human-corrected).
  const byMarathi = new Map<string, PreparedTerm>();
  for (const row of glossaryRows) {
    byMarathi.set(row.marathi, {
      marathi: row.marathi,
      english: row.english,
      termType: row.termType,
      verified: row.verified,
    });
  }
  for (const candidate of candidates) {
    if (byMarathi.has(candidate.marathi)) continue;
    byMarathi.set(candidate.marathi, {
      marathi: candidate.marathi,
      english: candidate.english,
      termType: candidate.termType,
      verified: false,
    });
  }

  // Unverified first — those are the rows that actually need the user's eyes.
  const terms = [...byMarathi.values()].sort(
    (a, b) => Number(a.verified) - Number(b.verified),
  );
  return { terms };
}
