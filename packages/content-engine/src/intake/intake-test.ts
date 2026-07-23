// Dev CLI for the DLO intake pipeline — exercises Sarvam batch STT / document
// digitization / mammoth on local files without the web UI or the API.
//
//   pnpm --filter @dgipr/content-engine intake:test <file.mp3|file.pdf|file.docx> [...]
//
// Requires SARVAM_API_KEY in the root .env (the script loads it via --env-file).

import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { combineIntakeSources, type IntakeSource } from '@dgipr/schemas';
import { extractDocxText } from './docx.js';
import { extractPdfPagesDetailed } from './pdf-pages.js';
import { transcribeAudioFiles, type AudioFileInput } from './sarvam-stt.js';

async function main(): Promise<void> {
  const paths = process.argv.slice(2);
  if (paths.length === 0) {
    console.error(
      'Usage: pnpm --filter @dgipr/content-engine intake:test <files...> (.mp3/.pdf/.docx)',
    );
    process.exit(1);
  }

  const sources: IntakeSource[] = [];
  const audio: Array<AudioFileInput & { path: string }> = [];

  for (const path of paths) {
    const name = basename(path);
    const data = await readFile(path);
    const lower = name.toLowerCase();
    if (lower.endsWith('.mp3')) {
      audio.push({ name, data, path });
    } else if (lower.endsWith('.pdf')) {
      console.log(`[intake:test] extracting PDF ${name}…`);
      const { source, pages } = await extractPdfPagesDetailed(name, data);
      const text = pages
        .map((page) => page.text)
        .filter((pageText) => pageText.length > 0)
        .join('\n\n');
      console.log(
        `[intake:test]   ${text.length} chars from ${pages.length} page(s) via ${source}`,
      );
      sources.push({ label: name, text });
    } else if (lower.endsWith('.docx')) {
      console.log(`[intake:test] extracting DOCX ${name}…`);
      const text = await extractDocxText(name, data);
      console.log(`[intake:test]   ${text.length} chars`);
      sources.push({ label: name, text });
    } else {
      console.error(`[intake:test] skipping unsupported file: ${name}`);
    }
  }

  if (audio.length > 0) {
    console.log(
      `[intake:test] transcribing ${audio.length} audio file(s) via Sarvam batch STT…`,
    );
    const results = await transcribeAudioFiles(audio);
    results.forEach((result, index) => {
      const name = audio[index]!.name;
      if ('text' in result) {
        console.log(`[intake:test]   ${name}: ${result.text.length} chars`);
        sources.push({ label: name, text: result.text });
      } else {
        console.error(`[intake:test]   ${name} FAILED: ${result.error}`);
      }
    });
  }

  const combined = combineIntakeSources('', sources);
  console.log('\n===== combined text =====\n');
  console.log(combined);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error('[intake:test] failed:', error);
    process.exit(1);
  });
}
