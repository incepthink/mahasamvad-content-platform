// Run B: one poster image-feedback round on the finished Run A generation.
// Captures the feedback box with a one-tap chip prefilled, the busy overlay while
// the n8n edit re-renders (a minutes-long window — easy to catch), and the poster
// version strip that appears once a second render exists.

import {
  cardByText,
  getGenerationDetail,
  gotoPage,
  launchBrowser,
  newDocsContext,
  openFold,
  pollGeneration,
  readState,
  shoot,
  sleep,
  waitReady,
} from './helpers.js';

export async function shootRunFeedback(): Promise<void> {
  const { articleId } = readState();
  if (!articleId) throw new Error('No articleId in .state.json — run `run-article` first.');

  let detail = await getGenerationDetail(articleId);
  if (detail.status !== 'completed' || !detail.posterUrl) {
    throw new Error(
      `Run A (${articleId}) must be completed with a poster (is: ${detail.status}, poster: ${Boolean(detail.posterUrl)}).`,
    );
  }

  const browser = await launchBrowser();
  try {
    const context = await newDocsContext(browser);
    const page = await context.newPage();
    await gotoPage(page, `/generations/${articleId}`);

    const posterCard = cardByText(page, 'तयार झालेले पोस्टर');
    await posterCard.waitFor({ timeout: 30000 });
    await posterCard.locator('img.poster-image').waitFor({ timeout: 30000 });
    await waitReady(page, 1500);

    // Open the picture-feedback fold and prefill via the first suggestion chip.
    const fold = await openFold(posterCard, 'चित्रात बदल हवा आहे?');
    await fold
      .locator('.suggestion-chip', { hasText: 'रंग अधिक उठावदार करा' })
      .click();
    await sleep(400);
    await shoot(posterCard, '05-feedback--poster-box');

    await fold.getByRole('button', { name: 'बदल करा' }).click();
    console.log('feedback sent — waiting for the re-render job…');

    // Wait for the revise job to register, then catch the busy overlay.
    await pollGeneration(articleId, {
      until: (d) => d.status === 'running' || d.status === 'queued',
      timeoutMs: 90_000,
      intervalMs: 1000,
    });
    await page.locator('.poster-loading').waitFor({ timeout: 30000 });
    await waitReady(page);
    await shoot(posterCard, '05-feedback--poster-busy');

    detail = await pollGeneration(articleId, {});
    if (detail.status !== 'completed') {
      throw new Error(`Poster edit ended ${detail.status}: ${detail.error ?? ''}`);
    }

    // Version strip appears once ≥2 renders exist.
    await sleep(4000);
    const strip = page.locator('.poster-versions');
    await strip.waitFor({ timeout: 30000 });
    await strip.scrollIntoViewIfNeeded();
    await waitReady(page, 1200);
    await shoot(strip, '05-feedback--versions');

    console.log('run-feedback complete.');
  } finally {
    await browser.close();
  }
}
