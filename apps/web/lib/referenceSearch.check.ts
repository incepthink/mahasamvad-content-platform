// Assertions for referenceSearch.ts. Free — no API, no model, no browser.
//
//   npx tsx apps/web/lib/referenceSearch.check.ts
//
// It lives in its own file (rather than behind a `--check` flag inside the module) so
// nothing in the Next bundle can ever reach `process`. Run it after touching the fold
// tables: the transliteration and the Devanagari folding must agree on a skeleton, and
// a one-character edit to either side silently stops "ladki" finding लाडकी.

import type { ReferenceImage } from '@dgipr/schemas';
import {
  NO_FILTERS,
  foldText,
  parseQuery,
  searchReferences,
  type SearchableReference,
} from './referenceSearch.js';

let failures = 0;
let checks = 0;

function ok(condition: boolean, label: string): void {
  checks += 1;
  if (!condition) {
    failures += 1;
    console.error(`  FAIL  ${label}`);
  }
}

function eq(actual: unknown, expected: unknown, label: string): void {
  ok(
    actual === expected,
    `${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );
}

// --- folding: the two alphabets must meet on one skeleton ------------------

const deva = (text: string): string => foldText(text).deva.join(' ');
// Transliteration is directional — only a QUERY's Latin word becomes a skeleton, so the
// Latin side is read off parseQuery rather than off foldText.
const q = (text: string): string =>
  parseQuery(text)
    .map((token) => token.deva)
    .join(' ');

console.log('folding');
// The anusvara survives as a nasal consonant on purpose (मंत्री must equal "mantri"), so
// लाडकी and लाडकीं are NOT the same skeleton — they are bridged by the matcher instead,
// which is asserted in both directions under "search" below.
ok(
  deva('लाडकीं').startsWith(deva('लाडकी')),
  'anusvara only appends to the skeleton',
);
eq(deva('लाडकी'), deva('लाडकि'), 'matra length does not change the skeleton');
eq(deva('कोल्हापूर'), deva('कोल्हापुर'), 'कोल्हापूर == कोल्हापुर');
eq(
  deva('शेतकरी'),
  deva('शेतकऱ्यांना').slice(0, deva('शेतकरी').length),
  'शेतकरी is a prefix of शेतकऱ्यांना',
);
eq(
  deva('महाराष्ट्र'),
  deva('महाराष्‍ट्र'),
  'a stray ZWJ does not change the skeleton',
);
eq(deva('५००'), '500', 'Devanagari digits fold to Latin digits');
ok(deva('राज्य') !== deva('राजा'), 'genuinely different words stay different');
ok(deva('कर') !== deva('खर'), 'aspiration is NOT folded');

console.log('transliteration');
eq(q('ladki'), deva('लाडकी'), 'ladki == लाडकी');
eq(q('bahin'), deva('बहीण'), 'bahin == बहीण');
eq(q('yojana'), deva('योजना'), 'yojana == योजना');
eq(q('shetkari'), deva('शेतकरी'), 'shetkari == शेतकरी');
eq(q('kolhapur'), deva('कोल्हापूर'), 'kolhapur == कोल्हापूर');
eq(q('mahila'), deva('महिला'), 'mahila == महिला');
eq(q('anudan'), deva('अनुदान'), 'anudan == अनुदान (word-initial vowel kept)');
eq(q('arogya'), deva('आरोग्य'), 'arogya == आरोग्य');
eq(q('mantrimandal'), deva('मंत्रिमंडळ'), 'mantrimandal == मंत्रिमंडळ');
eq(q('purskar'), deva('पुरस्कार'), 'purskar == पुरस्कार');

console.log('query parsing');
eq(parseQuery('   ').length, 0, 'blank query yields no tokens');
eq(parseQuery('लाडकी बहीण').length, 2, 'whitespace splits tokens');
eq(parseQuery('लाडकी, बहीण।').length, 2, 'punctuation and danda split tokens');
ok(
  parseQuery('quote').every((t) => t.latin === 'quote'),
  'a Latin token keeps its plain form',
);

// --- search ---------------------------------------------------------------

let seq = 0;
function image(
  spec: ReferenceImage['layoutSpec'],
  isActive = true,
): ReferenceImage {
  seq += 1;
  return {
    id: `img-${seq}`,
    category: 'twitter',
    subtype: 'info_bullets',
    storagePath: `references/library/${seq}.png`,
    url: `https://example.test/${seq}.png`,
    isActive,
    layoutSpec: spec,
    createdAt: `2026-07-0${(seq % 9) + 1}T00:00:00.000Z`,
    updatedAt: `2026-07-0${(seq % 9) + 1}T00:00:00.000Z`,
  };
}

function entry(
  typeLabel: string,
  typeDescription: string,
  img: ReferenceImage,
): SearchableReference {
  return {
    image: img,
    typeId: `type-${typeLabel}`,
    typeLabel,
    typeDescription,
  };
}

const ladki = entry(
  'माहिती मुद्दे',
  'योजना व अनुदानाची माहिती देणारे पोस्टर',
  image({
    hasPhotoZone: false,
    bulletSlots: 4,
    layoutSummary:
      'A bold headline on a solid colour panel above four numbered bullet rows and a call-to-action strip.',
    contentSummary: 'मुख्यमंत्री माझी लाडकी बहीण योजनेच्या हप्त्याची घोषणा.',
  }),
);
const quote = entry(
  'कोट',
  'मंत्र्यांचे वक्तव्य ठळकपणे मांडणारे पोस्टर',
  image({
    hasPhotoZone: true,
    bulletSlots: 0,
    layoutSummary:
      'A large quotation with attribution beside a portrait photograph zone on the right.',
    contentSummary: 'शेतकरी कर्जमुक्तीबाबत मुख्यमंत्र्यांचे वक्तव्य.',
  }),
);
const stats = entry(
  'स्टॅट्स',
  'आकडेवारी दाखवणारे पोस्टर',
  image(
    {
      hasPhotoZone: false,
      bulletSlots: 6,
      layoutSummary: 'Six stat callouts in a grid beneath a short headline.',
      contentSummary: 'आरोग्य विभागाच्या कामगिरीची आकडेवारी.',
    },
    false,
  ),
);
const raw = entry(
  'माहिती मुद्दे',
  'योजना व अनुदानाची माहिती देणारे पोस्टर',
  image(null),
);

const all = [ladki, quote, stats, raw];
const ids = (query: string, filters = NO_FILTERS): string[] =>
  searchReferences(all, query, filters).matches.map((m) => m.entry.image.id);

console.log('search');
{
  const result = searchReferences(all, '', NO_FILTERS);
  eq(result.matches.length, 4, 'no query and no filter returns everything');
  eq(
    result.unanalyzed.length,
    0,
    'un-analyzed is only split out once searching',
  );
  eq(result.queryActive, false, 'queryActive is false for a blank query');
  eq(
    result.matches.map((m) => m.entry.image.id).join(','),
    all.map((e) => e.image.id).join(','),
    'input order is preserved untouched',
  );
}

eq(ids('लाडकी')[0], ladki.image.id, 'exact Marathi word finds its master');
eq(ids('लाडकीं')[0], ladki.image.id, 'a wrong anusvara still finds it');
eq(
  ids('मंत्री')[0],
  quote.image.id,
  'मंत्री finds मंत्र्यांचे — the anusvara-as-nasal path',
);
eq(ids('mantri')[0], quote.image.id, 'and so does the romanised form');
eq(ids('लाडक')[0], ladki.image.id, 'a partly typed word finds it (prefix)');
eq(ids('ladki bahin')[0], ladki.image.id, 'romanised Marathi finds it');
eq(ids('शेतकरी')[0], quote.image.id, 'शेतकरी finds the कर्जमुक्ती master');
eq(ids('शेतकऱ्यांना')[0], quote.image.id, 'an inflected form still finds it');
eq(
  ids('quote')[0],
  quote.image.id,
  'an English query matches the layout prose',
);
eq(
  ids('stat callouts')[0],
  stats.image.id,
  'a multi-word English query matches',
);
eq(ids('कोट')[0], quote.image.id, 'the type name is searchable');
// Both found against the real 91-master library, and both are silent failures rather than
// visible ones — the first returned nothing, the second returned a hit nobody could explain.
eq(
  deva('पाऊस'),
  deva('पावसा').slice(0, deva('पाऊस').length),
  'पाऊस is a prefix of पावसा — the vowel/semivowel alternation',
);
{
  const rain = entry(
    'सूचना',
    'इशारा देणारे पोस्टर',
    image({
      hasPhotoZone: false,
      bulletSlots: 3,
      layoutSummary: 'An alert banner above three advisory rows.',
      contentSummary: 'मुसळधार पावसाच्या पार्श्वभूमीवर नागरिकांसाठी इशारा.',
    }),
  );
  eq(
    searchReferences([rain], 'पाऊस').matches.length,
    1,
    'पाऊस finds a master that only stores पावसाच्या',
  );
  // The library's English prose must stay English: transliterating it made पुरस्कार
  // (परसकर) match the English word "pairs" (परस).
  const english = entry(
    'रचना',
    'वर्णन',
    image({
      hasPhotoZone: false,
      bulletSlots: 2,
      layoutSummary: 'The lower area pairs four icon-led benefit rows.',
      contentSummary: '',
    }),
  );
  eq(
    searchReferences([english], 'पुरस्कार').matches.length,
    0,
    'a Devanagari query does not match transliterated English prose',
  );
  eq(
    searchReferences([english], 'pairs').matches.length,
    1,
    '…while an English query still matches it plainly',
  );
}
eq(ids('झझझ').length, 0, 'a word that appears nowhere returns nothing');
eq(
  ids('लाडकी आकडेवारी').length,
  0,
  'tokens are ANDed — no single master carries both',
);
ok(
  searchReferences(all, 'लाडकी').unanalyzed.some(
    (e) => e.image.id === raw.image.id,
  ),
  'an un-analyzed master is reported separately, never dropped',
);
ok(
  !ids('लाडकी').includes(raw.image.id),
  'an un-analyzed master is not a text match',
);

console.log('ranking');
{
  // Both masters mention मुख्यमंत्री; the one whose SUBJECT line leads with it wins over a
  // mention buried in the other's subject line only by weight, so assert the field
  // hierarchy directly instead.
  const result = searchReferences(all, 'माहिती');
  eq(
    result.matches[0]?.entry.image.id,
    ladki.image.id,
    'a type-name hit outranks a description-only hit',
  );
}
{
  const disabledFirst = [stats, ladki];
  const result = searchReferences(disabledFirst, 'योजना');
  eq(
    result.matches[0]?.entry.image.id,
    ladki.image.id,
    'text relevance decides before the enabled bonus',
  );
}

console.log('filters');
eq(
  searchReferences(all, '', { photo: 'photo', minSlots: 0 }).matches.length,
  1,
  'the photo filter alone narrows to the one master with a photo zone',
);
eq(
  searchReferences(all, '', { photo: 'text', minSlots: 0 }).matches.length,
  2,
  'the text-only filter keeps both text-only masters',
);
eq(
  searchReferences(all, '', { photo: 'any', minSlots: 5 }).matches.length,
  1,
  'the slot floor excludes a 4-slot master',
);
eq(
  ids('मुख्यमंत्री', { photo: 'photo', minSlots: 0 }).length,
  1,
  'query and filter compose',
);
eq(
  searchReferences(all, '', { photo: 'photo', minSlots: 0 }).unanalyzed.length,
  1,
  'a filter alone still reports the un-analyzed master',
);

console.log('highlighting');
{
  const match = searchReferences(all, 'लाडकी').matches[0];
  ok(match !== undefined, 'a match is returned');
  const ranges = match?.highlights ?? [];
  ok(ranges.length > 0, 'the matched word is located in the snippet');
  const marked = ranges.map((r) => match?.snippet.slice(r.start, r.end));
  ok(
    marked.includes('लाडकी'),
    `the marked span is the matched word (${marked.join('|')})`,
  );
  ok(
    ranges.every(
      (r) =>
        r.start >= 0 &&
        r.end <= (match?.snippet.length ?? 0) &&
        r.start < r.end,
    ),
    'every highlight range is inside the snippet',
  );
}
{
  const long = entry(
    'लांब',
    'वर्णन',
    image({
      hasPhotoZone: false,
      bulletSlots: 0,
      layoutSummary: 'x',
      contentSummary: `${'क्ष '.repeat(90)}लाडकी बहीण योजना.`,
    }),
  );
  const match = searchReferences([long], 'लाडकी').matches[0];
  ok((match?.snippet.length ?? 0) <= 152, 'a long summary is windowed');
  ok(
    match?.snippet.startsWith('…') === true,
    'the window is marked as clipped',
  );
  const marked = (match?.highlights ?? []).map((r) =>
    match?.snippet.slice(r.start, r.end),
  );
  ok(
    marked.includes('लाडकी'),
    `highlight offsets survive the window shift (${marked.join('|')})`,
  );
}

console.log('');
if (failures > 0) {
  console.error(`${failures} of ${checks} checks FAILED`);
  process.exit(1);
}
console.log(`all ${checks} checks passed`);
