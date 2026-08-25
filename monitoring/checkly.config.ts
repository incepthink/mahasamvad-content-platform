import { defineConfig } from 'checkly';
import { Frequency } from 'checkly/constructs';

export default defineConfig({
  projectName: 'DGIPR production monitoring',
  logicalId: 'dgipr-production-monitoring',
  checks: {
    playwrightConfigPath: './playwright.config.ts',
    playwrightChecks: [
      {
        name: 'Production - Marathi OCR journey',
        logicalId: 'production-marathi-ocr-journey',
        description:
          'Uploads an image-only Marathi PDF, runs the real OCR path, and verifies meaningful structured output.',
        pwTags: ['@ocr'],
        pwProjects: ['chromium'],
        frequency: Frequency.EVERY_24H,
        locations: ['ap-southeast-1'],
        tags: ['production', 'ocr', 'sarvam'],
        // The Checkly CLI is needed only to deploy this project, not by every paid run.
        installCommand: 'npm install --ignore-scripts --omit=dev',
        include: ['fixtures/ocr-test.pdf'],
      },
    ],
  },
});
