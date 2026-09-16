#!/usr/bin/env node

import { performance } from 'node:perf_hooks';

const TERMINAL_STATES = new Set([
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'TIMED_OUT',
]);

const CHAT_SYSTEM = `Act as a polished general-purpose Marathi assistant. Answer directly, preserve every supplied fact, and do not invent names, dates, figures, or quotations.`;

const DLO_SYSTEM = `Write a publication-ready Marathi government news article from only the supplied note. Preserve every supported name, date, figure and attribution. Do not invent facts. Return only the finished article.`;

const SAMPLE_NOTE = `महाराष्ट्र शासनाच्या जिल्हास्तरीय आढावा बैठकीत नागरिक सेवा वेळेत पूर्ण करण्याच्या सूचना देण्यात आल्या. अधिकाऱ्यांनी प्रलंबित प्रकरणांचा नियमित आढावा घ्यावा, लाभार्थ्यांना अचूक माहिती द्यावी आणि नोंदी अद्ययावत ठेवाव्यात. हा चाचणी मजकूर काल्पनिक आहे; त्यातील कोणतीही नावे, आकडे किंवा घोषणा वास्तव म्हणून मांडू नयेत.`;

function usage() {
  console.log(`Load-test a queue-based Runpod Serverless vLLM endpoint.

Usage:
  pnpm qwen:benchmark -- --execute --endpoint-id ENDPOINT_ID [options]

Required environment:
  RUNPOD_API_KEY          Runpod account API key with access to this endpoint

Options:
  --endpoint-id ID        Runpod Serverless endpoint ID (or RUNPOD_ENDPOINT_ID)
  --model ID              Exact served model ID (or RUNPOD_MODEL)
  --profile chat|dlo      Workload shape (default: chat)
  --concurrency N         Simultaneous submitted jobs (default: 25)
  --requests N            Jobs in this batch (default: concurrency)
  --prompt-repeat N       Repeat synthetic source note N times (default: 8)
  --max-tokens N          Completion ceiling (default: chat 512, DLO 2048)
  --thinking on|off       Qwen thinking mode (default: chat on, DLO off)
  --timeout-ms N          Whole benchmark deadline (default: 1200000)
  --poll-ms N             Status polling interval (default: 1000)
  --idle-seconds N        Idle billing tail estimate (default: 5)
  --gpu-rates CSV         Candidate hourly rates (or RUNPOD_GPU_RATES)
  --workdays N            Workdays per month (default: 22)
  --daily-generations CSV Per-user daily volumes (default: 1,5,10,20)
  --help                   Show this help

The command submits every job through /run before polling /status, so a 25-request batch
actually reaches Runpod as a simultaneous queue burst. It never prints the API key, endpoint
URL, prompts, or generated text. Use Runpod Billing for the authoritative charge; the script's
cost range is derived from observed worker lifetimes and the supplied GPU rates.`);
}

function parseArgs(argv) {
  const values = new Map();
  const flags = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) throw new Error(`Unexpected argument: ${arg}`);
    const name = arg.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith('--')) {
      flags.add(name);
      continue;
    }
    values.set(name, next);
    index += 1;
  }
  return { values, flags };
}

function positiveInteger(value, fallback, name) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`--${name} must be a positive integer`);
  }
  return parsed;
}

function nonNegativeNumber(value, fallback, name) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`--${name} must be a non-negative number`);
  }
  return parsed;
}

function positiveNumbers(csv, fallback, name) {
  const values = (csv ?? fallback)
    .split(',')
    .map((value) => Number(value.trim()));
  if (
    values.length === 0 ||
    values.some((value) => !Number.isFinite(value) || value <= 0)
  ) {
    throw new Error(`--${name} must be comma-separated positive numbers`);
  }
  return values;
}

function percentile(values, fraction) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * fraction) - 1),
  );
  return Math.round(sorted[index]);
}

function distribution(values) {
  return {
    min: values.length ? Math.round(Math.min(...values)) : null,
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    max: values.length ? Math.round(Math.max(...values)) : null,
  };
}

function round(value, places = 2) {
  const multiplier = 10 ** places;
  return Math.round(value * multiplier) / multiplier;
}

function findUsage(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return null;
  seen.add(value);
  if (
    value.usage &&
    typeof value.usage === 'object' &&
    (typeof value.usage.prompt_tokens === 'number' ||
      typeof value.usage.completion_tokens === 'number')
  ) {
    return value.usage;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const usage = findUsage(item, seen);
      if (usage) return usage;
    }
    return null;
  }
  for (const item of Object.values(value)) {
    const usage = findUsage(item, seen);
    if (usage) return usage;
  }
  return null;
}

async function requestJson(url, apiKey, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      Authorization: `Bearer ${apiKey}`,
      ...options.headers,
    },
  });
  const raw = await response.text();
  let body = null;
  if (raw) {
    try {
      body = JSON.parse(raw);
    } catch {
      body = null;
    }
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${new URL(url).pathname}`);
  }
  return body;
}

async function endpointHealth(baseUrl, apiKey) {
  try {
    return await requestJson(`${baseUrl}/health`, apiKey);
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

async function submitJob(baseUrl, apiKey, input, index) {
  const submittedAt = Date.now();
  const started = performance.now();
  try {
    const response = await requestJson(`${baseUrl}/run`, apiKey, {
      method: 'POST',
      body: JSON.stringify({ input }),
    });
    if (!response || typeof response.id !== 'string') {
      throw new Error('Runpod did not return a job id');
    }
    return {
      index,
      id: response.id,
      submittedAt,
      submissionMs: performance.now() - started,
      initialStatus: response.status ?? null,
    };
  } catch (error) {
    return {
      index,
      id: null,
      submittedAt,
      submissionMs: performance.now() - started,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function pollJob(baseUrl, apiKey, submitted, pollMs, deadline) {
  if (!submitted.id) return { ...submitted, status: 'SUBMISSION_FAILED' };
  for (;;) {
    if (Date.now() >= deadline) {
      return { ...submitted, status: 'CLIENT_TIMEOUT' };
    }
    try {
      const job = await requestJson(
        `${baseUrl}/status/${encodeURIComponent(submitted.id)}`,
        apiKey,
      );
      if (job && TERMINAL_STATES.has(job.status)) {
        return {
          ...submitted,
          status: job.status,
          delayTime: Number(job.delayTime ?? 0),
          executionTime: Number(job.executionTime ?? 0),
          workerId:
            typeof job.workerId === 'string'
              ? job.workerId
              : typeof job.worker_id === 'string'
                ? job.worker_id
                : null,
          usage: findUsage(job.output),
          completedAt: Date.now(),
          error:
            job.status === 'COMPLETED'
              ? null
              : typeof job.error === 'string'
                ? job.error.slice(0, 300)
                : job.status,
        };
      }
    } catch (error) {
      return {
        ...submitted,
        status: 'STATUS_FAILED',
        error: error instanceof Error ? error.message : String(error),
      };
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

async function cancelJob(baseUrl, apiKey, id) {
  if (!id) return;
  await requestJson(`${baseUrl}/cancel/${encodeURIComponent(id)}`, apiKey, {
    method: 'POST',
  }).catch(() => undefined);
}

function estimatedWorkerSeconds(completed, batchStartedAt, idleSeconds) {
  const withWorker = completed.filter((job) => job.workerId);
  if (withWorker.length === 0) return null;
  const workers = new Map();
  for (const job of withWorker) {
    const executionEnd =
      job.submittedAt + Number(job.delayTime) + Number(job.executionTime);
    const current = workers.get(job.workerId);
    if (!current) {
      workers.set(job.workerId, {
        start: Math.max(batchStartedAt, job.submittedAt),
        end: executionEnd,
      });
      continue;
    }
    current.start = Math.min(current.start, job.submittedAt);
    current.end = Math.max(current.end, executionEnd);
  }
  let seconds = 0;
  for (const worker of workers.values()) {
    seconds += Math.max(0, worker.end - worker.start) / 1000 + idleSeconds;
  }
  return { seconds, workers: workers.size };
}

async function main() {
  const { values, flags } = parseArgs(process.argv.slice(2));
  if (flags.has('help')) {
    usage();
    return;
  }
  if (!flags.has('execute')) {
    usage();
    throw new Error(
      'Refusing paid Serverless load generation without --execute',
    );
  }

  const endpointId =
    values.get('endpoint-id') ?? process.env.RUNPOD_ENDPOINT_ID;
  const apiKey = process.env.RUNPOD_API_KEY;
  if (!endpointId)
    throw new Error('Set RUNPOD_ENDPOINT_ID or pass --endpoint-id');
  if (!apiKey) {
    throw new Error(
      'Set RUNPOD_API_KEY in .env. Do not paste the API key into chat or a command.',
    );
  }
  const profile = values.get('profile') ?? 'chat';
  if (profile !== 'chat' && profile !== 'dlo') {
    throw new Error('--profile must be chat or dlo');
  }
  const concurrency = positiveInteger(
    values.get('concurrency'),
    25,
    'concurrency',
  );
  const requests = positiveInteger(
    values.get('requests'),
    concurrency,
    'requests',
  );
  const promptRepeat = positiveInteger(
    values.get('prompt-repeat'),
    8,
    'prompt-repeat',
  );
  const maxTokens = positiveInteger(
    values.get('max-tokens'),
    profile === 'chat' ? 512 : 2_048,
    'max-tokens',
  );
  const timeoutMs = positiveInteger(
    values.get('timeout-ms'),
    1_200_000,
    'timeout-ms',
  );
  const pollMs = positiveInteger(values.get('poll-ms'), 1_000, 'poll-ms');
  const idleSeconds = nonNegativeNumber(
    values.get('idle-seconds'),
    5,
    'idle-seconds',
  );
  const thinkingText =
    values.get('thinking') ?? (profile === 'chat' ? 'on' : 'off');
  if (thinkingText !== 'on' && thinkingText !== 'off') {
    throw new Error('--thinking must be on or off');
  }
  const thinking = thinkingText === 'on';
  const gpuRates = positiveNumbers(
    values.get('gpu-rates') ?? process.env.RUNPOD_GPU_RATES,
    '2.72,3.49,4.79',
    'gpu-rates',
  );
  const workdays = positiveInteger(values.get('workdays'), 22, 'workdays');
  const dailyVolumes = positiveNumbers(
    values.get('daily-generations'),
    '1,5,10,20',
    'daily-generations',
  );

  const baseUrl = `https://api.runpod.ai/v2/${encodeURIComponent(endpointId)}`;
  const model =
    values.get('model') ??
    process.env.RUNPOD_MODEL ??
    process.env.QWEN_MODEL ??
    'Qwen/Qwen3.8-27B';
  const source = Array.from({ length: promptRepeat }, () => SAMPLE_NOTE).join(
    '\n',
  );
  const messages =
    profile === 'chat'
      ? [
          { role: 'system', content: CHAT_SYSTEM },
          {
            role: 'user',
            content: `${source}\n\nवरील मजकुराचा अचूक आणि संक्षिप्त मुद्देसूद सारांश द्या.`,
          },
        ]
      : [
          { role: 'system', content: DLO_SYSTEM },
          {
            role: 'user',
            content: `${source}\n\nवरील माहितीवर आधारित मराठी बातमी तयार करा.`,
          },
        ];
  const input = {
    route: '/v1/chat/completions',
    method: 'POST',
    body: {
      model,
      messages,
      stream: false,
      max_tokens: maxTokens,
      chat_template_kwargs: { enable_thinking: thinking },
    },
  };

  const healthBefore = await endpointHealth(baseUrl, apiKey);
  console.log(
    JSON.stringify({
      phase: 'starting',
      endpointId,
      profile,
      model,
      concurrency,
      requests,
      promptCharacters: messages.reduce(
        (sum, item) => sum + item.content.length,
        0,
      ),
      maxTokens,
      thinking,
      gpuRates,
      healthBefore,
    }),
  );

  const batchStartedAt = Date.now();
  const submissions = await Promise.all(
    Array.from({ length: requests }, (_, index) =>
      submitJob(baseUrl, apiKey, input, index + 1),
    ),
  );
  const accepted = submissions.filter((job) => job.id);
  console.log(
    JSON.stringify({
      phase: 'submitted',
      accepted: accepted.length,
      rejected: submissions.length - accepted.length,
      submissionLatencyMs: distribution(
        submissions.map((job) => job.submissionMs),
      ),
    }),
  );

  const deadline = batchStartedAt + timeoutMs;
  const results = await Promise.all(
    submissions.map((job) => pollJob(baseUrl, apiKey, job, pollMs, deadline)),
  );
  const unfinished = results.filter(
    (job) => job.id && !TERMINAL_STATES.has(job.status),
  );
  await Promise.all(
    unfinished.map((job) => cancelJob(baseUrl, apiKey, job.id)),
  );

  const healthAfter = await endpointHealth(baseUrl, apiKey);
  const completed = results.filter((job) => job.status === 'COMPLETED');
  const failed = results.filter((job) => job.status !== 'COMPLETED');
  const workerEstimate = estimatedWorkerSeconds(
    completed,
    batchStartedAt,
    idleSeconds,
  );
  const batchWallSeconds = (Date.now() - batchStartedAt) / 1000;
  const executionSeconds = completed.reduce(
    (sum, job) => sum + Number(job.executionTime) / 1000,
    0,
  );
  const promptTokens = completed.reduce(
    (sum, job) => sum + Number(job.usage?.prompt_tokens ?? 0),
    0,
  );
  const completionTokens = completed.reduce(
    (sum, job) => sum + Number(job.usage?.completion_tokens ?? 0),
    0,
  );
  const estimatedSeconds = workerEstimate?.seconds ?? batchWallSeconds;
  const reportedRunningWorkers = Number(healthAfter?.workers?.running ?? 0);
  const observedProcessingWorkers = workerEstimate?.workers ?? null;
  const possibleExtraWorkers =
    observedProcessingWorkers === null
      ? null
      : Math.max(0, reportedRunningWorkers - observedProcessingWorkers);
  const batchCosts = gpuRates.map((hourlyRateUsd) => ({
    hourlyRateUsd,
    estimatedComputeCostUsd: round(
      (estimatedSeconds / 3_600) * hourlyRateUsd,
      4,
    ),
  }));
  const monthly = dailyVolumes.map((generationsPerUserDay) => {
    const batches = generationsPerUserDay * workdays;
    return {
      generationsPerUserDay,
      monthlyRequests: 25 * batches,
      estimatedWorkerHours: round((estimatedSeconds * batches) / 3_600),
      costByGpuRate: gpuRates.map((hourlyRateUsd) => ({
        hourlyRateUsd,
        computeCostUsd: round(
          (estimatedSeconds * batches * hourlyRateUsd) / 3_600,
        ),
      })),
    };
  });

  console.log(
    JSON.stringify(
      {
        phase: 'complete',
        endpointId,
        profile,
        concurrency,
        requests,
        completed: completed.length,
        failed: failed.length,
        observedWorkers: observedProcessingWorkers,
        batchWallSeconds: round(batchWallSeconds),
        delayMs: distribution(completed.map((job) => job.delayTime)),
        executionMs: distribution(completed.map((job) => job.executionTime)),
        tokens: {
          prompt: promptTokens || null,
          completion: completionTokens || null,
          aggregateCompletionTokensPerSecond:
            completionTokens > 0
              ? round(completionTokens / batchWallSeconds)
              : null,
        },
        billingProxy: {
          method: workerEstimate
            ? 'observed worker lifetimes from submission through execution, plus idle tail'
            : 'one-worker batch wall-clock lower bound; worker IDs were unavailable',
          estimatedWorkerSeconds: round(estimatedSeconds),
          summedJobExecutionSeconds: round(executionSeconds),
          idleSecondsPerObservedWorker: idleSeconds,
          batchCosts,
          possibleExtraAutoscaledWorkers: possibleExtraWorkers,
          scope:
            possibleExtraWorkers && possibleExtraWorkers > 0
              ? 'lower bound: job results identify fewer processing workers than endpoint health reports running; verify total in Runpod Billing'
              : 'processing workers identified by completed job results',
          authoritativeSource: 'Runpod Billing and endpoint Metrics tabs',
        },
        monthlyProjectionFor25Users: monthly,
        healthBefore,
        healthAfter,
        failures: failed.map((job) => ({
          index: job.index,
          id: job.id,
          status: job.status,
          error: job.error ?? null,
        })),
      },
      null,
      2,
    ),
  );
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
