// A photograph of a document becomes Marathi text, read by Sarvam Document AI — the image
// twin of sarvam-doc.ts, and the default backend for /dlo's photographs since 2026-08-27.
//
// It is the SAME Digitise job a scanned PDF gets. The endpoint takes an image directly (its
// own validation error has always said "Page/image count", and this was confirmed live: a
// JPEG of a Marathi page returns pages_succeeded: 1), so nothing here wraps the picture in a
// one-page PDF and no page identity has to be restored — an image IS one page.
//
// TWO THINGS DIFFER FROM THE PDF PATH, both deliberate.
//
//   output_format=md, not html. The PDF path asks for HTML because a document's pages are
//   reviewed through ExtractedText, which renders that structure; a photograph's transcript
//   is edited in a plain textarea and then travels VERBATIM into the article's source note
//   (combineIntakeSources), so HTML there would put markup in front of the officer and into
//   the prompt. Markdown is exactly the shape the OpenAI path returned, which is why nothing
//   downstream — the review card, the assembly, the glossary lock, the article — changed.
//   The live API accepts 'html', 'md' or 'json' and rejects anything else with
//   OUTPUT_FORMAT_INVALID, so those three are the whole list.
//
//   NO PROMPT, therefore no fidelity rules. openai-doc.ts's ocrSystemPrompt tells the model
//   to transcribe rather than summarise and to keep numerals in the script they were printed
//   in; Sarvam is a document pipeline and takes no instructions at all. That is the same
//   trade every scanned PDF has taken since Sarvam became the OCR default, and the officer's
//   review step — the photograph shown beside its editable transcript — is the guard either
//   way.

import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import AdmZip from 'adm-zip';
import { runDigitiseJob } from './sarvam-doc.js';
import { imageOcrMimeForFileName, normaliseImageForOcr } from './image-prep.js';

// Ceiling on one photograph; default 10 min, matching the PDF job.
const IMAGE_TIMEOUT_MS = Number.parseInt(
  process.env.SARVAM_DOC_TIMEOUT_MS ?? `${10 * 60_000}`,
  10,
);

// Bounds the upload without throwing away print. Deliberately NOT the OpenAI path's second
// step (shortest side to 768): that number is OpenAI's own tiling rule, and Sarvam reads the
// pixels itself — squeezing a page to 768 short-edge would drop the matras before its OCR
// ever saw them. 3000 px on the long edge is still >250 dpi across an A4 page.
const SARVAM_IMAGE_LONG_EDGE = Number.parseInt(
  process.env.SARVAM_IMAGE_LONG_EDGE ?? '3000',
  10,
);

// One page's metadata, the same file the PDF path falls back to. Only the fields used here.
type PageMetadata = {
  blocks?: Array<{ text?: unknown; reading_order?: unknown }>;
};

// The blocks in reading order, as plain text. This is the fallback for the day Sarvam stops
// putting a .md file in the ZIP: the metadata is where the OCR text actually lives, and
// losing a whole photograph because an output template changed shape would be far worse than
// losing its heading levels. Sarvam already emits pipe tables inside a block's text, so a
// table survives this as a Markdown table.
function textFromMetadata(raw: string): string {
  let parsed: PageMetadata;
  try {
    parsed = JSON.parse(raw) as PageMetadata;
  } catch {
    return '';
  }
  return (parsed.blocks ?? [])
    .map((block, index) => ({
      text: typeof block.text === 'string' ? block.text.trim() : '',
      order:
        typeof block.reading_order === 'number' ? block.reading_order : index,
    }))
    .filter((block) => block.text.length > 0)
    .sort((a, b) => a.order - b.order)
    .map((block) => block.text)
    .join('\n\n');
}

// The Markdown out of a Digitise output ZIP. The live layout is
//   manifest.json
//   <uploaded name>/<uploaded name>.md
//   <uploaded name>/metadata/page_001.json
// so the .md entry is found by extension rather than by a path that embeds the file name.
export function imageTextFromOutputZip(data: Buffer): string {
  const zip = new AdmZip(data);
  if (process.env.SARVAM_DOC_DEBUG) {
    console.log(
      `[sarvam-image] output zip entries: ${zip
        .getEntries()
        .map((entry) => entry.entryName)
        .join(', ')}`,
    );
  }
  const markdown = zip
    .getEntries()
    .filter(
      (entry) =>
        !entry.isDirectory && entry.entryName.toLowerCase().endsWith('.md'),
    )
    .map((entry) => entry.getData().toString('utf8').trim())
    .filter((text) => text.length > 0)
    .join('\n\n');
  if (markdown.length > 0) return markdown;

  const metadata = zip
    .getEntries()
    .filter(
      (entry) =>
        !entry.isDirectory &&
        entry.entryName.endsWith('.json') &&
        basename(entry.entryName).startsWith('page_'),
    )
    .map((entry) => textFromMetadata(entry.getData().toString('utf8')))
    .filter((text) => text.length > 0)
    .join('\n\n');
  if (metadata.length > 0) {
    console.warn(
      '[sarvam-image] no Markdown entry in the output; used the page metadata instead.',
    );
  }
  return metadata;
}

// Reads one image. Returns the transcribed Markdown, which is EMPTY when the picture carries
// no readable text — that is a real answer ("this photograph contributed nothing"), not a
// failure, and the caller reports it as such rather than failing the source.
export async function extractImageTextViaSarvam(
  name: string,
  data: Buffer,
  options?: Readonly<{ timeoutMs?: number }>,
): Promise<string> {
  const mimeType = imageOcrMimeForFileName(name);
  if (!mimeType) {
    throw new Error(`${name}: फक्त JPG, PNG आणि WEBP प्रतिमा वाचता येतात.`);
  }
  const prepared = await normaliseImageForOcr(name, data, {
    longEdge: SARVAM_IMAGE_LONG_EDGE,
  });
  // The uploaded name decides the output directory inside the ZIP, so it is kept plain and
  // its extension kept in step with what was actually encoded.
  const zip = await runDigitiseJob(
    name,
    {
      data: prepared.data,
      mimeType: prepared.mimeType,
      fileName: prepared.mimeType === 'image/png' ? 'input.png' : 'input.jpg',
    },
    { outputFormat: 'md', timeoutMs: options?.timeoutMs ?? IMAGE_TIMEOUT_MS },
  );
  return imageTextFromOutputZip(zip).trim();
}

// Free transport/output harness — proves the exact Digitise form fields and the ZIP reader
// without touching Sarvam or spending credits:
//   tsx src/intake/sarvam-image.ts
// Read a real photograph (one page of Sarvam credit):
//   tsx --env-file=../../.env src/intake/sarvam-image.ts <photo.jpg>
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const file = process.argv.slice(2).find((arg) => !arg.startsWith('--'));
  if (file) {
    readFile(file)
      .then(async (data) => {
        const started = Date.now();
        const text = await extractImageTextViaSarvam(basename(file), data);
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
  } else {
    const checks: Array<[string, boolean]> = [];
    const check = (label: string, ok: boolean): void => {
      checks.push([label, ok]);
    };

    const zip = new AdmZip();
    zip.addFile('manifest.json', Buffer.from('{}'));
    zip.addFile(
      'input.jpg/input.md',
      Buffer.from('## शीर्षक\n\nमजकूर ५०० कोटी'),
    );
    zip.addFile(
      'input.jpg/metadata/page_001.json',
      Buffer.from(
        JSON.stringify({
          page_num: 1,
          blocks: [{ text: 'मेटाडेटा', reading_order: 0 }],
        }),
      ),
    );
    check(
      'prefers the Markdown entry, whatever it is named',
      imageTextFromOutputZip(zip.toBuffer()) === '## शीर्षक\n\nमजकूर ५०० कोटी',
    );

    const noMarkdown = new AdmZip();
    noMarkdown.addFile(
      'input.jpg/metadata/page_001.json',
      Buffer.from(
        JSON.stringify({
          blocks: [
            { text: 'दुसरा', reading_order: 2 },
            {
              text: '| नाव | संख्या |\n| --- | --- |\n| अ | १ |',
              reading_order: 1,
            },
          ],
        }),
      ),
    );
    check(
      'falls back to metadata blocks in reading order, tables intact',
      imageTextFromOutputZip(noMarkdown.toBuffer()) ===
        '| नाव | संख्या |\n| --- | --- |\n| अ | १ |\n\nदुसरा',
    );
    check(
      'an empty output is an empty answer, not a throw',
      imageTextFromOutputZip(new AdmZip().toBuffer()) === '',
    );

    // The two warnings this prints are the point, not noise: the ZIP below has no Markdown
    // entry on its second read (metadata fallback), and the "photograph" is a text buffer
    // sharp cannot open (normalisation degrading to the original bytes rather than losing
    // the source). Both paths still have to submit an image, which formOk asserts.
    const originalFetch = globalThis.fetch;
    const originalKey = process.env.SARVAM_API_KEY;
    process.env.SARVAM_API_KEY = 'test-key';
    let formOk = false;
    let calls = 0;
    globalThis.fetch = (async (input, init) => {
      calls += 1;
      const url = String(input);
      if (url.endsWith('/digitise')) {
        const form = init?.body;
        const uploaded = form instanceof FormData ? form.get('file') : null;
        formOk =
          form instanceof FormData &&
          // Markdown, not HTML — the transcript is edited in a textarea and becomes the
          // article's source text verbatim.
          form.get('output_format') === 'md' &&
          form.get('content_type') === 'printed' &&
          // A language field is what fails the live job outright; it must not come back.
          form.get('language') === null &&
          uploaded instanceof Blob &&
          uploaded.type.startsWith('image/');
        return new Response(
          JSON.stringify({ job_id: 'job-1', status: 'pending' }),
          { status: 201 },
        );
      }
      if (url.endsWith('/job-1/status')) {
        return new Response(JSON.stringify({ status: 'completed' }));
      }
      if (url.endsWith('/job-1/download-url')) {
        return new Response(
          JSON.stringify({
            method: 'GET',
            url: 'https://download.test/output.zip',
          }),
        );
      }
      if (url === 'https://download.test/output.zip') {
        return new Response(new Uint8Array(zip.toBuffer()));
      }
      return new Response('unexpected URL', { status: 500 });
    }) as typeof fetch;

    let refused = '';
    extractImageTextViaSarvam('scan.jpg', Buffer.from('not-a-real-jpeg'))
      .then((text) => {
        check('submits an image as one Digitise job', formOk);
        check('create + status + URL + download', calls === 4);
        check('returns the Markdown', text === '## शीर्षक\n\nमजकूर ५०० कोटी');
      })
      .then(() =>
        extractImageTextViaSarvam('scan.bmp', Buffer.from('x')).catch(
          (error: unknown) => {
            refused = error instanceof Error ? error.message : String(error);
          },
        ),
      )
      .catch((error: unknown) => {
        console.error(error);
        check('transport completes', false);
      })
      .finally(() => {
        globalThis.fetch = originalFetch;
        if (originalKey === undefined) delete process.env.SARVAM_API_KEY;
        else process.env.SARVAM_API_KEY = originalKey;

        check(
          'an unsupported container is refused in Marathi, before any call',
          refused.includes('JPG, PNG'),
        );
        let failed = 0;
        for (const [label, ok] of checks) {
          console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
          if (!ok) failed += 1;
        }
        console.log(`\n${checks.length - failed}/${checks.length} passed.`);
        process.exitCode = failed > 0 ? 1 : 0;
      });
  }
}
