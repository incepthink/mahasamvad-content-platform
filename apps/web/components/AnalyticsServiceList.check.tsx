// Assertions for the वापरलेल्या सेवा table. Free — no API, no model, no browser.
//
//   npx tsx --tsconfig apps/web/tsconfig.check.json apps/web/components/AnalyticsServiceList.check.tsx
//
// (from a workspace that has tsx — packages/content-engine does. The extra tsconfig is
// there because the app's own sets `jsx: preserve`, which leaves a standalone runner with
// no JSX factory. The markdownRender.check.tsx precedent.)
//
// Two things are pinned here, and neither is visible by reading the component.
//
// The FIRST is that no supplier or model id reaches the rendered page. The platform does not
// name the vendor behind a service anywhere an officer can read it, and this table was the
// last place that did — "OpenAI · gpt-5.6-sol" under every row.
//
// The SECOND is the consequence of the first. The aggregator keys a row on
// [task, key, provider, model], so a window spanning a provider swap produces several rows
// of the same service; with the provider line gone those would render as identical
// duplicates. They are merged, and a merge is arithmetic nobody checks by looking at a page.

import { renderToStaticMarkup } from 'react-dom/server';
import { AnalyticsServiceList } from './AnalyticsServiceList';
import type { AnalyticsService } from '@dgipr/schemas';

let failures = 0;
let checks = 0;

function check(label: string, ok: boolean, detail?: string): void {
  checks += 1;
  if (!ok) {
    failures += 1;
    console.log(`FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    console.log(`ok   ${label}`);
  }
}

function service(over: Partial<AnalyticsService>): AnalyticsService {
  return {
    task: 'article_drafting',
    key: 'text',
    provider: 'openai',
    model: 'gpt-5.6-sol',
    calls: 10,
    units: 1000,
    unit: 'chars',
    costInr: 12.5,
    costEstimated: false,
    eventBacked: false,
    legacy: false,
    ...over,
  };
}

function render(services: readonly AnalyticsService[]): string {
  return renderToStaticMarkup(<AnalyticsServiceList services={services} />);
}

// ---------------------------------------------------------------------------
// No vendor reaches the page
// ---------------------------------------------------------------------------

// Every provider the aggregator can emit, each carrying a model id that names its vendor
// just as plainly as the provider field does — dropping one and keeping the other would
// leave "gpt-5.6-sol" on the row and change nothing.
const EVERY_PROVIDER = render([
  service({ task: 'article_drafting', key: 'text', provider: 'openai' }),
  service({
    task: 'audio_transcription',
    key: 'stt',
    provider: 'elevenlabs',
    model: 'scribe_v1',
    unit: 'minutes',
  }),
  service({
    task: 'document_ocr',
    key: 'ocr',
    provider: 'sarvam',
    model: 'sarvam-doc',
    unit: 'pages',
  }),
  service({
    task: 'video_clip_creation',
    key: 'clip',
    provider: 'kling',
    model: 'kling-3.0',
    unit: 'clips',
  }),
  service({
    task: 'video_storyboard_creation',
    key: 'image',
    provider: 'gemini',
    model: 'gemini-3-pro-image-preview',
    unit: 'images',
  }),
]);

for (const vendor of [
  'OpenAI',
  'openai',
  'gpt-',
  'ElevenLabs',
  'elevenlabs',
  'scribe',
  'Sarvam',
  'sarvam',
  'Kling',
  'kling',
  'Gemini',
  'gemini',
  'Google',
  'Veo',
]) {
  check(
    `no "${vendor}" in the rendered table`,
    !EVERY_PROVIDER.includes(vendor),
  );
}

// The row still says WHAT ran and how much it cost — the point is to drop the supplier, not
// the attribution. A blank sub-line would be a worse page than the one being fixed.
check('the service is still named', EVERY_PROVIDER.includes('ध्वनिलेखन'));
check('the cost is still shown', EVERY_PROVIDER.includes('₹'));

// ---------------------------------------------------------------------------
// Rows a reader can no longer tell apart are merged
// ---------------------------------------------------------------------------

// The real case: one window spans a chat-provider swap, so the same task ran the same
// service on two backends. Before the merge this printed "मजकूर निर्मिती" twice with two
// part-figures and nothing saying why.
const SWAPPED = render([
  service({
    provider: 'openai',
    model: 'gpt-5.6-sol',
    calls: 10,
    units: 1000,
    costInr: 12.5,
  }),
  service({
    provider: 'qwen',
    model: 'qwen3',
    calls: 4,
    units: 400,
    costInr: 2.5,
  }),
]);

// One `service-name` and no `service-detail-name` is the single-row shape: the task is not
// promoted to a heading with children, because after merging there is only one child.
check(
  'a provider swap renders as ONE row',
  (SWAPPED.match(/service-name/g) ?? []).length === 1 &&
    (SWAPPED.match(/service-detail-name/g) ?? []).length === 0,
  SWAPPED,
);
check('the merged row sums calls', SWAPPED.includes('१४'));
check('the merged row sums cost', SWAPPED.includes('₹१५'));

// A task genuinely running two DIFFERENT services still shows both — merging by task alone
// would hide that a marker poster revision is a vision call plus an image call.
const TWO_SERVICES = render([
  service({ task: 'poster_revision', key: 'text', calls: 2 }),
  service({ task: 'poster_revision', key: 'image', unit: 'images', calls: 3 }),
]);
check(
  'two different services under one task stay two rows',
  (TWO_SERVICES.match(/service-detail-name/g) ?? []).length === 2,
);

// "Not priced" and "₹0" are different answers, and the merge must not turn the first into
// the second — a dash means "counted elsewhere", ₹0 reads as "free".
const UNPRICED = render([
  service({ costInr: null, calls: 1 }),
  service({ provider: 'qwen', model: 'qwen3', costInr: null, calls: 1 }),
]);
check(
  'merging two unpriced rows keeps the dash',
  UNPRICED.includes('service-cost-none'),
);

// Units are a property of the service key, so this should not arise — but adding pages to
// minutes would be a wrong number printed with total confidence, so it is guarded.
const MIXED_UNITS = render([
  service({ task: 'document_ocr', key: 'ocr', unit: 'pages', calls: 1 }),
  service({
    task: 'document_ocr',
    key: 'ocr',
    unit: 'minutes',
    provider: 'sarvam',
    model: 'x',
    calls: 1,
  }),
]);
check(
  'rows with different units are NOT merged',
  (MIXED_UNITS.match(/service-detail-name/g) ?? []).length === 2,
);

console.log(`${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exit(1);
