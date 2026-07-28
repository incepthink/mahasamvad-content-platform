// The pre-generation "व्यक्ती व पदनाम" check: given a note, which people does it name and what
// designation (पदनाम) should the article print before each name?
//
// Synchronous and ad-hoc, the /pointers and /proofread shape — nothing is stored here. The
// officer reviews the list, edits it, and the approved pairs travel with the generate request
// (and are persisted on that row, migration 0033). The route is thin: the merge lives in
// jobs/translation-terms.ts, shared with the pre-translation name check.

import type { FastifyInstance } from 'fastify';
import { markPersonVerified, type SupabaseClient } from '@dgipr/database';
import {
  PrepareDesignationsRequestSchema,
  VerifyNameRequestSchema,
} from '@dgipr/schemas';
import { prepareDesignations } from '../jobs/translation-terms.js';

export function registerDesignationRoutes(
  app: FastifyInstance,
  client: SupabaseClient,
): void {
  app.post('/designations/prepare', async (request) => {
    const body = PrepareDesignationsRequestSchema.parse(request.body);
    // A note naming nobody returns { names: [] }, and the web submits straight through —
    // the check is invisible when there is nothing to check.
    return prepareDesignations(client, body.text);
  });

  // "तपासले म्हणून खूण करा" — confirm a name's नाव-शब्दकोश row from the review card, instead of
  // sending the officer to /glossary in the middle of preparing an article. Synchronous and
  // immediate (not deferred to generate time) because the badge must flip while they are
  // looking at the name, and because the assertion is about the DICTIONARY, not about this run:
  // it is worth keeping even if the officer then abandons the generation.
  app.post('/designations/verify', async (request) => {
    const body = VerifyNameRequestSchema.parse(request.body);
    // The Marathi form is the English fallback for a person the dictionary has never met — the
    // pre-translation name check is where an English spelling is actually confirmed.
    await markPersonVerified(client, body.name, body.name);
    return { name: body.name, verified: true as const };
  });
}
