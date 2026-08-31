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

// Person → designation (पदनाम): the official title printed before a person's name, reviewed
// before generating and applied to the Marathi article (both translations inherit it).
// Exported BEFORE api.js and dlo.js, which import from it, so each name has exactly one
// definition in this barrel (the copy.js/document.js precedent).
export * from './designations.js';

// Generation API request/response schemas (apps/api + apps/web).
export * from './api.js';

// YouTube links as an intake source (recognising/canonicalising a link + the oEmbed probe
// shapes). Exported BEFORE dlo.js and transcription.js, both of which carry these sources on
// their create requests, so each name has exactly one definition in this barrel.
export * from './youtube.js';

// DLO intake API schemas (file transcription/extraction → reviewed note).
export * from './dlo.js';

// The new /dlo lane (/new-dlo): documents go to the article model as files, so its
// requests carry no assembled text. Exported AFTER dlo.js, whose category and designation
// shapes it reuses rather than redeclaring.
export * from './new-dlo.js';

// Standalone transcription API schemas (/transcribe: recordings → Marathi text). Exported
// after dlo.js, whose AUDIO_FILE_* container rules it deliberately reuses rather than
// redefining.
export * from './transcription.js';

// "Pointers": the 5W1H fact-selection layer on /dlo (imports DloCategorySchema, so it is
// exported AFTER dlo.js to keep each name defined once in this barrel).
export * from './pointers.js';

// Uploaded documents (pdf/docx/txt) becoming pages of text — shared by /translate, /dlo,
// the media room and /proofread. Exported BEFORE translate-document.js, which imports
// from it, so each name has exactly one definition in this barrel.
export * from './document.js';

// PDF translation on /translate (page-wise OCR job; nothing stored).
export * from './translate-document.js';

// Ad-hoc proofread API schemas (issues + corrected text; nothing stored).
export * from './proofread.js';

// X post-length rules, shared by the API's publish guard and the web's caption counter.
export * from './tweet.js';

// AI explainer-video API schemas + shared tier pricing / SRT builder.
export * from './video.js';

// The general assistant at /chat: thread/message shapes, the attachment union and the SSE
// event framing. Exported after document.js and youtube.js, whose upload and link rules its
// attachments reuse rather than redefine.
export * from './chat.js';

// Department usage analytics (/analytics): the response shape, the reporting timezone and
// the single USD→INR presentation rate. Carries machine keys only — every Marathi label on
// that page lives in apps/web/lib/strings.ts.
export * from './analytics.js';
