# DGIPR OCR production monitor

This standalone Playwright suite uploads `fixtures/ocr-test.pdf` through the production
`/translate` document-intake UI and stops before translation. The fixture is a one-page
scan with no embedded text layer, so a successful run must exercise OCR.

The test fails when any of these regress:

- the upload, page-selection, extraction, or polling flow
- the result source is not OCR
- stable Marathi anchor words are missing
- too little Devanagari text is returned
- the document's table is no longer preserved with at least four rows
- a document-intake API request fails

Failure traces, screenshots, and video are retained. Retries are deliberately disabled:
an automatic retry would spend another paid OCR page and could hide an intermittent failure.

## Optional local verification

From this directory:

```powershell
npm.cmd install
npx.cmd playwright install chromium
npm.cmd run test:ocr
```

The final command runs one real OCR page and therefore incurs one Sarvam OCR charge.
The GitHub deployment below does not require a local install.
Override the production origin only when necessary:

```powershell
$env:OCR_BASE_URL = 'https://your-production-origin.example'
npm.cmd run test:ocr
```

## Required Checkly and GitHub setup

1. Create or sign in to a Checkly Hobby account.
2. In the GitHub repository settings, add `CHECKLY_API_KEY` as an Actions **secret** and
   `CHECKLY_ACCOUNT_ID` as an Actions **variable**. Both values are available in Checkly's
   account settings.
3. Push `.github/workflows/ocr-monitor.yml` and this `monitoring` directory to the repository's
   default branch.
4. At exactly **09:00 IST**, open GitHub **Actions > OCR production monitor > Run workflow**,
   choose `first-deploy-at-09:00`, and run it. This deploys the suite and anchors Checkly's
   native 24-hour interval to the daily 09:00 run. Singapore (`ap-southeast-1`) is the closest
   location available on Hobby.
5. In Checkly, create an email alert channel and subscribe it to the new OCR suite. Alert on
   the first failure and keep Checkly retries disabled. Playwright retries are already zero.
6. Back in GitHub Actions, use `trigger-now` once and confirm its Checkly test session passes
   and retains the artifacts. The scheduled workflow then triggers the same deployed suite at
   15:00 and 21:00 IST. Together, the daily schedule is 09:00, 15:00, and 21:00 IST.
7. In GitHub **Settings > Notifications > System > Actions**, enable email or web
   notifications for failed workflows. Checkly will report OCR/assertion failures; this second
   notification catches a broken schedule, expired API key, or failed trigger itself.

GitHub scheduled workflows can start a few minutes late during platform congestion. They run
on the default branch only. The India/UTC conversion does not change seasonally.

For later configuration changes, run the workflow manually with `deploy-update-no-run`; this
updates the suite without an extra immediate paid run or changing the daily anchor.

Checkly's Hobby plan counts a Playwright suite run in 30-second units. Three runs per day
fit its 1,000 monthly browser-run allowance only while the average duration remains below
roughly 5.5 minutes. Review the observed duration after the first week; use a paid plan or
reduce frequency if OCR regularly exceeds that budget.
