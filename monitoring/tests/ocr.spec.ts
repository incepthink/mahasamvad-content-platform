import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const OCR_FIXTURE = fileURLToPath(
  new URL('../fixtures/ocr-test.pdf', import.meta.url),
);

const EXPECTED_MARATHI_ANCHORS = [
  'महाराष्ट्र',
  'माध्यमिक',
  'शिक्षण',
  'आवेदनपत्र',
  'शुल्क',
];

test('production Marathi OCR journey @ocr', async ({ page }) => {
  const documentApiFailures: string[] = [];
  const successfulDocumentWrites = new Set<'upload' | 'extract'>();

  page.on('requestfailed', (request) => {
    if (request.url().includes('/api/documents')) {
      documentApiFailures.push(
        `${request.method()} ${request.url()} - ${request.failure()?.errorText ?? 'request failed'}`,
      );
    }
  });

  page.on('response', (response) => {
    if (!response.url().includes('/api/documents')) return;

    const request = response.request();
    const path = new URL(response.url()).pathname;

    if (response.status() >= 400) {
      documentApiFailures.push(
        `${request.method()} ${response.url()} - HTTP ${response.status()}`,
      );
      return;
    }

    if (request.method() === 'POST' && path.endsWith('/api/documents')) {
      successfulDocumentWrites.add('upload');
    } else if (
      request.method() === 'POST' &&
      /\/api\/documents\/[^/]+\/extract$/.test(path)
    ) {
      successfulDocumentWrites.add('extract');
    }
  });

  await page.goto('/translate', { waitUntil: 'domcontentloaded' });

  const fileInput = page.locator('input[type="file"][accept*=".pdf"]');
  await expect(fileInput).toHaveCount(1);
  await fileInput.setInputFiles(OCR_FIXTURE);

  await expect(
    page.getByRole('heading', { name: 'कोणती पृष्ठे वाचायची?' }),
  ).toBeVisible({ timeout: 60_000 });

  await page.getByRole('button', { name: 'निवडलेली पृष्ठे वाचा' }).click();

  await expect(
    page.getByRole('heading', { name: 'वाचलेला मजकूर तपासा' }),
  ).toBeVisible({ timeout: 14 * 60_000 });

  // This distinguishes the paid OCR result from the API's text-layer fallback.
  await expect(
    page.getByText('मजकूर OCR ने वाचला', { exact: true }),
  ).toBeVisible();

  const pageRow = page.locator('.page-row').first();
  await expect(pageRow).toBeVisible();
  await pageRow
    .getByRole('button', { name: 'मजकूर पाहा / दुरुस्त करा' })
    .click();

  const extractedOutput = pageRow.locator(
    '.extracted-text, textarea.note-input',
  );
  await expect(extractedOutput).toBeVisible();

  const rawText = await extractedOutput.evaluate((element) =>
    element instanceof HTMLTextAreaElement
      ? element.value
      : (element.textContent ?? ''),
  );
  const normalizedText = rawText.normalize('NFC').replace(/\s+/g, ' ').trim();

  for (const anchor of EXPECTED_MARATHI_ANCHORS) {
    expect(
      normalizedText,
      `OCR output should contain the anchor "${anchor}"`,
    ).toContain(anchor);
  }

  const devanagariCharacters =
    normalizedText.match(/[\u0900-\u097F]/g)?.length ?? 0;
  expect(
    devanagariCharacters,
    'OCR should return a substantial portion of the dense one-page Marathi fixture',
  ).toBeGreaterThanOrEqual(800);

  const extractedTable = pageRow.locator('.extracted-text table');
  await expect(extractedTable).toHaveCount(1);
  expect(
    await extractedTable.locator('tr').count(),
    'OCR should preserve the header and at least three data rows',
  ).toBeGreaterThanOrEqual(4);

  expect(
    documentApiFailures,
    'All document intake API requests should succeed',
  ).toEqual([]);
  expect(
    successfulDocumentWrites,
    'The browser should upload the fixture and explicitly start extraction',
  ).toEqual(new Set(['upload', 'extract']));
});
