// Run A (+A2): ONE real scheme article+poster generation ("दोन्ही") from the
// trial-input.txt note, photographed through the filled create form, the live
// progress steps (early + mid), the mid-run home-form busy callout + running task
// row, the article-with-poster-skeleton phase, every finished-result panel, and
// the on-demand English translation toggle.
//
// Progress states are captured opportunistically: the API is polled every 1.5s
// and the page is photographed ~3s after a target step appears (the UI itself
// polls every 2.5s). Only the early + mid progress shots are required; the rest
// are bonuses, so a missed window is not a failure.

import {
  cardByText,
  closeFold,
  getGenerationDetail,
  gotoPage,
  haveShot,
  launchBrowser,
  newDocsContext,
  openFold,
  openTasksModal,
  pollGeneration,
  readNoteFixture,
  shoot,
  sleep,
  waitReady,
  writeState,
} from './helpers.js';

// Heading echoing the scheme name from the note itself — nothing invented.
const HEADING = 'पुण्यश्लोक अहिल्यादेवी होळकर शेतकरी कर्जमुक्ती योजना, २०२६';

export async function shootRunArticle(): Promise<void> {
  const browser = await launchBrowser();
  try {
    const context = await newDocsContext(browser);
    const page = await context.newPage();

    // ---- create + submit --------------------------------------------------
    await gotoPage(page, '/');
    await page.fill('#note', readNoteFixture());
    await page.fill('#heading', HEADING);
    await page.locator('.output-option', { hasText: 'योजना-लेख' }).first().click();
    await page.locator('.output-option', { hasText: 'दोन्ही' }).first().click();
    await waitReady(page);
    await shoot(page, '03-create--filled-form', { fullPage: true });

    await page.getByRole('button', { name: 'तयार करा →' }).click();
    await page.waitForURL(/\/generations\/[0-9a-f-]+/i, { timeout: 30000 });
    const id = page.url().split('/').pop()!;
    writeState({ articleId: id });
    console.log(`generation started: ${id}`);

    // ---- live progress capture --------------------------------------------
    let earlyDone = haveShot('04-progress--early');
    let midDone = haveShot('04-progress--mid');
    let skeletonDone = haveShot('04-results--article-poster-skeleton');
    let busyCalloutDone = haveShot('11-faq--busy-callout');

    await pollGeneration(id, {
      onChange: async (detail) => {
        console.log(`  step: ${detail.step ?? '-'} (${detail.status})`);
        if (detail.status !== 'running' && detail.status !== 'queued') return;

        if (!earlyDone && detail.status === 'running' && detail.step) {
          await sleep(3000);
          await waitReady(page);
          await shoot(page, '04-progress--early', { fullPage: true });
          earlyDone = true;
        }

        if (!midDone && detail.step === 'draft') {
          await sleep(3000);
          await waitReady(page);
          await shoot(page, '04-progress--mid', { fullPage: true });
          midDone = true;

          // The draft step is the longest window: use it for the home-form busy
          // callout + the running task row. Client-side nav only — a reload would
          // wipe the in-memory session task list that drives both states.
          if (!busyCalloutDone) {
            await page.locator('.site-nav a', { hasText: 'नवीन मजकूर' }).click();
            await page
              .locator('.info-callout')
              .first()
              .waitFor({ timeout: 10000 });
            await shoot(cardByText(page, 'लेखाचा प्रकार?'), '11-faq--busy-callout');
            busyCalloutDone = true;
            const modal = await openTasksModal(page);
            await sleep(600);
            await shoot(page, '02-nav--tasks-article-running');
            await modal.locator('.task-row').first().click(); // back to the run
            await page.waitForURL(new RegExp(id), { timeout: 10000 });
          }
        }

        if (
          !skeletonDone &&
          Boolean(detail.article) &&
          !detail.posterUrl &&
          (detail.step === 'copy' ||
            detail.step === 'scene' ||
            detail.step === 'render')
        ) {
          await sleep(3500);
          await waitReady(page);
          await shoot(page, '04-results--article-poster-skeleton', {
            fullPage: true,
          });
          skeletonDone = true;
        }
      },
    });

    const detail = await getGenerationDetail(id);
    if (detail.status !== 'completed') {
      throw new Error(
        `Run ${id} ended ${detail.status}: ${detail.error ?? '(no error message)'}`,
      );
    }

    // ---- finished-run shots ------------------------------------------------
    await sleep(4000); // let the page's own poll swap to the completed view
    await waitReady(page);

    const articleCard = cardByText(page, 'तयार झालेला लेख');
    await articleCard.waitFor({ timeout: 30000 });
    await shoot(articleCard, '04-results--article');

    const fiveW = cardByText(page, 'थोडक्यात — कोण');
    if ((await fiveW.count()) > 0) await shoot(fiveW, '04-results--5w1h');

    const factFold = await openFold(page, 'तथ्य-तपासणी');
    await shoot(factFold, '04-results--factcheck');
    await closeFold(factFold);

    const posterCard = cardByText(page, 'तयार झालेले पोस्टर');
    await posterCard.waitFor({ timeout: 30000 });
    await posterCard.locator('img.poster-image').waitFor({ timeout: 30000 });
    await waitReady(page, 1500); // let the poster bitmap decode
    await shoot(posterCard, '04-results--poster-panel');

    const fbFold = await openFold(page, 'लेखात बदल हवा आहे?');
    await shoot(fbFold, '05-feedback--article-chips');
    await closeFold(fbFold);

    const next = page.locator('.next-actions');
    await shoot(next, '07-next--panel');
    const twFold = await openFold(next, 'याच टिपणीवरून ट्विटर पोस्ट');
    await sleep(600);
    await shoot(next, '07-next--twitter-fold');
    await closeFold(twFold);
    const enFold = await openFold(next, 'टिपणी बदलून');
    await shoot(next, '07-next--editnote-fold');
    await closeFold(enFold);

    // ---- A2: on-demand English translation ---------------------------------
    if (!haveShot('04-results--article-english')) {
      await articleCard
        .getByRole('button', { name: 'इंग्रजीत भाषांतर करा' })
        .click();
      await page
        .locator('.translating-note')
        .waitFor({ timeout: 15000 })
        .catch(() => undefined);
      await shoot(articleCard, '04-results--article-translating');
      await pollGeneration(id, {
        until: (d) => Boolean(d.articleEnglish) || Boolean(d.translateError),
        timeoutMs: 10 * 60 * 1000,
      });
      await sleep(4000);
      const englishBtn = articleCard.getByRole('button', { name: 'English' });
      await englishBtn.waitFor({ timeout: 15000 });
      await englishBtn.click();
      await sleep(600);
      await shoot(articleCard, '04-results--article-english');
    }

    console.log('run-article complete.');
  } finally {
    await browser.close();
  }
}
