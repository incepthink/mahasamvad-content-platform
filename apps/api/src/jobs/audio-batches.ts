// How many recordings a transcription job may hold in memory at once.
//
// WHY THIS EXISTS. Both transcribe phases — /transcribe's and /dlo's — used to download
// EVERY recording of a run up front, with one `Promise.all`, and hand the whole array to the
// STT seam. That is fine for the 2 MB voice notes the feature was built on and impossible for
// what officers actually upload: ten two-hour meeting recordings is several gigabytes resident
// on a box that also runs n8n, PostgREST and Chromium, and the process is killed long before
// the first transcript comes back. The upload side of the same problem was fixed on 2026-08-30
// by streaming straight to S3 (uploadStream); this is the other half, because a recording that
// now uploads successfully still has to be transcribable.
//
// The recordings are therefore processed in GROUPS whose total size is bounded. Grouping
// rather than one-at-a-time is deliberate: Sarvam transcribes a whole group in ONE batch job,
// so a run of small recordings keeps costing one call rather than N.
//
// A FILE IS NEVER REFUSED FOR BEING TOO BIG. One recording larger than the whole budget simply
// gets a group to itself — that is the officer's meeting, and the product's answer to it has to
// be "this takes a while", never "no".
const DEFAULT_BATCH_MAX_BYTES = 256 * 1024 * 1024;

export function sttBatchMaxBytes(): number {
  const raw = process.env.STT_BATCH_MAX_BYTES;
  if (raw === undefined || raw.trim() === '') return DEFAULT_BATCH_MAX_BYTES;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : DEFAULT_BATCH_MAX_BYTES;
}

// Group positions 0..sizes.length-1 into consecutive batches whose known sizes sum to at most
// `budget`, preserving order.
//
// An UNKNOWN size (`undefined`) counts as the whole budget, which puts it in a group of its
// own. Two things arrive that way and both deserve the cautious reading: a recording uploaded
// before sizes were recorded, and a pasted link, whose audio is downloaded inside the STT seam
// and whose length nothing here can know.
export function batchBySize(
  sizes: readonly (number | undefined)[],
  budget: number = sttBatchMaxBytes(),
): number[][] {
  const batches: number[][] = [];
  let current: number[] = [];
  let used = 0;
  for (const [index, size] of sizes.entries()) {
    const weight = size ?? budget;
    // `current.length > 0` is what keeps an oversized single item from being dropped: it
    // starts a fresh group and is transcribed alone rather than refused.
    if (current.length > 0 && used + weight > budget) {
      batches.push(current);
      current = [];
      used = 0;
    }
    current.push(index);
    used += weight;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

// Free harness: npx tsx apps/api/src/jobs/audio-batches.ts
if (
  process.argv[1] &&
  process.argv[1].replace(/\\/g, '/').endsWith('src/jobs/audio-batches.ts')
) {
  const checks: Array<[string, boolean]> = [];
  const check = (label: string, ok: boolean): void => {
    checks.push([label, ok]);
  };
  const eq = (a: number[][], b: number[][]): boolean =>
    JSON.stringify(a) === JSON.stringify(b);
  const MB = 1024 * 1024;

  check('nothing in, nothing out', eq(batchBySize([], 100 * MB), []));
  check(
    'one small recording is one group',
    eq(batchBySize([5 * MB], 100 * MB), [[0]]),
  );
  check(
    'small recordings share a group',
    eq(batchBySize([5 * MB, 5 * MB, 5 * MB], 100 * MB), [[0, 1, 2]]),
  );
  check(
    'a group closes when the next file would exceed the budget',
    eq(batchBySize([60 * MB, 60 * MB, 10 * MB], 100 * MB), [[0], [1, 2]]),
  );
  // The property the officer's 239.6 MB recording depends on: too big for the budget is
  // still transcribed, alone, rather than refused.
  check(
    'a recording larger than the whole budget gets its own group',
    eq(batchBySize([500 * MB], 100 * MB), [[0]]),
  );
  check(
    'an oversized recording does not swallow its neighbours',
    eq(batchBySize([5 * MB, 500 * MB, 5 * MB], 100 * MB), [[0], [1], [2]]),
  );
  check(
    'exactly the budget still fits in one group',
    eq(batchBySize([50 * MB, 50 * MB], 100 * MB), [[0, 1]]),
  );
  // An unknown size is an old row or a pasted link, and is read as a group's worth.
  check(
    'an unknown size is isolated',
    eq(batchBySize([5 * MB, undefined, 5 * MB], 100 * MB), [[0], [1], [2]]),
  );
  check(
    'order is always preserved',
    eq(batchBySize([40 * MB, 40 * MB, 40 * MB, 40 * MB], 100 * MB), [
      [0, 1],
      [2, 3],
    ]),
  );
  // Every input must appear exactly once, whatever the sizes — a dropped position is a
  // recording that silently never gets transcribed.
  const sizes = [1, undefined, 900, 2, 3, 400, undefined, 5].map((value) =>
    value === undefined ? undefined : value * MB,
  );
  const flat = batchBySize(sizes, 100 * MB).flat();
  check(
    'every recording appears exactly once, in order',
    flat.length === sizes.length && flat.every((value, i) => value === i),
  );

  const zero = process.env.STT_BATCH_MAX_BYTES;
  process.env.STT_BATCH_MAX_BYTES = '';
  check('an empty env value falls back to the default', sttBatchMaxBytes() > 0);
  process.env.STT_BATCH_MAX_BYTES = 'nonsense';
  check('junk falls back to the default', sttBatchMaxBytes() > 0);
  process.env.STT_BATCH_MAX_BYTES = String(64 * MB);
  check('a configured budget is honoured', sttBatchMaxBytes() === 64 * MB);
  if (zero === undefined) delete process.env.STT_BATCH_MAX_BYTES;
  else process.env.STT_BATCH_MAX_BYTES = zero;

  let failed = 0;
  for (const [label, ok] of checks) {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
    if (!ok) failed++;
  }
  console.log(`\n${checks.length - failed}/${checks.length} passed.`);
  process.exitCode = failed > 0 ? 1 : 0;
}
