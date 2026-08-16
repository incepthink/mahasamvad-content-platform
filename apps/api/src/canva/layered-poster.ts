import PptxGenJS from 'pptxgenjs';
import type { CanvaSocialPosterLayers } from '@dgipr/poster-renderer';

const SLIDE_WIDTH_INCHES = 8;
const LAYOUT_NAME = 'MAHASAMVAD_SOCIAL_POSTER';

type PptxImageOptions = Readonly<{
  data: string;
  x: number;
  y: number;
  w: number;
  h: number;
  objectName: string;
  altText: string;
}>;

type PptxBuilder = {
  layout: string;
  author: string;
  company: string;
  subject: string;
  title: string;
  defineLayout(value: { name: string; width: number; height: number }): void;
  addSlide(): {
    background: { color: string };
    addImage(value: PptxImageOptions): void;
  };
  write(value: {
    outputType: 'nodebuffer';
    compression: boolean;
  }): Promise<unknown>;
};

function imageData(png: Buffer): string {
  return `data:image/png;base64,${png.toString('base64')}`;
}

/**
 * Build the file Canva receives for an ordinary DGIPR social poster.
 *
 * The full-canvas first image contains the model-painted poster with transparent holes where
 * the official chrome lived. The exact logo and footer crops sit above it as independent image
 * objects. Canva therefore imports three selectable elements, and Magic Layers can be applied
 * to `Mahasamvad editable artwork` without ever seeing or reconstructing the brand assets.
 */
export async function createLayeredSocialPosterPptx(
  layers: CanvaSocialPosterLayers,
): Promise<Buffer> {
  if (layers.width <= 0 || layers.height <= 0) {
    throw new Error('Canva poster dimensions must be positive.');
  }

  const slideHeight = (SLIDE_WIDTH_INCHES * layers.height) / layers.width;
  const toSlideUnits = SLIDE_WIDTH_INCHES / layers.width;
  // PptxGenJS 4 ships a proper ESM default at runtime, but its NodeNext declaration currently
  // exposes that value as the module namespace. Narrow the known runtime shape here rather than
  // enabling esModuleInterop for the whole API.
  type PptxConstructor = new () => PptxBuilder;
  const imported = PptxGenJS as unknown as
    PptxConstructor | { default: PptxConstructor };
  const PptxConstructor =
    typeof imported === 'function' ? imported : imported.default;
  const pptx = new PptxConstructor();
  pptx.defineLayout({
    name: LAYOUT_NAME,
    width: SLIDE_WIDTH_INCHES,
    height: slideHeight,
  });
  pptx.layout = LAYOUT_NAME;
  pptx.author = 'DGIPR Mahasamvad Content Platform';
  pptx.company =
    'Directorate General of Information and Public Relations, Maharashtra';
  pptx.subject = 'Layered Canva poster handoff';
  pptx.title = 'Mahasamvad poster';

  const slide = pptx.addSlide();
  slide.background = { color: 'FFFFFF' };
  slide.addImage({
    data: imageData(layers.base),
    x: 0,
    y: 0,
    w: SLIDE_WIDTH_INCHES,
    h: slideHeight,
    objectName: 'Mahasamvad editable artwork',
    altText:
      'Editable Mahasamvad poster artwork. Apply Magic Layers to this image only.',
  });
  slide.addImage({
    data: imageData(layers.logo.png),
    x: layers.logo.left * toSlideUnits,
    y: layers.logo.top * toSlideUnits,
    w: layers.logo.width * toSlideUnits,
    h: layers.logo.height * toSlideUnits,
    objectName: 'Official Maharashtra Government logo - keep unchanged',
    altText: 'Official Maharashtra Government logo.',
  });
  slide.addImage({
    data: imageData(layers.footer.png),
    x: layers.footer.left * toSlideUnits,
    y: layers.footer.top * toSlideUnits,
    w: layers.footer.width * toSlideUnits,
    h: layers.footer.height * toSlideUnits,
    objectName: 'Official DGIPR footer - keep unchanged',
    altText: 'Official DGIPR footer.',
  });

  const output = await pptx.write({
    outputType: 'nodebuffer',
    compression: true,
  });
  if (!(output instanceof Uint8Array)) {
    throw new Error('Could not create the layered Canva presentation.');
  }
  return Buffer.from(output);
}
