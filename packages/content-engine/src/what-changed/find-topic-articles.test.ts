import assert from 'node:assert/strict';
import { test } from 'node:test';
import { topicLexicalScore } from './find-topic-articles.js';
import type { StoredNewsArticle } from './types.js';

function article(title: string, text: string): StoredNewsArticle {
  return {
    articleId: 1,
    title,
    text,
    url: 'https://mahasamvad.in/test',
    publishedTime: '2026-01-01T00:00:00Z',
  };
}

test('a common subject word alone is not a multi-word topic match', () => {
  const unrelated = article(
    'राज्यातील धरणसाठ्याचा आढावा',
    'राज्यातील विविध धरणांमध्ये पाणीसाठा वाढला आहे.',
  );
  assert.equal(topicLexicalScore(unrelated, 'कोयना धरण'), 0);
});

test('exact and close reordered subject words remain topic matches', () => {
  const exact = article(
    'कोयना धरणाबाबत बैठक',
    'कोयना धरणाच्या कामाचा आढावा घेण्यात आला.',
  );
  const reordered = article(
    'प्रकल्पाचा आढावा',
    'धरण परिसरातील कोयना प्रकल्पाच्या कामावर चर्चा झाली.',
  );
  assert.ok(topicLexicalScore(exact, 'कोयना धरण') > 0);
  assert.ok(topicLexicalScore(reordered, 'कोयना धरण') > 0);
});
