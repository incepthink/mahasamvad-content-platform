// Current GitBook screenshot pass. It covers every user-facing route without
// starting a paid generation. Existing completed runs provide the durable
// result/review states; short-lived translation, proofreading and scanned-PDF
// states are exercised through response fixtures so the real React UI is still
// what gets photographed and no external model is called.

import fs from 'node:fs';
import type { BrowserContext, Locator, Page } from 'playwright';
import {
  cardByText,
  gotoPage,
  haveShot,
  launchBrowser,
  newDocsContext,
  openTasksModal,
  shotPath,
  shoot,
  waitForImages,
  waitReady,
} from './helpers.js';

const ARTICLE_GENERATION_ID = '5f3419f9-689a-4f9d-877d-92da30454abd';
const SOCIAL_GENERATION_ID = 'eeef4b15-76a8-4474-a31b-7f383b7752e3';
const DLO_REVIEW_ID = '51697eef-15e9-4379-bf02-fee846fca35d';
const VIDEO_SCRIPT_ID = '9b47ea72-d7b0-4b9a-bce4-10615d99e1d6';
const VIDEO_STORYBOARD_ID = '1cd561e5-dd00-4bc8-80f0-c13cf02b5a18';
const VIDEO_COMPLETE_ID = '3536be3b-ac38-4503-b470-526db3c99322';

async function hideDevUi(page: Page): Promise<void> {
  await page.evaluate(() => {
    if (document.getElementById('docs-current-hide')) return;
    const style = document.createElement('style');
    style.id = 'docs-current-hide';
    style.textContent = 'nextjs-portal { display: none !important; }';
    document.head.appendChild(style);
  });
}

// Keep a complex card at readable scale by photographing the viewport aligned
// to its top instead of producing a several-thousand-pixel-tall locator image.
async function shootViewportAt(target: Locator, name: string): Promise<void> {
  if (haveShot(name)) {
    console.log(`  = ${name} (exists, skipped)`);
    return;
  }
  fs.mkdirSync(
    new URL('../../../../docs/user-guide/.gitbook/assets/', import.meta.url),
    {
      recursive: true,
    },
  );
  await target.scrollIntoViewIfNeeded();
  await target.page().waitForTimeout(350);
  await hideDevUi(target.page());
  await target.page().screenshot({ path: shotPath(name) });
  console.log(`  + ${name}`);
}

async function waitForLoadedRoute(page: Page, selector: string): Promise<void> {
  await page.locator(selector).first().waitFor({ timeout: 60_000 });
  await waitReady(page, 700);
}

async function navigationAndCreative(page: Page): Promise<void> {
  await gotoPage(page, '/');
  await shoot(page, '01-overview--home');
  await shoot(page.locator('.sidebar'), '02-navigation--sidebar');

  const tasks = await openTasksModal(page);
  await shoot(tasks, '02-navigation--tasks');
  await page.keyboard.press('Escape');

  const formatCard = cardByText(page, 'काय तयार करायचे?');
  await shoot(formatCard, '03-creative--formats');

  await page.getByRole('button', { name: 'लेख पोस्टर' }).click();
  await waitReady(page, 250);
  await shoot(formatCard, '03-creative--article-poster');

  await page.getByRole('button', { name: 'क्रिएटिव्ह' }).click();
  await page.locator('.ref-picker-disclosure-head').click();
  await page
    .locator('.ref-picker-thumb, .ref-picker-loading, .info-callout')
    .first()
    .waitFor({ timeout: 30_000 });
  await waitForImages(page);
  await shoot(formatCard, '03-creative--template-picker');
}

async function mobileNavigation(context: BrowserContext): Promise<void> {
  const page = await context.newPage();
  await gotoPage(page, '/');
  await page.locator('.nav-toggle').click();
  await waitReady(page, 250);
  await shoot(page, '02-navigation--mobile');
}

async function articleJourney(page: Page): Promise<void> {
  await gotoPage(page, '/dlo');
  await waitReady(page, 1_000);
  await shoot(page, '04-article--start');
  await shoot(
    cardByText(page, 'ध्वनिमुद्रण (MP3, AAC, M4A)'),
    '04-article--audio',
  );
  await shoot(cardByText(page, 'यूट्युब व्हिडिओ'), '04-article--youtube');
  await shoot(cardByText(page, 'कागदपत्र'), '04-article--document');
  await shoot(cardByText(page, 'AI साठी सूचना'), '04-article--instructions');

  await gotoPage(page, `/dlo/${DLO_REVIEW_ID}`);
  // A finished intake resumes at its completed article. Returning to review is
  // a client-only state change and exposes the saved, already-paid review data.
  await page
    .getByRole('button', { name: 'याच स्रोतातून पुन्हा लेख तयार करा' })
    .waitFor({ timeout: 60_000 });
  await page
    .getByRole('button', { name: 'याच स्रोतातून पुन्हा लेख तयार करा' })
    .click();
  await waitForLoadedRoute(page, '.names-review');
  await shootViewportAt(
    page.locator('.names-review').first(),
    '05-article--review',
  );
  const sourceCard = page
    .locator('section.card')
    .filter({ has: page.locator('textarea.note-input') })
    .first();
  if ((await sourceCard.count()) > 0) {
    await shoot(sourceCard, '05-article--source-review');
  }

  await gotoPage(page, `/generations/${ARTICLE_GENERATION_ID}`);
  await waitForLoadedRoute(page, '.article-body');
  await waitForImages(page);
  const articleCard = page
    .locator('section.card')
    .filter({ has: page.locator('.article-body') })
    .first();
  await shootViewportAt(articleCard, '06-results--article');
  const factFold = page
    .locator('details.fold')
    .filter({ hasText: 'तथ्य-तपासणी' })
    .first();
  if ((await factFold.count()) > 0) {
    await factFold.locator('summary').click();
    await waitReady(page, 200);
    await shoot(factFold, '06-results--fact-check');
  }
}

async function socialResult(page: Page): Promise<void> {
  await gotoPage(page, `/generations/${SOCIAL_GENERATION_ID}`);
  await waitForLoadedRoute(page, '.poster-image');
  await waitForImages(page);
  await shootViewportAt(
    page.locator('.poster-layout').first(),
    '06-social--result',
  );
  await shoot(
    page.locator('.poster-icon-actions').first(),
    '06-social--actions',
  );

  await page
    .getByRole('button', { name: 'चित्रात बदल करा (पोस्टरवर खूण करा)' })
    .click();
  const overlay = page.locator('.poster-annotator').first();
  let box = await overlay.boundingBox();
  if (box) {
    await page.mouse.click(box.x + box.width * 0.36, box.y + box.height * 0.28);
    await page
      .locator('.marker-note-row input')
      .first()
      .fill('मुख्य शीर्षक थोडे मोठे करा');
  }

  await page
    .getByRole('button', { name: 'जागा मोकळी करा (स्वतःच्या लोगोसाठी)' })
    .click();
  box = await overlay.boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width * 0.56, box.y + box.height * 0.62);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.84, box.y + box.height * 0.82, {
      steps: 8,
    });
    await page.mouse.up();
  }
  await waitReady(page, 250);
  await shootViewportAt(
    page.locator('.poster-layout').first(),
    '06-social--markers',
  );
}

async function transcription(page: Page): Promise<void> {
  await gotoPage(page, '/transcribe');
  await waitForLoadedRoute(page, '.transcribe-open');
  await shoot(page, '07-transcription--page');
  const readyRow = page.locator('.transcribe-open').first();
  await readyRow.click();
  await waitForLoadedRoute(page, '.social-caption');
  await shoot(
    cardByText(page, 'तयार झालेला मजकूर'),
    '07-transcription--result',
  );
}

async function translation(context: BrowserContext): Promise<void> {
  const page = await context.newPage();
  await page.route('**/api/translate/prepare', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        terms: [
          {
            marathi: 'कोल्हापूर',
            english: 'Kolhapur',
            hindi: 'कोल्हापुर',
            termType: 'place',
            verified: true,
          },
          {
            marathi: 'वंदना थोरात',
            english: 'Vandana Thorat',
            hindi: 'वंदना थोरात',
            termType: 'person',
            verified: false,
          },
          {
            marathi: 'सहकारी संस्था',
            english: 'Co-operative institution',
            hindi: 'सहकारी संस्था',
            termType: 'org',
            verified: false,
          },
        ],
      }),
    });
  });
  await page.route('**/api/translate', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        translated:
          'कोल्हापुर में आयोजित बैठक में वंदना थोरात ने नागरिकों को योजना की जानकारी दी।',
        language: 'hi',
        lockedTermCount: 2,
        minedTermCount: 0,
        unpreservedNames: [],
      }),
    });
  });

  await gotoPage(page, '/translate');
  await shoot(page, '08-translation--form');
  await page
    .locator('#translate-text')
    .fill(
      'कोल्हापूर येथे झालेल्या बैठकीत वंदना थोरात यांनी नागरिकांना योजनेची माहिती दिली.',
    );
  await page.getByRole('button', { name: 'हिंदी' }).click();
  await page.getByRole('button', { name: 'भाषांतर करा' }).click();
  await waitForLoadedRoute(page, '.names-review');
  await shoot(page.locator('.names-review'), '08-translation--name-review');
  await page.locator('.names-review .btn-primary').click();
  await cardByText(page, 'हिंदी भाषांतर').waitFor({ timeout: 10_000 });
  await shoot(cardByText(page, 'हिंदी भाषांतर'), '08-translation--result');
}

async function scannedPdfSelection(context: BrowserContext): Promise<void> {
  const page = await context.newPage();
  const jobId = 'docs-shot-scanned-pdf';
  await page.route('**/api/documents**', async (route) => {
    const url = new URL(route.request().url());
    if (
      route.request().method() === 'POST' &&
      url.pathname.endsWith('/api/documents')
    ) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: jobId,
          kind: 'pdf',
          pageCount: 6,
          needsOcr: true,
        }),
      });
      return;
    }
    if (
      route.request().method() === 'GET' &&
      url.pathname.endsWith(`/api/documents/${jobId}`)
    ) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: jobId,
          fileName: 'बैठक-अहवाल.pdf',
          kind: 'pdf',
          status: 'selecting',
          pages: [],
          pageCount: 6,
          needsOcr: true,
          source: null,
          extractProgress: null,
          error: null,
          createdAt: '2026-08-03T10:00:00.000Z',
        }),
      });
      return;
    }
    await route.continue();
  });
  await gotoPage(page, '/translate');
  await page.locator('input[type="file"]').setInputFiles({
    name: 'बैठक-अहवाल.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4 documentation fixture'),
  });
  await cardByText(page, 'कोणती पृष्ठे वाचायची?').waitFor({ timeout: 10_000 });
  await shoot(
    cardByText(page, 'कोणती पृष्ठे वाचायची?'),
    '08-translation--ocr-pages',
  );
}

async function proofreading(context: BrowserContext): Promise<void> {
  const page = await context.newPage();
  const original =
    'मुख्यमंत्र्यांनी आज मुंबई येथे बैठकीत सांगितले की, नागरिकांनी अधिकृत माहिती तपासुन घ्यावी . ही योजना लोकांसाठी खूप चांगली आहे.';
  const corrected =
    'मुख्यमंत्र्यांनी आज मुंबई येथे बैठकीत सांगितले की, नागरिकांनी अधिकृत माहिती तपासून घ्यावी. ही योजना लोकांसाठी खूप चांगली आहे.';
  await page.route('**/api/proofread', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: {
        'Access-Control-Allow-Origin':
          route.request().headers()['origin'] ?? '*',
      },
      body: JSON.stringify({
        language: 'mr',
        issues: [
          {
            type: 'spelling',
            severity: 'error',
            excerpt: 'तपासुन',
            suggestion: 'तपासून',
            explanation: 'शुद्धलेखनानुसार दीर्घ ऊकार आवश्यक आहे.',
          },
          {
            type: 'punctuation',
            severity: 'error',
            excerpt: 'घ्यावी .',
            suggestion: 'घ्यावी.',
            explanation: 'पूर्णविरामापूर्वी जागा ठेवली जात नाही.',
          },
          {
            type: 'style',
            severity: 'suggestion',
            excerpt: 'ही योजना लोकांसाठी खूप चांगली आहे.',
            suggestion: 'योजनेमुळे नागरिकांना होणारा थेट लाभ नेमका लिहा.',
            explanation:
              'महासंवाद शैलीत सर्वसाधारण विशेषणाऐवजी ठोस परिणाम लिहा.',
          },
        ],
        unverifiedNames: ['मुंबई'],
        correctedText: corrected,
        styleChecked: true,
        styleReference: {
          title: 'महासंवाद नमुना लेख',
          url: 'https://mahasamvad.in/',
        },
      }),
    });
  });
  await gotoPage(page, '/proofread');
  await shoot(page, '09-proofreading--form');
  // In Next.js dev mode the server HTML can appear just before this route has
  // hydrated. Wait for React to own the controlled textarea before filling it.
  await waitReady(page, 1_500);
  await page.locator('#proofread-text').fill(original);
  const proofreadButton = page.getByRole('button', { name: 'तपासणी करा' });
  await proofreadButton.waitFor({ state: 'visible', timeout: 30_000 });
  await page.waitForFunction(
    () =>
      !(
        document.querySelector('button.btn-primary') as HTMLButtonElement | null
      )?.disabled,
    undefined,
    { timeout: 30_000 },
  );
  await proofreadButton.click();
  await cardByText(page, 'दुरुस्त मजकूर').waitFor({ timeout: 10_000 });
  await shootViewportAt(
    cardByText(page, 'आढळलेल्या चुका'),
    '09-proofreading--issues',
  );
  await shoot(cardByText(page, 'दुरुस्त मजकूर'), '09-proofreading--corrected');
}

async function glossaryAndReferences(page: Page): Promise<void> {
  await gotoPage(page, '/glossary');
  await waitForLoadedRoute(page, '.gl-list');
  await shoot(page, '10-glossary--overview');
  const addFold = page.locator('details.gl-add-fold');
  await addFold.locator('summary').click();
  await addFold.locator('#gl-add-marathi').fill('कोल्हापूर');
  await addFold.locator('#gl-add-english').fill('Kolhapur');
  await addFold.locator('#gl-add-hindi').fill('कोल्हापुर');
  await shoot(addFold, '10-glossary--add');

  await gotoPage(page, '/references');
  await waitForLoadedRoute(page, '.ref-thumb');
  await waitForImages(page);
  await shoot(page, '11-templates--overview');
  await shoot(page.locator('.ref-thumb').first(), '11-templates--tile');
}

async function videoJourney(page: Page): Promise<void> {
  await gotoPage(page, '/video');
  await waitReady(page, 700);
  await shoot(page, '12-video--create');
  await page.getByRole('button', { name: 'तयार संहितेवरून' }).click();
  await waitReady(page, 200);
  await shootViewportAt(
    cardByText(page, 'व्हिडिओ कशावरून तयार करायचा?'),
    '12-video--ready-script',
  );

  await gotoPage(page, `/video/${VIDEO_SCRIPT_ID}`);
  await waitForLoadedRoute(page, 'textarea#video-style');
  await shoot(page, '12-video--script-review');
  const scriptScene = page
    .locator('section.card')
    .filter({ hasText: 'दृश्य 1' })
    .first();
  await shoot(scriptScene, '12-video--script-scene');

  await gotoPage(page, `/video/${VIDEO_STORYBOARD_ID}`);
  await waitForLoadedRoute(page, 'img[alt="प्रारंभ फ्रेम"]');
  await waitForImages(page);
  await shoot(page, '12-video--storyboard');
  const storyboardScene = page
    .locator('section.card')
    .filter({ hasText: 'दृश्य 1' })
    .first();
  await shoot(storyboardScene, '12-video--storyboard-scene');

  await gotoPage(page, `/video/${VIDEO_COMPLETE_ID}`);
  await waitForLoadedRoute(page, 'video');
  await shootViewportAt(
    page
      .locator('section.card')
      .filter({ has: page.locator('video') })
      .first(),
    '12-video--result',
  );
  await shoot(cardByText(page, 'वेळेसह निवेदन'), '12-video--timed-script');
}

async function historyAndAnalytics(page: Page): Promise<void> {
  await gotoPage(page, '/generations');
  await waitForLoadedRoute(page, '.history-grid');
  await waitForImages(page);
  await shoot(page, '13-history--grid');

  await gotoPage(page, '/analytics?range=30d');
  await waitForLoadedRoute(page, '.stat-grid');
  await shoot(page, '14-analytics--overview');

  await gotoPage(page, '/analytics/social?range=30d');
  await waitForLoadedRoute(page, '.service-table');
  await shoot(page, '14-analytics--detail');
}

export async function shootCurrentGuide(): Promise<void> {
  const browser = await launchBrowser();
  try {
    const context = await newDocsContext(browser, { dpr: 1 });
    const page = await context.newPage();
    console.log('navigation + creative…');
    await navigationAndCreative(page);

    console.log('mobile navigation…');
    const mobile = await newDocsContext(browser, { mobile: true, dpr: 1 });
    await mobileNavigation(mobile);
    await mobile.close();

    console.log('article journey…');
    await articleJourney(page);
    console.log('social result…');
    await socialResult(page);
    console.log('transcription…');
    await transcription(page);
    console.log('translation…');
    await translation(context);
    console.log('scanned PDF selection…');
    await scannedPdfSelection(context);
    console.log('proofreading…');
    await proofreading(context);
    console.log('glossary + templates…');
    await glossaryAndReferences(page);
    console.log('video…');
    await videoJourney(page);
    console.log('history + analytics…');
    await historyAndAnalytics(page);
  } finally {
    await browser.close();
  }
}
