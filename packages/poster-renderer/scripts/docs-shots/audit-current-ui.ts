// Read-only visual/text inventory of the current web UI. This is deliberately
// separate from the published screenshot phases: it helps documentation work
// discover changed routes before deciding which focused screenshots belong in
// the user guide.

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { REPO_ROOT, WEB_URL } from './config.js';

const outputDir = path.join(REPO_ROOT, '.tmp', 'docs-audit');
const statePath = path.join(import.meta.dirname, '.state.json');

const state = fs.existsSync(statePath)
  ? (JSON.parse(fs.readFileSync(statePath, 'utf8')) as {
      articleId?: string;
      twitterId?: string;
    })
  : {};

const routes = [
  '/',
  '/dlo',
  '/transcribe',
  '/translate',
  '/proofread',
  '/glossary',
  '/references',
  '/video',
  '/generations',
  '/analytics',
  ...(state.articleId ? [`/generations/${state.articleId}`] : []),
  ...(state.twitterId ? [`/generations/${state.twitterId}`] : []),
];

fs.mkdirSync(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    locale: 'mr-IN',
    timezoneId: 'Asia/Kolkata',
  });
  const page = await context.newPage();

  for (const route of routes) {
    const errors: string[] = [];
    const onPageError = (error: Error) => errors.push(error.message);
    page.on('pageerror', onPageError);

    const response = await page.goto(`${WEB_URL}${route}`, {
      // Most pages poll while work is active, so `networkidle` is not a stable
      // readiness signal. The body plus a short UI-settle delay is.
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    await page.locator('body').waitFor({ state: 'visible', timeout: 30_000 });
    await page.waitForTimeout(750);

    const key =
      route === '/'
        ? 'home'
        : route
            .slice(1)
            .replaceAll('/', '--')
            .replaceAll(/[^a-zA-Z0-9-]/g, '-');
    const text = (await page.locator('body').innerText()).trim();
    fs.writeFileSync(path.join(outputDir, `${key}.txt`), text, 'utf8');
    await page.screenshot({
      path: path.join(outputDir, `${key}.png`),
      fullPage: true,
      animations: 'disabled',
    });

    console.log(
      `${route} -> ${response?.status() ?? 'no response'} | ${text.length} chars | ${errors.length} page errors`,
    );
    for (const error of errors) console.log(`  ! ${error}`);
    page.off('pageerror', onPageError);
  }
} finally {
  await browser.close();
}

console.log(`Audit saved to ${outputDir}`);
