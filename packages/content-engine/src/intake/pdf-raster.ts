// Turning a PDF into PICTURES, because a vision model cannot read a PDF.
//
// THIS IS NOT OCR. Nothing here reads a character, calls a model or spends a rupee. It is
// format conversion: a PDF is a list of drawing instructions ("draw मुंबई in Mukta 11pt at
// x=80 y=340") and carries no pixels, so something must follow those instructions and paint
// the result before a vision model has anything to look at. OpenAI's `input_file` does this
// too — on their servers, invisibly, which is the whole of what that parameter buys. A
// self-hosted vLLM has no such layer (it answers `Unsupported chat content part type:
// 'file'`), so the conversion happens here instead.
//
// WHY TILES, AND WHY THIS IS THE ACCURATE OPTION RATHER THAN THE CHEAP ONE. Measured against
// the deployed gemma-4-31B-it on 2026-09-20: an image costs ~270 prompt tokens REGARDLESS OF
// ITS PIXEL SIZE (14 tokens for text alone, 282 with one 1588x2246 page, 554 with two
// images). The model normalises every image to one fixed internal tile, so a whole A4 page is
// downsampled until the glyphs smear — and it read `५०० कोटी` as `४०० कोटी` and the scheme
// name `पुण्यश्लोक` as `पुण्यशोधक`. Cut the SAME page into strips and each strip gets its own
// full budget, so the text lands larger: at 2x on one strip it read both correctly.
//
// That misreading is the danger this module exists to prevent, and it is worse here than on
// the old OCR lane. There the officer reviewed the extracted text and fixed names and
// amounts before they became facts. The file-native /dlo has NO review step by design (see
// DloFileWorkspace's header), so a smeared digit goes straight into a published government
// article with nothing to catch it. The repo's "never invent an amount" rule cannot help: the
// model is not inventing, it is misreading. Tiling is the guard.
//
// PAGE NUMBERS ARE THE DOCUMENT'S OWN throughout, the rule every PDF module here follows: a
// caller selects pages by them and a shifted number silently reads the wrong part of a
// document. A tile carries the page it came from and its index within that page.
//
// Free harness (renders, measures and writes tiles to disk — no network, no model):
//   tsx src/intake/pdf-raster.ts <file.pdf> [--scale=2] [--tiles=3] [--pages=2,5] [--out=dir]

import { createRequire } from 'node:module';
import { dirname, join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from '@napi-rs/canvas';

// The cmap and standard-font data pdf.js needs, resolved off the installed package exactly as
// pdf-text-layer.ts does — see its header for why these must be filesystem paths ending in a
// forward slash, on Windows too.
const pdfjsRoot = dirname(
  createRequire(import.meta.url).resolve('pdfjs-dist/package.json'),
);
function dataDir(name: string): string {
  return `${join(pdfjsRoot, name).split(sep).join('/')}/`;
}
const CMAP_URL = dataDir('cmaps');
const STANDARD_FONT_DATA_URL = dataDir('standard_fonts');

/**
 * How many horizontal strips each page is cut into. Three is the measured default: one strip
 * of an A4 page read every digit and the scheme name correctly, where the whole page did not.
 * A denser page wants more; a sparse one wastes tokens at more.
 */
export const DEFAULT_TILES_PER_PAGE = 3;

/**
 * Render scale. The model downsamples whatever it is given, so this does not buy resolution
 * directly — it buys a cleaner downsample, because antialiasing a 2x render reads better than
 * scaling up a 1x one. Above ~3x the return is nil and the memory is real.
 */
export const DEFAULT_SCALE = 2;

/**
 * How much of a strip's height is repeated on the strip below it. Without overlap a line of
 * text sitting exactly on a cut is split between two images and can be misread in both; with
 * it, every line appears whole in at least one tile. Costs one extra band of pixels per tile
 * and no extra tokens, the tile budget being fixed.
 */
export const DEFAULT_OVERLAP_RATIO = 0.08;

/**
 * A ceiling on how much one document may contribute, so a 300-page scan cannot quietly fill
 * the context window and push the officer's own note out of the prompt. The caller sizes this
 * against the model's context; see gemma-article.ts, which budgets it.
 */
export const DEFAULT_MAX_TILES = 240;

export type RasterTile = Readonly<{
  /** The page's number in the ORIGINAL document, 1-based. */
  page: number;
  /** Which strip of that page this is, 1-based. */
  tile: number;
  /** How many strips that page was cut into. */
  tileCount: number;
  png: Buffer;
  width: number;
  height: number;
}>;

export type RasterizeOptions = Readonly<{
  /** Document page numbers to render. Omitted or empty means every page. */
  pages?: readonly number[] | undefined;
  scale?: number | undefined;
  tilesPerPage?: number | undefined;
  overlapRatio?: number | undefined;
  maxTiles?: number | undefined;
}>;

/** Thrown when a document would contribute more tiles than the caller allowed. */
export class PdfRasterTooLargeError extends Error {
  constructor(
    readonly tiles: number,
    readonly maxTiles: number,
  ) {
    super(
      `ही फाईल खूप मोठी आहे — ${tiles} भाग तयार होतात, मर्यादा ${maxTiles} आहे. ` +
        `कृपया आवश्यक तेवढीच पृष्ठे निवडा किंवा फाईल लहान करा.`,
    );
    this.name = 'PdfRasterTooLargeError';
  }
}

/** Renders one page to a PNG at `scale`, white-backed (a PDF page has no background of its own). */
async function renderPage(
  pdf: Awaited<ReturnType<typeof getDocument>['promise']>,
  pageNumber: number,
  scale: number,
): Promise<{ png: Buffer; width: number; height: number }> {
  const page = await pdf.getPage(pageNumber);
  try {
    const viewport = page.getViewport({ scale });
    const width = Math.max(1, Math.ceil(viewport.width));
    const height = Math.max(1, Math.ceil(viewport.height));
    const canvas = createCanvas(width, height);
    const context = canvas.getContext('2d');
    // Without this the page renders onto transparency, which flattens to BLACK in most
    // encoders — a page of black-on-black that the model reports as blank.
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    await page.render({
      canvasContext: context as unknown as CanvasRenderingContext2D,
      viewport,
      canvas: canvas as unknown as HTMLCanvasElement,
    }).promise;
    return { png: canvas.toBuffer('image/png'), width, height };
  } finally {
    page.cleanup();
  }
}

/**
 * Cuts one rendered page into overlapping horizontal strips.
 *
 * A page shorter than it is wide is left whole: strips of a landscape page are letterbox
 * slivers, which normalise worse than the page did.
 */
async function tilePage(
  rendered: { png: Buffer; width: number; height: number },
  pageNumber: number,
  tilesPerPage: number,
  overlapRatio: number,
): Promise<RasterTile[]> {
  const { png, width, height } = rendered;
  if (tilesPerPage <= 1 || height <= width) {
    return [{ page: pageNumber, tile: 1, tileCount: 1, png, width, height }];
  }

  const band = height / tilesPerPage;
  const overlap = Math.round(band * overlapRatio);
  const image = sharp(png);
  const tiles: RasterTile[] = [];
  for (let index = 0; index < tilesPerPage; index += 1) {
    // Grow each strip by the overlap on both sides, then clamp to the page. Computing top
    // and bottom first and deriving the height from them is what keeps a clamped strip
    // inside the image — extending a height past the edge is what sharp refuses outright.
    const top = Math.max(0, Math.round(index * band) - overlap);
    const bottom = Math.min(height, Math.round((index + 1) * band) + overlap);
    const strip = await image
      .clone()
      .extract({ left: 0, top, width, height: bottom - top })
      .png()
      .toBuffer();
    tiles.push({
      page: pageNumber,
      tile: index + 1,
      tileCount: tilesPerPage,
      png: strip,
      width,
      height: bottom - top,
    });
  }
  return tiles;
}

/**
 * Renders the selected pages of a PDF into overlapping strips a vision model can read.
 *
 * Throws {@link PdfRasterTooLargeError} before rendering anything when the selection would
 * exceed `maxTiles` — the check is up front so a document that cannot be used costs no work.
 */
export async function rasterizePdf(
  data: Buffer,
  options: RasterizeOptions = {},
): Promise<RasterTile[]> {
  const scale = options.scale ?? DEFAULT_SCALE;
  const tilesPerPage = Math.max(
    1,
    options.tilesPerPage ?? DEFAULT_TILES_PER_PAGE,
  );
  const overlapRatio = options.overlapRatio ?? DEFAULT_OVERLAP_RATIO;
  const maxTiles = options.maxTiles ?? DEFAULT_MAX_TILES;

  // pdf.js takes ownership of the array it is handed and detaches it — copy, so the caller's
  // buffer survives (the same note pdf-text-layer.ts carries).
  const task = getDocument({
    data: new Uint8Array(data),
    cMapUrl: CMAP_URL,
    cMapPacked: true,
    standardFontDataUrl: STANDARD_FONT_DATA_URL,
    useSystemFonts: false,
  });

  try {
    const pdf = await task.promise;
    const requested =
      options.pages && options.pages.length > 0
        ? [...new Set(options.pages)]
            .filter(
              (page) =>
                Number.isInteger(page) && page >= 1 && page <= pdf.numPages,
            )
            .sort((a, b) => a - b)
        : Array.from({ length: pdf.numPages }, (_, index) => index + 1);

    if (requested.length === 0) return [];

    const projected = requested.length * tilesPerPage;
    if (projected > maxTiles) {
      throw new PdfRasterTooLargeError(projected, maxTiles);
    }

    const tiles: RasterTile[] = [];
    for (const pageNumber of requested) {
      const rendered = await renderPage(pdf, pageNumber, scale);
      tiles.push(
        ...(await tilePage(rendered, pageNumber, tilesPerPage, overlapRatio)),
      );
    }
    return tiles;
  } finally {
    await task.destroy().catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Free harness
// ---------------------------------------------------------------------------
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'));
  const flag = (name: string): string | undefined =>
    args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];

  if (!file) {
    console.error(
      'usage: tsx src/intake/pdf-raster.ts <file.pdf> [--scale=2] [--tiles=3] [--pages=2,5] [--out=dir]',
    );
    process.exit(1);
  }

  const { readFile, writeFile, mkdir } = await import('node:fs/promises');
  const pages = flag('pages')
    ?.split(',')
    .map((n) => Number(n.trim()));
  const outDir = flag('out');

  const started = Date.now();
  const tiles = await rasterizePdf(await readFile(file), {
    ...(flag('scale') ? { scale: Number(flag('scale')) } : {}),
    ...(flag('tiles') ? { tilesPerPage: Number(flag('tiles')) } : {}),
    ...(pages ? { pages } : {}),
  });
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);

  const bytes = tiles.reduce((sum, t) => sum + t.png.length, 0);
  console.log(
    `${tiles.length} tiles from ${new Set(tiles.map((t) => t.page)).size} page(s) in ${elapsed}s, ` +
      `${(bytes / 1024 / 1024).toFixed(2)} MB total`,
  );
  for (const tile of tiles) {
    console.log(
      `  page ${tile.page} tile ${tile.tile}/${tile.tileCount}  ${tile.width}x${tile.height}  ` +
        `${(tile.png.length / 1024).toFixed(0)} KB`,
    );
  }
  // ~270 prompt tokens per image, measured against gemma-4-31B-it.
  console.log(`\nestimated image tokens: ~${tiles.length * 270}`);

  if (outDir) {
    await mkdir(outDir, { recursive: true });
    for (const tile of tiles) {
      await writeFile(
        join(
          outDir,
          `p${String(tile.page).padStart(3, '0')}-t${tile.tile}.png`,
        ),
        tile.png,
      );
    }
    console.log(`wrote ${tiles.length} files to ${outDir}`);
  }
}
