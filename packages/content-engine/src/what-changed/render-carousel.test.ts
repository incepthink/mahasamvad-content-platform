import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { writeWhatChangedCarousel } from './render-carousel.js';
import type { WhatChangedResult } from './types.js';

const fixture: WhatChangedResult = {
  subject: 'कोयना धरण',
  scannedArticleCount: 500,
  candidateCount: 8,
  latestArticleId: 2,
  articles: [
    {
      articleId: 1,
      title: 'कोयना धरण प्रकल्पाची पहिली नोंद',
      url: 'https://mahasamvad.in/one',
      publishedTime: '2025-01-10T10:00:00+05:30',
      text: 'पहिली नोंद',
    },
    {
      articleId: 2,
      title: 'कोयना धरण कामाचा नवा टप्पा',
      url: 'https://mahasamvad.in/two',
      publishedTime: '2026-07-29T10:00:00+05:30',
      text: 'नवी नोंद',
    },
  ],
  analysis: {
    heading: 'कोयना धरण — काय बदलले?',
    summary: 'दोन संग्रहित लेखांमधून विषयाची स्पष्ट प्रगती दिसते.',
    latest: {
      title: 'सध्याची स्थिती',
      detail: 'नव्या लेखात कामाचा पुढील टप्पा नोंदवला आहे.',
      citations: [2],
    },
    changes: [
      {
        label: 'नवीन निर्णय',
        title: 'कामाचा नवा टप्पा',
        before: 'आधी प्राथमिक निर्णय नोंदला होता.',
        now: 'नव्या टप्प्याची घोषणा झाली.',
        explanation: 'नवीन लेखाने आधीच्या नोंदीत भर घातली.',
        citations: [1, 2],
      },
    ],
    unchanged: [
      {
        title: 'मूळ उद्देश कायम',
        detail: 'दोन्ही लेखांत प्रकल्पाचा मूळ उद्देश कायम आहे.',
        citations: [1, 2],
      },
    ],
    conflicts: [
      {
        title: 'मुदतीत तफावत',
        earlier: 'पहिल्या लेखात जुनी मुदत आहे.',
        later: 'नव्या लेखात वेगळी मुदत आहे.',
        status: 'बदलाचे कारण स्पष्ट नाही.',
        citations: [1, 2],
      },
    ],
    nextSteps: [
      {
        title: 'पुढील आढावा',
        detail: 'नव्या लेखानुसार पुढील आढावा होणार आहे.',
        citations: [2],
      },
    ],
    timeline: [
      {
        articleId: 1,
        label: 'पहिली नोंद',
        title: 'प्रारंभिक निर्णय',
        summary: 'विषयाची पहिली संग्रहित स्थिती.',
        citations: [1],
      },
      {
        articleId: 2,
        label: 'अंमलबजावणी',
        title: 'नवा टप्पा',
        summary: 'अंमलबजावणीचा पुढील टप्पा नोंदला.',
        citations: [2],
      },
    ],
  },
};

test('writes a cited Nirmala UI carousel and individual slide pages', async () => {
  const outputDir = await mkdtemp(join(tmpdir(), 'dgipr-what-changed-'));
  try {
    const rendered = await writeWhatChangedCarousel(fixture, outputDir);
    assert.ok(rendered.slideCount >= 8);

    const index = await readFile(rendered.indexPath, 'utf8');
    assert.match(index, /font-family:"Nirmala UI"/);
    assert.match(index, /नोंदी कुठे जुळत नाहीत\?/);
    assert.match(index, /href="#source-1"/);
    assert.match(index, /@page\{size:1080px 1350px/);
    assert.doesNotMatch(index, /undefined/);

    const files = await readdir(join(outputDir, 'slides'));
    assert.equal(files.length, rendered.slideCount);
    assert.ok(files.every((file) => /^\d{2}\.html$/.test(file)));
    const currentSlide = await readFile(
      join(outputDir, 'slides', '02.html'),
      'utf8',
    );
    assert.match(currentSlide, /href="\.\.\/index\.html#source-2"/);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});
