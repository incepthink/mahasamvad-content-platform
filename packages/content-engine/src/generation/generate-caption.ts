// Write a social post's caption (twitter/facebook) from the run's note. This is the
// first-draft counterpart of revise-caption.ts.
//
// Two things follow from owning it in code. A social run can now be POSTER-ONLY (the
// create form's toggle defaults to off), and a run that skipped its caption can be
// given one later without re-rendering — neither was expressible while the prompt
// lived inside the image workflow.
//
// The prompt is deliberately minimal: clearly explain the supplied information for
// DGIPR Maharashtra, using Marathi text and Devanagari numerals throughout. One chat
// call, plus one repair call if the model's JSON is malformed.

import { pathToFileURL } from 'node:url';
import { chatComplete, type ChatMessage } from './openai-chat.js';

const SYSTEM_PROMPT = [
  'Write a caption for an official social-media account of DGIPR Maharashtra.',
  'Explain the provided information in a very clear way.',
  'Write all text in Marathi only and write every number using Marathi Devanagari digits',
  '(०-९) only.',
  'Respond with STRICT JSON only: { "caption": string }.',
  'No markdown, no code fence, no explanation.',
].join('\n');

function buildUserTurn(
  input: GenerateCaptionInput,
  invalid?: { raw: string; errorMessage: string },
): string {
  return [
    `Account: Official ${input.platform === 'twitter' ? 'Twitter' : 'Facebook'} account of DGIPR Maharashtra`,
    '',
    '<INFORMATION>',
    input.note.trim(),
    '</INFORMATION>',
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
      ? 'The INVALID_OUTPUT above does not match the expected shape. Redo the same work and'
      : 'Clearly explain the INFORMATION above as a caption for the official account.',
    'Answer with a valid JSON object of the form {"caption": "..."} only.',
    '</TASK>',
  ].join('\n');
}

function buildMessages(
  input: GenerateCaptionInput,
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

// Same tolerant extraction as revise-caption.ts: response_format keeps this rare, but
// a stray code fence must not fail a caption.
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

// One string field, so a hand-written guard keeps this package free of a zod
// dependency (only @dgipr/schemas carries one).
function validateCaption(parsed: unknown, raw: string): string {
  const caption =
    typeof parsed === 'object' && parsed !== null
      ? (parsed as { caption?: unknown }).caption
      : undefined;
  if (typeof caption !== 'string' || caption.trim().length === 0) {
    throw new Error(
      `Caption generation did not return a non-empty "caption" string:\n${raw}`,
    );
  }
  return caption.trim();
}

export type GenerateCaptionInput = Readonly<{
  // The run's note — on the media-room path this is the finished article.
  note: string;
  // Which official account the caption is for.
  platform: 'twitter' | 'facebook';
}>;

export async function generateSocialCaption(
  input: GenerateCaptionInput,
): Promise<string> {
  const raw = await chatComplete(buildMessages(input), {
    temperature: 0.4,
    responseFormat: 'json_object',
    // A caption is a few hundred characters; the article-sized default is wasteful.
    maxTokens: 2048,
  });

  try {
    return validateCaption(parseJson(raw), raw);
  } catch (firstError) {
    const repaired = await chatComplete(
      buildMessages(input, {
        raw,
        errorMessage: (firstError as Error).message,
      }),
      { temperature: 0, responseFormat: 'json_object', maxTokens: 2048 },
    );

    try {
      return validateCaption(parseJson(repaired), repaired);
    } catch (repairError) {
      throw new Error(
        [
          'Caption generation failed after repair attempt.',
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
// Write a caption without the API or the web UI:
//
//   tsx --env-file=../../.env src/generation/generate-caption.ts [twitter|facebook]
//
// Both platforms use the same deliberately simple instructions, with the account named
// in the user turn. Check that the result is clear Marathi and all numerals are Devanagari.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const platform =
    process.argv[2] === 'facebook'
      ? ('facebook' as const)
      : ('twitter' as const);

  const SAMPLE_NOTE = [
    'मुख्यमंत्री यांच्या हस्ते आज पुणे येथे नमो शेतकरी महासन्मान निधी योजनेच्या दुसऱ्या टप्प्याचे',
    'उद्घाटन झाले. या टप्प्यात राज्यातील ५०० शेतकरी कुटुंबांना थेट लाभ मिळणार असून त्यासाठी',
    'एकूण २ कोटी रुपयांची तरतूद करण्यात आली आहे. अर्ज करण्याची अंतिम मुदत ३१ ऑगस्ट २०२६ आहे.',
    'यावेळी कृषी विभागाचे वरिष्ठ अधिकारी उपस्थित होते.',
  ].join(' ');

  generateSocialCaption({
    note: SAMPLE_NOTE,
    platform,
  })
    .then((caption) => {
      console.log(`\n=== ${platform} caption ===\n`);
      console.log(caption);
      console.log(
        `\n(${Array.from(caption.normalize('NFC')).length} characters)\n`,
      );
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
