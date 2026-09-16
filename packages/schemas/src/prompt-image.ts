// Pictures the officer attaches to a create request so the IMAGE MODEL can see them
// (migration 0056).
//
// The note has always been the only thing a poster run is made of, which is fine for text
// and useless for the cases an officer actually has a picture for: "this building", "this
// person", "make it look like this". So the create form takes images beside the note, they
// are uploaded before the run is submitted, and the request names their storage PATHS.
//
// NAMED `promptImage`, DELIBERATELY. "Reference image" already means something else on this
// platform — a master template out of the `reference_images` library, pinned through
// `referenceImageId` — and these are not that: they are not a library, not rotated, not
// analysed, and they shape no layout. The name is borrowed from `video_projects.
// prompt_image_paths` (migration 0051), which is exactly this idea on the /video lane.
//
// A PATH RATHER THAN A URL, and the prefix is the reason. The create request points a paid
// render at an object, so what it names must be an object this API minted: the route checks
// every submitted path against PROMPT_IMAGE_PREFIX, exactly as the Dynamic Poster's source
// is checked against MOTION_SOURCE_PREFIX and /video's against `projects/{id}/references/`.
// A public URL is a string anyone can type.
//
// Deliberately NOT here: the size ceiling and the accepted extensions. Both come from
// dlo.ts (UPLOAD_FILE_MAX_BYTES, IMAGE_FILE_ACCEPT/isImageFileName) — the picker and the
// route already share one answer about what an image is and how large it may be, and a
// second answer beside it would only be a second thing to keep in step.

import { z } from 'zod';

// Where an attached picture lives in the PUBLIC posters bucket. Exported because it is a
// SECURITY boundary rather than a formatting detail — see the header.
export const PROMPT_IMAGE_PREFIX = 'generations/prompt-images/';

export function isPromptImagePath(path: string): boolean {
  return (
    path.startsWith(PROMPT_IMAGE_PREFIX) &&
    path.length > PROMPT_IMAGE_PREFIX.length &&
    // No traversal and no nesting: the route mints these names itself, so anything with a
    // second segment or a dot-segment in it did not come from us.
    !path.slice(PROMPT_IMAGE_PREFIX.length).includes('/') &&
    !path.includes('..')
  );
}

// Pictures per run. The same allowance /video gives one project (VIDEO_PROMPT_IMAGE_LIMIT),
// and for the same reason: each one reaches the model as base64 inside a request body, so
// the cap is about what a single call can carry rather than about what an officer might
// plausibly want to attach.
export const GENERATION_PROMPT_IMAGE_LIMIT = 4;

// What the upload route hands back. The PATH is what the create request carries; the URL is
// for the thumbnail on the form, and the name is the officer's own so the card can be
// labelled with the file they picked rather than with the token this API minted.
export const PromptImageUploadResponseSchema = z.object({
  name: z.string(),
  path: z.string(),
  url: z.string(),
});
export type PromptImageUpload = z.infer<typeof PromptImageUploadResponseSchema>;
