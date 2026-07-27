// Ad-hoc extraction of "pointers" from an assembled note — one flat, ordered list of Marathi
// key points /dlo shows the officer as a reading summary of what their source says. It is
// display-only: it does not steer article generation, which works from the complete reviewed
// text. Synchronous like /proofread: the engine runs one chat call and the result is returned
// inline; nothing is stored. The route is a thin wrapper — all logic lives in
// @dgipr/content-engine (extract-pointers.ts).

import type { FastifyInstance } from 'fastify';
import { extractPointers } from '@dgipr/content-engine';
import { PointersRequestSchema } from '@dgipr/schemas';

export function registerPointerRoutes(app: FastifyInstance): void {
  app.post('/pointers', async (request) => {
    const body = PointersRequestSchema.parse(request.body);
    // Best-effort inside the engine: any failure returns { points: [] }, so the officer can
    // still generate — they simply do not get the summary. category ('news' | 'scheme')
    // steers the tone.
    return extractPointers(body.text, body.category, body.heading);
  });
}
