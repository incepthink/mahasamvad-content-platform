// Offline checks for the DLO review state that /dlo autosaves (migration 0036).
//
// The state itself lives in @dgipr/schemas (serializeDloReviewState / parseDloReviewState),
// because BOTH apps touch it — the web writes it and the API validates it, and apps/web cannot
// import this package. The harness lives HERE because this package has tsx; the same split
// `applyProofreadFixes` already uses, whose logic sits in schemas while
// `proof-read.ts --check` exercises it.
//
// What is worth checking offline is not the zod shape but the two properties a resumed review
// silently depends on:
//
//   1. Serialization is DETERMINISTIC. `excluded` is a Set, so its iteration order follows
//      insertion; two officers holding the identical selection would otherwise produce
//      different blobs and every comparison would report a change that is not there.
//   2. A RESTORED overlay reproduces the SAME assembled text as the live one. That string
//      becomes the article's note verbatim, so a restore that shifts even a page boundary
//      would quietly change what gets published.
//
// Run it (free, no key, no model call):
//   tsx src/intake/dlo-review-state.ts

import { pathToFileURL } from 'node:url';
import {
  DLO_REVIEW_STATE_MAX_CHARS,
  DloReviewStateSchema,
  combineIntakeSources,
  parseDloReviewState,
  serializeDloReviewState,
  type DloReviewState,
} from '@dgipr/schemas';

// A stand-in for the review step's own assembly. It mirrors apps/web/lib/dloReview.ts's
// overlay rule — `edits[key] ?? page.text`, dropping excluded keys — over the shared
// combineIntakeSources, so what is being compared here is the overlay, not a second
// implementation of the header format.
type Source = Readonly<{
  label: string;
  pages: ReadonlyArray<Readonly<{ page: number; text: string }>>;
}>;

function assemble(
  notes: string,
  sources: readonly Source[],
  edits: Readonly<Record<string, string>>,
  excluded: ReadonlySet<string>,
): string {
  const notesText = excluded.has('notes') ? '' : (edits['notes'] ?? notes);
  return combineIntakeSources(
    notesText,
    sources.map((source, index) => ({
      label: source.label,
      text: source.pages
        .filter((page) => !excluded.has(`${index}:${page.page}`))
        .map((page) => edits[`${index}:${page.page}`] ?? page.text)
        .join('\n\n'),
    })),
  );
}

// Round-trip through JSON exactly as the wire does, so a value that only survives in memory
// (a Set, a Date, an undefined) cannot pass by accident.
function overWire(state: DloReviewState): unknown {
  return JSON.parse(JSON.stringify(state));
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  let failures = 0;
  const check = (label: string, actual: unknown, expected: unknown): void => {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a === e) {
      console.log(`  ✓ ${label}`);
    } else {
      failures += 1;
      console.error(`  ✗ ${label}\n      expected ${e}\n      got      ${a}`);
    }
  };

  const WRITER = 'tab-abc123';
  const SOURCES: Source[] = [
    {
      label: 'बैठक.mp3',
      pages: [
        { page: 1, text: 'मुख्यमंत्री देवेंद्र फडणवीस यांनी बैठक घेतली.' },
      ],
    },
    {
      label: 'शासन-निर्णय.pdf',
      pages: [
        { page: 1, text: 'प्रस्तावना पृष्ठ.' },
        { page: 2, text: 'योजनेसाठी ५०० कोटींची तरतूद.' },
        { page: 5, text: 'अर्जाची अंतिम मुदत ३१ ऑगस्ट २०२६.' },
      ],
    },
  ];

  console.log('\nअ. क्रमनिरपेक्ष क्रमांकन (deterministic serialization)');
  {
    const a = serializeDloReviewState({
      edits: {},
      excluded: new Set(['1:5', '0:1', '1:2']),
      writer: WRITER,
      updatedAt: 'T',
    });
    const b = serializeDloReviewState({
      edits: {},
      excluded: new Set(['1:2', '1:5', '0:1']),
      writer: WRITER,
      updatedAt: 'T',
    });
    check('excluded sorted', a.excluded, ['0:1', '1:2', '1:5']);
    check(
      'same selection ⇒ identical blob',
      JSON.stringify(a),
      JSON.stringify(b),
    );
  }

  console.log('\nआ. फेरफेर टिकतात (edits + exclusions survive the wire)');
  {
    const edits = {
      '1:2': 'योजनेसाठी ५०० कोटींची तरतूद. (दुरुस्त)',
      notes: 'सुधारित टिपणी',
    };
    const excluded = new Set(['1:1']);
    const restored = parseDloReviewState(
      overWire(
        serializeDloReviewState({
          edits,
          excluded,
          writer: WRITER,
          updatedAt: 'T',
        }),
      ),
    );
    check('parsed', restored !== null, true);
    check('edits verbatim', restored?.edits, edits);
    check('excluded restored', restored?.excluded, ['1:1']);
    check(
      'Devanagari digits intact',
      restored?.edits['1:2']?.includes('५०० कोटींची'),
      true,
    );
  }

  console.log(
    '\nइ. पुनर्संचयित मजकूर तंतोतंत तोच (restored text is byte-identical)',
  );
  {
    const edits = { '1:2': 'योजनेसाठी ५०० कोटींची तरतूद. (दुरुस्त)' };
    const excluded = new Set(['1:1']);
    const live = assemble('मूळ टिपणी', SOURCES, edits, excluded);

    const restored = parseDloReviewState(
      overWire(
        serializeDloReviewState({
          edits,
          excluded,
          writer: WRITER,
          updatedAt: 'T',
        }),
      ),
    );
    const after = assemble(
      'मूळ टिपणी',
      SOURCES,
      restored?.edits ?? {},
      new Set(restored?.excluded ?? []),
    );
    check('assembled text identical', after, live);
    check('excluded page absent', after.includes('प्रस्तावना पृष्ठ'), false);
    check('kept page present', after.includes('३१ ऑगस्ट २०२६'), true);
    check(
      'source header intact',
      after.includes('=== स्रोत: शासन-निर्णय.pdf ==='),
      true,
    );
  }

  console.log('\nई. रिकामी व अनोळखी स्थिती (empty + forward-compatible)');
  {
    const empty = DloReviewStateSchema.safeParse({
      v: 1,
      writer: WRITER,
      updatedAt: 'T',
    });
    check('empty blob accepted', empty.success, true);
    check('edits default', empty.success && empty.data.edits, {});
    check('excluded default', empty.success && empty.data.excluded, []);

    // zod objects are non-strict, so an unknown key from a NEWER web build must pass through
    // rather than fail the save. This is the property that lets web and API deploy separately.
    const extra = DloReviewStateSchema.safeParse({
      v: 1,
      writer: WRITER,
      updatedAt: 'T',
      somethingNew: 'ignored',
    });
    check('unknown key tolerated', extra.success, true);
  }

  console.log('\nउ. नकार व अधोगती (rejection + degradation)');
  {
    check(
      'wrong version rejected',
      parseDloReviewState({ v: 2, writer: WRITER, updatedAt: 'T' }),
      null,
    );
    check('junk rejected', parseDloReviewState('nonsense'), null);
    check(
      'missing writer rejected',
      parseDloReviewState({ v: 1, updatedAt: 'T' }),
      null,
    );
    // The pre-0036 case: the column does not exist, so the row returns nothing for it. This
    // must read as "no saved review", never throw — an un-applied migration disables resume,
    // it does not break the intake.
    check('null ⇒ no review state', parseDloReviewState(null), null);
    check('undefined ⇒ no review state', parseDloReviewState(undefined), null);
  }

  console.log('\nऊ. आकारमर्यादा (size cap is detectable before sending)');
  {
    const huge = serializeDloReviewState({
      edits: { '0:1': 'क'.repeat(DLO_REVIEW_STATE_MAX_CHARS + 1) },
      excluded: [],
      writer: WRITER,
      updatedAt: 'T',
    });
    check(
      'oversized blob exceeds the cap',
      JSON.stringify(huge).length > DLO_REVIEW_STATE_MAX_CHARS,
      true,
    );
    const ordinary = serializeDloReviewState({
      edits: { '0:1': 'क'.repeat(1000) },
      excluded: [],
      writer: WRITER,
      updatedAt: 'T',
    });
    check(
      'ordinary blob is well under it',
      JSON.stringify(ordinary).length < DLO_REVIEW_STATE_MAX_CHARS,
      true,
    );

    // The cap has to be REACHABLE, which is a byte question, not a character one. Marathi is
    // 3 bytes per character in UTF-8 and apps/api caps JSON bodies at 1 MiB, so a cap above
    // ~349,525 characters would be pre-empted by the body limit and the officer would get an
    // opaque English 413 instead of the Marathi message. Verified live at 410k both ways.
    const API_BODY_LIMIT_BYTES = 1024 * 1024;
    const DEVANAGARI_BYTES_PER_CHAR = 3;
    check(
      'a full-size Devanagari blob still fits the 1 MiB body limit',
      DLO_REVIEW_STATE_MAX_CHARS * DEVANAGARI_BYTES_PER_CHAR <
        API_BODY_LIMIT_BYTES,
      true,
    );
  }

  console.log(
    failures === 0
      ? '\nसर्व तपासण्या यशस्वी (all checks passed)\n'
      : `\n${failures} तपासणी अयशस्वी (${failures} check(s) failed)\n`,
  );
  if (failures > 0) process.exitCode = 1;
}
