// The pre-generation "व्यक्ती व पदनाम" check: given a note, which people does it name and what
// designation (पदनाम) should the article print before each name?
//
// Synchronous and ad-hoc, the /pointers and /proofread shape — nothing is stored here. The
// officer reviews the list, edits it, and the approved pairs travel with the generate request
// (and are persisted on that row, migration 0033). The route is thin: the merge lives in
// jobs/translation-terms.ts, shared with the pre-translation name check.

import type { FastifyInstance } from 'fastify';
import type { SupabaseClient } from '@dgipr/database';
import { PrepareDesignationsRequestSchema } from '@dgipr/schemas';
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
}
