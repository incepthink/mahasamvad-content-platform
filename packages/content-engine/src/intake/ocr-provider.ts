// Provider seam for reading a PDF's PIXELS, mirroring stt-provider.ts (speech),
// narration-provider.ts (TTS), clip-provider.ts (clips) and frame-provider.ts (frames).
// pdf-pages.ts owns the policy — text layer vs paid read — and asks this module for "the
// text of these pages"; OCR_PROVIDER trades the backend in an .env edit.
//
// Deliberately thin, like its four siblings: per-provider quirks live inside each client
// (Sarvam's ≤10-page async jobs with their upload/poll/download/ZIP-reassembly dance,
// OpenAI's one-call-per-page fan-out and its own concurrency lane), and neither widens this
// type.
//
// The contract every provider must honour is PAGES CARRYING THE ORIGINAL DOCUMENT'S NUMBERS,
// restricted to options.pages when given — the callers list and select pages by those
// numbers, and a shifted one silently reads the wrong part of a document. A throw means the
// whole file could not be read; the DLO caller records it against that file and the intake
// survives.
//
// THE DEFAULT IS SARVAM. It is the purpose-built document path: Digitise reads a printed PDF
// as structured HTML, including headings and tables, so the officer can review the document
// in the same shape the generation pipeline receives. OCR_PROVIDER=openai remains the
// one-line rollback.
//
// A THIRD BACKEND, gemini-doc.ts, reads a whole PDF in ONE call (up to 1,000 pages / 50 MB).
// It is not the deployment default and is not meant to be: it is what /chat's attachments are
// read with, selected per read through ExtractPdfOptions.ocrProvider rather than by
// OCR_PROVIDER, so the surfaces whose output gets published are unaffected by it.
//
// NOT A COST-FREE SWAP, and worth knowing before flipping it back and forth: Sarvam bills
// per page against its own credits and is estimated in the OCR task bucket; OpenAI bills
// tokens against OPENAI_API_KEY through recordChatUsage. The provider therefore changes both
// the bill and how analytics attributes it.

import { pathToFileURL } from 'node:url';
import { recordOcrCost } from '../cost/cost-meter.js';
import { extractPdfPagesViaOcr } from './sarvam-doc.js';
import { extractPdfPagesViaOpenAI } from './openai-doc.js';
import { extractPdfPagesViaGemini } from './gemini-doc.js';
import { type ExtractPdfOptions, type PdfPage } from './pdf-shared.js';

const SUPPORTED_PROVIDERS = ['gemini', 'openai', 'sarvam'] as const;

// `override` is one read's own choice of backend, and the ONLY caller that passes one is the
// document intake service on behalf of /chat — see ExtractPdfOptions.ocrProvider. Everything
// else asks with no argument and gets the deployment's default.
export function ocrProviderName(override?: string | undefined): string {
  const raw = override ?? process.env.OCR_PROVIDER;
  return raw && raw.trim() !== '' ? raw.trim().toLowerCase() : 'sarvam';
}

// Which backend /chat's document attachments are read with. Its own env var rather than a
// hardcoded 'gemini' so a deployment can put chat back on the shared default in one line, and
// so the browser never gets to name a provider: it declares the SURFACE and the server decides
// what that surface reads with.
export function chatOcrProviderName(): string {
  const raw = process.env.CHAT_OCR_PROVIDER;
  return raw && raw.trim() !== '' ? raw.trim().toLowerCase() : 'gemini';
}

// Which env var a caller must find for the configured provider, so a route or job can name
// the RIGHT key rather than hardcoding SARVAM_API_KEY (the clipProviderApiKeyEnv precedent —
// an OpenAI-OCR deployment may legitimately hold no Sarvam key at all).
export function ocrProviderApiKeyEnv(override?: string | undefined): string {
  switch (ocrProviderName(override)) {
    case 'sarvam':
      return 'SARVAM_API_KEY';
    case 'gemini':
      return 'GEMINI_API_KEY';
    default:
      return 'OPENAI_API_KEY';
  }
}

export function ocrKeyPresent(override?: string | undefined): boolean {
  const key = process.env[ocrProviderApiKeyEnv(override)];
  return typeof key === 'string' && key.trim() !== '';
}

// Read the selected pages of a PDF by looking at them. Pages come back numbered as in the
// ORIGINAL document, in ascending order.
export async function extractPdfPagesViaProvider(
  name: string,
  data: Buffer,
  options?: ExtractPdfOptions,
): Promise<PdfPage[]> {
  const provider = ocrProviderName(options?.ocrProvider);
  // Metered HERE rather than inside either client, so a third provider is counted the day it
  // is added. The pages that come back are the pages that were actually read — an options
  // selection can be trimmed by the client, and the analytics card must report what was
  // bought, not what was asked for.
  const meter = (pages: PdfPage[]): PdfPage[] => {
    recordOcrCost(provider, pages.length);
    return pages;
  };
  switch (provider) {
    case 'sarvam':
      return extractPdfPagesViaOcr(name, data, options).then(meter);
    case 'openai':
      return extractPdfPagesViaOpenAI(name, data, options).then(meter);
    case 'gemini':
      return extractPdfPagesViaGemini(name, data, options).then(meter);
    default:
      throw new Error(
        `Unknown OCR_PROVIDER "${provider}". ` +
          `Supported: ${SUPPORTED_PROVIDERS.join(', ')}.`,
      );
  }
}

// Free harness: asserts dispatch and which key each provider's gate names.
//   tsx src/intake/ocr-provider.ts
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const checks: Array<[string, boolean]> = [];
  const check = (label: string, ok: boolean): void => {
    checks.push([label, ok]);
  };
  const original = process.env.OCR_PROVIDER;

  delete process.env.OCR_PROVIDER;
  check('unset defaults to sarvam', ocrProviderName() === 'sarvam');
  check(
    'sarvam gate names SARVAM_API_KEY',
    ocrProviderApiKeyEnv() === 'SARVAM_API_KEY',
  );

  process.env.OCR_PROVIDER = '  OpenAI  ';
  check('trimmed + lowercased', ocrProviderName() === 'openai');
  check(
    'openai gate names OPENAI_API_KEY',
    ocrProviderApiKeyEnv() === 'OPENAI_API_KEY',
  );

  delete process.env.OCR_PROVIDER;
  check(
    'an override beats the env default',
    ocrProviderName('gemini') === 'gemini',
  );
  check(
    'the gemini gate names GEMINI_API_KEY',
    ocrProviderApiKeyEnv('gemini') === 'GEMINI_API_KEY',
  );
  delete process.env.CHAT_OCR_PROVIDER;
  check('chat reads on gemini by default', chatOcrProviderName() === 'gemini');
  process.env.CHAT_OCR_PROVIDER = 'Sarvam';
  check(
    'and can be put back on the shared default in one line',
    chatOcrProviderName() === 'sarvam',
  );
  delete process.env.CHAT_OCR_PROVIDER;

  process.env.OCR_PROVIDER = 'nope';
  let threw = '';
  void extractPdfPagesViaProvider('a.pdf', Buffer.from('x')).catch(
    (error: unknown) => {
      threw = error instanceof Error ? error.message : String(error);
    },
  );

  if (original === undefined) delete process.env.OCR_PROVIDER;
  else process.env.OCR_PROVIDER = original;

  setTimeout(() => {
    check(
      'unknown provider names the supported list',
      threw.includes('gemini, openai, sarvam'),
    );
    let failed = 0;
    for (const [label, ok] of checks) {
      console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
      if (!ok) failed++;
    }
    console.log(`\n${checks.length - failed}/${checks.length} passed.`);
    process.exitCode = failed > 0 ? 1 : 0;
  }, 0);
}
