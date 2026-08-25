import { defineConfig, devices } from '@playwright/test';

const MINUTE = 60_000;

export default defineConfig({
  testDir: './tests',
  timeout: 15 * MINUTE,
  globalTimeout: 20 * MINUTE,
  expect: {
    timeout: 30_000,
  },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  maxFailures: 1,
  use: {
    baseURL: process.env.OCR_BASE_URL ?? 'https://dgipr.hashcase.tech',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
