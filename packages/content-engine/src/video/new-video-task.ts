// Which task /new-video-workflow declares for one turn — the request-field half of what
// new-video-scaffold.ts says in prose.
//
// Omni takes an explicit `generation_config.video_config.task`. Step 2 of the Gemini-app plan
// declared one on EVERY first turn: `text_to_video` with no picture, `reference_to_video` with
// any. The second half was wrong for the commonest request an officer makes with a picture.
// Generation 83a2602b attached a finished artwork and asked "make a video from this image, keep
// cinematic"; the forced reference task (and the scaffold's matching "should not be used as
// literal initial frames") told Gemini the picture was only a reference, so it rendered a new
// realistic scene and never animated the artwork at all.
//
// SO THE DEFAULT IS NOW TO SAY NOTHING ABOUT AN OFFICER'S PICTURE. With `imageRole: 'auto'`
// the field is left out and Gemini reads the role off the officer's own words — which is what
// the Gemini app does, and needs no classification call of ours. The officer can still state
// the role explicitly (`animate` / `reference`), and then this field and the scaffold's prose
// say the same thing, because both are derived from the same facts about the turn.
//
// Two cases stay declared by default because they are unambiguous:
//   - no picture at all     -> `text_to_video`;
//   - only CAST PORTRAITS   -> `reference_to_video`. A registry portrait is a person to keep,
//                              never artwork to animate, whatever the officer typed.
//
// WHY A FOLLOW-UP DECLARES NOTHING. Testing writeups report that combining a task with
// `previous_interaction_id` BREAKS EDIT CHAINS, so the field belongs to first turns only.
// `edit` and `extend` exist in the enum and are deliberately never returned here, and the
// client enforces the same rule a second time. That is also why `animate` always starts a NEW
// clip (the job and the route see to it): a first frame only exists at the start of one.
//
// WHY IT IS SENT IN BOTH PROMPT MODES. `verbatim` is the comparison stance, and its rule is
// about the officer's PROMPT reaching Gemini untouched — a request field adds not one
// character to it (the aspect-ratio precedent in gemini-interactions-client.ts).

import { pathToFileURL } from 'node:url';

import type { NewVideoImageRole } from '@dgipr/schemas';

import type { InteractionVideoTask } from './gemini-interactions-client.js';

export type NewVideoTaskInput = Readonly<{
  // How many images THIS turn attaches, cast portraits included — the same count the
  // scaffold's tags are built from, so the declaration and the task describe one request.
  imageCount: number;
  // How many of those are cast portraits. They are sent FIRST and are always references.
  // Omitted means none, so a caller with no cast is unchanged.
  portraitCount?: number | undefined;
  // What the officer said their own picture is for. Omitted means `auto` — say nothing.
  imageRole?: NewVideoImageRole | undefined;
  // Whether the turn continues an earlier interaction, read off the CHAIN POINT rather than
  // the turn's position: a turn whose predecessor failed starts a fresh chain and is a first
  // turn in every sense that matters here.
  isEdit: boolean;
}>;

/**
 * The task to declare for one turn, or null to leave it for Gemini to infer.
 *
 * Pure, and decided without reading the prompt — like the scaffold, and for the same reason:
 * nothing about a paid render should depend on a pattern match over the officer's Marathi.
 */
export function newVideoTaskFor({
  imageCount,
  portraitCount = 0,
  imageRole = 'auto',
  isEdit,
}: NewVideoTaskInput): InteractionVideoTask | null {
  if (isEdit) return null;
  if (imageCount <= 0) return 'text_to_video';
  if (imageRole === 'animate') return 'image_to_video';
  if (imageRole === 'reference') return 'reference_to_video';
  // `auto`: declared only when every picture is a cast portrait. An officer's own picture is
  // left for Gemini to read from the instruction.
  const officerImages = imageCount - Math.max(0, portraitCount);
  return officerImages <= 0 ? 'reference_to_video' : null;
}

// Free harness: npx tsx src/video/new-video-task.ts
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  let failed = 0;
  const check = (label: string, ok: boolean): void => {
    if (ok) console.log(`  ok  ${label}`);
    else {
      failed += 1;
      console.error(`FAIL  ${label}`);
    }
  };
  const roles = ['auto', 'animate', 'reference'] as const;

  check(
    'a first turn with no pictures is text-to-video',
    newVideoTaskFor({ imageCount: 0, isEdit: false }) === 'text_to_video',
  );
  // THE FIX FOR 83a2602b: an officer's own picture is no longer forced to be a reference.
  check(
    "by default an officer's picture declares NO task — Gemini reads the role from the words",
    newVideoTaskFor({ imageCount: 1, isEdit: false }) === null &&
      newVideoTaskFor({ imageCount: 3, isEdit: false, imageRole: 'auto' }) ===
        null,
  );
  check(
    'a turn carrying only cast portraits is still reference-to-video',
    newVideoTaskFor({ imageCount: 2, portraitCount: 2, isEdit: false }) ===
      'reference_to_video',
  );
  check(
    "portraits beside an officer's picture leave the task undeclared by default",
    newVideoTaskFor({ imageCount: 2, portraitCount: 1, isEdit: false }) ===
      null,
  );
  check(
    "'animate' declares image-to-video",
    newVideoTaskFor({ imageCount: 1, imageRole: 'animate', isEdit: false }) ===
      'image_to_video',
  );
  check(
    "'reference' declares reference-to-video, however many pictures",
    [1, 2, 4].every(
      (imageCount) =>
        newVideoTaskFor({
          imageCount,
          imageRole: 'reference',
          isEdit: false,
        }) === 'reference_to_video',
    ),
  );
  check(
    'a role with no picture attached declares text-to-video, not a role',
    roles.every(
      (imageRole) =>
        newVideoTaskFor({ imageCount: 0, imageRole, isEdit: false }) ===
        'text_to_video',
    ),
  );

  // A task alongside previous_interaction_id is reported to break edit chains, so a turn that
  // continues one declares nothing at all — whatever role was chosen.
  check(
    'a follow-up declares no task, whatever the role',
    roles.every(
      (imageRole) =>
        newVideoTaskFor({ imageCount: 0, imageRole, isEdit: true }) === null &&
        newVideoTaskFor({ imageCount: 2, imageRole, isEdit: true }) === null,
    ),
  );
  check(
    'neither `edit` nor `extend` is ever returned',
    (['edit', 'extend'] as const).every((task) =>
      roles.every((imageRole) =>
        [0, 1, 2].every((imageCount) =>
          [true, false].every(
            (isEdit) =>
              newVideoTaskFor({ imageCount, imageRole, isEdit }) !== task,
          ),
        ),
      ),
    ),
  );
  check(
    'a nonsense count is not a crash',
    newVideoTaskFor({ imageCount: -1, isEdit: false }) === 'text_to_video',
  );

  console.log(
    failed === 0 ? '\nAll task checks passed.' : `\n${failed} check(s) FAILED.`,
  );
  if (failed > 0) process.exit(1);
}
