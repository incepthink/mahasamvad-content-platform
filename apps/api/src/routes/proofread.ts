// Ad-hoc proofreading of pasted Marathi/English text (not tied to a generation).
// Synchronous like /translate: the engine runs at most two chat calls and the
// result is returned inline; nothing is stored. The route only assembles the
// glossary context — all checking logic lives in @dgipr/content-engine.

import type { FastifyInstance } from 'fastify';
import {
  proofreadText,
  type ProofreadGlossaryTerm,
} from '@dgipr/content-engine';
import {
  findGlossaryTermsInText,
  listGlossaryTerms,
  type SupabaseClient,
} from '@dgipr/database';
import { ProofreadRequestSchema } from '@dgipr/schemas';

// How many verified rows feed the near-miss reference set. One language side of
// 300 terms is ~1.5k prompt tokens — enough coverage without bloating call 1.
const NEAR_MISS_GLOSSARY_CAP = 300;

export function registerProofreadRoutes(
  app: FastifyInstance,
  client: SupabaseClient,
): void {
  app.post('/proofread', async (request) => {
    const body = ProofreadRequestSchema.parse(request.body);

    // Two-source glossary: (a) every verified term literally present in the text —
    // scans all verified rows, so a correctly spelled known name is never reported
    // unverified; (b) the most recently updated verified terms as the near-miss
    // reference set. Merged, deduped by Marathi key.
    const [present, recent] = await Promise.all([
      findGlossaryTermsInText(client, body.text),
      listGlossaryTerms(client, {
        verifiedOnly: true,
        limit: NEAR_MISS_GLOSSARY_CAP,
      }),
    ]);
    const byMarathi = new Map<string, ProofreadGlossaryTerm>();
    for (const term of [...present, ...recent]) {
      if (!byMarathi.has(term.marathi)) {
        byMarathi.set(term.marathi, {
          marathi: term.marathi,
          english: term.english,
          termType: term.termType,
        });
      }
    }

    return proofreadText(body.text, [...byMarathi.values()]);
  });
}
