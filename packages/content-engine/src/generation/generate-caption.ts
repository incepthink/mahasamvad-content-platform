// Write a social post's caption (twitter/facebook) from the run's note. This is the
// first-draft counterpart of revise-caption.ts.
//
// Two things follow from owning it in code. A social run can now be POSTER-ONLY (the
// create form's toggle defaults to off), and a run that skipped its caption can be
// given one later without re-rendering — neither was expressible while the prompt
// lived inside the image workflow.
//
// The prompt is one DGIPR-editor brief shared by every caption, plus ONE closing
// paragraph chosen by what the caption is for: a caption that IS the whole post (the
// फक्त कॅप्शन lane) is a condensed news report, while a caption that accompanies a
// poster is one or two sentences. One chat call, plus one repair call if the model's
// JSON is malformed.

import { pathToFileURL } from 'node:url';
import { chatComplete, type ChatMessage } from './openai-chat.js';

const BASE_PROMPT = [
  'You are a senior DGIPR editor. Write publication-ready social-media text',
  'in formal, natural Marathi from SOURCE INFORMATION.',
  '',
  'Lead with the main decision, directive, announcement or public outcome;',
  'follow with relevant background and practical details. Attribute statements',
  'and appeals to the named speaker or issuing official using their correct',
  'name and designation. For government decisions without a named speaker,',
  'make the government or issuing department the subject; do not treat a',
  'routine GR signature as a spoken statement.',
  '',
  'Use only source-supported facts. Preserve names, dates, figures and whether',
  'an action is proposed, approved, underway or completed. Never invent',
  'speakers, quotations or attendees. Condense administrative lists and',
  'procedures, omit file/reference numbers, and state each point once.',
  '',
  'Write Marathi text and Devanagari numerals. Any supplied examples guide',
  'style only, never facts. Do not add an article headline stack, dateline',
  'or release terminator.',
  '',
  'Return only valid JSON: {"caption": "..."}.',
].join('\n');

// फक्त कॅप्शन: the caption is the run's entire output.
const STANDALONE_RULE = [
  'Write a self-contained, condensed news report in connected paragraphs,',
  'retaining the important news, attribution and context; let the substantive',
  'source information determine its length.',
].join('\n');

// पोस्टर + कॅप्शन: the poster carries the content, the caption accompanies it.
const WITH_POSTER_RULE = [
  'Write a brief caption accompanying the poster, usually one or two',
  'sentences conveying its central message and essential context.',
].join('\n');

export function captionSystemPrompt(mode: CaptionMode): string {
  return [
    BASE_PROMPT,
    mode === 'standalone' ? STANDALONE_RULE : WITH_POSTER_RULE,
  ].join('\n\n');
}

function buildUserTurn(
  input: GenerateCaptionInput,
  invalid?: { raw: string; errorMessage: string },
): string {
  return [
    `Account: Official ${input.platform === 'twitter' ? 'Twitter' : 'Facebook'} account of DGIPR Maharashtra`,
    '',
    '<SOURCE_INFORMATION>',
    input.note.trim(),
    '</SOURCE_INFORMATION>',
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
      : 'Write the caption from the SOURCE INFORMATION above.',
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
      content: captionSystemPrompt(input.mode),
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

// 'standalone' = the फक्त कॅप्शन lane (no poster; the caption is the whole post).
// 'with_poster' = a caption accompanying a social poster or a carousel.
export type CaptionMode = 'standalone' | 'with_poster';

export type GenerateCaptionInput = Readonly<{
  // The run's note — on the media-room path this is the finished article.
  note: string;
  // Which official account the caption is for.
  platform: 'twitter' | 'facebook';
  // What the caption is for; selects the prompt's closing paragraph.
  mode: CaptionMode;
}>;

// Room for the ANSWER (chatComplete adds reasoning headroom on top). A poster caption is
// a sentence or two; a standalone caption is a condensed news report whose length follows
// the source, and Marathi runs ~1.5 chars/token, so 2048 would cut a long one mid-JSON.
function captionMaxTokens(mode: CaptionMode): number {
  return mode === 'standalone' ? 6144 : 2048;
}

export async function generateSocialCaption(
  input: GenerateCaptionInput,
): Promise<string> {
  const raw = await chatComplete(buildMessages(input), {
    temperature: 0.4,
    responseFormat: 'json_object',
    maxTokens: captionMaxTokens(input.mode),
  });

  try {
    return validateCaption(parseJson(raw), raw);
  } catch (firstError) {
    const repaired = await chatComplete(
      buildMessages(input, {
        raw,
        errorMessage: (firstError as Error).message,
      }),
      {
        temperature: 0,
        responseFormat: 'json_object',
        maxTokens: captionMaxTokens(input.mode),
      },
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
//   tsx --env-file=../../.env src/generation/generate-caption.ts [twitter|facebook] [standalone|with_poster]
//
// Both platforms use the same instructions, with the account named in the user turn.
// Check that the result is clear Marathi and all numerals are Devanagari, and that
// with_poster comes back as one or two sentences.
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

  const mode: CaptionMode =
    process.argv[3] === 'with_poster' ? 'with_poster' : 'standalone';

  generateSocialCaption({
    note: SAMPLE_NOTE,
    platform,
    mode,
  })
    .then((caption) => {
      console.log(`\n=== ${platform} caption (${mode}) ===\n`);
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
