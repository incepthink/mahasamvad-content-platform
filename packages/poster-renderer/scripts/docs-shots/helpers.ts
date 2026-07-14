// Toolkit shared by every docs-shots phase: browser/context setup tuned for crisp
// Devanagari captures, idempotent screenshot writing, fold/modal helpers, and a
// generation poller that fires a callback on every status/step change. The web UI
// has no test ids, so elements are located by semantic class + visible Marathi text
// (the exact literals from apps/web/lib/strings.ts).

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import type { Browser, BrowserContext, Locator, Page } from 'playwright';
import {
  API_URL,
  DESKTOP_VIEWPORT,
  FORCE,
  MOBILE_VIEWPORT,
  NOTE_FIXTURE_PATH,
  OUT_DIR,
  STATE_PATH,
  WEB_URL,
} from './config.js';

// ---------- browser ----------

export async function launchBrowser(): Promise<Browser> {
  return chromium.launch();
}

export async function newDocsContext(
  browser: Browser,
  opts: { mobile?: boolean; dpr?: number } = {},
): Promise<BrowserContext> {
  const context = await browser.newContext({
    viewport: opts.mobile ? MOBILE_VIEWPORT : DESKTOP_VIEWPORT,
    // DPR 2 = crisp Devanagari. Image-heavy fullPage captures need dpr: 1 —
    // at DPR 2 headless Chromium blanks some decoded images while stitching.
    deviceScaleFactor: opts.dpr ?? 2,
    locale: 'mr-IN',
    timezoneId: 'Asia/Kolkata',
  });
  return context;
}

export async function gotoPage(page: Page, route: string): Promise<void> {
  await page.goto(`${WEB_URL}${route}`, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
}

// Fonts must be loaded before any capture, or Devanagari renders in a fallback face.
export async function waitReady(page: Page, settleMs = 600): Promise<void> {
  await page.evaluate(() => (document as { fonts: { ready: Promise<unknown> } }).fonts.ready);
  await page.waitForTimeout(settleMs);
}

// Wait until every <img> currently in the DOM has finished loading (or errored).
export async function waitForImages(page: Page, timeoutMs = 20000): Promise<void> {
  await page
    .waitForFunction(
      () =>
        [...document.querySelectorAll('img')].every(
          (img) => img.complete && img.naturalWidth > 0,
        ),
      undefined,
      { timeout: timeoutMs },
    )
    .catch(() => undefined); // a broken image must not sink the whole capture
}

// Scroll through the whole page once so lazy images decode before a fullPage shot.
export async function autoScroll(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      let total = 0;
      const timer = setInterval(() => {
        window.scrollBy(0, 600);
        total += 600;
        if (total >= document.body.scrollHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 120);
    });
  });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(600);
}

// ---------- screenshots ----------

export function shotPath(name: string): string {
  return path.join(OUT_DIR, `${name}.png`);
}

export function haveShot(name: string): boolean {
  return !FORCE && fs.existsSync(shotPath(name));
}

function isPage(target: Page | Locator): target is Page {
  return 'goto' in target;
}

// The Next.js dev-tools indicator ("N" bubble) is a dev-only artifact end users
// never see. Hiding it must happen AFTER hydration (React strips styles injected
// earlier) and by stylesheet (the overlay re-writes its host's inline style), so
// it is (re-)injected right before every capture.
async function hideDevIndicator(page: Page): Promise<void> {
  await page.evaluate(() => {
    if (document.getElementById('docs-shots-hide')) return;
    const style = document.createElement('style');
    style.id = 'docs-shots-hide';
    style.textContent = 'nextjs-portal { display: none !important; }';
    document.head.appendChild(style);
  });
}

// Idempotent: existing files are kept unless --force, so a re-run only fills gaps.
export async function shoot(
  target: Page | Locator,
  name: string,
  opts: { fullPage?: boolean } = {},
): Promise<void> {
  if (haveShot(name)) {
    console.log(`  = ${name} (exists, skipped)`);
    return;
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  await hideDevIndicator(isPage(target) ? target : target.page());
  if (isPage(target)) {
    await target.screenshot({
      path: shotPath(name),
      fullPage: opts.fullPage ?? false,
    });
  } else {
    await target.scrollIntoViewIfNeeded();
    await target.page().waitForTimeout(250);
    await target.screenshot({ path: shotPath(name) });
  }
  console.log(`  + ${name}`);
}

// ---------- locating UI by visible Marathi text ----------

// Cards are located by their visible heading/label text (no test ids in the app).
export function cardByText(page: Page, text: string): Locator {
  return page.locator('section.card, div.card').filter({ hasText: text }).first();
}

// Opens a <details class="fold"> by its summary text; returns the fold locator.
export async function openFold(
  scope: Page | Locator,
  summaryText: string,
): Promise<Locator> {
  const page = isPage(scope) ? scope : scope.page();
  const fold = scope
    .locator('details.fold')
    .filter({ has: page.locator('summary', { hasText: summaryText }) })
    .first();
  await fold.scrollIntoViewIfNeeded();
  const open = await fold.evaluate((el) => (el as HTMLDetailsElement).open);
  if (!open) {
    await fold.locator('summary').first().click();
    await page.waitForTimeout(350);
  }
  return fold;
}

export async function closeFold(fold: Locator): Promise<void> {
  const open = await fold.evaluate((el) => (el as HTMLDetailsElement).open);
  if (open) {
    await fold.locator('summary').first().click();
    await fold.page().waitForTimeout(200);
  }
}

export async function openTasksModal(page: Page): Promise<Locator> {
  const modal = page.locator('.tasks-modal');
  if (!(await modal.isVisible().catch(() => false))) {
    await page.locator('.tasks-button').click();
    await modal.waitFor({ state: 'visible', timeout: 10000 });
    await page.waitForTimeout(400);
  }
  return modal;
}

export async function closeTasksModal(page: Page): Promise<void> {
  if (await page.locator('.tasks-modal').isVisible().catch(() => false)) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
  }
}

// ---------- API polling ----------

export type GenerationApiDetail = {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  step: string | null;
  category: string;
  article?: string | null;
  articleEnglish?: string | null;
  posterUrl?: string | null;
  sceneUrl?: string | null;
  translating?: boolean;
  translateError?: string | null;
  error?: string | null;
};

export async function apiGet<T>(route: string): Promise<T> {
  const res = await fetch(`${API_URL}${route}`);
  if (!res.ok) throw new Error(`GET ${route} -> HTTP ${res.status}`);
  return (await res.json()) as T;
}

export async function getGenerationDetail(
  id: string,
): Promise<GenerationApiDetail> {
  return apiGet<GenerationApiDetail>(`/api/generations/${id}`);
}

export function isTerminal(detail: GenerationApiDetail): boolean {
  return detail.status === 'completed' || detail.status === 'failed';
}

// Polls the API every `intervalMs`, invoking `onChange` whenever status/step (or
// article/poster presence) changes. Stops when `until` is satisfied — or, if no
// `until` is given, when the run reaches a terminal status.
export async function pollGeneration(
  id: string,
  opts: {
    onChange?: (
      detail: GenerationApiDetail,
      prev: GenerationApiDetail | null,
    ) => Promise<void>;
    until?: (detail: GenerationApiDetail) => boolean;
    timeoutMs?: number;
    intervalMs?: number;
  } = {},
): Promise<GenerationApiDetail> {
  const timeoutMs = opts.timeoutMs ?? 40 * 60 * 1000;
  const intervalMs = opts.intervalMs ?? 1500;
  const deadline = Date.now() + timeoutMs;
  let prev: GenerationApiDetail | null = null;
  for (;;) {
    const detail = await getGenerationDetail(id);
    const changed =
      !prev ||
      prev.status !== detail.status ||
      prev.step !== detail.step ||
      Boolean(prev.article) !== Boolean(detail.article) ||
      Boolean(prev.posterUrl) !== Boolean(detail.posterUrl);
    if (changed && opts.onChange) await opts.onChange(detail, prev);
    prev = detail;
    if (opts.until ? opts.until(detail) : isTerminal(detail)) return detail;
    if (Date.now() > deadline) {
      throw new Error(
        `Timed out waiting on generation ${id} (last: ${detail.status} / ${detail.step ?? '-'})`,
      );
    }
    await sleep(intervalMs);
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------- run state + fixture ----------

export type ShotsState = {
  articleId?: string;
  twitterId?: string;
  rerunId?: string;
};

export function readState(): ShotsState {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')) as ShotsState;
  } catch {
    return {};
  }
}

export function writeState(patch: Partial<ShotsState>): void {
  fs.writeFileSync(STATE_PATH, JSON.stringify({ ...readState(), ...patch }, null, 2));
}

export function readNoteFixture(): string {
  return fs.readFileSync(NOTE_FIXTURE_PATH, 'utf8').trim();
}
