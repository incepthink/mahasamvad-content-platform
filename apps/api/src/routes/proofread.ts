// Ad-hoc proofreading of pasted Marathi/English text (not tied to a generation).
// Synchronous like /translate: the engine runs at most two chat calls and the
// result is returned inline; nothing is stored. The route only assembles the
// glossary context — all checking logic lives in @dgipr/content-engine.

import type { FastifyInstance } from 'fastify';
import {
  createCostAccumulator,
  proofreadText,
  runInCostScope,
  runInCostTask,
  type ProofreadGlossaryTerm,
} from '@dgipr/content-engine';
import { recordTasksFromCost } from '../jobs/service-usage.js';
import {
  findGlossaryTermsInText,
  listGlossaryTerms,
  recordUsageEvent,
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

    // A cost scope so /analytics can report what मुद्रितशोधन spends. The route persists
    // nothing, so this is the only place those one-to-two chat calls can be attributed —
    // and it is why the feature's cost stops reading "not measured".
    const cost = createCostAccumulator();
    const result = await runInCostScope(cost, () =>
      runInCostTask('proofreading', () =>
        proofreadText(body.text, [...byMarathi.values()]),
      ),
    );
    recordTasksFromCost(client, 'proofread', cost);

    // This route stores nothing by design, so without an event the analytics page could only
    // report मुद्रितशोधन as "never used". Counts and a language code only — the text checked
    // is never recorded (0043). Fire-and-forget: it cannot fail the check.
    recordUsageEvent(client, {
      feature: 'proofread',
      action: 'check',
      charCount: body.text.length,
      count: result.issues.length,
      detail: { language: result.language },
    });

    return result;
  });
}
