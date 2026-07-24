// Ad-hoc extraction of "pointers" from an assembled note — the 5W1H-grouped, AI-summarized
// fact bullets /dlo shows the officer so they can deselect what the article should leave out.
// Synchronous like /proofread: the engine runs one chat call and the result is returned
// inline; nothing is stored. The route is a thin wrapper — all logic lives in
// @dgipr/content-engine (extract-pointers.ts).

import type { FastifyInstance } from 'fastify';
import { extractPointers } from '@dgipr/content-engine';
import { PointersRequestSchema } from '@dgipr/schemas';

export function registerPointerRoutes(app: FastifyInstance): void {
  app.post('/pointers', async (request) => {
    const body = PointersRequestSchema.parse(request.body);
    // Best-effort inside the engine: any failure returns { groups: [] }, so the officer can
    // still generate with no exclusions. category ('news' | 'scheme') steers the tone.
    return extractPointers(body.text, body.category, body.heading);
  });
}
