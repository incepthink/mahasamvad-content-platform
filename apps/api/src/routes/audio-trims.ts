// Reading the `audioTrims` field off a create request, shared by /dlo and /transcribe so the
// two can never disagree about what a trim means or which recording it lands on.
//
// THE FIELD IS SPARSE AND POSITIONAL. One entry per TRIMMED recording, carrying its position
// among the audio files in the order the client appended them — so an intake where nothing was
// trimmed sends no field at all and its request is byte-for-byte what it was before this
// feature existed.
//
// WHY THE NAME IS CHECKED AND NOT USED AS THE KEY. A name is not unique: two takes of one
// meeting arrive as `recording.m4a` twice, and half a dozen phone recordings share whatever
// the handset calls them. So the position is the key and the name is a CHECK — and a mismatch
// is a 400 rather than a shrug, because the failure it guards against is silent and
// destructive: applying somebody's four-minute window to a different two-hour meeting discards
// the source they came to use and leaves a plausible-looking transcript behind.
//
// Free harness: npx tsx apps/api/src/routes/audio-trims.ts
// (run it from packages/content-engine, which has tsx — the audio-batches.ts precedent)

import { pathToFileURL } from 'node:url';
import {
  AudioTrimsSchema,
  type AudioTrim,
  type AudioTrimEntry,
} from '@dgipr/schemas';

const UNREADABLE =
  'ध्वनिमुद्रणाच्या निवडलेल्या कालावधीची माहिती वाचता आली नाही.';

export type AudioTrimParse =
  | Readonly<{ ok: true; entries: readonly AudioTrimEntry[] }>
  | Readonly<{ ok: false; message: string }>;

/**
 * Parse the raw field into entries. SHAPE only — nothing here knows which recordings arrived,
 * so the positions and names are checked by `resolveAudioTrims` once they are.
 */
export function parseAudioTrimsField(value: string): AudioTrimParse {
  if (value.trim().length === 0) return { ok: true, entries: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return { ok: false, message: UNREADABLE };
  }
  const result = AudioTrimsSchema.safeParse(parsed);
  if (!result.success) return { ok: false, message: UNREADABLE };
  return { ok: true, entries: result.data };
}

export type AudioTrimResolution =
  | Readonly<{ ok: true; byPosition: readonly (AudioTrim | undefined)[] }>
  | Readonly<{ ok: false; message: string }>;

/**
 * Line the parsed windows up against the recordings that actually arrived.
 *
 * `audioNames` is every AUDIO upload, in arrival order — on /dlo that is the recordings picked
 * out of a `files` field they share with photographs and documents, which is why the caller
 * filters rather than passing the whole list.
 *
 * One slot per recording, `undefined` where nothing was selected, so the caller can build its
 * entries positionally without a second lookup.
 */
export function resolveAudioTrims(
  audioNames: readonly string[],
  entries: readonly AudioTrimEntry[],
): AudioTrimResolution {
  const byPosition = new Array<AudioTrim | undefined>(audioNames.length).fill(
    undefined,
  );
  for (const entry of entries) {
    const actual = audioNames[entry.index];
    // Out of range, or pointing at a different recording than the client thought. Either way
    // the client and the server disagree about what arrived, and guessing is the one thing
    // that must not happen here.
    if (actual === undefined || actual !== entry.name) {
      return {
        ok: false,
        message: `"${entry.name}" हे ध्वनिमुद्रण सापडले नाही, त्यामुळे निवडलेला कालावधी लागू करता आला नाही.`,
      };
    }
    // Two windows for one recording: picking either is a guess about which was meant.
    if (byPosition[entry.index] !== undefined) {
      return { ok: false, message: UNREADABLE };
    }
    if (entry.endSeconds <= entry.startSeconds) {
      return {
        ok: false,
        message: `"${entry.name}" साठी निवडलेला कालावधी चुकीचा आहे.`,
      };
    }
    byPosition[entry.index] = {
      startSeconds: entry.startSeconds,
      endSeconds: entry.endSeconds,
      ...(entry.durationSeconds !== undefined
        ? { durationSeconds: entry.durationSeconds }
        : {}),
    };
  }
  return { ok: true, byPosition };
}

// ---------- harness ----------

if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url.replace(/\?.*$/, '')
) {
  const checks: Array<[string, boolean]> = [];
  const check = (label: string, ok: boolean): void => {
    checks.push([label, ok]);
  };
  const parse = parseAudioTrimsField;
  const names = ['a.mp3', 'b.mp3', 'a.mp3'];

  // An untrimmed run sends nothing at all, and must behave exactly as it did before.
  check('an absent field is not an error', parse('').ok);
  check('a whitespace field is not an error', parse('   ').ok);
  const empty = parse('[]');
  check('an empty list resolves to no trims', empty.ok);
  if (empty.ok) {
    const r = resolveAudioTrims(names, empty.entries);
    check(
      'no trims means one empty slot per recording',
      r.ok &&
        r.byPosition.length === 3 &&
        r.byPosition.every((t) => t === undefined),
    );
  }

  check('junk is refused', !parse('not json').ok);
  check('a bare object is refused', !parse('{"index":0}').ok);
  check(
    'a missing field is refused',
    !parse('[{"index":0,"name":"a.mp3","startSeconds":1}]').ok,
  );

  const good = parse(
    '[{"index":1,"name":"b.mp3","startSeconds":10,"endSeconds":25,"durationSeconds":300}]',
  );
  check('a well-formed entry parses', good.ok);
  if (good.ok) {
    const r = resolveAudioTrims(names, good.entries);
    check(
      'it lands on its own position',
      r.ok && r.byPosition[1]?.startSeconds === 10,
    );
    check(
      'and on no other',
      r.ok && r.byPosition[0] === undefined && r.byPosition[2] === undefined,
    );
    check(
      'the duration is carried through',
      r.ok && r.byPosition[1]?.durationSeconds === 300,
    );
  }

  // The point of the name check: positions 0 and 2 are both called a.mp3, so a shifted list
  // must be caught rather than silently trimming the wrong meeting.
  const shifted = parse(
    '[{"index":0,"name":"b.mp3","startSeconds":1,"endSeconds":9}]',
  );
  check(
    'a window naming a different recording is refused',
    shifted.ok && !resolveAudioTrims(names, shifted.entries).ok,
  );
  const same = parse(
    '[{"index":2,"name":"a.mp3","startSeconds":1,"endSeconds":9}]',
  );
  check(
    'two recordings sharing a name are told apart by position',
    same.ok && resolveAudioTrims(names, same.entries).ok,
  );

  const oob = parse(
    '[{"index":9,"name":"a.mp3","startSeconds":1,"endSeconds":9}]',
  );
  check(
    'a position past the last recording is refused',
    oob.ok && !resolveAudioTrims(names, oob.entries).ok,
  );

  const dup = parse(
    '[{"index":0,"name":"a.mp3","startSeconds":1,"endSeconds":9},{"index":0,"name":"a.mp3","startSeconds":2,"endSeconds":8}]',
  );
  check(
    'two windows for one recording are refused',
    dup.ok && !resolveAudioTrims(names, dup.entries).ok,
  );

  const backwards = parse(
    '[{"index":0,"name":"a.mp3","startSeconds":30,"endSeconds":12}]',
  );
  check(
    'a backwards window is refused',
    backwards.ok && !resolveAudioTrims(names, backwards.entries).ok,
  );
  const zero = parse(
    '[{"index":0,"name":"a.mp3","startSeconds":5,"endSeconds":5}]',
  );
  check(
    'a zero-length window is refused',
    zero.ok && !resolveAudioTrims(names, zero.entries).ok,
  );

  // Every refusal reaches the officer in Marathi — this route answers a plain form submit.
  const refusals = [
    parse('nope'),
    resolveAudioTrims(names, oob.ok ? oob.entries : []),
  ];
  check(
    'every refusal is Marathi',
    refusals.every((r) => r.ok || /[ऀ-ॿ]/.test(r.message)),
  );

  for (const [label, ok] of checks) {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
  }
  const failed = checks.filter(([, ok]) => !ok).length;
  console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
  process.exit(failed === 0 ? 0 : 1);
}
