// The content of one distillation turn: a plain string, or — for a vision pair — ordered text
// and image parts.
//
// A vision pair's student turn is what `buildGemmaMessages` produces for production: the
// prompt text, split at the source-file marker, with each document's `=== स्रोत: … ===` label
// and its image tiles spliced in between. The tiles are written as FILES beside the JSONL and
// referenced by a relative path, never inlined as base64: a 2-page scan at 1120 soft tokens is
// megabytes of PNG, and a JSONL line of that size is unreadable, undiffable and slow for every
// tool that opens it. Both the dataset builder and train.py resolve a path against the
// directory of the file that names it.

export type PairTextPart = Readonly<{ type: 'text'; text: string }>;
export type PairImagePart = Readonly<{ type: 'image'; path: string }>;
export type PairPart = PairTextPart | PairImagePart;
export type PairContent = string | readonly PairPart[];

export function isPartList(content: unknown): content is readonly PairPart[] {
  return Array.isArray(content);
}

/** Every text segment, in order, joined — images contribute nothing. */
export function contentText(content: PairContent): string {
  if (typeof content === 'string') return content;
  return content
    .map((part) => (part.type === 'text' ? part.text : ''))
    .join('');
}

/** The relative paths of the image parts, in order. */
export function contentImagePaths(content: PairContent): string[] {
  if (typeof content === 'string') return [];
  return content
    .filter((part): part is PairImagePart => part.type === 'image')
    .map((part) => part.path);
}

/**
 * Why a content value is not a valid turn, or null. A part list must be non-empty, every part
 * must be a known type with a non-empty payload, and an image path must be relative and stay
 * inside its directory — a path that escapes it would make the dataset read an arbitrary file.
 */
export function contentProblem(content: unknown): string | null {
  if (typeof content === 'string') return null;
  if (!Array.isArray(content))
    return 'content is neither a string nor a part list';
  if (content.length === 0) return 'content is an empty part list';
  for (const part of content as unknown[]) {
    const record =
      part !== null && typeof part === 'object'
        ? (part as Record<string, unknown>)
        : {};
    if (record['type'] === 'text') {
      if (typeof record['text'] !== 'string') return 'a text part has no text';
      continue;
    }
    if (record['type'] === 'image') {
      const path = record['path'];
      if (typeof path !== 'string' || path.length === 0) {
        return 'an image part has no path';
      }
      if (
        path.startsWith('/') ||
        /^[A-Za-z]:/u.test(path) ||
        path.split(/[\\/]/u).includes('..')
      ) {
        return `image path "${path}" is not a relative path inside the pair directory`;
      }
      continue;
    }
    return `unknown part type ${JSON.stringify(record['type'])}`;
  }
  return null;
}

/** Rewrite each image path — the dataset builder moves images beside its own JSONL. */
export function mapImagePaths(
  content: PairContent,
  map: (path: string) => string,
): PairContent {
  if (typeof content === 'string') return content;
  return content.map((part) =>
    part.type === 'image' ? { type: 'image', path: map(part.path) } : part,
  );
}

/** The file extension a data URI's MIME type should be saved under. */
export function extensionForDataUri(uri: string): string {
  const mime = /^data:([^;,]+)[;,]/u.exec(uri)?.[1]?.toLowerCase() ?? '';
  if (mime === 'image/jpeg' || mime === 'image/jpg') return 'jpg';
  if (mime === 'image/webp') return 'webp';
  return 'png';
}

/** The bytes of a base64 data URI. Refuses anything else rather than writing garbage. */
export function dataUriBytes(uri: string): Buffer {
  const comma = uri.indexOf(',');
  if (
    !uri.startsWith('data:') ||
    comma === -1 ||
    !uri.slice(0, comma).endsWith(';base64')
  ) {
    throw new Error('Expected a base64 data URI for an image part.');
  }
  return Buffer.from(uri.slice(comma + 1), 'base64');
}
