// Tighten ONE scene's Marathi narration so its spoken audio fits the time the
// caller names — the 15s clip ceiling, a frozen legacy window, or a scene's
// share of the video's total budget.
//
// Why this exists at all: past whatever ceiling applies, the clip cannot grow
// to hold the voice — Kling tops out at 15s, a frozen window is paid for — so
// the text is the only thing that can move. The alternative the mux offers is
// atempo, i.e. fast-forwarding the narration, which sounds exactly as bad as
// it reads and is what this module exists to prevent.
//
// The script writer is already TOLD the word budget (generate-video-script.ts).
// This is the structural half of the repo's usual instructed-and-verified pair:
// the caller synthesizes, MEASURES the real WAV, and only calls this when the
// measurement says the line actually overran — so it corrects the model's pace
// mistakes rather than trusting a chars-per-second estimate.
//
// The guardrail that stays ABSOLUTE is the never-invent rule: no new name,
// date, amount, designation, scheme or place, and anything retained is retained
// verbatim — no truncated scheme name, no rounded figure, no re-scripted digit.
//
// What is deliberately NOT absolute is total coverage. Per the tiered-
// completeness principle in AGENTS.md, a scene may DROP secondary detail to fit:
// the deliverable is a clear video, not a recitation of the note, and a hurried
// clip crammed with every figure is a worse product than a calm one carrying the
// point plus the details a citizen can act on. So the prompt below ranks what to
// keep (core point → citizen-actionable detail → everything else) and says
// plainly that omitting a fact beats stating it vaguely or by half.

import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import {
  DEFAULT_NARRATION_CHARS_PER_SECOND,
  VIDEO_SCENE_REWRITE_TARGET_SECONDS,
} from '@dgipr/schemas';
import { chatComplete, VIDEO_CHAT_MODEL } from '../generation/openai-chat.js';

// Deliberately NOT capped at VIDEO_NARRATION_MAX_CHARS. This step is a
// best-effort improvement, not a gate: a line cut from 195 chars to 150 is a
// large win even though it has not yet reached the ceiling, and the caller
// re-measures and can come round again. Capping here threw that away and
// returned null, leaving the ORIGINAL over-long line in place — the opposite of
// the intent. The real requirement ("strictly shorter than what we had") is
// checked deterministically below, where it belongs.
const ResultSchema = z.object({
  narration: z.string().trim().min(1),
});

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

export type ShortenNarrationOptions = Readonly<{
  // What the voice actually took, measured from the synthesized WAV.
  measuredSeconds: number;
  // What it has to come in under.
  targetSeconds: number;
  // The scene's beat, when known: the one thing that must still be conveyed
  // after cutting, so the model trims wording rather than information.
  beat?: string | undefined;
}>;

// Returns a shorter narration, or null when the model could not produce a valid
// one. Null is not a failure the caller should treat as fatal — keeping the
// slightly-long line is strictly better than losing the scene, and the mux still
// has its atempo backstop.
export async function shortenNarration(
  narration: string,
  options: ShortenNarrationOptions,
): Promise<string | null> {
  const current = narration.trim();
  if (current === '') return null;

  // Cut proportionally to the overrun, with a little extra so one round is
  // usually enough — measured seconds map to characters far more reliably
  // within a single line than any global chars/second constant does. The
  // absolute cap SCALES with the caller's target: a 14s ceiling and a frozen
  // legacy 7.5s window are both legitimate asks, and a fixed cap would have
  // over-cut the first.
  const ratio = options.targetSeconds / Math.max(options.measuredSeconds, 0.1);
  const targetChars = Math.max(
    20,
    Math.min(
      Math.floor(options.targetSeconds * DEFAULT_NARRATION_CHARS_PER_SECOND),
      Math.floor(current.length * ratio * 0.96),
    ),
  );

  try {
    const raw = await chatComplete(
      [
        {
          role: 'system',
          content: [
            'तुम्ही मराठी explainer व्हिडिओच्या निवेदनाचे (voiceover) संपादक आहात.',
            'दिलेले निवेदन त्याच्या दृश्याच्या वेळेत बसत नाही — ते लहान करा.',
            '',
            'कठोर नियम:',
            '1. नवीन माहिती जोडू नका — नवीन नावे, तारखा, रक्कम, पदनामे, योजना, ठिकाणे',
            '   किंवा आकडे तयार करणे पूर्णपणे निषिद्ध आहे.',
            '2. जे ठेवाल ते जशाच्या तसे ठेवा: नावे, तारखा, रक्कम, आकडे व योजनांची नावे',
            '   अर्धवट लिहू नका, त्यांचे संक्षेप करू नका, अंकांची लिपी वा किंमत बदलू नका.',
            '3. सर्वच तपशील ठेवण्याचा अट्टहास करू नका — निवेदन दृश्यात बसणे महत्त्वाचे आहे.',
            '   प्राधान्यक्रम: (अ) दृश्याचा मुख्य मुद्दा, (ब) नागरिकाला थेट उपयोगी तपशील —',
            '   फायदा, पात्रता, मुदत, दर, कुठे जायचे, (क) उरलेला तपशील.',
            '   आधी पुनरुक्ती, विशेषणे व पाल्हाळ गाळा. तरीही लांब असेल तर (क) गटातील तपशील',
            '   सरळ वगळा — लांबलचक याद्या, दुय्यम आकडे, प्रशासकीय तपशील.',
            '   एखादे तथ्य अर्धवट किंवा मोघम लिहिण्यापेक्षा ते पूर्णपणे वगळणे चांगले.',
            '4. भाषा शासकीय, नागरिकाभिमुख व संयत ठेवा; मराठी देवनागरीतच लिहा.',
            '5. एकच वाक्यसमूह परत करा — शीर्षक, यादी किंवा स्पष्टीकरण नको.',
            '',
            'फक्त वैध JSON object परत करा: { "narration": "..." }',
          ].join('\n'),
        },
        {
          role: 'user',
          content: [
            '<CURRENT_NARRATION>',
            current,
            '</CURRENT_NARRATION>',
            '',
            ...(options.beat
              ? ['<BEAT purpose="information_that_must_survive">', options.beat, '</BEAT>', '']
              : []),
            '<LENGTH>',
            `सध्याचे निवेदन बोलण्यास ${options.measuredSeconds.toFixed(1)} सेकंद लागतात;`,
            `ते ${options.targetSeconds.toFixed(1)} सेकंदांच्या आत आले पाहिजे.`,
            `म्हणजे सुमारे ${targetChars} अक्षरांपर्यंत (सध्या ${current.length}).`,
            '</LENGTH>',
            '',
            '<TASK>',
            'वरील निवेदन लहान करून वैध JSON object परत करा.',
            '</TASK>',
          ].join('\n'),
        },
      ],
      {
        model: VIDEO_CHAT_MODEL,
        temperature: 0,
        responseFormat: 'json_object',
      },
    );

    const parsed = ResultSchema.safeParse(parseJson(raw));
    if (!parsed.success) {
      console.warn(
        '[video-narration] shorten returned an unusable shape (keeping the line).',
      );
      return null;
    }
    const shortened = parsed.data.narration.trim();
    // The one hard rule, checked here rather than in the schema: only ever
    // accept a genuine shortening. A "repair" that came back the same length or
    // longer would send the caller round the loop again for nothing.
    if (shortened === '' || shortened.length >= current.length) {
      console.warn(
        `[video-narration] shorten produced no reduction ` +
          `(${current.length} → ${shortened.length} chars); keeping the line.`,
      );
      return null;
    }
    return shortened;
  } catch (error) {
    console.warn('[video-narration] shorten failed (keeping the line):', error);
    return null;
  }
}

// Free-ish harness (one small chat call, no TTS/video spend):
//
//   tsx --env-file=../../.env src/video/shorten-narration.ts "<मराठी निवेदन>" [measuredSeconds] [targetSeconds]
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const text = process.argv[2];
  const measured = Number(process.argv[3] ?? '18');
  // Defaults to the scene-ceiling rewrite target the storyboard job uses.
  const target = Number(process.argv[4] ?? String(VIDEO_SCENE_REWRITE_TARGET_SECONDS));
  if (!text) {
    console.error(
      'Usage: tsx --env-file=../../.env src/video/shorten-narration.ts "<मराठी निवेदन>" [measuredSeconds] [targetSeconds]',
    );
    process.exit(1);
  }
  void (async () => {
    const result = await shortenNarration(text, {
      measuredSeconds: Number.isFinite(measured) ? measured : 18,
      targetSeconds: Number.isFinite(target)
        ? target
        : VIDEO_SCENE_REWRITE_TARGET_SECONDS,
    });
    console.log(`before (${text.length} chars): ${text}`);
    console.log(
      result === null
        ? 'after: <no valid shortening returned>'
        : `after  (${result.length} chars): ${result}`,
    );
  })().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
