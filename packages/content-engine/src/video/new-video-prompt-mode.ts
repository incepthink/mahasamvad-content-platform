// What /new-video-workflow is FOR, and the one place that decides.
//
// This lane shipped as a COMPARISON HARNESS. Its founding rule was that the officer's prompt
// reaches Gemini byte for byte, because anything this repo added — a reference-role block, a
// voice description, a house style, a rewrite — would make "is our output worse than the
// Gemini app?" unanswerable.
//
// That question has since been answered, and the answer is that the app's advantage IS the
// scaffolding: it tags reference images with roles, states dialogue in a form that does not
// burn in subtitles, and re-states the voice description on every turn. So the rule that made
// the comparison fair is the same rule that makes the output worse. The two goals are mutually
// exclusive, and this module is where that is decided rather than assumed.
//
// The default is therefore SCAFFOLDED — /new-video-workflow is a product lane now. `verbatim`
// is kept so the comparison can still be run A/B against a scaffolded turn on the same prompt,
// which is the only way to show a scaffolding change helped rather than merely differed.
//
// The in-repo precedent for the shape of the answer is the Dynamic Poster lane, which calls
// the same client and has ALWAYS scaffolded: its prompt is written by a first LLM pass
// (generation/motion-prompt.ts). Nothing about that lane is governed here.
//
// Read fresh at every turn rather than captured at boot: the value is deployment-wide and
// constant, and reading it late is what lets an operator flip the lane with a restart.

import { pathToFileURL } from 'node:url';

import type { InteractionPromptMode } from './gemini-interactions-client.js';

// THREE STANCES, NOT THE CLIENT'S TWO. `authored` (Step 5) is `scaffolded` plus a first LLM
// pass that writes the instruction the scaffold then wraps — so it is a decision of this
// LANE, taken above the client, which still only ever knows whether IT is adding text. That
// is why this union is its own type rather than the client's: mapping one onto the other is
// `interactionModeFor` below, and it is a two-line function precisely because the two
// questions are different ones.
export type NewVideoPromptMode = 'scaffolded' | 'verbatim' | 'authored';

const MODES: readonly NewVideoPromptMode[] = [
  'scaffolded',
  'verbatim',
  'authored',
];

/**
 * Which stance /new-video-workflow takes for one turn. Default 'scaffolded'.
 *
 * Throws on an unrecognised value rather than falling back — the articleProvider /
 * clipProviderName rule: a typo in a deployment's .env must not silently leave the lane in
 * the mode the operator believed they had just switched away from, which on this surface
 * would look like the scaffolding simply not working.
 *
 * WHY `authored` IS NOT THE DEFAULT, even though it is the end of the plan. It is the only
 * stance in which the officer's own sentence is not what reaches the model, and it adds a
 * paid call to every turn. Nothing in Steps 1-4 has been proven on a real render yet, so
 * turning it on at the same time would make the first honest comparison unattributable —
 * which is the whole reason `verbatim` was kept in the first place. Flip it deliberately,
 * on one note, against a `scaffolded` turn of the same note.
 */
export function newVideoPromptMode(): NewVideoPromptMode {
  const raw = process.env.NEW_VIDEO_PROMPT_MODE?.trim().toLowerCase();
  if (!raw) return 'scaffolded';
  if (raw === 'scaffolded' || raw === 'verbatim' || raw === 'authored')
    return raw;
  throw new Error(
    `Unknown NEW_VIDEO_PROMPT_MODE "${process.env.NEW_VIDEO_PROMPT_MODE}". ` +
      `Supported: ${MODES.join(', ')}.`,
  );
}

/**
 * What the CLIENT is told to do, given this lane's stance.
 *
 * `authored` maps to `scaffolded` because the client's mode has only ever been about what
 * `buildInteractionRequest` adds around the text it is handed — and an authored turn is
 * still wrapped in exactly the same deterministic blocks. Where the text came from is not
 * the client's business, which is the same reason the Dynamic Poster lane, whose prompt is
 * written by an LLM pass of its own, is correctly `verbatim` there.
 */
export function interactionModeFor(
  mode: NewVideoPromptMode,
): InteractionPromptMode {
  return mode === 'verbatim' ? 'verbatim' : 'scaffolded';
}

/** Whether this stance runs the Step 5 authoring pass before the turn is composed. */
export function promptModeAuthors(mode: NewVideoPromptMode): boolean {
  return mode === 'authored';
}

// Free harness: npx tsx src/video/new-video-prompt-mode.ts
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const checks: Array<[string, () => void]> = [
    [
      'unset defaults to scaffolded',
      () => {
        delete process.env.NEW_VIDEO_PROMPT_MODE;
        if (newVideoPromptMode() !== 'scaffolded')
          throw new Error('not scaffolded');
      },
    ],
    [
      'blank defaults to scaffolded',
      () => {
        process.env.NEW_VIDEO_PROMPT_MODE = '   ';
        if (newVideoPromptMode() !== 'scaffolded')
          throw new Error('not scaffolded');
      },
    ],
    [
      'verbatim is selectable, and tolerates case and padding',
      () => {
        process.env.NEW_VIDEO_PROMPT_MODE = '  Verbatim ';
        if (newVideoPromptMode() !== 'verbatim')
          throw new Error('not verbatim');
      },
    ],
    [
      'authored is selectable',
      () => {
        process.env.NEW_VIDEO_PROMPT_MODE = ' Authored ';
        if (newVideoPromptMode() !== 'authored')
          throw new Error('not authored');
      },
    ],
    [
      'a typo throws and names every option',
      () => {
        process.env.NEW_VIDEO_PROMPT_MODE = 'scaffoled';
        try {
          newVideoPromptMode();
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          if (
            !message.includes('scaffolded') ||
            !message.includes('verbatim') ||
            !message.includes('authored')
          ) {
            throw new Error(`message does not name every mode: ${message}`);
          }
          return;
        }
        throw new Error('a typo was accepted');
      },
    ],
    [
      'an authored turn is still scaffolded as far as the client is concerned',
      () => {
        if (interactionModeFor('authored') !== 'scaffolded')
          throw new Error('authored did not map to scaffolded');
        if (interactionModeFor('scaffolded') !== 'scaffolded')
          throw new Error('scaffolded did not map to itself');
        if (interactionModeFor('verbatim') !== 'verbatim')
          throw new Error('verbatim did not map to itself');
      },
    ],
    [
      'only the authored stance runs the authoring pass',
      () => {
        if (!promptModeAuthors('authored'))
          throw new Error('authored does not author');
        if (promptModeAuthors('scaffolded') || promptModeAuthors('verbatim'))
          throw new Error('a non-authoring stance authors');
      },
    ],
  ];

  let failed = 0;
  for (const [name, run] of checks) {
    try {
      run();
      console.log(`  ok  ${name}`);
    } catch (error) {
      failed += 1;
      console.error(`FAIL  ${name}: ${(error as Error).message}`);
    }
  }
  delete process.env.NEW_VIDEO_PROMPT_MODE;
  console.log(`\n${checks.length - failed}/${checks.length} checks passed.`);
  if (failed > 0) process.exit(1);
}
