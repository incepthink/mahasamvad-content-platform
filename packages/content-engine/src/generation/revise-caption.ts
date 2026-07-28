// Revise a social post's caption according to free-text user feedback ("कॅप्शनमध्ये
// बदल हवा आहे?" in the web UI). This is the caption counterpart of revise-copy.ts:
// twitter/facebook runs store their caption in generations.article, but the article
// revision path (reviseArticle) is a Mahasamvad long-form editor and rejects social
// categories by design — a caption is one short social post with hashtags, not an
// article.
//
// The prompt is deliberately minimal: interpret the user's request, change the current
// caption, and keep all text and numerals Marathi. One chat call, plus one repair call
// if the model's JSON is malformed.

import { pathToFileURL } from 'node:url';
import { chatComplete, type ChatMessage } from './openai-chat.js';

const SYSTEM_PROMPT = [
  'Revise a caption for an official social-media account of DGIPR Maharashtra.',
  "Interpret the user's request and make the requested change to the current caption.",
  'Keep all text in Marathi only and write every number using Marathi Devanagari digits',
  '(०-९) only.',
  'Respond with STRICT JSON only: { "caption": string }.',
  'No markdown, no code fence, no explanation.',
].join('\n');

function buildUserTurn(
  input: ReviseCaptionInput,
  invalid?: { raw: string; errorMessage: string },
): string {
  return [
    '<CURRENT_CAPTION>',
    input.caption.trim(),
    '</CURRENT_CAPTION>',
    '',
    '<USER_REQUEST>',
    input.feedback.trim(),
    '</USER_REQUEST>',
    ...(invalid
      ? [
          '',
          '<INVALID_OUTPUT>',
          invalid.raw,
          '</INVALID_OUTPUT>',
          '',
          '<SCHEMA_ERROR>',
          invalid.errorMessage,
          '</SCHEMA_ERROR>',
        ]
      : []),
    '',
    '<TASK>',
    invalid
      ? 'वरील INVALID_OUTPUT अपेक्षित रचनेशी जुळत नाही. तेच काम पुन्हा करा आणि'
      : 'USER_REQUEST चा अर्थ समजून त्यानुसार CURRENT_CAPTION मध्ये बदल करा.',
    'फक्त {"caption": "..."} अशा वैध JSON object स्वरूपात उत्तर द्या.',
    '</TASK>',
  ].join('\n');
}

function buildMessages(
  input: ReviseCaptionInput,
  invalid?: { raw: string; errorMessage: string },
): ChatMessage[] {
  return [
    {
      role: 'system',
      content: SYSTEM_PROMPT,
    },
    { role: 'user', content: buildUserTurn(input, invalid) },
  ];
}

// Same tolerant extraction as revise-copy.ts: response_format keeps this rare, but a
// stray code fence must not fail a revision.
function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    const firstBrace = raw.indexOf('{');
    const lastBrace = raw.lastIndexOf('}');

    if (firstBrace !== -1 && lastBrace > firstBrace) {
      return JSON.parse(raw.slice(firstBrace, lastBrace + 1));
    }

    throw new Error('Response did not contain a valid JSON object.');
  }
}

// The expected shape is one string field, so a hand-written guard keeps this package
// free of a zod dependency (only @dgipr/schemas carries one).
function validateRevisedCaption(parsed: unknown, raw: string): string {
  const caption =
    typeof parsed === 'object' && parsed !== null
      ? (parsed as { caption?: unknown }).caption
      : undefined;
  if (typeof caption !== 'string' || caption.trim().length === 0) {
    throw new Error(
      `Caption revision did not return a non-empty "caption" string:\n${raw}`,
    );
  }
  return caption.trim();
}

export type ReviseCaptionInput = Readonly<{
  // The caption as it stands (generations.article on a social row).
  caption: string;
  feedback: string;
}>;

export async function reviseCaption(
  input: ReviseCaptionInput,
): Promise<string> {
  const raw = await chatComplete(buildMessages(input), {
    temperature: 0.25,
    responseFormat: 'json_object',
    // A caption is a few hundred characters; the article-sized default is wasteful.
    maxTokens: 1024,
  });

  try {
    return validateRevisedCaption(parseJson(raw), raw);
  } catch (firstError) {
    const repaired = await chatComplete(
      buildMessages(input, {
        raw,
        errorMessage: (firstError as Error).message,
      }),
      { temperature: 0, responseFormat: 'json_object', maxTokens: 1024 },
    );

    try {
      return validateRevisedCaption(parseJson(repaired), repaired);
    } catch (repairError) {
      throw new Error(
        [
          'Caption revision failed after repair attempt.',
          '',
          'First error:',
          (firstError as Error).message,
          '',
          'Repair error:',
          (repairError as Error).message,
          '',
          'Original output:',
          raw,
          '',
          'Repaired output:',
          repaired,
        ].join('\n'),
      );
    }
  }
}

// --- CLI harness -----------------------------------------------------------
// Exercise the revision without the API or the web UI:
//
//   tsx --env-file=../../.env src/generation/revise-caption.ts ["feedback"]
//
// The default feedback exercises the simple instruction-following revision path.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const feedback =
    process.argv.slice(2).join(' ').trim() ||
    'कॅप्शन २८० अक्षरांपेक्षा लहान करा आणि सर्व आकडे मराठी अंकांत लिहा.';

  const SAMPLE_CAPTION = [
    'नमो शेतकरी महासन्मान निधी योजनेच्या दुसऱ्या टप्प्याचे मुंबईत मुख्यमंत्री यांच्या हस्ते उद्घाटन.',
    'राज्यातील 500 शेतकरी कुटुंबांना थेट लाभ मिळणार असून यासाठी 2 कोटी रुपयांची भरीव तरतूद',
    'करण्यात आली आहे. पात्र शेतकऱ्यांनी 31 ऑगस्ट 2026 पूर्वी अर्ज करावेत, असे आवाहन करण्यात आले आहे.',
    '#महासंवाद #शेतकरी',
  ].join(' ');

  reviseCaption({
    caption: SAMPLE_CAPTION,
    feedback,
  })
    .then((revised) => {
      console.log('\n=== feedback ===\n');
      console.log(feedback);
      console.log(
        `\n=== revised caption (${Array.from(revised.normalize('NFC')).length} chars) ===\n`,
      );
      console.log(revised);
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
