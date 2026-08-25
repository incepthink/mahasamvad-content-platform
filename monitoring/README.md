# DGIPR production monitoring

This directory contains two Checkly Playwright suites:

- `Production - External provider API canaries` calls the external AI providers directly
  once per day with the smallest useful inputs.
- `Production - Marathi OCR journey` exercises the complete production browser flow three
  times per day.

## External provider API canaries

One canary run performs exactly one paid operation for each capability:

| Capability         | Request used by the canary                                                       |
| ------------------ | -------------------------------------------------------------------------------- |
| OpenAI             | One Responses API request to `gpt-5.6`, reasoning disabled, asking for `OK`      |
| Sarvam translation | One short Marathi-to-Hindi request using `sarvam-translate:v1`                   |
| Sarvam OCR         | One one-page PDF submitted to Document AI `digitise`, then polled and downloaded |
| ElevenLabs TTS     | One `नमस्कार.` generation using the configured production voice/model            |
| ElevenLabs STT     | The generated TTS clip transcribed once with the configured Scribe model         |

The ElevenLabs calls form one small round trip, so no additional audio fixture or duplicate
TTS call is needed. Sarvam OCR's create/status/download lifecycle uses several HTTP requests,
but creates only one billable one-page job. All retries are disabled to prevent a monitor from
silently repeating a paid operation.

The direct canary validates provider authentication, the exact endpoints/models, response
shape, and non-empty results. The browser OCR journey below remains the deeper Marathi OCR
quality check.

### Canary secrets

In Checkly, open **Environment variables** and add these four values as global **secrets**:

- `OPENAI_API_KEY`
- `SARVAM_API_KEY`
- `ELEVENLABS_API_KEY`
- `ELEVENLABS_VOICE_ID`

The defaults match this repository: `gpt-5.6`, `sarvam-translate:v1`, `eleven_v3`,
`scribe_v1`, and Marathi STT language `mar`. If production overrides an ElevenLabs setting,
add the corresponding non-secret Checkly variable from `.env.canaries.example` so the canary
tests the same model. `SARVAM_TRANSLATE_URL` can likewise mirror a production URL override.

## Marathi OCR browser journey

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

To run only the direct provider canaries locally, set the same four secrets in the shell and
run:

```powershell
$env:OPENAI_API_KEY = '...'
$env:SARVAM_API_KEY = '...'
$env:ELEVENLABS_API_KEY = '...'
$env:ELEVENLABS_VOICE_ID = '...'
npm.cmd run test:canaries
```

This makes one real paid operation per capability. For Checkly-hosted pre-deploy testing,
store the secrets in Checkly and use the GitHub workflow mode described below instead.

## Required Checkly and GitHub setup

1. Create or sign in to a Checkly Hobby account.
2. In the GitHub repository settings, add `CHECKLY_API_KEY` as an Actions **secret** and
   `CHECKLY_ACCOUNT_ID` as an Actions **variable**. Both values are available in Checkly's
   account settings. A `CHECKLY_ACCOUNT_ID` secret also works as a fallback.
3. Add the four provider secrets listed above to Checkly. Push
   `.github/workflows/ocr-monitor.yml` and this `monitoring` directory to the repository's
   default branch.
4. To test the provider canaries without deploying them, open GitHub
   **Actions > Production monitors > Run workflow**, choose
   `test-provider-canaries-before-deploy`, and run it. It uses the Checkly secrets and records
   the session, but does not create a schedule.
5. Run the same workflow with `deploy-update-no-run`. This deploys both monitoring suites
   without spending on an immediate run. Then use `trigger-provider-canaries-now` once to
   confirm the deployed canaries pass. Checkly runs the canary suite every 24 hours from
   Singapore (`ap-southeast-1`).
6. To test the browser OCR suite before deployment, choose `test-now-before-deploy`. This
   performs one real paid OCR page and records the test session without deploying the suite.
7. For a completely new Checkly project, at exactly **09:00 IST** use
   `first-deploy-at-09:00`; it deploys both suites and anchors their native 24-hour interval.
8. In Checkly, create an email alert channel and subscribe it to both suites. Alert on the
   first failure and keep Checkly retries disabled. Playwright retries are already zero.
9. Use `trigger-deployed-now` for an additional manual browser OCR check. The scheduled
   workflow triggers that deployed suite at 15:00 and 21:00 IST. Together, the daily schedule
   is 09:00, 15:00, and 21:00 IST.
10. In GitHub **Settings > Notifications > System > Actions**, enable email or web
    notifications for failed workflows. Checkly will report OCR/assertion failures; this second
    notification catches a broken schedule, expired API key, or failed trigger itself.

GitHub scheduled workflows can start a few minutes late during platform congestion. They run
on the default branch only. The India/UTC conversion does not change seasonally.

For later configuration changes, run `deploy-update-no-run`; this updates both suites without
an extra immediate paid run or changing their daily anchors.

Checkly's Hobby plan counts a Playwright suite run in 30-second units. Three runs per day
fit its 1,000 monthly browser-run allowance only while the average duration remains below
roughly 5.5 minutes. Review the observed duration after the first week; use a paid plan or
reduce frequency if OCR regularly exceeds that budget.
