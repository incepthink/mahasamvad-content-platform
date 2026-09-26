// The officer's own PICTURES (migration 0056), stated to the image model.
//
// An officer attaches a photograph on the create form — a minister's portrait, a building, a
// scheme logo — and says in the text how it should appear ("मुख्यमंत्र्यांचा फोटो उजवीकडे,
// पार्श्वभूमी काढून"). The pictures now reach the image model as extra image parts of the
// edit call (runner.ts attaches them after any reference template); this block is the half
// that tells the model what they ARE. Without it an image model treats an attached photo as
// "inspiration" and paints its own version — a stranger with a similar haircut, a redrawn
// logo — which is the one outcome this feature exists to prevent.
//
// ONE block for every lane (social poster with or without a template, the article banner,
// the YouTube thumbnail, the carousel cover, and every feedback edit of them), PREPENDED to
// the lane's own prompt. Prepended rather than threaded into each builder because:
//   - each lane's builder already ends with blocks whose LAST position is harness-asserted
//     (fitToReserveRule, the reserved-zone blocks), so an appended block would break them;
//   - an image manifest ("Image 1 is…, Image 2 is…") belongs before the instructions that
//     refer to those images, the way these edit prompts are conventionally written;
//   - one function cannot drift between lanes the way five copies would.
//
// No pictures ⇒ the prompt is returned BYTE-FOR-BYTE unchanged, so every run without them
// renders exactly as before (asserted below).
//
// WHAT IT PERMITS AND FORBIDS, deliberately split along the officer's own words: the model may
// CROP, REMOVE THE BACKGROUND, RESIZE and POSITION the picture — the handling a designer does to
// a supplied photograph — and must never REPLACE, REDRAW or RESTYLE the subject. That is the
// difference between placing a real minister's photograph and inventing a likeness of one.
//
// It also has to OUTRANK the lanes' own imagery rules, and says so, because several of them
// point the other way: the fresh lanes ask for imagery to be designed, the thumbnail's people
// rule asks for a named person's likeness to be painted from their name, and the template lanes
// carry a content firewall telling the model to copy NOTHING from an attached image. Left
// unranked, whichever sounds more absolute wins — the DISPLACE_PRESERVE_RULE lesson.

import { pathToFileURL } from 'node:url';

export type OfficerImagesMode =
  // A render that designs a new poster (fresh, or from a reference template).
  | 'render'
  // A feedback edit of a finished poster that should already carry the pictures.
  | 'feedback';

export type OfficerImagesOptions = Readonly<{
  // How many officer pictures are attached. 0 ⇒ no block at all.
  count: number;
  // What the images BEFORE the officer's are, in order, as the model should understand them —
  // e.g. ['the reference template'] on a template render, ['the current poster'] on feedback,
  // [] on a from-scratch render. The officer's pictures follow them, so their numbers start
  // after these. Must match the order runner.ts hands the buffers to editImage.
  leadingImages: readonly string[];
  mode: OfficerImagesMode;
}>;

function imageRange(first: number, count: number): string {
  if (count === 1) return `Image ${first}`;
  if (count === 2) return `Images ${first} and ${first + 1}`;
  return `Images ${first}–${first + count - 1}`;
}

// The block alone. Exported for the harness and for a caller that wants to place it itself.
export function officerImagesBlock(options: OfficerImagesOptions): string {
  const count = Math.max(0, Math.floor(options.count));
  if (count === 0) return '';
  const leading = options.leadingImages;
  const first = leading.length + 1;
  const range = imageRange(first, count);
  const pictures = count === 1 ? 'this picture' : 'these pictures';
  const each = count === 1 ? 'it' : 'each of them';

  const manifest: string[] = leading.map(
    (label, index) => `- Image ${index + 1} is ${label}.`,
  );
  manifest.push(
    `- ${range} ${count === 1 ? 'is a REAL picture' : 'are REAL pictures'} supplied by the officer ` +
      `(for example a photograph of a person, a building, a place, an object or a logo). ` +
      (leading.length === 0
        ? `None of them is a canvas, a background or a layout to follow — design the poster described below and place ${pictures} into it.`
        : `${count === 1 ? 'It is' : 'They are'} NOT part of any template and NOT placeholder content.`),
  );

  const lines: string[] = [
    "OFFICER'S OWN PICTURES — READ THIS FIRST. It outranks every other instruction about imagery below.",
    ...manifest,
  ];

  if (options.mode === 'feedback') {
    lines.push(
      `- The poster being edited already contains ${pictures}. ${range} ${count === 1 ? 'is the ORIGINAL' : 'are the ORIGINALS'}: ` +
        `keep every subject in the edited poster IDENTICAL to ${count === 1 ? 'it' : 'them'} — same face and facial features, ` +
        'same age, skin tone, hair, expression and clothing; for an object, building or logo the same shape, colours, text and details.',
      `- Do NOT redraw, regenerate, restyle or replace ${each}, and do not swap in a different person or object. ` +
        'If the requested change moves or resizes the picture, move or resize the SAME picture; you may crop it or remove its background, nothing more.',
      '- Unless the requested change asks to remove a picture, keep it in the poster; if one has been distorted, restore it from the original.',
    );
    return lines.join('\n');
  }

  lines.push(
    `- USE THE ACTUAL PICTURE. ${count === 1 ? 'It' : 'Every one of them'} must appear in the finished poster, taken from the attached pixels. ` +
      `Never replace ${count === 1 ? 'it' : 'any of them'} with a newly generated, redrawn, repainted, illustrated, restyled or "similar" image, ` +
      'and never generate a different person, building, object or logo in its place.',
    '- PRESERVE THE SUBJECT EXACTLY: the same face and facial features, age, skin tone, hairstyle, expression, clothing and ' +
      'body proportions; for an object, building or logo the same shape, colours, lettering and details. Do not beautify, ' +
      'idealise, age, cartoonise, stylise, recolour or add anything to the subject.',
    `- YOU MAY: crop ${each}, remove or replace ${count === 1 ? 'its' : 'their'} background with a clean cut-out along the subject's edges, ` +
      `scale ${count === 1 ? 'it' : 'each one'} up or down, and position ${count === 1 ? 'it' : 'each one'} anywhere the design needs it. ` +
      'Those are the ONLY changes allowed to the picture itself; ' +
      'light shadows or a border AROUND the cut-out are fine.',
    "- FOLLOW THE OFFICER'S DIRECTIONS for each picture exactly — where it goes, how large it is, whether its background is removed, " +
      'whether it is cropped (e.g. to a circle or a head-and-shoulders cut-out), which side it sits on — as written in the text and ' +
      'instructions below, even where they are in Marathi. Where no direction is given, place it prominently where it best serves the design.',
    "- Where the instructions below ask for a photograph, a scene, an illustration or a person, use the officer's picture for that subject " +
      'instead of generating one. A rule below that says to depict a named person from their name applies ONLY to a person with no attached picture.',
    "- The content firewall below that tells you to copy nothing from a reference image does NOT apply to these pictures — they are the officer's content.",
    `- Any instruction below that forbids photographs, portraits or pictures (for example a text-only template or layout) does NOT apply to ${pictures}: ` +
      `${count === 1 ? 'it' : 'they'} must still appear — make room for ${count === 1 ? 'it' : 'them'} within the layout. ` +
      'Likewise, rules that imagery must contain no text or logos, or that no logo may be added, are about generated imagery and official branding: ' +
      "keep any lettering or logo already inside the officer's picture exactly as it is.",
    `- Keep ${pictures} clear of the reserved branding zones described below, and never cover the poster's text with ${count === 1 ? 'it' : 'them'}.`,
  );
  return lines.join('\n');
}

// The prompt with the block prepended, or the prompt unchanged when there are no pictures.
export function withOfficerImages(
  prompt: string,
  options: OfficerImagesOptions,
): string {
  const block = officerImagesBlock(options);
  return block ? `${block}\n\n${prompt}` : prompt;
}

// ---------------------------------------------------------------------------------------
// Free harness: `npx tsx src/generation/officer-images-rule.ts`
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const failures: string[] = [];
  const check = (ok: boolean, message: string): void => {
    if (!ok) failures.push(message);
  };
  const BASE = 'Design a poster.\nRESERVED ZONES…';

  // 1. No pictures: byte-identical.
  check(
    withOfficerImages(BASE, { count: 0, leadingImages: [], mode: 'render' }) ===
      BASE,
    'no pictures changed the prompt',
  );
  check(
    withOfficerImages(BASE, {
      count: 0,
      leadingImages: ['the current poster'],
      mode: 'feedback',
    }) === BASE,
    'no pictures changed the feedback prompt',
  );

  // 2. From scratch: pictures are Images 1..N, none is a canvas.
  const fresh = withOfficerImages(BASE, {
    count: 2,
    leadingImages: [],
    mode: 'render',
  });
  check(fresh.endsWith(BASE), 'the lane prompt was not kept intact at the end');
  check(fresh.startsWith("OFFICER'S OWN PICTURES"), 'block is not first');
  check(fresh.includes('Images 1 and 2 are REAL'), 'fresh numbering wrong');
  check(
    fresh.includes('None of them is a canvas'),
    'fresh canvas note missing',
  );
  check(fresh.includes('USE THE ACTUAL PICTURE'), 'use-actual rule missing');
  check(
    /Never replace/.test(fresh) && /newly generated/.test(fresh),
    'no-replacement rule missing',
  );
  check(
    /crop/.test(fresh) &&
      /remove or replace/.test(fresh) &&
      /scale (it|each one)/.test(fresh) &&
      /position (it|each one)/.test(fresh),
    'crop/background/resize/position permissions missing',
  );
  check(
    fresh.includes('PRESERVE THE SUBJECT EXACTLY'),
    'identity rule missing',
  );
  check(
    fresh.includes("FOLLOW THE OFFICER'S DIRECTIONS"),
    'officer-direction rule missing',
  );
  check(
    fresh.includes('does NOT apply to these pictures'),
    'firewall carve-out missing',
  );
  check(fresh.includes('outranks every other'), 'precedence missing');
  check(
    fresh.includes('does NOT apply to these pictures: they must still appear'),
    'text-only / no-photo override missing',
  );
  check(
    /keep any lettering or logo already inside/.test(fresh),
    'no-text / no-logo carve-out missing',
  );

  // 3. Template: Image 1 is the template, officer pictures start at 2.
  const templ = officerImagesBlock({
    count: 3,
    leadingImages: ['the reference template'],
    mode: 'render',
  });
  check(
    templ.includes('- Image 1 is the reference template.'),
    'template manifest missing',
  );
  check(templ.includes('Images 2–4 are REAL'), 'template numbering wrong');
  check(!templ.includes('None of them is a canvas'), 'template canvas note');

  // 4. Single picture wording.
  const one = officerImagesBlock({
    count: 1,
    leadingImages: ['the reference template'],
    mode: 'render',
  });
  check(one.includes('Image 2 is a REAL picture'), 'singular numbering wrong');

  // 5. Feedback: originals, preserve, no redraw.
  const fb = officerImagesBlock({
    count: 1,
    leadingImages: ['the current poster'],
    mode: 'feedback',
  });
  check(fb.includes('- Image 1 is the current poster.'), 'feedback manifest');
  check(fb.includes('Image 2 is the ORIGINAL'), 'feedback original wording');
  check(fb.includes('IDENTICAL'), 'feedback identity rule missing');
  check(!fb.includes('USE THE ACTUAL PICTURE'), 'render rules leaked');

  if (failures.length > 0) {
    console.error(`\n${failures.length} FAILURE(S):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exitCode = 1;
  } else {
    console.log(`All officer-images rule assertions passed.\n\n${templ}`);
  }
}
