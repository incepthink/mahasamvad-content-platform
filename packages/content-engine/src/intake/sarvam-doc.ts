// Marathi PDF text extraction for DLO uploads via the Sarvam Document
// Digitization API. Chosen over local pdf-parse because government PDFs are
// routinely SCANNED — a text-layer parser yields nothing there, while this OCRs
// Devanagari across 23 languages. One async job per PDF: create → upload →
// start → poll → download. Output arrives as a ZIP of per-page Markdown files.

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import AdmZip from 'adm-zip';
import { createSarvamClient } from './sarvam-client.js';

// Overall ceiling on one document job; default 10 min (long scanned PDFs OCR
// page by page).
const DOC_TIMEOUT_MS = Number.parseInt(
  process.env.SARVAM_DOC_TIMEOUT_MS ?? `${10 * 60_000}`,
  10,
);
const DOC_POLL_MS = 5_000;

// Concatenates every Markdown entry of the output ZIP in name order (entries
// are per-page, named so lexicographic order == page order).
function textFromOutputZip(zipPath: string): string {
  const zip = new AdmZip(zipPath);
  const pages = zip
    .getEntries()
    .filter((entry) => !entry.isDirectory && entry.entryName.endsWith('.md'))
    .sort((a, b) => a.entryName.localeCompare(b.entryName))
    .map((entry) => entry.getData().toString('utf8').trim())
    .filter((text) => text.length > 0);
  return pages.join('\n\n');
}

// Extracts a PDF's text as Markdown. Throws with a descriptive message on any
// failure — the caller records it as that FILE's error without failing the
// whole intake.
export async function extractPdfText(
  name: string,
  data: Buffer,
): Promise<string> {
  const client = createSarvamClient();
  const workDir = await mkdtemp(join(tmpdir(), 'dlo-doc-'));
  try {
    // Sarvam's presigned upload requires a .pdf file name; the display name may
    // be Devanagari, so upload under a fixed safe name.
    const pdfPath = join(workDir, 'input.pdf');
    await writeFile(pdfPath, data);

    const job = await client.documentIntelligence.createJob({
      language: 'mr-IN',
      outputFormat: 'md',
      pollingIntervalMs: DOC_POLL_MS,
      maxPollingAttempts: Math.max(1, Math.ceil(DOC_TIMEOUT_MS / DOC_POLL_MS)),
    });
    await job.uploadFile(pdfPath);
    await job.start();
    const status = await job.waitUntilComplete();

    if (status.job_state === 'Failed') {
      throw new Error(
        `Sarvam document digitization failed for ${name}: ${
          status.error_message ?? 'unknown error'
        }`,
      );
    }

    const zipPath = join(workDir, 'output.zip');
    await job.downloadOutput(zipPath);
    const text = textFromOutputZip(zipPath).trim();
    if (!text) {
      throw new Error(
        `Sarvam document digitization returned no text for ${name}.`,
      );
    }
    return text;
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
