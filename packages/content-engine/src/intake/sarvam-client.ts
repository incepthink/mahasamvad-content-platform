// Shared Sarvam key + legacy SDK client for batch speech-to-text and narration. Document
// OCR now calls the newer /doc-ai/v1 Digitise REST contract directly (sarvam-doc.ts), because
// the published JavaScript package still exposes the legacy documentIntelligence group.
// Same key as the chat and translation paths.

import { SarvamAIClient } from 'sarvamai';

export function requireSarvamApiKey(): string {
  const key = process.env.SARVAM_API_KEY;
  if (!key) {
    throw new Error(
      'Missing required environment variable SARVAM_API_KEY. ' +
        'Copy .env.example to .env and fill it in (needed for the DLO intake flow).',
    );
  }
  return key;
}

export function createSarvamClient(): SarvamAIClient {
  return new SarvamAIClient({ apiSubscriptionKey: requireSarvamApiKey() });
}
