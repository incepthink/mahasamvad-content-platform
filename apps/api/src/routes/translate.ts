import type { FastifyInstance } from 'fastify';
import {
  extractGlossaryCandidates,
  translateArticleToEnglish,
} from '@dgipr/content-engine';
import {
  findGlossaryTermsInText,
  insertGlossaryCandidates,
  type SupabaseClient,
} from '@dgipr/database';
import { TranslateTextRequestSchema } from '@dgipr/schemas';

export function registerTranslateRoutes(
  app: FastifyInstance,
  client: SupabaseClient,
): void {
  app.post('/translate', async (request) => {
    const body = TranslateTextRequestSchema.parse(request.body);

    const terms = await findGlossaryTermsInText(client, body.text);
    const glossary = terms.map((term) => ({
      marathi: term.marathi,
      english: term.english,
    }));

    const english = await translateArticleToEnglish(body.text, glossary);

    let minedTermCount = 0;
    if (body.mineTerms) {
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
