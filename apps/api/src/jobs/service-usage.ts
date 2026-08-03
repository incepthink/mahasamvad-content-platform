// Turn a finished job's cost accumulator into usage_events service rows — the bridge that
// lets /analytics say WHICH paid external API each feature ran on.
//
// Why here and not in @dgipr/content-engine: the accumulator is engine-side and the Supabase
// client is not. content-engine must stay DB-free (AGENTS.md), and every job in this package
// already opens a cost scope and holds a client, so this is one call at the point where both
// exist. It is also why nothing had to be threaded through the engine's ~15 call sites.
//
// THE ONE RULE: NEVER DOUBLE-COUNT. Some capabilities are already persisted per row —
// generations.cost_breakdown carries chat+image, video_projects.cost_breakdown carries
// chat+image+clip+tts — and the analytics aggregator reads those from the COLUMN, which is
// what gives them full history instead of history starting at instrumentation deploy day.
// Every caller therefore names the services it wants written, and the list is the exact
// complement of what its own table records. A caller that names a column-backed service
// counts that spend twice; hence the explicit list rather than a convenient "write
// everything".
//
// Fire-and-forget throughout: recordServiceUsage swallows every failure, so a database
// without 0043 costs the analytics rows and nothing else.

import {
  recordServiceUsage,
  recordTaskUsage,
  type SupabaseClient,
  type UsageFeature,
  type UsageService,
} from '@dgipr/database';
import {
  clipProviderName,
  narrationProviderName,
  ocrProviderName,
  sttProviderName,
  type CostAccumulator,
} from '@dgipr/content-engine';

// Sarvam's two translation endpoints are the only backend translate-article.ts has — there
// is no TRANSLATE_PROVIDER seam to read, so this is stated rather than looked up. If one is
// ever added, this becomes translateProviderName().
const TRANSLATE_PROVIDER = 'sarvam';

// OpenAI is the only text and image backend outside the video lane's frame provider.
const OPENAI_PROVIDER = 'openai';

type ServiceRow = Readonly<{
  provider: string;
  // The capability's own billing dimension, matching AnalyticsService.unit: seconds of
  // audio, pages, characters, seconds of footage, calls.
  units: number;
  costUsd: number;
}>;

function rowsFor(acc: CostAccumulator): Record<UsageService, ServiceRow> {
  return {
    text: {
      provider: OPENAI_PROVIDER,
      // Calls rather than tokens: "how many times did this feature ask a model something"
      // is the question the card answers, and a token count means nothing to its reader.
      units: acc.chatCalls,
      costUsd: acc.textCostUsd,
    },
    // Legacy capability writer never asks for embeddings separately; exact task buckets do.
    embedding: { provider: OPENAI_PROVIDER, units: 0, costUsd: 0 },
    image: {
      provider: OPENAI_PROVIDER,
      units: acc.imageCount,
      costUsd: acc.imageCostUsd,
    },
    ocr: {
      provider: ocrProviderName(),
      units: acc.ocrPages,
      // Zero on the OpenAI path by design: those tokens are already in the text line, and
      // charging a page rate on top would double-count them (see estimateOcrCostUsd).
      costUsd: acc.ocrCostUsd,
    },
    stt: {
      provider: sttProviderName(),
      units: acc.sttSeconds,
      costUsd: acc.sttCostUsd,
    },
    tts: {
      provider: narrationProviderName(),
      units: acc.ttsCharacters,
      costUsd: acc.ttsCostUsd,
    },
    clip: {
      provider: clipProviderName(),
      units: acc.videoSeconds,
      costUsd: acc.videoCostUsd,
    },
    translate: {
      provider: TRANSLATE_PROVIDER,
      units: acc.translateChars,
      costUsd: acc.translateCostUsd,
    },
  };
}

// Write one row per NAMED capability the job actually used. A capability with no usage
// writes nothing, so a poster run leaves no empty stt/ocr rows behind.
//
// `calls` is 1 per job rather than per underlying request: the accumulator sums units
// across a batch (one STT job transcribes several recordings together) and cannot recover
// how many requests produced them. One row per job is the honest reading, and the UNITS —
// minutes, pages, characters — are the figure the card leads with anyway.
export function recordServicesFromCost(
  client: SupabaseClient,
  feature: UsageFeature,
  acc: CostAccumulator,
  services: readonly UsageService[],
): void {
  const rows = rowsFor(acc);
  for (const service of services) {
    const row = rows[service];
    if (row.units <= 0) continue;
    recordServiceUsage(client, {
      feature,
      service,
      provider: row.provider,
      calls: 1,
      units: row.units,
      costUsd: row.costUsd,
    });
  }
}

// Persist the accumulator's exact task buckets. Unlike the legacy capability rows above,
// these are safe to write for generation/video jobs whose aggregate costs also live on their
// own row: analytics reads task events for post-deployment detail and uses the column only as
// pre-deployment combined history, so the two are never added into one task.
export function recordTasksFromCost(
  client: SupabaseClient,
  feature: UsageFeature,
  acc: CostAccumulator,
): void {
  for (const usage of acc.taskUsage.values()) {
    recordTaskUsage(client, {
      feature,
      task: usage.task,
      service: usage.service,
      provider: usage.provider,
      model: usage.model,
      calls: usage.calls,
      units: usage.units,
      costUsd: usage.costUsd,
      costEstimated: usage.costEstimated,
    });
  }
}
