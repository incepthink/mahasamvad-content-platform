// Marathi speech-to-text for DLO meeting recordings via the Sarvam Batch STT
// API. The sync REST endpoint only accepts ~30-second clips, so everything goes
// through one bulk job (up to 2h per file, 20 files per job): create → upload →
// start → poll → download transcripts. saaras:v3 in `transcribe` mode outputs
// text in the SOURCE language, i.e. Marathi stays Marathi (never round-tripped
// through English, per AGENTS.md).
//
// The SDK's job instance works on local files (presigned uploads/downloads), so
// buffers are staged in a temp dir for the duration of the job.

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSarvamClient } from './sarvam-client.js';

// Overall ceiling on one batch job (upload → transcribe → download). Long
// recordings transcribe in minutes, not seconds; default 20 min.
const STT_TIMEOUT_MS = Number.parseInt(
  process.env.SARVAM_STT_TIMEOUT_MS ?? `${20 * 60_000}`,
  10,
);
const STT_POLL_SECONDS = 10;

export type AudioFileInput = Readonly<{
  // Display name (may be Devanagari); results come back in input order, so the
  // name is only for error messages.
  name: string;
  data: Buffer;
}>;

export type AudioTranscription =
  | Readonly<{ text: string }>
  | Readonly<{ error: string }>;

// Presigned-upload file names must be storage-safe; the index prefix keeps them
// unique (two uploads may share a display name) and maps results back.
function tempFileName(index: number, name: string): string {
  const safe = name.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `${index}-${safe || 'audio.mp3'}`;
}

// The downloaded output is JSON with a `transcript` field; fall back to the raw
// text if Sarvam ever returns something unexpected rather than failing the file.
function transcriptFromOutput(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as { transcript?: unknown };
    if (typeof parsed.transcript === 'string') return parsed.transcript;
  } catch {
    // Not JSON — treat the whole payload as the transcript.
  }
  return raw;
}

// Transcribes all audio files in ONE Sarvam batch job. Returns one entry per
// input, in input order; a per-file transcription failure becomes { error } so
// one bad recording never sinks the other sources. Throws only on job-level
// failures (auth, timeout, network) — the caller then marks all audio failed.
export async function transcribeAudioFiles(
  files: readonly AudioFileInput[],
): Promise<AudioTranscription[]> {
  if (files.length === 0) return [];

  const client = createSarvamClient();
  const workDir = await mkdtemp(join(tmpdir(), 'dlo-stt-'));
  try {
    const inputDir = join(workDir, 'in');
    const outputDir = join(workDir, 'out');
    await mkdir(inputDir);
    await mkdir(outputDir);

    const tempNames = files.map((file, index) => tempFileName(index, file.name));
    await Promise.all(
      files.map((file, index) =>
        writeFile(join(inputDir, tempNames[index]!), file.data),
      ),
    );

    const job = await client.speechToTextJob.createJob({
      model: 'saaras:v3',
      mode: 'transcribe',
      languageCode: 'mr-IN',
    });
    await job.uploadFiles(tempNames.map((name) => join(inputDir, name)));
    await job.start();
    await job.waitUntilComplete(STT_POLL_SECONDS, STT_TIMEOUT_MS / 1000);

    const { successful, failed } = await job.getFileResults();
    console.log(
      `[sarvam-stt] batch job: ${successful.length} succeeded, ${failed.length} failed` +
        (failed.length > 0
          ? ` (${failed.map((entry) => entry.file_name).join(', ')})`
          : ''),
    );
    if (successful.length > 0) {
      await job.downloadOutputs(outputDir);
    }

    // Index results by their temp name; the numeric prefix maps back to inputs.
    const byTempName = new Map<string, AudioTranscription>();
    for (const entry of failed) {
      byTempName.set(entry.file_name, {
        error:
          entry.error_message ??
          `Sarvam transcription failed (status ${entry.status}).`,
      });
    }
    for (const entry of successful) {
      const outputFile = entry.output_file;
      if (!outputFile) {
        byTempName.set(entry.file_name, {
          error: 'Sarvam transcription returned no output file.',
        });
        continue;
      }
      try {
        // downloadOutputs saves each transcript as `<input file>.json`, NOT as
        // the server-side output_file name getFileResults reports; the latter
        // stays as a fallback in case the SDK's naming ever changes.
        const raw = await readFile(
          join(outputDir, `${entry.file_name}.json`),
          'utf8',
        ).catch(() => readFile(join(outputDir, outputFile), 'utf8'));
        const text = transcriptFromOutput(raw).trim();
        byTempName.set(
          entry.file_name,
          text ? { text } : { error: 'Sarvam transcription came back empty.' },
        );
      } catch (error) {
        byTempName.set(entry.file_name, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return files.map((file, index) => {
      const result = byTempName.get(tempNames[index]!);
      return (
        result ?? {
          error: `Sarvam batch job returned no result for ${file.name}.`,
        }
      );
    });
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
