// Standalone Marathi→English translation of ad-hoc pasted text (not tied to a
// generation). Two-step like the per-generation flow: /translate/prepare returns the
// text's proper nouns for the user to confirm/correct in place, then /translate
// receives the confirmed set, saves it as verified glossary rows, and locks it into
// the translation. Without `terms` (older client) the legacy path mines unverified
// candidates into the review queue after translating instead.

import type { FastifyInstance } from 'fastify';
import {
  extractGlossaryCandidates,
  translateArticleToEnglish,
} from '@dgipr/content-engine';
import {
  findGlossaryTermsInText,
  insertGlossaryCandidates,
  upsertGlossaryTerm,
  type SupabaseClient,
} from '@dgipr/database';
import {
  PrepareTranslateTextRequestSchema,
  TranslateTextRequestSchema,
} from '@dgipr/schemas';
import { prepareTranslationTerms } from '../jobs/translation-terms.js';

export function registerTranslateRoutes(
  app: FastifyInstance,
  client: SupabaseClient,
): void {
  app.post('/translate/prepare', async (request) => {
    const body = PrepareTranslateTextRequestSchema.parse(request.body);
    return prepareTranslationTerms(client, body.text);
  });

  app.post('/translate', async (request) => {
    const body = TranslateTextRequestSchema.parse(request.body);

    // Persist the user-confirmed names first (verified, overwrite by Marathi key) so
    // the glossary scan below locks the exact spellings the user just approved —
    // and future translations inherit them.
    if (body.terms) {
      for (const term of body.terms) {
        await upsertGlossaryTerm(client, {
          marathi: term.marathi,
          english: term.english,
          termType: term.termType ?? 'other',
          verified: true,
          source: 'manual',
        });
      }
    }

    const terms = await findGlossaryTermsInText(client, body.text);
    const glossary = terms.map((term) => ({
      marathi: term.marathi,
      english: term.english,
    }));

    const english = await translateArticleToEnglish(body.text, glossary);

    // Legacy path only: with no confirmed set, mine unverified candidates into the
    // review queue (best-effort). The prepare flow already extracted these, so
    // re-mining there would just double the spend.
    let minedTermCount = 0;
    if (!body.terms) {
      try {
        const candidates = await extractGlossaryCandidates(body.text);
        await insertGlossaryCandidates(
          client,
          candidates.map((candidate) => ({
            ...candidate,
            source: 'auto' as const,
            verified: false,
          })),
        );
        minedTermCount = candidates.length;
      } catch (error) {
        request.log.error(error, 'glossary candidate mining failed');
      }
    }

    return { english, lockedTermCount: glossary.length, minedTermCount };
  });
}
