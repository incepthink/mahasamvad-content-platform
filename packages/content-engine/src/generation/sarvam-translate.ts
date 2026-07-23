// Sarvam's dedicated text-translation endpoint (sarvam-translate), used for the
// Marathi→Hindi path.
//
// Why this exists instead of reusing sarvam-chat.ts: the CHAT model cannot translate
// Marathi to Hindi at all. Asked to, it hands the Marathi text back unchanged and
// asserts that the result is Hindi — verified against sarvam-30b with three different
// prompts (bare, Hindi-only system prompt, and an explicit "these are different
// languages" framing). Because both languages use Devanagari, that failure is invisible
// to anything but a real check, which is why the callers keep one anyway
// (isUntranslated in translate-article.ts). The purpose-built endpoint translates
// correctly, so Hindi goes through here while English stays on the chat path with its
// LOCKED TERMS prompt (this endpoint takes no prompt, hence no glossary parameter —
// name fidelity is enforced afterwards, in translate-article.ts).
//
// Same conventions as sarvam-chat.ts: plain fetch (no SDK), env-overridable URL/model.

const SARVAM_TRANSLATE_URL =
  process.env.SARVAM_TRANSLATE_URL ?? 'https://api.sarvam.ai/translate';

export const SARVAM_TRANSLATE_MODEL =
  process.env.SARVAM_TRANSLATE_MODEL ?? 'sarvam-translate:v1';

// The API rejects input beyond 2000 characters; callers chunk to this smaller budget so
// a block that lands slightly over its target never trips the hard cap.
export const SARVAM_TRANSLATE_MAX_INPUT_CHARS = 1800;

type TranslateResponse = {
  translated_text?: string | null;
  error?: unknown;
};

function requireSarvamApiKey(): string {
  const key = process.env.SARVAM_API_KEY;
  if (!key) {
    throw new Error(
      'Missing required environment variable SARVAM_API_KEY. ' +
        'Copy .env.example to .env and fill it in (needed for translation).',
    );
  }
  return key;
}

// Translate one chunk of text between two Sarvam language codes (e.g. 'mr-IN' → 'hi-IN').
//
// numeralsFormat defaults to 'native': the source articles write figures in Devanagari
// digits (५००, २ कोटी) and the API's 'international' default silently rewrites them as
// 500 / 2, which reads wrong beside Marathi originals. The value is preserved either way
// — this is about script, not arithmetic.
export async function sarvamTranslate(
  input: string,
  options: Readonly<{
    sourceLanguageCode: string;
    targetLanguageCode: string;
    mode?: string;
    numeralsFormat?: 'native' | 'international';
    model?: string;
  }>,
): Promise<string> {
  const apiKey = requireSarvamApiKey();
  const response = await fetch(SARVAM_TRANSLATE_URL, {
    method: 'POST',
    headers: {
      'api-subscription-key': apiKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      input,
      source_language_code: options.sourceLanguageCode,
      target_language_code: options.targetLanguageCode,
      model: options.model ?? SARVAM_TRANSLATE_MODEL,
      // 'formal' matches the official register of DGIPR press material.
      mode: options.mode ?? 'formal',
      numerals_format: options.numeralsFormat ?? 'native',
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `Sarvam translate request failed: ${response.status} ${response.statusText} — ${detail}`,
    );
  }

  const raw = await response.text();

  let body: TranslateResponse;
  try {
    body = JSON.parse(raw) as TranslateResponse;
  } catch {
    console.error('[sarvam] translate response was not valid JSON:', {
      status: response.status,
      body: raw.slice(0, 2000),
    });
    throw new Error(
      `Sarvam translate response was not valid JSON (status ${response.status}).`,
    );
  }

  const translated = body.translated_text?.trim() ?? '';
  if (!translated) {
    console.error('[sarvam] translate response contained no text:', {
      status: response.status,
      error: body.error,
      body: raw.slice(0, 2000),
    });
    throw new Error(
      `Sarvam translate response contained no text (status ${response.status}). ` +
        'See the [sarvam] log above for the raw response body.',
    );
  }
  return translated;
}
