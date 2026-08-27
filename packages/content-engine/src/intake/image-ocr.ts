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
// THIS IS NO LONGER THE DEFAULT (2026-08-27). It used to be the only image backend, on the
// reasoning that OCR_PROVIDER chooses between two backends that both take a PDF while
// Sarvam's document job wants a .pdf upload — which turned out to be false: Digitise takes an
// image directly. So images now honour OCR_PROVIDER exactly as pages do (ocr-provider.ts),
// Sarvam reads them by default, and this file is the OCR_PROVIDER=openai rollback. Keep it
// working: it is the only image path with a PROMPT, and therefore the only one whose fidelity
// rules can be changed at all.
//
// NO PAGES, SO NO SPEND GATE. A PDF stops at a page picker because OCR is billed per page
// and the officer decides which are worth it; an image IS one page, so there is nothing to
// choose and nothing to decide before reading it. That is why the /dlo job reads these
// itself, in its extract phase, rather than the input step doing it.

import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openAiFetch } from '../http/openai-request.js';
import { recordChatUsage, type ChatUsage } from '../cost/cost-meter.js';
import {
  OCR_MODEL,
  ocrSystemPrompt,
  unwrapWholeAnswerFence,
} from './openai-doc.js';
import { imageOcrMimeForFileName, normaliseImageForOcr } from './image-prep.js';

const CHAT_URL = 'https://api.openai.com/v1/chat/completions';

// NO OUTPUT CEILING, matching the PDF path — see the constant block in openai-doc.ts. There
// was an 8,000-token cap here; on gpt-5 that budget is shared with reasoning tokens, and
// exhausting it truncates silently rather than erroring. Billing is on tokens emitted, so it
// was never saving anything.

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

type ChatResponse = {
  choices: Array<{
    message: { content: string | null };
    finish_reason?: string;
  }>;
  usage?: ChatUsage;
};

// How much of the photograph the model is shown. OpenAI's own two steps: fit inside
// 2048x2048, then the SHORTEST side to 768 — it downscales a `detail: high` image that way
// itself, so doing it here throws away nothing it would have seen. Sarvam is given a
// different bound for a reason; see sarvam-image.ts.
const OCR_LONG_EDGE = 2048;
const OCR_SHORT_EDGE = 768;

// Reads one image. Returns the transcribed Markdown, which is empty when the picture carries
// no readable text — that is a real answer ("this photograph contributed nothing"), not a
// failure, and the caller reports it as such rather than failing the source.
export async function extractImageTextViaOpenAI(
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
  const prepared = await normaliseImageForOcr(name, data, {
    longEdge: OCR_LONG_EDGE,
    shortEdge: OCR_SHORT_EDGE,
  });

  const response = await openAiFetch(CHAT_URL, {
    label: 'image page',
    apiKey: key,
    // The same serialized OCR lane the PDF path uses, so a ten-photograph intake fans out
    // exactly as a ten-page PDF does instead of competing with it for the article lane.
    lane: 'ocr',
    timeoutMs: options?.timeoutMs ?? IMAGE_TIMEOUT_MS,
    body: {
      model: OCR_MODEL,
      // No max_completion_tokens — see the note above the timeout constant.
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
      `[image-ocr] ${name}: hit the model's output limit (finish_reason: length) — its tail may be missing.`,
    );
  }
  return unwrapWholeAnswerFence(body.choices[0]?.message.content ?? '').trim();
}

// Read a real photograph and see what comes back — the loop for the prompt above:
//
//   tsx --env-file=../../.env src/intake/image-ocr.ts <photo.jpg>
//
// This reads on OpenAI whatever OCR_PROVIDER says — it is the OpenAI client's own loop. For
// what a /dlo photograph actually gets, run the seam's default: sarvam-image.ts.
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
        const text = await extractImageTextViaOpenAI(basename(file), data);
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
