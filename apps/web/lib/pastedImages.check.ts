// Assertions for the clipboard-image reader. Free — no API, no model, no browser.
//
//   npx tsx --tsconfig apps/web/tsconfig.check.json apps/web/lib/pastedImages.check.ts
//
// (from a workspace that has tsx — packages/content-engine does.)
//
// The cases are the shapes a real clipboard actually produces: Chrome's invented `image.png`,
// a screenshot with no name at all, Safari's TIFF, a picture copied out of a web page, and a
// paste that is only text. In its own file rather than behind a `--check` flag inside the
// module, so nothing in the Next bundle can reach `process` — the errorMessage.check.ts
// precedent.

import {
  imageFilesFromClipboard,
  type ClipboardFileSource,
} from './pastedImages';

let failures = 0;
let checks = 0;

function check(label: string, ok: boolean, detail?: string): void {
  checks += 1;
  if (ok) return;
  failures += 1;
  console.error(`FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
}

function file(name: string, type: string): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type });
}

/** A clipboard that exposes its files the way every current browser does. */
function clipboard(files: readonly File[]): ClipboardFileSource {
  return {
    files,
    // The same files are reachable through `items` as well — which is exactly the duplicate
    // the reader must not attach twice.
    items: files.map((entry) => ({ kind: 'file', getAsFile: () => entry })),
  };
}

/** An older clipboard that carries its files only through `items`. */
function itemsOnly(files: readonly File[]): ClipboardFileSource {
  return {
    files: [],
    items: files.map((entry) => ({ kind: 'file', getAsFile: () => entry })),
  };
}

const SUPPORTED = /\.(png|jpe?g|webp)$/i;

// --------------------------------------------------------------------------
// 1. A screenshot, named and unnamed.
// --------------------------------------------------------------------------

{
  // Chrome and Firefox invent this name for a PrtSc screenshot.
  const result = imageFilesFromClipboard(
    clipboard([file('image.png', 'image/png')]),
  );
  check('chrome screenshot is accepted', result.files.length === 1);
  check(
    'a usable name is kept as it is',
    result.files[0]?.name === 'image.png',
    result.files[0]?.name,
  );
  check('nothing is reported rejected', result.rejected === 0);
}

{
  // The clipboards that hand over no name at all. This is the case that would otherwise be
  // refused by the upload route, which decides by extension.
  const result = imageFilesFromClipboard(clipboard([file('', 'image/png')]));
  check('unnamed screenshot is accepted', result.files.length === 1);
  check(
    'unnamed screenshot is renamed with an extension',
    SUPPORTED.test(result.files[0]?.name ?? ''),
    result.files[0]?.name,
  );
  check(
    'the renamed file keeps its type',
    result.files[0]?.type === 'image/png',
    result.files[0]?.type,
  );
  check(
    'the renamed file keeps its bytes',
    result.files[0]?.size === 3,
    String(result.files[0]?.size),
  );
}

{
  // Windows' Snipping Tool has been seen to give a name with no extension at all.
  const result = imageFilesFromClipboard(
    clipboard([file('Screenshot', 'image/jpeg')]),
  );
  check(
    'an extensionless name is renamed, not passed through',
    result.files[0]?.name !== 'Screenshot' &&
      (result.files[0]?.name ?? '').endsWith('.jpg'),
    result.files[0]?.name,
  );
}

// --------------------------------------------------------------------------
// 2. Formats the upload routes cannot store.
// --------------------------------------------------------------------------

{
  // Safari copies a screenshot as TIFF. Reported, so the composer can say why.
  const result = imageFilesFromClipboard(
    clipboard([file('image.tiff', 'image/tiff')]),
  );
  check('a TIFF is not attached', result.files.length === 0);
  check('a TIFF is reported', result.rejected === 1);
}

{
  const result = imageFilesFromClipboard(
    clipboard([
      file('logo.svg', 'image/svg+xml'),
      file('anim.gif', 'image/gif'),
    ]),
  );
  check('SVG and GIF are not attached', result.files.length === 0);
  check('both are reported', result.rejected === 2, String(result.rejected));
}

{
  // A supported picture beside an unsupported one: the good one still lands.
  const result = imageFilesFromClipboard(
    clipboard([file('shot.png', 'image/png'), file('scan.tiff', 'image/tiff')]),
  );
  check('the supported picture is kept', result.files.length === 1);
  check('the other is reported', result.rejected === 1);
}

// --------------------------------------------------------------------------
// 3. Clipboards that are not pictures.
// --------------------------------------------------------------------------

{
  const result = imageFilesFromClipboard({ files: [], items: [] });
  check('an empty clipboard yields nothing', result.files.length === 0);
  check('an empty clipboard reports nothing', result.rejected === 0);
}

{
  // Copied text: `items` holds a string entry, never a file.
  const result = imageFilesFromClipboard({
    files: [],
    items: [{ kind: 'string', getAsFile: () => null }],
  });
  check('pasted text is left alone', result.files.length === 0);
  check('pasted text is not reported as a bad image', result.rejected === 0);
}

{
  // A PDF copied out of the file explorer is something else on the clipboard — not this
  // composer's business, and not a broken picture either.
  const result = imageFilesFromClipboard(
    clipboard([file('gr.pdf', 'application/pdf')]),
  );
  check('a copied PDF is ignored', result.files.length === 0);
  check('a copied PDF is not reported', result.rejected === 0);
}

{
  check(
    'a null clipboard is safe',
    imageFilesFromClipboard(null).files.length === 0,
  );
  check(
    'an undefined clipboard is safe',
    imageFilesFromClipboard(undefined).rejected === 0,
  );
}

// --------------------------------------------------------------------------
// 4. The same picture reachable twice, and the items-only fallback.
// --------------------------------------------------------------------------

{
  // `files` and `items` both carry it; attaching it twice would upload and bill it twice.
  const result = imageFilesFromClipboard(
    clipboard([file('image.png', 'image/png')]),
  );
  check('a picture on both lists is attached once', result.files.length === 1);
}

{
  const result = imageFilesFromClipboard(
    itemsOnly([file('image.png', 'image/png')]),
  );
  check('an items-only clipboard still works', result.files.length === 1);
}

{
  // Two pictures pasted together keep the order they were copied in.
  const result = imageFilesFromClipboard(
    clipboard([file('', 'image/png'), file('', 'image/webp')]),
  );
  check('both are attached', result.files.length === 2);
  check(
    'their generated names are distinct',
    result.files[0]?.name !== result.files[1]?.name,
    `${result.files[0]?.name} / ${result.files[1]?.name}`,
  );
  check(
    'each is named for its own format',
    (result.files[0]?.name ?? '').endsWith('.png') &&
      (result.files[1]?.name ?? '').endsWith('.webp'),
    `${result.files[0]?.name} / ${result.files[1]?.name}`,
  );
}

{
  // Some Linux clipboards report no type for a copied file. The name alone decides.
  const result = imageFilesFromClipboard(clipboard([file('photo.JPG', '')]));
  check(
    'a typeless file is accepted on its extension',
    result.files.length === 1,
  );
  check(
    'and is not renamed',
    result.files[0]?.name === 'photo.JPG',
    result.files[0]?.name,
  );
}

{
  // Every generated name must survive the API's storage-key sanitiser unchanged, or a paste
  // would be stored under a different name than the one that passed validation.
  const result = imageFilesFromClipboard(clipboard([file('', 'image/png')]));
  const name = result.files[0]?.name ?? '';
  check(
    'the generated name is storage-safe ASCII',
    name === name.replace(/[^a-zA-Z0-9._-]/g, '_'),
    name,
  );
}

console.log(
  failures === 0
    ? `pastedImages: ${checks} checks passed`
    : `pastedImages: ${failures} of ${checks} checks FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
