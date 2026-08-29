// Extracts lucide icon node data into apps/web/lib/doodleMarks.ts, the geometry the
// page wallpaper is sketched from (components/common/PageBackdrop.tsx).
//
// Curate the sets below, then regenerate:  pnpm --filter @dgipr/web doodles
//
// Reading lucide's dist here rather than at runtime is deliberate: `lucide-react`
// exports components, not paths, and its per-icon `__iconNode` sits at a dist path
// with no export map behind it — fine to read once at authoring time, not an
// interface to ship a dependency on.
import { readFileSync } from 'node:fs';

const SETS = {
  CREATIVE_DOODLES: [
    'image',
    'camera',
    'palette',
    'sparkles',
    'crop',
    'megaphone',
    'layout-template',
    'pen-tool',
    'paintbrush',
    'frame',
    'aperture',
    'film',
    'layers',
    'shapes',
    'wand-sparkles',
    'star',
    'heart',
    'thumbs-up',
    'share-2',
    'hash',
    'at-sign',
    'send',
    'images',
    'sticker',
    'scissors',
    'pipette',
    'ruler',
    'quote',
    'bookmark',
    'smile',
    'flag',
    'zap',
    'gem',
    'feather',
    'focus',
    'monitor-play',
    'type',
    'sun',
  ],
  NEWS_DOODLES: [
    'newspaper',
    'file-text',
    'mic',
    'quote',
    'pen-line',
    'pen-tool',
    'notepad-text',
    'scroll-text',
    'book-open',
    'clipboard-list',
    'landmark',
    'building-2',
    'users',
    'speech',
    'megaphone',
    'radio',
    'printer',
    'archive',
    'folder-open',
    'paperclip',
    'highlighter',
    'stamp',
    'map-pin',
    'languages',
    'audio-lines',
    'headphones',
    'rss',
    'bookmark',
    'feather',
    'type',
    'hash',
    'gavel',
    'badge-check',
    'message-square-quote',
    'notebook-pen',
    'library',
    'clock',
  ],
  TRANSLATE_DOODLES: [
    'languages',
    'globe',
    'earth',
    'book-open',
    'book-open-text',
    'book-a',
    'letter-text',
    'type',
    'quote',
    'text-quote',
    'message-square-quote',
    'messages-square',
    'speech',
    'arrow-left-right',
    'arrow-right-left',
    'replace',
    'repeat',
    'scroll-text',
    'library',
    'bookmark',
    'file-text',
    'pen-line',
    'highlighter',
    'notebook-pen',
    'spell-check',
    'case-sensitive',
    'case-upper',
    'whole-word',
    'a-arrow-up',
    'a-arrow-down',
    'feather',
    'flag',
    'map-pin',
    'signpost',
    'handshake',
    'users',
    'hash',
  ],
  TRANSCRIBE_DOODLES: [
    'mic',
    'mic-vocal',
    'audio-lines',
    'audio-waveform',
    'headphones',
    'speaker',
    'volume-2',
    'radio',
    'radio-tower',
    'podcast',
    'music',
    'music-2',
    'disc-3',
    'file-headphone',
    'captions',
    'circle-play',
    'play',
    'pause',
    'list-music',
    'ear',
    'speech',
    'megaphone',
    'languages',
    'file-text',
    'notepad-text',
    'pen-line',
    'quote',
    'message-square-quote',
    'type',
    'activity',
    'signal',
    'video',
    'users',
    'bookmark',
    'hash',
    'clock',
  ],
};

// One line per set, saying what the page it dresses is ABOUT — the whole point of a
// per-route wallpaper is that it answers that before a word is read.
const LABELS = {
  CREATIVE_DOODLES:
    '/** Creative and Social: what an officer makes on that page is a picture. */',
  NEWS_DOODLES:
    '/** DLO: what an officer makes on that page is a news report. */',
  TRANSLATE_DOODLES:
    '/** भाषांतर: what an officer brings to that page is one language, and takes away another. */',
  TRANSCRIBE_DOODLES:
    '/** ध्वनिलेखन: what an officer brings to that page is a recording. */',
};

const DIR = 'node_modules/lucide-react/dist/esm/icons';

function nodesFor(name) {
  const src = readFileSync(`${DIR}/${name}.mjs`, 'utf8');
  // Some names are deprecated aliases whose module is a bare re-export carrying no
  // geometry of its own (letter-text -> text-initial). Follow it once rather than
  // making the curated sets remember which name lucide has since renamed.
  const alias = /export \{ default \} from '\.\/([a-z0-9-]+)\.mjs'/.exec(src);
  if (alias) return nodesFor(alias[1]);
  const start = src.indexOf('const __iconNode = ');
  const end = src.indexOf('\n];', start);
  if (start < 0 || end < 0) throw new Error(`cannot parse ${name}`);
  const literal = src.slice(start + 'const __iconNode = '.length, end + 2);
  // The literal is plain JS with unquoted keys — eval it in a sandboxed Function.
  const nodes = Function(`"use strict"; return (${literal});`)();
  return nodes.map(([tag, attrs]) => {
    const { key, ...rest } = attrs;
    return [tag, rest];
  });
}

const out = [];
out.push(`/**
 * doodleMarks — the geometry the page wallpaper is drawn from.
 *
 * GENERATED DATA, curated by hand. Each entry is a lucide icon's node list on
 * lucide's own 24x24 grid, copied out of \`lucide-react\`'s dist (ISC licensed,
 * (c) Lucide Contributors) so the backdrop can hand raw geometry to rough.js
 * instead of rendering a finished <svg> it cannot redraw.
 *
 * WHY THE DATA IS COPIED RATHER THAN IMPORTED: \`lucide-react\` exports components,
 * not paths — its per-icon \`__iconNode\` lives at a dist path with no export map
 * behind it, which is not an interface to depend on. A flat table of strings has
 * no runtime cost and nothing to break on a lucide upgrade.
 *
 * PICK MARKS WITH BOLD SILHOUETTES. rough.js re-samples every curve and jitters
 * it, so an icon carrying fine detail (dashed borders, stacked hairlines, small
 * glyphs) turns to mush at wallpaper size. Edit the sets at the top of
 * scripts/extract-doodle-marks.mjs and regenerate with \`pnpm --filter @dgipr/web
 * doodles\`; do not hand-edit the table below.
 */

/** A lucide node: an SVG tag plus its attributes, on a 24x24 viewBox. */
export type DoodleNode = readonly [string, Readonly<Record<string, string>>];
export type DoodleMark = readonly DoodleNode[];
`);

for (const [constName, names] of Object.entries(SETS)) {
  const label = LABELS[constName] ?? '';
  out.push(`${label}\nexport const ${constName}: readonly DoodleMark[] = [`);
  for (const name of names) {
    const nodes = nodesFor(name);
    const body = nodes
      .map(
        ([tag, attrs]) => `[${JSON.stringify(tag)}, ${JSON.stringify(attrs)}]`,
      )
      .join(', ');
    out.push(`  // ${name}\n  [${body}],`);
  }
  out.push(`];\n`);
}

process.stdout.write(out.join('\n'));
