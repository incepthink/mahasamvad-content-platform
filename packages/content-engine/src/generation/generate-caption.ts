// Write a social post's caption (twitter/facebook) from the run's note. This is the
// first-draft counterpart of revise-caption.ts, and its house style is the one the
// `social-post-v2-api` n8n workflow's "Build Caption Request" node used to carry —
// ported here verbatim so captions do not change character, and so the caption stops
// being welded into the poster render.
//
// Two things follow from owning it in code. A social run can now be POSTER-ONLY (the
// create form's toggle defaults to off), and a run that skipped its caption can be
// given one later without re-rendering — neither was expressible while the prompt
// lived inside the image workflow.
//
// The note is the only fact source, exactly as in revise-caption.ts. One chat call,
// plus one repair call if the model's JSON is malformed.

import { pathToFileURL } from 'node:url';
import { chatComplete, type ChatMessage } from './openai-chat.js';

// The DGIPR house style for a post caption. Long-form press-note prose, not a
// headline: the officer is publishing an official communication, and the poster
// carries the short version.
const STYLE_GUIDE = [
  'House style for DGIPR Maharashtra posts — long-form press-note captions:',
  '- Marathi (Devanagari) only. Fluent government news-release prose.',
  '- Cover ALL substantive information from the note: announcements, directives, figures,',
  '  scheme names, instructions attributed to the dignitary, and the concluding attendees',
  '  paragraph if the note contains one. Do not compress facts away.',
  '- NEVER invent names, dates, amounts, designations, scheme names, or locations — the',
  '  note is the only factual source.',
  '- Structure: 2-4 short paragraphs separated by blank lines.',
  '- If the note clearly names the place of the event/meeting, the very first line is',
  '  exactly "📍" followed by that place name (e.g. "📍पुणे") on its own line, before the',
  '  text. If no clear place, omit this line entirely.',
  '- The 📍 location pin is the ONLY emoji allowed anywhere in the caption. No other emojis.',
  '- Weave 2-4 hashtags INLINE on key thematic words inside the sentences (e.g.',
  '  "#कामगार विभागाच्या", "#महिला सक्षमीकरण"). Do NOT add a separate hashtag block or any',
  '  trailing hashtags.',
  '- End the caption with "@MahaDGIPR" as the final line.',
  '- No clickbait, no opinions beyond the note.',
].join('\n');

const SYSTEM_PROMPT = [
  'You are the social media editor for DGIPR Maharashtra. Write ONE ready-to-post caption',
  'for the poster described. Respond with STRICT JSON only: { "caption": string }.',
  'No markdown, no code fence, no explanation.',
  '',
  STYLE_GUIDE,
].join('\n');

// The platform's hard cap, stated as a rule only when the platform has one (X: 280
// weighted characters; a Facebook post has no practical limit). Mirrors
// revise-caption.ts — the publish route stays the hard gate either way.
function lengthRule(maxLength: number | undefined): string[] {
  if (!maxLength) return [];
  return [
    '',
    'Length limit:',
    `- The caption must be at most ${maxLength} characters, hashtags included.`,
    '- Drop less important detail to fit; never change a fact to fit.',
  ];
}

function buildUserTurn(
  input: GenerateCaptionInput,
  invalid?: { raw: string; errorMessage: string },
): string {
  return [
    ...(input.postType ? [`Post type: ${input.postType}`, ''] : []),
    '<NOTE purpose="only_authoritative_fact_source">',
    input.note.trim(),
    '</NOTE>',
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
      : 'Write the caption for the post described by the NOTE above.',
    'Add no fact that is not in the NOTE.',
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
      content: [SYSTEM_PROMPT, ...lengthRule(input.maxLength)].join('\n'),
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
  // The run's note — on the media-room path this is the finished article, and it is the
  // only thing facts may come from.
  note: string;
  // Which lane asked for it. Today both write the same house style; the field is what a
  // future per-platform divergence reads (and it keeps the log self-explanatory).
  platform: 'twitter' | 'facebook';
  // The poster type the n8n workflow resolved (its catalog slug), as a light tone steer.
  postType?: string | undefined;
  // Platform character cap, when the platform has one. Stated in the prompt; not enforced
  // in code — the publish route is the hard gate.
  maxLength?: number | undefined;
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
// twitter states the 280-character rule, facebook states none — the same split the
// runner makes. Check the output for: the 📍 line, inline (not trailing) hashtags, the
// closing @MahaDGIPR, and no fact absent from the note.
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
    postType: 'scheme_launch',
    ...(platform === 'twitter' ? { maxLength: 280 } : {}),
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
