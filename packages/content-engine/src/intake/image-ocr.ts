// A photograph of a document becomes Marathi text — the image twin of openai-doc.ts.
//
// The officers photograph GRs, notices, letters and tables with a phone as readily as they
// scan them, and until now that material had to be turned into a PDF before /dlo would take
// it. This reads the picture directly, with the SAME model, the SAME lane and the SAME
// fidelity prompt a PDF page gets (`ocrSystemPrompt('image')`), so a note assembled from a
// photograph is held to exactly the rules one assembled from a scan is: transcribe, never
// summarise, keep every numeral in the script it was printed in, and keep tables as Markdown
// tables. Everything downstream — the glossary name lock, the designation pass, the
// never-invent rule the article prompt rests on — treats this text as the source document
// itself and cannot tell a helpful paraphrase from what was printed.
//
// IMAGES ALWAYS GO THROUGH OPENAI, whatever OCR_PROVIDER says. That flag is the PDF
// rollback (ocr-provider.ts): it chooses between two backends that both take a PDF, and
// Sarvam's document job wants a .pdf upload, so honouring it here would mean a second image
// path — one that runs only in a configuration nobody uses today, and would therefore be
// broken on the day it was finally needed. One backend, one prompt, one thing to verify.
//
// NO PAGES, SO NO SPEND GATE. A PDF stops at a page picker because OCR is billed per page
// and the officer decides which are worth it; an image IS one page, so there is nothing to
// choose and nothing to decide before reading it. That is why the /dlo job reads these
// itself, in its extract phase, rather than the input step doing it.

import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { openAiFetch } from '../http/openai-request.js';
import { recordChatUsage, type ChatUsage } from '../cost/cost-meter.js';
import {
  OCR_MODEL,
  ocrSystemPrompt,
  unwrapWholeAnswerFence,
} from './openai-doc.js';

const CHAT_URL = 'https://api.openai.com/v1/chat/completions';

// Same budget as one PDF page, and for the same reason: a dense Marathi page plus its tables
// runs ~2-3k tokens, billing is on what is emitted, and an exhausted ceiling comes back as
// silently truncated output rather than an error.
const IMAGE_MAX_TOKENS = 8_000;

const IMAGE_TIMEOUT_MS = Number.parseInt(
  process.env.OPENAI_OCR_TIMEOUT_MS ?? `${5 * 60_000}`,
  10,
);

// How hard the model thinks before answering. UNSET by default, which sends no field and so
// reproduces the PDF path's behaviour exactly.
//
// It is a knob at all because Devanagari digits are the measured weak spot of this read (see
// the numerals rule in ocrSystemPrompt), and effort was the obvious lever — but 'high' was
// tried against the calibration page and did NOT help: ५०→७० and ६५.५→६६.५ survived it and
// ७१५ went from ७२५ to १७५. So it is left off rather than paying reasoning tokens for
// nothing, and the knob remains only so the next person can re-measure without a code change.
const IMAGE_REASONING_EFFORT = process.env.OPENAI_OCR_REASONING_EFFORT?.trim();

// What the model can be handed. Kept in step with IMAGE_MIME_BY_EXTENSION in @dgipr/schemas,
// which is what the web picker offers and the API stores under — this is the last of the
// three and exists so a file that reached the job cannot fail with an opaque API error.
const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

export function imageOcrMimeForFileName(fileName: string): string | null {
  return MIME_BY_EXTENSION[extname(fileName).toLowerCase()] ?? null;
}

type ChatResponse = {
  choices: Array<{
    message: { content: string | null };
    finish_reason?: string;
  }>;
  usage?: ChatUsage;
};

// ---------- normalising the photograph before it is sent ----------
//
// NOT an accuracy fix, and worth saying so: a 3000 px render of the calibration page and a
// 1000 px one read equally well (and made the same digit mistakes), so nobody should expect
// this to move quality. It is here for two other reasons.
//
// The API downscales a `detail: high` image anyway — fit inside 2048x2048, then the SHORTEST
// side to 768 — so doing it here throws away nothing the model would have seen, while making
// what it receives the same shape whatever camera the officer used, and bounding a request
// body that for a raw 12-megapixel PNG would otherwise be tens of megabytes.
//
// The SECOND reason is EXIF orientation, and it is the one that would otherwise look like a
// model failure: a phone held upright writes a landscape image plus a "rotate me" tag, and a
// reader that ignores the tag sees the page on its side. `sharp().rotate()` with no argument
// applies it — and sharp drops metadata on output, so it cannot then be applied twice.
const OCR_LONG_EDGE = 2048;
const OCR_SHORT_EDGE = 768;

async function normaliseForOcr(
  name: string,
  data: Buffer,
): Promise<Readonly<{ data: Buffer; mimeType: string }>> {
  try {
    const image = sharp(data).rotate();
    const { width, height } = await image.metadata();
    if (!width || !height) throw new Error('unreadable image dimensions');

    // OpenAI's own two steps, in order, and never an enlargement — upscaling a small scan
    // invents no detail and only makes the request bigger.
    const longEdge = Math.max(width, height);
    const firstScale = Math.min(1, OCR_LONG_EDGE / longEdge);
    const shortEdge = Math.min(width, height) * firstScale;
    const scale = firstScale * Math.min(1, OCR_SHORT_EDGE / shortEdge);

    const resized =
      scale < 1
        ? image.resize({
            width: Math.round(width * scale),
            height: Math.round(height * scale),
            fit: 'inside',
          })
        : image;
    // JPEG rather than the original container: a photograph is a photograph, and q92 is what
    // the video path already sends frames at. It also bounds the base64 body, which for a raw
    // 12-megapixel PNG would be tens of megabytes.
    return {
      data: await resized.jpeg({ quality: 92 }).toBuffer(),
      mimeType: 'image/jpeg',
    };
  } catch (error) {
    // Never fail a source over the preparation step: the API can read the original bytes, so
    // the worst case here is the unnormalised behaviour rather than a lost photograph.
    console.warn(
      `[image-ocr] ${name}: could not normalise, sending as-is:`,
      error,
    );
    return { data, mimeType: imageOcrMimeForFileName(name) ?? 'image/jpeg' };
  }
}

// Reads one image. Returns the transcribed Markdown, which is empty when the picture carries
// no readable text — that is a real answer ("this photograph contributed nothing"), not a
// failure, and the caller reports it as such rather than failing the source.
export async function extractImageText(
  name: string,
  data: Buffer,
  options?: Readonly<{ timeoutMs?: number }>,
): Promise<string> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    throw new Error(
      'Missing required environment variable OPENAI_API_KEY. ' +
        'Copy .env.example to .env and fill it in.',
    );
  }
  if (!imageOcrMimeForFileName(name)) {
    throw new Error(`${name}: फक्त JPG, PNG आणि WEBP प्रतिमा वाचता येतात.`);
  }
  const prepared = await normaliseForOcr(name, data);

  const response = await openAiFetch(CHAT_URL, {
    label: 'image page',
    apiKey: key,
    // The same serialized OCR lane the PDF path uses, so a ten-photograph intake fans out
    // exactly as a ten-page PDF does instead of competing with it for the article lane.
    lane: 'ocr',
    timeoutMs: options?.timeoutMs ?? IMAGE_TIMEOUT_MS,
    body: {
      model: OCR_MODEL,
      max_completion_tokens: IMAGE_MAX_TOKENS,
      ...(IMAGE_REASONING_EFFORT
        ? { reasoning_effort: IMAGE_REASONING_EFFORT }
        : {}),
      messages: [
        { role: 'system', content: ocrSystemPrompt('image') },
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: {
                url: `data:${prepared.mimeType};base64,${prepared.data.toString('base64')}`,
                // The tiled read, not the thumbnail one: the whole point is small Devanagari
                // print, where a matra — and with it a name — is what gets lost.
                detail: 'high',
              },
            },
            {
              type: 'text',
              // Markdown, not a language — see ocrSystemPrompt: the image's own language and
              // script are what come back, so naming one here would override that rule.
              text: 'Transcribe this image as Markdown, following your instructions exactly.',
            },
          ],
        },
      ],
    },
  });

  const body = (await response.json()) as ChatResponse;
  recordChatUsage(OCR_MODEL, body.usage);

  if (body.choices[0]?.finish_reason === 'length') {
    console.warn(
      `[image-ocr] ${name}: the image did not fit in ${IMAGE_MAX_TOKENS} tokens (finish_reason: length) — its tail may be missing.`,
    );
  }
  return unwrapWholeAnswerFence(body.choices[0]?.message.content ?? '').trim();
}

// Read a real photograph and see what comes back — the loop for the prompt above:
//
//   tsx --env-file=../../.env src/intake/image-ocr.ts <photo.jpg>
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const file = process.argv.slice(2).find((arg) => !arg.startsWith('--'));
  if (!file) {
    console.error(
      'usage: tsx --env-file=../../.env src/intake/image-ocr.ts <photo.jpg|png|webp>',
    );
    process.exitCode = 1;
  } else {
    readFile(file)
      .then(async (data) => {
        const started = Date.now();
        const text = await extractImageText(basename(file), data);
        console.log(
          `${basename(file)} (${(data.length / 1024 / 1024).toFixed(1)} MB) — ${
            text.length
          } chars in ${((Date.now() - started) / 1000).toFixed(1)}s:\n`,
        );
        console.log(text || '(no readable text)');
      })
      .catch((error: unknown) => {
        console.error(error);
        process.exitCode = 1;
      });
  }
}
