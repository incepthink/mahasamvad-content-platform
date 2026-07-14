// Docs screenshot pipeline for docs/user-guide (GitBook user manual).
//
//   pnpm --filter @dgipr/poster-renderer docs:shots -- <phase> [--force]
//
// Phases, in capture order:
//   preflight     readiness checklist (no secrets printed; nothing captured)
//   static        every state capturable without a generation (+1 translate call)
//   run-article   LIVE: scheme article+poster from trial-input.txt (+ English toggle)
//   run-feedback  LIVE: one poster image-feedback round on that run
//   run-twitter   LIVE: twitter post via the "पुढील पाऊल" cross-format action
//   run-rerun     LIVE: edit-note rerun (thread rail with all three nodes)
//   history       /generations grid/search shots (run AFTER the live phases)
//   optimize      compress all captured PNGs in place
//   verify        lint SUMMARY.md links + chapter image links + orphan report
//
// Screenshots are idempotent: existing files are skipped unless --force.
// The live phases require `pnpm dev` (web :3000 + api :3001) and a working
// Supabase/OpenAI/n8n backend — they spend real OpenAI credits.

import { preflight } from './preflight.js';
import { shootHistory, shootStatic } from './shoot-static.js';
import { shootRunArticle } from './shoot-run-article.js';
import { shootRunFeedback } from './shoot-run-feedback.js';
import { shootRunTwitter } from './shoot-run-twitter.js';
import { shootRunRerun } from './shoot-run-rerun.js';
import { optimize } from './optimize.js';
import { verifyDocs } from './verify-docs.js';

// pnpm may forward a literal "--"; the phase is the first real (non-flag) arg.
const phase = process.argv
  .slice(2)
  .find((arg) => arg !== '--' && !arg.startsWith('--'));

const phases: Record<string, () => Promise<void> | void> = {
  preflight,
  static: shootStatic,
  'run-article': shootRunArticle,
  'run-feedback': shootRunFeedback,
  'run-twitter': shootRunTwitter,
  'run-rerun': shootRunRerun,
  history: shootHistory,
  optimize,
  verify: verifyDocs,
};

const run = phase ? phases[phase] : undefined;
if (!run) {
  console.error(
    `Usage: docs:shots -- <${Object.keys(phases).join('|')}> [--force]`,
  );
  process.exit(1);
}

try {
  await run();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
