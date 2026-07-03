import { z } from 'zod';

export const SCHEMAS_PACKAGE = '@dgipr/schemas';

export const ApiHealthResponseSchema = z.object({
  status: z.literal('ok'),
});

export type ApiHealthResponse = Readonly<{
  status: 'ok';
}>;

// Poster copy schemas (see copy.ts). api.ts imports from copy.ts directly so the
// two modules never form an import cycle through this index.
export * from './copy.js';

// Generation API request/response schemas (apps/api + apps/web).
export * from './api.js';
