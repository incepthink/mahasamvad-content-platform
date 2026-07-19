// Shared Sarvam SDK client for the DLO intake pipeline (batch speech-to-text +
// document digitization). Unlike the chat path (sarvam-chat.ts, one OpenAI-
// compatible POST kept SDK-free on purpose), the intake flows are multi-step
// jobs — create → presigned uploads → start → poll → presigned downloads — so
// the official SDK is worth the dependency here. Same key as the chat path.

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
