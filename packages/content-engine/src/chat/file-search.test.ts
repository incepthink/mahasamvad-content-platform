// No-network checks for /chat's File Search document path.
//
// Everything here is free. What it pins is the arithmetic and the guards — the two halves of
// this module that fail SILENTLY if they are wrong. A bad part plan produces a document with
// a hole in it and answers confidently from what is left; a missing size guard produces a
// 512 MB transfer that OpenAI refuses at the end of it.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MISC_CHAT_PDF_MAX_BYTES,
  planUploadParts,
  uploadOpenAiChatDocument,
  uploadPartBytes,
} from './file-search.js';

test('the size ceiling is File Search’s, not ours', () => {
  // The number this whole change exists for: the Responses file-input path it replaced was
  // capped at 50 MB, which is what made a scanned compendium unaskable.
  assert.equal(MISC_CHAT_PDF_MAX_BYTES, 512 * 1024 * 1024);
});

test('a part is never larger than the Uploads API allows', () => {
  const original = process.env.OPENAI_UPLOAD_PART_BYTES;
  try {
    delete process.env.OPENAI_UPLOAD_PART_BYTES;
    assert.equal(uploadPartBytes(), 32 * 1024 * 1024);

    process.env.OPENAI_UPLOAD_PART_BYTES = '8388608';
    assert.equal(uploadPartBytes(), 8 * 1024 * 1024);

    // Clamped rather than trusted. 64 MB is the API's own limit, and a configured value above
    // it would be rejected partway through a large upload rather than up front.
    process.env.OPENAI_UPLOAD_PART_BYTES = `${256 * 1024 * 1024}`;
    assert.equal(uploadPartBytes(), 64 * 1024 * 1024);

    process.env.OPENAI_UPLOAD_PART_BYTES = 'nonsense';
    assert.equal(uploadPartBytes(), 32 * 1024 * 1024);
  } finally {
    if (original === undefined) delete process.env.OPENAI_UPLOAD_PART_BYTES;
    else process.env.OPENAI_UPLOAD_PART_BYTES = original;
  }
});

test('the parts cover the document exactly: no gap, no overlap, nothing past the end', () => {
  const cases: readonly (readonly [number, number])[] = [
    [1, 10],
    [10, 10],
    [11, 10],
    [100, 10],
    [512 * 1024 * 1024, 32 * 1024 * 1024],
    // A document whose length is an exact multiple must not produce a trailing empty part,
    // which OpenAI rejects.
    [64 * 1024 * 1024, 32 * 1024 * 1024],
  ];
  for (const [totalBytes, partSize] of cases) {
    const parts = planUploadParts(totalBytes, partSize);
    assert.equal(parts[0]?.[0], 0, `${totalBytes}/${partSize} starts at 0`);
    assert.equal(
      parts.at(-1)?.[1],
      totalBytes,
      `${totalBytes}/${partSize} ends at the last byte`,
    );
    let covered = 0;
    for (const [index, [start, end]] of parts.entries()) {
      assert.ok(
        end > start,
        `${totalBytes}/${partSize} part ${index} is empty`,
      );
      assert.ok(
        end - start <= partSize,
        `${totalBytes}/${partSize} part ${index} is oversized`,
      );
      if (index > 0) {
        assert.equal(
          start,
          parts[index - 1]?.[1],
          `${totalBytes}/${partSize} part ${index} is not contiguous`,
        );
      }
      covered += end - start;
    }
    assert.equal(covered, totalBytes, `${totalBytes}/${partSize} coverage`);
  }
  assert.deepEqual(planUploadParts(0, 10), []);
});

test('an oversized or empty document is refused before anything is transferred', async () => {
  // The reader throws: reaching it at all would mean the guard did not fire, and on the real
  // path that is a 600 MB read out of S3 spent to earn a refusal from OpenAI.
  const read = (): Promise<Buffer> => {
    throw new Error('the document must not be read');
  };
  await assert.rejects(
    uploadOpenAiChatDocument('huge.pdf', MISC_CHAT_PDF_MAX_BYTES + 1, read),
    /512 MB/,
  );
  await assert.rejects(uploadOpenAiChatDocument('empty.pdf', 0, read), /empty/);
});
