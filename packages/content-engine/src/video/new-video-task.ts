// Which task /new-video-workflow declares for one turn — the request-field half of what
// new-video-scaffold.ts says in prose.
//
// Step 2 of the plan that closes the gap with the Gemini app. Omni takes an explicit
// `generation_config.video_config.task`; we sent none, so the task was INFERRED from the
// shape of the request, and the inference is wrong in exactly the case the officers
// reported. A turn that attaches a picture looks like image-to-video — that picture becoming
// the literal opening frame — while what this lane means by an attached picture is a
// CHARACTER OR SUBJECT TO HOLD STEADY, which is `reference_to_video`. Step 1 already says so
// in words (the `[# References <IMAGE_REF_0>@Image1]` block and the documented "should not be
// used as literal initial frames" boilerplate); this says the same thing in the one place the
// model cannot read past.
//
// SO THIS IS NOT AN ORTHOGONAL KNOB — it is the same decision as the reference tagging, and
// the two must not be allowed to disagree. Both are derived from the same two facts about a
// turn, which is what keeps them in step.
//
// WHY A FOLLOW-UP DECLARES NOTHING. Testing writeups report that combining a task with
// `previous_interaction_id` BREAKS EDIT CHAINS, so the field belongs to first turns only.
// `edit` and `extend` exist in the enum and are deliberately never returned here: the turn
// they would describe is precisely the turn that must not carry one. The client enforces the
// same rule a second time, so neither layer alone can get it wrong.
//
// WHY IT IS SENT IN BOTH PROMPT MODES. `verbatim` is the comparison stance, and its rule is
// about the officer's PROMPT reaching Gemini untouched — a request field adds not one
// character to it. That is the aspect-ratio precedent (gemini-interactions-client.ts's
// header: "THE ASPECT RATIO IS A REQUEST FIELD, NOT A SENTENCE"), and keeping the task
// outside the A/B is what leaves the scaffolded-vs-verbatim comparison about the text alone.

import { pathToFileURL } from 'node:url';

import type { InteractionVideoTask } from './gemini-interactions-client.js';

export type NewVideoTaskInput = Readonly<{
  // How many reference images THIS turn attaches — the same count the scaffold's tags are
  // built from, so the declaration and the task describe one request.
  imageCount: number;
  // Whether the turn continues an earlier interaction, read off the CHAIN POINT rather than
  // the turn's position: a turn whose predecessor failed starts a fresh chain and is a first
  // turn in every sense that matters here.
  isEdit: boolean;
}>;

/**
 * The task to declare for one turn, or null to leave it inferred.
 *
 * Pure, and decided without reading the prompt — like the scaffold, and for the same reason:
 * nothing about a paid render should depend on a pattern match over the officer's Marathi.
 */
export function newVideoTaskFor({
  imageCount,
  isEdit,
}: NewVideoTaskInput): InteractionVideoTask | null {
  if (isEdit) return null;
  return imageCount > 0 ? 'reference_to_video' : 'text_to_video';
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

  check(
    'a first turn with no pictures is text-to-video',
    newVideoTaskFor({ imageCount: 0, isEdit: false }) === 'text_to_video',
  );
  // The whole point of the step: an attached picture is a REFERENCE, never the opening frame.
  check(
    'a first turn with a picture is reference-to-video, not image-to-video',
    newVideoTaskFor({ imageCount: 1, isEdit: false }) === 'reference_to_video',
  );
  check(
    'and that holds however many pictures are attached',
    [2, 3, 4].every(
      (imageCount) =>
        newVideoTaskFor({ imageCount, isEdit: false }) === 'reference_to_video',
    ),
  );

  // A task alongside previous_interaction_id is reported to break edit chains, so a turn that
  // continues one declares nothing at all — with or without a new picture.
  check(
    'a follow-up declares no task',
    newVideoTaskFor({ imageCount: 0, isEdit: true }) === null &&
      newVideoTaskFor({ imageCount: 2, isEdit: true }) === null,
  );
  check(
    'neither `edit` nor `extend` is ever returned',
    (['edit', 'extend'] as const).every((task) =>
      [
        newVideoTaskFor({ imageCount: 0, isEdit: false }),
        newVideoTaskFor({ imageCount: 1, isEdit: false }),
        newVideoTaskFor({ imageCount: 0, isEdit: true }),
        newVideoTaskFor({ imageCount: 1, isEdit: true }),
      ].every((chosen) => chosen !== task),
    ),
  );
  check(
    'a nonsense count is not a crash',
    newVideoTaskFor({ imageCount: -1, isEdit: false }) === 'text_to_video',
  );

  // The task and the scaffold's reference tags are two statements of one decision, so they
  // are derived from the same two facts and can never describe different requests.
  check(
    'the task is pure: the same turn gives the same answer',
    newVideoTaskFor({ imageCount: 1, isEdit: false }) ===
      newVideoTaskFor({ imageCount: 1, isEdit: false }),
  );

  console.log(
    failed === 0 ? '\nAll task checks passed.' : `\n${failed} check(s) FAILED.`,
  );
  if (failed > 0) process.exit(1);
}
