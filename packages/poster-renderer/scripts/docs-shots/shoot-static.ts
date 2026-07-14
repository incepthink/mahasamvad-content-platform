// Static screenshot pass: every state capturable without triggering a generation.
// Safe to re-run — existing files are skipped unless --force. The one network
// call it makes is a single synchronous /api/translate demo (skipped once its
// result shot exists). Nothing here writes data: forms are filled but not
// submitted (except the deliberate short-note validation error).

import type { Browser, Page } from 'playwright';
import {
  autoScroll,
  cardByText,
  closeTasksModal,
  gotoPage,
  haveShot,
  launchBrowser,
  newDocsContext,
  openTasksModal,
  readNoteFixture,
  shoot,
  waitForImages,
  waitReady,
} from './helpers.js';

async function homeShots(page: Page): Promise<void> {
  await gotoPage(page, '/');
  await shoot(page, '01-intro--home', { fullPage: true });
  await shoot(page.locator('header').first(), '02-nav--header');

  // Empty tasks modal — nothing is tracked in a fresh session.
  await openTasksModal(page);
  await shoot(page, '02-nav--tasks-empty');
  await closeTasksModal(page);

  await shoot(cardByText(page, 'टिपणी येथे लिहा'), '03-create--note-card');
  await shoot(cardByText(page, 'शीर्षक किंवा लेखाचा रोख'), '03-create--heading-card');
  await shoot(cardByText(page, 'लेखाचा प्रकार?'), '03-create--categories');
  await shoot(cardByText(page, 'काय तयार करायचे?'), '03-create--output-types');

  // Reference picker for the article library (default: योजना-लेख + दोन्ही).
  const picker = page.locator('.ref-picker').first();
  await shoot(picker, '03-create--refpicker-auto');
  await picker.locator('.output-option', { hasText: 'स्वतः निवडा' }).click();
  await picker
    .locator('.ref-picker-grid, .info-callout, .form-error')
    .first()
    .waitFor({ timeout: 30000 });
  await waitReady(page, 1200);
  await shoot(picker, '03-create--refpicker-manual');
  const thumb = picker.locator('.ref-picker-thumb').first();
  if ((await thumb.count()) > 0) {
    await thumb.click();
    await page.waitForTimeout(500);
    await shoot(picker, '03-create--refpicker-pinned-image');
  }

  // Twitter flow: the 4th card flips to design modes and the picker to the
  // twitter library (grouped by type, with the whole-type checkbox).
  await page
    .locator('.output-option', { hasText: 'ट्विटर पोस्ट' })
    .first()
    .click();
  await page.waitForTimeout(500);
  await shoot(page, '06-twitter--form', { fullPage: true });
  await shoot(cardByText(page, 'पोस्टरची रचना-शैली?'), '06-twitter--design-modes');

  const twPicker = page.locator('.ref-picker').first();
  await twPicker.locator('.output-option', { hasText: 'स्वतः निवडा' }).click();
  await twPicker
    .locator('.ref-picker-group, .info-callout, .form-error')
    .first()
    .waitFor({ timeout: 30000 });
  await waitReady(page, 1500);
  await shoot(twPicker, '06-twitter--refpicker-groups');
  const typeCheck = twPicker.locator('.ref-picker-check input').first();
  if ((await typeCheck.count()) > 0) {
    await typeCheck.check();
    await page.waitForTimeout(500);
    await shoot(twPicker, '03-create--refpicker-pinned-type');
  }

  // Validation error for a too-short note (fresh form via reload).
  if (!haveShot('03-create--error-short-note')) {
    await gotoPage(page, '/');
    await page.fill('#note', 'चाचणी');
    await page.getByRole('button', { name: 'तयार करा →' }).click();
    await page.locator('.form-error').waitFor({ timeout: 5000 });
    await shoot(cardByText(page, 'कृपया किमान'), '03-create--error-short-note');
  }
}

async function mobileShot(browser: Browser): Promise<void> {
  if (haveShot('02-nav--mobile-menu')) return;
  const context = await newDocsContext(browser, { mobile: true });
  const page = await context.newPage();
  await gotoPage(page, '/');
  await page.locator('.nav-toggle').click();
  await page.waitForTimeout(400);
  await shoot(page, '02-nav--mobile-menu');
  await context.close();
}

async function translateShots(page: Page): Promise<void> {
  await gotoPage(page, '/translate');
  await shoot(page, '08-translate--form', { fullPage: true });
  if (haveShot('08-translate--result')) return;

  // One real (synchronous) translation call using the opening of the fixture note.
  const excerpt = readNoteFixture().split('---------')[0]!.trim().slice(0, 900);
  await page.locator('#translate-text').fill(excerpt);
  await page.getByRole('button', { name: 'भाषांतर करा' }).click();
  await page
    .locator('.translating-note')
    .waitFor({ timeout: 5000 })
    .catch(() => undefined);
  await shoot(cardByText(page, 'भाषांतर करा'), '08-translate--busy');
  const result = cardByText(page, 'इंग्रजी भाषांतर');
  await result.waitFor({ timeout: 4 * 60 * 1000 });
  await waitReady(page);
  await shoot(result, '08-translate--result');
}

async function glossaryShots(page: Page): Promise<void> {
  await gotoPage(page, '/glossary');
  await page
    .locator('.glossary-row, .glossary-toolbar')
    .first()
    .waitFor({ timeout: 30000 });
  await waitReady(page);
  // Viewport shot, not fullPage — the list can hold hundreds of rows.
  await shoot(page, '09-glossary--overview');

  // Add form filled but NOT submitted — no data is written.
  const addCard = cardByText(page, 'नवीन नाव जोडा');
  await addCard.locator('input').nth(0).fill('जिल्हाधिकारी');
  await addCard.locator('input').nth(1).fill('District Collector');
  await shoot(addCard, '09-glossary--add-filled');

  // Toolbar + top rows within one viewport (verified/unverified row states).
  const toolbar = page.locator('.glossary-toolbar');
  if ((await toolbar.count()) > 0) {
    await toolbar.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    await shoot(page, '09-glossary--row-states');
  }
}

async function referencesShots(page: Page): Promise<void> {
  await gotoPage(page, '/references');
  await page.locator('.ref-type-card').first().waitFor({ timeout: 30000 });
  await autoScroll(page); // decode lazy thumbnails
  await waitReady(page, 1200);
  // Viewport shot, not fullPage — the library grows with every uploaded master.
  await shoot(page, '10-refs--overview');
  await shoot(page.locator('.ref-thumb').first(), '10-refs--tile-badges');
  const disabled = page.locator('.ref-thumb:not(.is-enabled)').first();
  if ((await disabled.count()) > 0) {
    await shoot(disabled, '10-refs--disabled-tile');
  }

  // Custom-type creation form: opened, photographed, cancelled — nothing created.
  await page.locator('.ref-new-type-toggle').click();
  await page.locator('.ref-new-type-form').waitFor({ timeout: 5000 });
  await shoot(page.locator('.ref-new-type-form'), '10-refs--newtype-form');
  await page.getByRole('button', { name: 'रद्द करा' }).click();
}

// History shots live in their own phase so they can run AFTER the live runs
// populated the grid ("docs:shots -- history").
export async function shootHistory(): Promise<void> {
  const browser = await launchBrowser();
  try {
    // dpr 1: nine poster thumbnails in one fullPage capture — see newDocsContext.
    const context = await newDocsContext(browser, { dpr: 1 });
    const page = await context.newPage();
    await gotoPage(page, '/generations');
    await page
      .locator('.history-grid, .history-empty, .card')
      .first()
      .waitFor({ timeout: 30000 });
    await autoScroll(page);
    await waitForImages(page);
    await waitReady(page, 1200);
    await shoot(page, '07-history--grid', { fullPage: true });

    const search = page.locator('.history-search');
    if ((await search.count()) > 0) {
      await search.fill('कर्जमुक्ती');
      await page.waitForTimeout(700);
      await waitForImages(page);
      await shoot(page, '07-history--search', { fullPage: true });
      await search.fill('क्ष्क्ष्क्ष'); // gibberish → no-results state
      await page.waitForTimeout(700);
      await shoot(page, '07-history--no-results');
      await search.fill('');
      await page.waitForTimeout(700);
    }
    const pagination = page.locator('.pagination');
    if ((await pagination.count()) > 0) {
      await shoot(pagination, '07-history--pagination');
    }
  } finally {
    await browser.close();
  }
}

export async function shootStatic(): Promise<void> {
  const browser = await launchBrowser();
  try {
    const context = await newDocsContext(browser);
    const page = await context.newPage();
    console.log('home/create form…');
    await homeShots(page);
    console.log('mobile nav…');
    await mobileShot(browser);
    console.log('translate…');
    await translateShots(page);
    console.log('glossary…');
    await glossaryShots(page);
    console.log('references…');
    await referencesShots(page);
  } finally {
    await browser.close();
  }
}
