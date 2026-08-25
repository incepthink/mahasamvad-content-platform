import { expect, test, type APIRequestContext } from '@playwright/test';

const OPENAI_MODEL = 'gpt-5.6';
const SARVAM_TRANSLATE_MODEL =
  process.env.SARVAM_TRANSLATE_MODEL?.trim() || 'sarvam-translate:v1';
const SARVAM_DOCUMENT_API = 'https://api.sarvam.ai/doc-ai/v1/job';
const ELEVENLABS_API = (
  process.env.ELEVENLABS_BASE_URL?.trim() || 'https://api.elevenlabs.io'
).replace(/\/+$/, '');

const TERMINAL_DOCUMENT_STATUSES = new Set([
  'completed',
  'partially_completed',
  'failed',
  'rejected',
]);

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  expect(
    value,
    `${name} must be configured as a Checkly secret (or a local environment variable).`,
  ).toBeTruthy();
  return value!;
}

async function jsonResponse<T>(
  response: Awaited<ReturnType<APIRequestContext['fetch']>>,
  label: string,
): Promise<T> {
  const raw = await response.text();
  expect(
    response.ok(),
    `${label} returned HTTP ${response.status()}: ${raw.slice(0, 1_000)}`,
  ).toBeTruthy();
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(
      `${label} returned invalid JSON (HTTP ${response.status()}): ${raw.slice(0, 1_000)}`,
    );
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

// A valid one-page PDF with one short vector-text line. The separate browser OCR
// journey owns Marathi scan-quality coverage; this fixture exists only to make the
// direct Document AI canary the smallest possible one-page job.
function minimalCanaryPdf(): Buffer {
  const content = 'BT /F1 18 Tf 24 48 Td (DGIPR CANARY 7429) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 260 90] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(content, 'ascii')} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf, 'ascii'));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf, 'ascii');
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  pdf += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  pdf += `startxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, 'ascii');
}

test('OpenAI GPT-5.6 Responses API @canary', async ({ request }) => {
  const response = await request.post('https://api.openai.com/v1/responses', {
    headers: {
      authorization: `Bearer ${requiredEnv('OPENAI_API_KEY')}`,
      'content-type': 'application/json',
    },
    data: {
      model: OPENAI_MODEL,
      input: 'Reply exactly OK.',
      reasoning: { effort: 'none' },
      text: { verbosity: 'low' },
      max_output_tokens: 16,
      store: false,
    },
    timeout: 60_000,
  });
  const body = await jsonResponse<{
    id?: unknown;
    model?: unknown;
    status?: unknown;
    output_text?: unknown;
    output?: Array<{
      content?: Array<{ type?: unknown; text?: unknown }>;
    }>;
  }>(response, 'OpenAI Responses API');

  const outputText =
    typeof body.output_text === 'string'
      ? body.output_text
      : (body.output ?? [])
          .flatMap((item) => item.content ?? [])
          .filter((item) => item.type === 'output_text')
          .map((item) => (typeof item.text === 'string' ? item.text : ''))
          .join('');

  expect(body.id).toEqual(expect.stringMatching(/^resp_/));
  expect(body.status).toBe('completed');
  expect(body.model).toEqual(expect.stringMatching(/^gpt-5\.6/));
  expect(outputText.trim()).not.toBe('');
});

test('Sarvam text translation @canary', async ({ request }) => {
  const input = 'मी ठीक आहे.';
  const response = await request.post(
    process.env.SARVAM_TRANSLATE_URL ?? 'https://api.sarvam.ai/translate',
    {
      headers: {
        'api-subscription-key': requiredEnv('SARVAM_API_KEY'),
        'content-type': 'application/json',
      },
      data: {
        input,
        source_language_code: 'mr-IN',
        target_language_code: 'hi-IN',
        model: SARVAM_TRANSLATE_MODEL,
        mode: 'formal',
        numerals_format: 'native',
      },
      timeout: 60_000,
    },
  );
  const body = await jsonResponse<{ translated_text?: unknown }>(
    response,
    'Sarvam Translate API',
  );

  expect(typeof body.translated_text).toBe('string');
  expect((body.translated_text as string).trim()).not.toBe('');
  expect((body.translated_text as string).normalize('NFC')).not.toBe(
    input.normalize('NFC'),
  );
});

test('Sarvam one-page Document AI digitise @canary', async ({ request }) => {
  const apiKey = requiredEnv('SARVAM_API_KEY');
  const headers = { 'api-subscription-key': apiKey };
  const createdResponse = await request.post(
    `${SARVAM_DOCUMENT_API}/digitise`,
    {
      headers,
      multipart: {
        file: {
          name: 'dgipr-canary.pdf',
          mimeType: 'application/pdf',
          buffer: minimalCanaryPdf(),
        },
        output_format: 'html',
        content_type: 'printed',
      },
      timeout: 60_000,
    },
  );
  const created = await jsonResponse<{ job_id?: unknown }>(
    createdResponse,
    'Sarvam Document AI digitise',
  );
  expect(created.job_id).toEqual(expect.any(String));
  const jobId = created.job_id as string;

  const deadline = Date.now() + 5 * 60_000;
  let state = '';
  let status: {
    status?: unknown;
    usage?: { pages_succeeded?: unknown; pages_failed?: unknown };
  } = {};
  while (Date.now() < deadline) {
    const statusResponse = await request.get(
      `${SARVAM_DOCUMENT_API}/${encodeURIComponent(jobId)}/status`,
      { headers, timeout: 30_000 },
    );
    status = await jsonResponse<typeof status>(
      statusResponse,
      'Sarvam Document AI status',
    );
    state =
      typeof status.status === 'string' ? status.status.toLowerCase() : '';
    if (TERMINAL_DOCUMENT_STATUSES.has(state)) break;
    await delay(5_000);
  }

  expect(state, `Sarvam job ${jobId} did not complete successfully.`).toBe(
    'completed',
  );
  if (typeof status.usage?.pages_succeeded === 'number') {
    expect(status.usage.pages_succeeded).toBeGreaterThanOrEqual(1);
  }
  if (typeof status.usage?.pages_failed === 'number') {
    expect(status.usage.pages_failed).toBe(0);
  }

  const targetResponse = await request.get(
    `${SARVAM_DOCUMENT_API}/${encodeURIComponent(jobId)}/download-url`,
    { headers, timeout: 30_000 },
  );
  const target = await jsonResponse<{
    method?: unknown;
    url?: unknown;
    headers?: unknown;
  }>(targetResponse, 'Sarvam Document AI download URL');
  expect(target.url).toEqual(expect.any(String));

  const downloadHeaders =
    target.headers && typeof target.headers === 'object'
      ? Object.fromEntries(
          Object.entries(target.headers).filter(
            (entry): entry is [string, string] => typeof entry[1] === 'string',
          ),
        )
      : undefined;
  const artifactResponse = await request.fetch(target.url as string, {
    method: typeof target.method === 'string' ? target.method : 'GET',
    ...(downloadHeaders ? { headers: downloadHeaders } : {}),
    timeout: 60_000,
  });
  expect(
    artifactResponse.ok(),
    `Sarvam Document AI artifact returned HTTP ${artifactResponse.status()}.`,
  ).toBeTruthy();
  expect((await artifactResponse.body()).length).toBeGreaterThan(100);
});

test('ElevenLabs TTS to speech-to-text round trip @canary', async ({
  request,
}) => {
  const apiKey = requiredEnv('ELEVENLABS_API_KEY');
  const voiceId = requiredEnv('ELEVENLABS_VOICE_ID');
  const ttsResponse = await request.post(
    `${ELEVENLABS_API}/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_22050_32`,
    {
      headers: {
        'xi-api-key': apiKey,
        'content-type': 'application/json',
        accept: 'audio/mpeg',
      },
      data: {
        text: 'नमस्कार.',
        model_id: process.env.ELEVENLABS_MODEL?.trim() || 'eleven_v3',
        ...(process.env.ELEVENLABS_LANGUAGE_CODE?.trim()
          ? { language_code: process.env.ELEVENLABS_LANGUAGE_CODE.trim() }
          : {}),
      },
      timeout: 120_000,
    },
  );
  const ttsDetail = ttsResponse.ok()
    ? ''
    : (await ttsResponse.text()).slice(0, 1_000);
  expect(
    ttsResponse.ok(),
    `ElevenLabs TTS returned HTTP ${ttsResponse.status()}: ${ttsDetail}`,
  ).toBeTruthy();
  const speech = await ttsResponse.body();
  expect(speech.length).toBeGreaterThan(100);

  const sttResponse = await request.post(
    `${ELEVENLABS_API}/v1/speech-to-text`,
    {
      headers: { 'xi-api-key': apiKey },
      multipart: {
        file: {
          name: 'dgipr-canary.mp3',
          mimeType: 'audio/mpeg',
          buffer: speech,
        },
        model_id: process.env.ELEVENLABS_STT_MODEL?.trim() || 'scribe_v1',
        language_code: process.env.ELEVENLABS_STT_LANGUAGE?.trim() || 'mar',
        diarize: 'false',
        tag_audio_events: 'false',
      },
      timeout: 120_000,
    },
  );
  const transcript = await jsonResponse<{
    language_code?: unknown;
    text?: unknown;
  }>(sttResponse, 'ElevenLabs Speech-to-Text API');

  expect(typeof transcript.text).toBe('string');
  expect((transcript.text as string).trim()).not.toBe('');
});
