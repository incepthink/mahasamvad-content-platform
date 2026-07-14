// Run C: a Twitter post spawned from Run A's detail page via the "पुढील पाऊल"
// cross-format action. Twitter runs never navigate — the tasks modal is their
// primary surface — so this phase captures: the started-success line, the modal
// with a pulsing running row + live step label, the determinate progress bar on
// the run's own page, the finished SocialPostView (poster + caption), and the
// completed task row with its thumbnail.

import {
  cardByText,
  closeTasksModal,
  getGenerationDetail,
  gotoPage,
  haveShot,
  isTerminal,
  launchBrowser,
  newDocsContext,
  openFold,
  openTasksModal,
  pollGeneration,
  readState,
  shoot,
  sleep,
  waitReady,
  writeState,
} from './helpers.js';

export async function shootRunTwitter(): Promise<void> {
  const { articleId } = readState();
  if (!articleId) throw new Error('No articleId in .state.json — run `run-article` first.');
  const source = await getGenerationDetail(articleId);
  if (source.status !== 'completed') {
    throw new Error(`Run A (${articleId}) is ${source.status}; needs to be completed.`);
  }

  const browser = await launchBrowser();
  try {
    const context = await newDocsContext(browser);
    const page = await context.newPage();
    await gotoPage(page, `/generations/${articleId}`);

    const next = page.locator('.next-actions');
    await next.waitFor({ timeout: 30000 });
    const fold = await openFold(next, 'याच टिपणीवरून ट्विटर पोस्ट');
    if (!haveShot('07-next--twitter-fold')) {
      await sleep(800);
      await shoot(next, '07-next--twitter-fold');
    }

    await fold.getByRole('button', { name: 'ट्विटर पोस्ट तयार करा' }).click();

    // The panel opens itself on submit; the only tracked task in this fresh
    // session is the new twitter run.
    const modal = page.locator('.tasks-modal');
    await modal.waitFor({ timeout: 20000 });
    const href = await modal
      .locator('.task-row')
      .first()
      .getAttribute('href', { timeout: 20000 });
    const twitterId = href!.split('/').pop()!;
    writeState({ twitterId });
    console.log(`twitter run started: ${twitterId}`);

    // Running row with its live step label.
    await pollGeneration(twitterId, {
      until: (d) => d.status === 'running' || isTerminal(d),
      timeoutMs: 90_000,
      intervalMs: 1000,
    });
    await sleep(3500);
    await waitReady(page);
    await shoot(page, '06-twitter--tasks-running');

    // Success line under the fold (modal closed).
    await closeTasksModal(page);
    await shoot(next, '07-next--twitter-started');

    // Follow the task to its own page (client-side, keeps the session task list).
    await openTasksModal(page);
    await page.locator('.task-row').first().click();
    await page.waitForURL(new RegExp(twitterId), { timeout: 15000 });

    // Determinate progress bar mid-run (copy/image ≈ 50–75%).
    if (!haveShot('06-twitter--progressbar')) {
      await pollGeneration(twitterId, {
        until: (d) => d.step === 'copy' || d.step === 'image' || isTerminal(d),
        timeoutMs: 10 * 60 * 1000,
        intervalMs: 1000,
      });
      await sleep(3500);
      await waitReady(page);
      await shoot(page, '06-twitter--progressbar', { fullPage: true });
    }

    const detail = await pollGeneration(twitterId, {});
    if (detail.status !== 'completed') {
      throw new Error(`Twitter run ended ${detail.status}: ${detail.error ?? ''}`);
    }

    // Finished view: poster + caption + download/copy/regenerate.
    await sleep(4000);
    await waitReady(page, 1500);
    const socialCard = cardByText(page, 'कॅप्शन कॉपी करा');
    await socialCard.waitFor({ timeout: 30000 });
    await socialCard.locator('img.poster-image').waitFor({ timeout: 30000 });
    await waitReady(page, 1200);
    await shoot(socialCard, '06-twitter--socialpost');

    // Completed task row: thumbnail + "पूर्ण".
    await openTasksModal(page);
    await sleep(3000); // one provider poll + thumbnail decode
    await shoot(page, '06-twitter--tasks-done');
    await closeTasksModal(page);

    console.log('run-twitter complete.');
  } finally {
    await browser.close();
  }
}
