import assert from 'node:assert/strict';
import { test } from 'node:test';
import { splitToLimit } from './translate-article.js';

const SARVAM_SAFE_LIMIT = 1_800;

test('a 28,453-character sentence is always split below the Sarvam limit', () => {
  const input = 'अ'.repeat(28_453);
  const chunks = splitToLimit(input, SARVAM_SAFE_LIMIT);

  assert.equal(chunks.join(''), input);
  assert.equal(chunks.length, Math.ceil(input.length / SARVAM_SAFE_LIMIT));
  assert.ok(chunks.every((chunk) => chunk.length <= SARVAM_SAFE_LIMIT));
});

test('long punctuation-free prose prefers whitespace without losing words', () => {
  const input = 'महाराष्ट्र शासन '.repeat(2_500).trim();
  const chunks = splitToLimit(input, SARVAM_SAFE_LIMIT);

  assert.equal(chunks.join(' '), input);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.length <= SARVAM_SAFE_LIMIT));
});

test('sentence-sized units are packed without exceeding the limit', () => {
  const input = `${'अ'.repeat(700)}। ${'ब'.repeat(700)}। ${'क'.repeat(700)}।`;
  const chunks = splitToLimit(input, SARVAM_SAFE_LIMIT);

  assert.equal(chunks.length, 2);
  assert.ok(chunks.every((chunk) => chunk.length <= SARVAM_SAFE_LIMIT));
});

test('an invalid chunk limit is rejected before translation starts', () => {
  assert.throws(() => splitToLimit('मजकूर', 0), RangeError);
});
