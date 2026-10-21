// Round 1 of error analysis: turn rows the database ALREADY holds into reconstructed traces, about
// 20 per sidebar feature, for one Marathi-reading editor to open-code in Braintrust.
// See docs/evals-error-analysis.md for the review loop this feeds.
//
// READ-ONLY. No database write and no model call. `--dry-run` (the default) writes each trace as
// JSON under packages/content-engine/data/evals/ (gitignored) so it can be read before anything
// leaves the machine; `--upload` sends the same traces to Braintrust, attachments included.
//
// NO IDENTITY reaches a trace: activity_events is read through ACTIVITY_LITE_COLUMNS, which
// leaves out the IP, the device id, the user agent and the summary.
//
// Needs the database tunnel (`pnpm db:tunnel`, docs/database-on-aws.md) when run locally.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import {
  ACTIVITY_EVENTS_TABLE,
  createServiceRoleClient,
  getChatThread,
  getDloIntake,
  getGeneration,
  getNewVideoConversationRow,
  getReferenceImageRow,
  getTranscription,
  GENERATIONS_TABLE,
  listChatMessages,
  listNewVideoTurns,
  listRevisions,
  type SupabaseClient,
} from '@dgipr/database';
import {
  DEFAULT_BRAINTRUST_PROJECT,
  uploadTraces,
} from './braintrust-upload.js';
import { buildChatTrace } from './reconstruct/chat.js';
import { buildCreativeTrace } from './reconstruct/creative.js';
import { buildDloTrace } from './reconstruct/dlo.js';
import { buildNewVideoTrace } from './reconstruct/new-video.js';
import { buildReferenceTrace } from './reconstruct/reference.js';
import { buildTranscriptionTrace } from './reconstruct/transcription.js';
import { buildTranslationTrace } from './reconstruct/translation.js';
import {
  fetchCandidates,
  pageAll,
  pickLatest,
  pickStratified,
} from './sample.js';
import {
  ACTIVITY_LITE_COLUMNS,
  collectMedia,
  EVAL_FEATURES,
  isEvalFeature,
  type ActivityLite,
  type EvalFeature,
  type ReconstructedTrace,
} from './trace.js';

const DEFAULT_OUT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../data/evals',
);
const ID_BATCH = 80;

async function activityFor(
  client: SupabaseClient,
  subjectIds: readonly string[],
): Promise<ActivityLite[]> {
  const out: ActivityLite[] = [];
  try {
    for (let i = 0; i < subjectIds.length; i += ID_BATCH) {
      const { data, error } = await client
        .from(ACTIVITY_EVENTS_TABLE)
        .select(ACTIVITY_LITE_COLUMNS)
        .in('subject_id', subjectIds.slice(i, i + ID_BATCH))
        .order('created_at', { ascending: true });
      if (error) throw new Error(error.message);
      for (const row of (data ?? []) as unknown as Record<string, unknown>[]) {
        out.push({
          createdAt: String(row.created_at),
          settledAt: (row.settled_at as string | null) ?? null,
          feature: String(row.feature),
          action: String(row.action),
          status: String(row.status),
          subjectId: (row.subject_id as string | null) ?? null,
          error: (row.error as string | null) ?? null,
        });
      }
    }
  } catch (error) {
    // Best-effort: the activity log began with 0058, and its absence costs the reaction spans only.
    console.warn(
      `[evals] activity unavailable (${error instanceof Error ? error.message : error}); continuing without it`,
    );
    return [];
  }
  return out;
}

async function buildTrace(
  client: SupabaseClient,
  feature: EvalFeature,
  id: string,
): Promise<ReconstructedTrace | null> {
  switch (feature) {
    case 'creative': {
      const row = await getGeneration(client, id);
      if (!row) return null;
      const [revisions, activity] = await Promise.all([
        listRevisions(client, id),
        activityFor(client, [id]),
      ]);
      return buildCreativeTrace(row, revisions, activity);
    }
    case 'dlo': {
      const intake = await getDloIntake(client, id);
      if (!intake) return null;
      const linked = await pageAll<{ id: string }>(
        client,
        GENERATIONS_TABLE,
        'id,created_at',
        (q) => q.eq('dlo_intake_id', id),
      );
      const bundles = (
        await Promise.all(
          linked.map(async ({ id: generationId }) => {
            const [generation, revisions] = await Promise.all([
              getGeneration(client, generationId),
              listRevisions(client, generationId),
            ]);
            return generation ? [{ generation, revisions }] : [];
          }),
        )
      ).flat();
      const activity = await activityFor(client, [
        id,
        ...linked.map((g) => g.id),
      ]);
      return buildDloTrace(intake, bundles, activity);
    }
    case 'transcribe': {
      const row = await getTranscription(client, id);
      return row
        ? buildTranscriptionTrace(row, await activityFor(client, [id]))
        : null;
    }
    case 'translate': {
      const row = await getGeneration(client, id);
      return row
        ? buildTranslationTrace(row, await activityFor(client, [id]))
        : null;
    }
    case 'references': {
      const row = await getReferenceImageRow(client, id);
      return row ? buildReferenceTrace(row) : null;
    }
    case 'storyboard':
    case 'new-video': {
      const conversation = await getNewVideoConversationRow(client, id);
      if (!conversation) return null;
      return buildNewVideoTrace(
        conversation,
        await listNewVideoTurns(client, id),
      );
    }
    case 'chat': {
      const thread = await getChatThread(client, id);
      if (!thread) return null;
      return buildChatTrace(thread, await listChatMessages(client, id));
    }
  }
}

const HELP = `Usage: pnpm --filter @dgipr/content-engine evals:export-existing -- [options]

  --dry-run              Write traces as JSON under data/evals/ (default).
  --upload               Send the traces to Braintrust (needs BRAINTRUST_API_KEY).
  --features=a,b         Subset of: ${EVAL_FEATURES.join(', ')} (default: all).
  --per-feature=20       Traces per feature.
  --seed=round1          Makes the pick reproducible.
  --latest               Take the most recent runs instead of a mix across history.
  --out=<dir>            JSON output directory.
  --project=<name>       Braintrust project (default ${DEFAULT_BRAINTRUST_PROJECT}).
  --max-attachment-mb=50 Larger files are named, not uploaded.

Read-only: no database writes and no model calls.`;

export async function main(args = process.argv.slice(2)): Promise<void> {
  const { values } = parseArgs({
    // `pnpm --filter … evals:export-existing -- --dry-run` passes the literal `--` through,
    // and parseArgs treats everything after it as positional and refuses it.
    args: args.filter((arg) => arg !== '--'),
    options: {
      'dry-run': { type: 'boolean' },
      upload: { type: 'boolean' },
      features: { type: 'string' },
      'per-feature': { type: 'string', default: '20' },
      seed: { type: 'string', default: 'round1' },
      latest: { type: 'boolean' },
      out: { type: 'string' },
      project: { type: 'string' },
      'max-attachment-mb': { type: 'string', default: '50' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    console.log(HELP);
    return;
  }
  if (values.upload && values['dry-run']) {
    throw new Error('Choose one of --dry-run and --upload.');
  }
  const features = values.features
    ? values.features
        .split(',')
        .map((f) => f.trim())
        .filter(Boolean)
    : [...EVAL_FEATURES];
  for (const feature of features) {
    if (!isEvalFeature(feature)) {
      throw new Error(
        `Unknown feature "${feature}". Supported: ${EVAL_FEATURES.join(', ')}.`,
      );
    }
  }
  const perFeature = Number(values['per-feature']);
  if (!Number.isInteger(perFeature) || perFeature < 1) {
    throw new Error('--per-feature must be a positive whole number.');
  }
  const maxMb = Number(values['max-attachment-mb']);
  if (!Number.isFinite(maxMb) || maxMb <= 0) {
    throw new Error('--max-attachment-mb must be a positive number.');
  }
  // pnpm --filter changes cwd; resolve user paths relative to where the command was typed.
  const invocationDir = process.env.INIT_CWD ?? process.cwd();
  const out = values.out ? resolve(invocationDir, values.out) : DEFAULT_OUT;
  const seed = values.seed ?? 'round1';

  const client = createServiceRoleClient();
  const traces: ReconstructedTrace[] = [];
  for (const feature of features as EvalFeature[]) {
    const candidates = await fetchCandidates(client, feature);
    const picked = values.latest
      ? pickLatest(candidates, perFeature)
      : pickStratified(candidates, perFeature, seed, feature);
    const failed = picked.filter((c) => c.failed).length;
    console.log(
      `${feature}: ${candidates.length} candidates → ${picked.length} picked (${failed} failed)`,
    );
    for (const candidate of picked) {
      const trace = await buildTrace(client, feature, candidate.id);
      if (!trace) {
        console.warn(`  ${feature}:${candidate.id} vanished; skipped`);
        continue;
      }
      traces.push(trace);
      const dir = resolve(out, feature);
      await mkdir(dir, { recursive: true });
      await writeFile(
        resolve(dir, `${candidate.id}.json`),
        JSON.stringify(trace, null, 2) + '\n',
        'utf8',
      );
      console.log(
        `  ${trace.id}  ${trace.name}  spans=${trace.spans.length} media=${collectMedia(trace).length}`,
      );
    }
  }
  console.log(`Wrote ${traces.length} trace(s) under ${out}`);

  if (values.upload) {
    await uploadTraces(traces, {
      client,
      projectName:
        values.project ??
        process.env.BRAINTRUST_PROJECT ??
        DEFAULT_BRAINTRUST_PROJECT,
      maxAttachmentBytes: maxMb * 1_048_576,
      log: (line) => console.log(line),
    });
    console.log(`Uploaded ${traces.length} trace(s) to Braintrust.`);
  } else {
    console.log('Dry run: nothing was uploaded. Re-run with --upload to send.');
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
