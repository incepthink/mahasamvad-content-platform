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

// DLO intake API schemas (file transcription/extraction → reviewed note).
export * from './dlo.js';

// PDF translation on /translate (page-wise OCR job; nothing stored).
export * from './translate-document.js';

// Ad-hoc proofread API schemas (issues + corrected text; nothing stored).
export * from './proofread.js';

// X post-length rules, shared by the API's publish guard and the web's caption counter.
export * from './tweet.js';

// AI explainer-video API schemas + shared tier pricing / SRT builder.
export * from './video.js';
