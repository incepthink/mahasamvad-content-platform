// `updateGeneration` as the job runners use it: the same write, plus a step span in the job's
// Braintrust trace whenever the write moves the run to a new pipeline step ('retrieve', 'draft',
// 'copy', 'image', …). Outside a traced job — and with tracing off — this is exactly the
// database call. Routes keep importing the plain one from @dgipr/database.

import { traceStep } from '@dgipr/content-engine';
import { updateGeneration as updateGenerationRow } from '@dgipr/database';

export function updateGeneration(
  ...args: Parameters<typeof updateGenerationRow>
): ReturnType<typeof updateGenerationRow> {
  const step = args[2].step;
  if (typeof step === 'string' && step !== 'done') traceStep(step);
  return updateGenerationRow(...args);
}
