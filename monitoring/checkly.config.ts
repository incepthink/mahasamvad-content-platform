import { defineConfig } from 'checkly';
import { Frequency } from 'checkly/constructs';

export default defineConfig({
  projectName: 'DGIPR production monitoring',
  logicalId: 'dgipr-production-monitoring',
  checks: {
    playwrightConfigPath: './playwright.config.ts',
    include: ['fixtures/ocr-test.pdf'],
    playwrightChecks: [
      {
        name: 'Production - Marathi OCR journey',
        logicalId: 'production-marathi-ocr-journey',
        pwTags: ['@ocr'],
        pwProjects: ['chromium'],
        frequency: Frequency.EVERY_24H,
        locations: ['ap-southeast-1'],
        tags: ['production', 'ocr', 'sarvam'],
        // The Checkly CLI is needed only to deploy this project, not by every paid run.
        installCommand: 'npm install --ignore-scripts --omit=dev',
      },
      {
        name: 'Production - External provider API canaries',
        logicalId: 'production-external-provider-api-canaries',
        pwTags: ['@canary'],
        pwProjects: ['chromium'],
        frequency: Frequency.EVERY_24H,
        locations: ['ap-southeast-1'],
        tags: ['production', 'canary', 'openai', 'sarvam', 'elevenlabs'],
        installCommand: 'npm install --ignore-scripts --omit=dev',
      },
    ],
  },
});
