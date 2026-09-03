// Pasting a picture into a composer: turning a clipboard into files the upload routes accept.
//
// WHY THIS IS NOT `event.clipboardData.files` INLINE. Both image upload routes decide what a
// file is from its FILENAME EXTENSION (`isImageFileName` on /chat, `imageMimeFor` on
// /new-video-workflow — the browser's reported type is deliberately not trusted anywhere in
// this repo), and a screenshot taken with PrtSc has no filename at all. Chrome and Firefox
// invent `image.png` for it, which happens to pass; other clipboards hand over an empty name,
// and Windows' own Snipping Tool has been seen to give one with no extension. So a pasted
// file is RENAMED here, from its MIME type, before anything else sees it — otherwise paste
// works in one browser and answers `फक्त JPG, PNG किंवा WEBP चित्रे स्वीकारली जातात` in the next.
//
// An image the routes cannot store (Safari copies screenshots as `image/tiff`; a copied web
// image may be GIF or SVG) is COUNTED rather than dropped, so the composer can say why
// nothing appeared instead of looking broken.
//
// Free harness: `npx tsx --tsconfig apps/web/tsconfig.check.json apps/web/lib/pastedImages.check.ts`
// (from a workspace that has tsx — packages/content-engine does).

// The set both upload routes accept, and the extension each one is stored under. Kept here
// rather than imported from `IMAGE_MIME_BY_EXTENSION` because that map runs the other way
// (extension -> type) and picks `.jpg` or `.jpeg` ambiguously for image/jpeg.
const EXTENSION_BY_MIME: Readonly<Record<string, string>> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
};

const SUPPORTED_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'] as const;

/**
 * The shape both a real `DataTransfer` and a hand-built test double satisfy. Typed
 * structurally so the harness can run in Node, which has `File` but no `DataTransfer`.
 */
export type ClipboardFileSource = {
  readonly files?: ArrayLike<File> | null | undefined;
  readonly items?:
    | ArrayLike<{ readonly kind: string; getAsFile: () => File | null }>
    | null
    | undefined;
};

export type PastedImages = Readonly<{
  /** Ready to hand straight to the composer's `onAddImages`. */
  files: readonly File[];
  /** Clipboard images in a format neither route can store, e.g. TIFF, GIF or SVG. */
  rejected: number;
}>;

function hasSupportedExtension(name: string): boolean {
  const lower = name.toLowerCase();
  return SUPPORTED_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

/** True for anything that owns the keystroke itself — another field's paste is not ours. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

function toArray<T>(list: ArrayLike<T> | null | undefined): T[] {
  if (!list) return [];
  return Array.from({ length: list.length }, (_, index) => list[index] as T);
}

/**
 * Every image on the clipboard, renamed where the clipboard gave no usable name.
 *
 * `files` is preferred over `items` rather than merged: a clipboard exposes the same
 * screenshot through both, and merging would attach it twice.
 */
export function imageFilesFromClipboard(
  data: ClipboardFileSource | null | undefined,
): PastedImages {
  if (!data) return { files: [], rejected: 0 };

  const direct = toArray(data.files).filter(
    (file): file is File => file instanceof File,
  );
  const candidates =
    direct.length > 0
      ? direct
      : toArray(data.items)
          .filter((item) => item?.kind === 'file')
          .map((item) => item.getAsFile())
          .filter((file): file is File => file instanceof File);

  const files: File[] = [];
  let rejected = 0;
  // One stamp for the whole paste, so two pictures pasted together sort in the order they
  // were copied rather than by whichever millisecond each was renamed in.
  const stamp = Date.now().toString(36);

  candidates.forEach((file, index) => {
    const type = file.type.toLowerCase();
    const named = hasSupportedExtension(file.name);
    // A file with no image type and no image extension is something else on the clipboard —
    // a copied PDF, a folder — and is left alone rather than reported as a bad picture.
    if (!type.startsWith('image/') && !named) return;

    const extension = EXTENSION_BY_MIME[type];
    if (!extension) {
      // An image the routes cannot store. A name alone is still enough when the clipboard
      // reported no type at all (some Linux clipboards do this for a copied file).
      if (named && type === '') {
        files.push(file);
        return;
      }
      rejected += 1;
      return;
    }

    files.push(
      named
        ? file
        : new File([file], `pasted-image-${stamp}-${index + 1}${extension}`, {
            type,
            lastModified: file.lastModified,
          }),
    );
  });

  return { files, rejected };
}
