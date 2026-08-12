// Display-time repair for the one Devanagari sequence Mukta cannot shape.
//
// Marathi writes the "æ"/"ɔ" of loanwords as an independent vowel plus a candra sign —
// अॅटलस is अ (U+0905) + ॅ (U+0945), अॉ is अ + ॉ (U+0949). Those signs are combining marks
// with zero advance and a negative bearing: they have no position of their own and land
// correctly only if the font's GPOS `mark` feature anchors them to the base letter.
//
// Mukta has eight MarkBasePos lookups and अ (`vowelA.dv`) is in the base coverage of NONE
// of them, while every consonant is — which is why टॅ, बॅ and कॅ shape perfectly and अॅ does
// not. HarfBuzz cannot fall back either (it only positions marks itself for fonts with no
// GPOS mark feature at all), so the sign draws at its raw -287 bearing and floats beside अ
// at the wrong height: `अ ॅटलस`.
//
// Unicode encodes the same two sounds as single precomposed letters, ऍ (U+090D) and ऑ
// (U+0911), and Mukta carries both as real full-height outlines. So the fix is to swap the
// pair for the letter at RENDER time.
//
// Deliberately display-only. This changes a codepoint, and the officer's text is the source
// of truth everywhere else in this product — so copy, .txt/.md download, the PDF export, the
// poster prompts and everything persisted keep reading the raw string. Do not move this into
// the API or into an input handler.
//
// A font that anchors marks to independent vowels makes this a no-op; it is safe to leave in
// place either way.

const CANDRA_PAIRS: ReadonlyArray<readonly [RegExp, string]> = [
  [/अॅ/g, 'ऍ'], // अ + ॅ → ऍ
  [/अॉ/g, 'ऑ'], // अ + ॉ → ऑ
];

/** Replace unshapeable independent-vowel + candra pairs with their precomposed letters. */
export function precomposeCandraVowels(text: string): string {
  let out = text;
  for (const [pattern, replacement] of CANDRA_PAIRS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}
