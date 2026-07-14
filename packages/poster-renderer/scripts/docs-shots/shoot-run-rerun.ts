// Run D: the edit-note rerun from Run A's "पुढील पाऊल" panel. One small marker
// line is appended to the prefilled note (no facts touched), producing a new run
// whose thread rail shows all three lineage nodes — the original (मूळ), the
// twitter follow-up, and this rerun with its "बदललेली टिपणी" badge. The run is
// then left to finish so the history grid photographs a settled state.

import {
  getGenerationDetail,
  gotoPage,
  haveShot,
  launchBrowser,
  newDocsContext,
  openFold,
  pollGeneration,
  readState,
  shoot,
  sleep,
  waitReady,
  writeState,
} from './helpers.js';

export async function shootRunRerun(): Promise<void> {
  const { articleId } = readState();
  if (!articleId) throw new Error('No articleId in .state.json — run `run-article` first.');
  const source = await getGenerationDetail(articleId);
  if (source.status !== 'completed') {
    throw new Error(
      `Run A (${articleId}) is ${source.status}; the article lane must be free (run-feedback finished).`,
    );
  }

  const browser = await launchBrowser();
  try {
    const context = await newDocsContext(browser);
    const page = await context.newPage();
    await gotoPage(page, `/generations/${articleId}`);

    const next = page.locator('.next-actions');
    await next.waitFor({ timeout: 30000 });
    const fold = await openFold(next, 'टिपणी बदलून');
    if (!haveShot('07-next--editnote-fold')) {
      await shoot(next, '07-next--editnote-fold');
    }

    const textarea = fold.locator('textarea');
    const current = await textarea.inputValue();
    await textarea.fill(`${current}\n\n(टीप: ही टिपणीची सुधारित आवृत्ती आहे.)`);
    await fold.getByRole('button', { name: 'नव्याने तयार करा' }).click();
    await page.waitForURL(
      (url) =>
        url.pathname.startsWith('/generations/') &&
        !url.pathname.includes(articleId),
      { timeout: 30000 },
    );
    const rerunId = page.url().split('/').pop()!;
    writeState({ rerunId });
    console.log(`rerun started: ${rerunId}`);

    // Thread rail: visible as soon as the lineage has >1 member.
    const rail = page.locator('.thread-card');
    await rail.waitFor({ timeout: 30000 });
    await waitReady(page, 2000); // let node thumbnails decode
    await shoot(rail, '07-next--thread-rail');

    // Let the run finish so the history grid shows a settled state (its progress
    // states already exist from Run A and are skipped by shoot()).
    console.log('waiting for the rerun to finish…');
    const detail = await pollGeneration(rerunId, {
      onChange: async (d) => {
        console.log(`  step: ${d.step ?? '-'} (${d.status})`);
      },
    });
    console.log(`rerun ended: ${detail.status}`);
    await sleep(1000);
  } finally {
    await browser.close();
  }
}
