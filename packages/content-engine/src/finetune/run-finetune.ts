// Launch and track the OpenAI supervised fine-tuning job (plan step 4).
//
// PAID + creates a remote resource. Subcommands:
//   upload            — upload data/finetune/train.jsonl, print the file id
//   create <fileId>   — create a fine-tuning job on gpt-4o-mini, print the job id
//   status <jobId>    — print a job's status (and the fine_tuned_model id when done)
//   run               — upload + create + poll to completion (one shot)
//
// Run: `tsx --env-file=../../.env src/finetune/run-finetune.ts run`

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const API = 'https://api.openai.com/v1';
// gpt-4o-mini fine-tuning base snapshot.
const BASE_MODEL = 'gpt-4o-mini-2024-07-18';

function apiKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('Missing OPENAI_API_KEY (use --env-file=../../.env).');
  return key;
}

function trainPath(): string {
  return resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../data/finetune/train.jsonl',
  );
}

async function uploadTrainingFile(): Promise<string> {
  const buf = await readFile(trainPath());
  const form = new FormData();
  form.append('purpose', 'fine-tune');
  form.append(
    'file',
    new Blob([buf], { type: 'application/jsonl' }),
    'train.jsonl',
  );
  const res = await fetch(`${API}/files`, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey()}` },
    body: form,
  });
  if (!res.ok) throw new Error(`File upload failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { id: string };
  console.log(`Uploaded training file: ${body.id}`);
  return body.id;
}

// Epochs are fixed (not auto) so cost is predictable; 3 passes suit a small style set.
const N_EPOCHS = 3;

async function createJob(trainingFileId: string): Promise<string> {
  const res = await fetch(`${API}/fine_tuning/jobs`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey()}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      training_file: trainingFileId,
      model: BASE_MODEL,
      hyperparameters: { n_epochs: N_EPOCHS },
    }),
  });
  if (!res.ok) throw new Error(`Job create failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { id: string; status: string };
  console.log(`Created fine-tuning job: ${body.id} (status: ${body.status})`);
  return body.id;
}

type Job = {
  id: string;
  status: string;
  fine_tuned_model: string | null;
  trained_tokens: number | null;
  error?: { message?: string } | null;
};

async function getJob(jobId: string): Promise<Job> {
  const res = await fetch(`${API}/fine_tuning/jobs/${jobId}`, {
    headers: { authorization: `Bearer ${apiKey()}` },
  });
  if (!res.ok) throw new Error(`Job fetch failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as Job;
}

const TERMINAL = new Set(['succeeded', 'failed', 'cancelled']);

async function pollJob(jobId: string): Promise<Job> {
  for (;;) {
    const job = await getJob(jobId);
    const stamp = new Date().toISOString().slice(11, 19);
    console.log(`[${stamp}] ${job.id} — ${job.status}`);
    if (TERMINAL.has(job.status)) {
      if (job.status === 'succeeded') {
        console.log(
          `\n✅ fine_tuned_model: ${job.fine_tuned_model}` +
            `  (trained_tokens: ${job.trained_tokens ?? '?'})`,
        );
        console.log(
          'Set CHAT_MODEL to this id (or wire it into generate-article) to use it.',
        );
      } else {
        console.log(`\n❌ ${job.status}: ${job.error?.message ?? 'unknown error'}`);
      }
      return job;
    }
    await new Promise((r) => setTimeout(r, 30_000));
  }
}

async function main(): Promise<void> {
  const [cmd, arg] = process.argv.slice(2);
  switch (cmd) {
    case 'upload':
      await uploadTrainingFile();
      break;
    case 'create':
      if (!arg) throw new Error('Usage: create <trainingFileId>');
      await createJob(arg);
      break;
    case 'status':
      if (!arg) throw new Error('Usage: status <jobId>');
      await pollJob(arg);
      break;
    case 'run': {
      const fileId = await uploadTrainingFile();
      const jobId = await createJob(fileId);
      await pollJob(jobId);
      break;
    }
    default:
      console.log(
        'Usage: run-finetune.ts <upload | create <fileId> | status <jobId> | run>',
      );
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
