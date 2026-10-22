// Current GitBook screenshot pass (docs/user-guide/.gitbook/assets).
//
//   pnpm --filter @dgipr/poster-renderer docs:shots -- current [--force]
//
// Photographs every page of the user guide WITHOUT starting a paid generation and
// WITHOUT writing anything: a context-level route aborts every non-GET request to the
// API, so the only "submits" that succeed are the response fixtures below (translation
// and proofreading results). Completed runs that already exist supply the result pages.
//
// Needs `pnpm db:tunnel` + `pnpm dev` (web :3000, api :3001). The example ids below are
// real completed rows; if one is deleted, pick another of the same kind from
// /generations (the "प्रकार" filter) or the relevant list page.
//
// Frames are viewport-sized, never fullPage: a fullPage capture stitches the fixed
// sidebar wrongly (it renders as a 58px strip beside an empty gap).

import type { BrowserContext, Locator, Page, Route } from 'playwright';
import { API_URL, WEB_URL } from './config.js';
import {
  gotoPage,
  launchBrowser,
  newDocsContext,
  openTasksModal,
  shoot,
  waitForImages,
  waitReady,
} from './helpers.js';

const SOCIAL_POSTER_ID = '3e834d14-d333-4635-9c77-0aadd80ed0bf';
const ARTICLE_ID = 'cc286183-4d3c-47bc-ad73-57f42050f8fe';
const CAROUSEL_ID = '0f430ff4-2462-46b3-b62a-c381f1d774e8';
const DYNAMIC_POSTER_ID = '133f7c73-49ec-4e2b-82ed-5841a45eb8e7';
const TRANSCRIPTION_NAME = 'My recording 198.m4a';
const VIDEO_SCRIPT_ID = '5a0cb938-1bef-4a47-92a5-1cb9eb26868b';
const VIDEO_STORYBOARD_ID = '7d675faf-2641-4261-8ac2-bb1fbfd2a2f5';
const VIDEO_COMPLETE_ID = 'e2e1bbe0-089c-4788-b798-3c745ba96fb0';
const VIDEO_CONVERSATION_ID = '85f4c80d-ee09-4694-8197-add78231a0d3';

// ---------- safety + fixtures ----------

function corsHeaders(route: Route): Record<string, string> {
  return {
    'access-control-allow-origin':
      route.request().headers()['origin'] ?? WEB_URL,
    'access-control-allow-headers': 'content-type, accept, x-dgipr-device',
    'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  };
}

// Read-only guarantee: anything that is not a GET (or a CORS preflight) is refused.
async function blockWrites(context: BrowserContext): Promise<void> {
  await context.route(`${API_URL}/api/**`, async (route) => {
    const method = route.request().method();
    if (method === 'GET' || method === 'OPTIONS') return route.continue();
    console.warn(
      `  ! blocked ${method} ${new URL(route.request().url()).pathname}`,
    );
    await route.abort();
  });
}

// A page-level fixture (page routes take precedence over the context guard).
async function fixture(page: Page, path: string, body: unknown): Promise<void> {
  await page.route(`${API_URL}${path}`, async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: corsHeaders(route) });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: corsHeaders(route),
      body: JSON.stringify(body),
    });
  });
}

// ---------- framing ----------

const SIDEBAR_WIDTH = 260;

// The content column only (no sidebar), from the top of the window. Used for detail
// shots where the menu would only repeat what the navigation chapter already shows.
async function shootContent(
  page: Page,
  name: string,
  height = 900,
): Promise<void> {
  const width = page.viewportSize()!.width - SIDEBAR_WIDTH;
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(250);
  await shootClip(page, name, { x: SIDEBAR_WIDTH, y: 0, width, height });
}

// Whatever is in the window right now, cropped to the content column, scrolled so
// `target` sits near the top.
async function shootContentAt(
  target: Locator,
  name: string,
  height = 900,
  offset = 24,
): Promise<void> {
  const page = target.page();
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (box) {
    await page.evaluate((dy) => window.scrollBy(0, dy), box.y - offset);
  }
  await page.waitForTimeout(350);
  const width = page.viewportSize()!.width - SIDEBAR_WIDTH;
  await shootClip(page, name, { x: SIDEBAR_WIDTH, y: 0, width, height });
}

function shootClip(
  page: Page,
  name: string,
  clip: { x: number; y: number; width: number; height: number },
): Promise<void> {
  return shoot(page, name, { clip });
}

async function loaded(
  page: Page,
  selector: string,
  settle = 700,
): Promise<void> {
  await page
    .locator(`${selector} >> visible=true`)
    .first()
    .waitFor({ timeout: 60_000 });
  await waitReady(page, settle);
}

// A <video> paints black until it has data; seek a second in so the still is a frame.
async function showVideoFrame(page: Page): Promise<void> {
  await page
    .evaluate(
      `(async () => {
      const v = [...document.querySelectorAll('video')].pop();
      if (!v) return;
      v.scrollIntoView({ block: 'center' });
      if (v.readyState < 1) await new Promise((r) => v.addEventListener('loadedmetadata', r, { once: true }));
      v.currentTime = Math.min(1, (v.duration || 2) / 2);
      await new Promise((r) => v.addEventListener('seeked', r, { once: true }));
    })()`,
    )
    .catch(() => undefined);
  await page.waitForTimeout(800);
}

// ---------- chapters ----------

async function overviewAndNavigation(page: Page): Promise<void> {
  await gotoPage(page, '/');
  await loaded(page, 'textarea');
  await shoot(page, '01-overview--home');
  await shoot(page.locator('aside.sidebar'), '02-navigation--sidebar');

  const tasks = await openTasksModal(page);
  await shoot(tasks, '02-navigation--tasks');
  await page.keyboard.press('Escape');
}

async function mobileNavigation(context: BrowserContext): Promise<void> {
  const page = await context.newPage();
  await gotoPage(page, '/');
  await loaded(page, 'textarea');
  await page.locator('.nav-toggle').click();
  await waitReady(page, 400);
  await shoot(page, '02-navigation--mobile');
  await page.close();
}

async function creative(page: Page): Promise<void> {
  await gotoPage(page, '/');
  await loaded(page, 'textarea');
  await page
    .locator('textarea')
    .first()
    .fill(
      'मुख्यमंत्री माझी लाडकी बहीण योजना — अर्ज करण्याची अंतिम मुदत ३१ ऑगस्ट २०२६.\nपात्र महिलांना दरमहा १,५०० रुपये थेट बँक खात्यात.\nअर्ज ग्रामपंचायत, नागरी सुविधा केंद्र किंवा मोबाईल ॲपवर.',
    );
  await waitReady(page, 300);
  await shootContent(page, '03-creative--composer', 640);

  // The format menu (a Radix dropdown, portalled to <body>).
  await page.getByRole('button', { name: 'क्रिएटिव्ह' }).first().click();
  const menu = page.getByRole('menu');
  await menu.waitFor({ timeout: 10_000 });
  await waitReady(page, 300);
  await shootContent(page, '03-creative--formats', 820);

  // Dynamic Poster swaps the text box for an upload area.
  await menu.getByRole('menuitem', { name: /डायनॅमिक पोस्टर/ }).click();
  await waitReady(page, 500);
  await shootContent(page, '03-dynamic--upload', 760);

  // Back to Creative, then open the template picker.
  await gotoPage(page, '/');
  await loaded(page, 'textarea');
  const head = page
    .locator('.ref-picker-disclosure-head >> visible=true')
    .first();
  await head.click();
  await page
    .locator('.ref-picker-thumb, .ref-picker-loading, .info-callout')
    .first()
    .waitFor({ timeout: 30_000 });
  await waitReady(page, 1_500);
  await waitForImages(page);
  await shootContentAt(head, '03-creative--template-picker', 900, 120);
}

async function carouselAndDynamic(page: Page): Promise<void> {
  await gotoPage(page, `/generations/${CAROUSEL_ID}`);
  await loaded(page, 'img');
  await waitForImages(page);
  await shootContent(page, '03-carousel--result', 820);

  await gotoPage(page, `/generations/${DYNAMIC_POSTER_ID}`);
  await loaded(page, 'video, img');
  await waitForImages(page);
  await shootContent(page, '03-dynamic--result', 900);
}

async function article(page: Page): Promise<void> {
  await gotoPage(page, '/dlo');
  await loaded(page, 'textarea');
  await shoot(page, '04-article--start');

  await gotoPage(page, `/generations/${ARTICLE_ID}`);
  await loaded(page, 'h2, h3');
  await shootContent(page, '06-results--article', 900);

  // The action row and folds below the article body.
  const feedback = page.getByText('बातमीत बदल हवा आहे?').first();
  await feedback.scrollIntoViewIfNeeded();
  await shootContentAt(feedback, '06-results--article-actions', 620, 420);

  await feedback.click();
  await waitReady(page, 400);
  await shootContentAt(feedback, '05-feedback--article', 560, 40);
}

async function socialPoster(page: Page): Promise<void> {
  await gotoPage(page, `/generations/${SOCIAL_POSTER_ID}`);
  await loaded(page, '.poster-image');
  await waitForImages(page);
  await shootContent(page, '06-social--result', 900);

  const toolbar = page.locator('.poster-icon-actions').first();
  await shoot(toolbar, '06-social--actions');

  // Mark mode: one red mark with a note. Nothing is sent — the send button is never
  // pressed, and the context guard would block it anyway.
  await page
    .getByRole('button', { name: 'चित्रात बदल करा (पोस्टरवर खूण करा)' })
    .first()
    .click();
  const poster = page.locator('.poster-frame').first();
  const box = await poster.boundingBox();
  if (box) {
    await page.mouse.click(box.x + box.width * 0.42, box.y + box.height * 0.2);
    await waitReady(page, 300);
    const note = page
      .locator('.marker-note-row input, .marker-note-row textarea')
      .first();
    if ((await note.count()) > 0) await note.fill('शीर्षक थोडे मोठे करा');
  }
  await waitReady(page, 300);
  await shootContentAt(poster, '06-social--markers', 900, 30);

  // The conversation box under the poster.
  const chat = page.getByText('AI सोबत बदल करा').first();
  if ((await chat.count()) > 0) {
    await shootContentAt(chat, '06-social--edit-chat', 520, 40);
  }
}

async function transcription(page: Page): Promise<void> {
  await gotoPage(page, '/transcribe');
  await loaded(page, 'h1');
  await shoot(page, '07-transcription--page');

  // Open the history fold and one finished Marathi run.
  await page.getByText('मागील ध्वनिलेखने').first().click();
  await waitReady(page, 800);
  await page.getByText(TRANSCRIPTION_NAME, { exact: true }).first().click();
  await waitReady(page, 1_500);
  const result = page.getByText('तयार झालेला मजकूर').first();
  if ((await result.count()) > 0) {
    await shootContentAt(result, '07-transcription--result', 700, 60);
  }
}

async function translation(context: BrowserContext): Promise<void> {
  const page = await context.newPage();
  await fixture(page, '/api/translate/prepare', {
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
        english: 'Co-operative society',
        hindi: 'सहकारी संस्था',
        termType: 'org',
        verified: false,
      },
    ],
  });
  await fixture(page, '/api/translate', {
    translated:
      'At a meeting held in Kolhapur, Vandana Thorat briefed citizens on the scheme and urged co-operative societies to help eligible families apply before 31 August 2026.',
    language: 'en',
    sourceLanguage: 'mr',
    lockedTermCount: 2,
    minedTermCount: 0,
    unpreservedNames: [],
  });

  await gotoPage(page, '/translate');
  await loaded(page, '#translate-text');
  await shoot(page, '08-translation--form');
  await page
    .locator('#translate-text')
    .fill(
      'कोल्हापूर येथे झालेल्या बैठकीत वंदना थोरात यांनी नागरिकांना योजनेची माहिती दिली आणि पात्र कुटुंबांनी ३१ ऑगस्ट २०२६ पूर्वी अर्ज करावेत यासाठी सहकारी संस्थांनी मदत करावी, असे आवाहन केले.',
    );
  await waitReady(page, 400);
  await page.getByRole('button', { name: 'भाषांतर करा' }).click();
  await loaded(page, '.names-review', 500);
  await shootContentAt(
    page.locator('.names-review'),
    '08-translation--name-review',
    760,
    30,
  );
  await page.locator('.names-review .btn-primary').first().click();
  const result = page.getByText('Vandana Thorat briefed').first();
  await result.waitFor({ timeout: 15_000 });
  await waitReady(page, 400);
  await shootContentAt(result, '08-translation--result', 560, 200);
  await page.close();
}

async function proofreading(context: BrowserContext): Promise<void> {
  const page = await context.newPage();
  const original =
    'मुख्यमंत्र्यांनी आज मुंबई येथे बैठकीत सांगितले की, नागरिकांनी अधिकृत माहिती तपासुन घ्यावी . ही योजना लोकांसाठी खूप चांगली आहे.';
  const corrected =
    'मुख्यमंत्र्यांनी आज मुंबई येथे बैठकीत सांगितले की, नागरिकांनी अधिकृत माहिती तपासून घ्यावी. ही योजना लोकांसाठी खूप चांगली आहे.';
  await fixture(page, '/api/proofread', {
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
        explanation: 'महासंवाद शैलीत सर्वसाधारण विशेषणाऐवजी ठोस परिणाम लिहा.',
      },
    ],
    unverifiedNames: [],
    correctedText: corrected,
    styleChecked: true,
    styleReference: {
      title: 'महासंवाद नमुना लेख',
      url: 'https://mahasamvad.in/',
    },
  });
  await gotoPage(page, '/proofread');
  await loaded(page, '#proofread-text', 1_500);
  await shoot(page, '09-proofreading--form');
  await page.locator('#proofread-text').fill(original);
  await waitReady(page, 400);
  await page.getByRole('button', { name: 'तपासणी करा' }).click();
  await page.getByText('दुरुस्त मजकूर').first().waitFor({ timeout: 15_000 });
  await waitReady(page, 500);
  await shootContentAt(
    page.getByText('आढळलेल्या चुका').first(),
    '09-proofreading--issues',
    760,
    40,
  );
  await shootContentAt(
    page.getByText('दुरुस्त मजकूर').first(),
    '09-proofreading--corrected',
    420,
    40,
  );
  await page.close();
}

async function chat(page: Page): Promise<void> {
  await gotoPage(page, '/chat');
  await loaded(page, 'textarea');
  await page
    .locator('textarea')
    .first()
    .fill('या शासन निर्णयातील मुख्य मुद्दे सोप्या भाषेत पाच ओळींत सांगा.');
  await waitReady(page, 300);
  await shoot(page, '15-chat--new');
}

async function videoConversations(page: Page): Promise<void> {
  await gotoPage(page, '/new-video-workflow?mode=storyboard');
  await loaded(page, 'textarea');
  await shoot(page, '16-conversation--storyboard');

  await gotoPage(page, `/new-video-workflow/${VIDEO_CONVERSATION_ID}`);
  await loaded(page, 'textarea');
  await waitReady(page, 1_500);
  await showVideoFrame(page);
  await shoot(page, '16-conversation--video');
}

async function videoProject(page: Page): Promise<void> {
  await gotoPage(page, '/video');
  await loaded(page, 'textarea');
  await shoot(page, '12-video--create');

  // The two approval gates and the finished video. These pages poll, so wait on time
  // rather than a selector, then let every frame image decode.
  for (const [id, name] of [
    [VIDEO_SCRIPT_ID, '12-video--script-review'],
    [VIDEO_STORYBOARD_ID, '12-video--storyboard'],
    [VIDEO_COMPLETE_ID, '12-video--result'],
  ] as const) {
    await gotoPage(page, `/video/${id}`);
    await waitReady(page, 5_000);
    await waitForImages(page);
    if (name === '12-video--result') {
      await showVideoFrame(page);
      await page.evaluate(() => window.scrollTo(0, 0));
    }
    await shootContent(page, name, 900);
  }
}

async function historyAnalyticsAdmin(page: Page): Promise<void> {
  await gotoPage(page, '/generations');
  await loaded(page, '.history-grid');
  await waitForImages(page);
  await shoot(page, '13-history--grid');

  await gotoPage(page, '/analytics?range=30d');
  await waitReady(page, 4_000);
  await shoot(page, '14-analytics--overview');

  await gotoPage(page, '/analytics/social?range=30d');
  await waitReady(page, 4_000);
  const services = page.getByText('वापरलेल्या सेवा').first();
  if ((await services.count()) > 0) {
    await shootContentAt(services, '14-analytics--detail', 760, 40);
  }

  await gotoPage(page, '/glossary');
  await loaded(page, '.gl-list');
  await shoot(page, '10-glossary--overview');
  const addFold = page.locator('details.gl-add-fold');
  await addFold.locator('summary').click();
  await addFold.locator('#gl-add-marathi').fill('कोल्हापूर');
  await addFold.locator('#gl-add-english').fill('Kolhapur');
  await addFold.locator('#gl-add-hindi').fill('कोल्हापुर');
  await waitReady(page, 300);
  await shootContentAt(addFold, '10-glossary--add', 560, 30);

  await gotoPage(page, '/preferences');
  await waitReady(page, 2_500);
  await shoot(page, '17-rules--overview');

  await gotoPage(page, '/references');
  await loaded(page, '.ref-thumb');
  await waitForImages(page);
  await shoot(page, '11-templates--overview');
  await shoot(page.locator('.ref-thumb').first(), '11-templates--tile');
}

export async function shootCurrentGuide(): Promise<void> {
  const browser = await launchBrowser();
  try {
    const context = await newDocsContext(browser, { dpr: 2 });
    await blockWrites(context);
    const page = await context.newPage();

    const steps: [string, () => Promise<void>][] = [
      ['overview + navigation', () => overviewAndNavigation(page)],
      ['creative', () => creative(page)],
      ['carousel + dynamic poster', () => carouselAndDynamic(page)],
      ['news report', () => article(page)],
      ['social poster', () => socialPoster(page)],
      ['transcription', () => transcription(page)],
      ['translation', () => translation(context)],
      ['proofreading', () => proofreading(context)],
      ['chat', () => chat(page)],
      ['video conversations', () => videoConversations(page)],
      ['storyboard-to-video project', () => videoProject(page)],
      [
        'history, analytics, glossary, rules, templates',
        () => historyAnalyticsAdmin(page),
      ],
    ];
    const failures: string[] = [];
    for (const [label, step] of steps) {
      console.log(`${label}…`);
      try {
        await step();
      } catch (error) {
        failures.push(label);
        console.error(
          `  ✗ ${label}: ${error instanceof Error ? error.message.split('\n')[0] : error}`,
        );
      }
    }

    const mobile = await newDocsContext(browser, { mobile: true, dpr: 2 });
    await blockWrites(mobile);
    console.log('mobile navigation…');
    await mobileNavigation(mobile).catch((error) => {
      failures.push('mobile navigation');
      console.error(
        `  ✗ mobile: ${error instanceof Error ? error.message.split('\n')[0] : error}`,
      );
    });
    await mobile.close();

    if (failures.length > 0) {
      throw new Error(`Some sections failed: ${failures.join(', ')}`);
    }
  } finally {
    await browser.close();
  }
}
