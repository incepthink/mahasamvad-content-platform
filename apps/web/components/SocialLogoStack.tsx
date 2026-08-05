// The क्रिएटिव्ह format card's icon: X, Facebook and Instagram overlapping, because that one
// card produces a poster for all three — a single X mark read as "this makes a tweet".
//
// It satisfies the picker's icon signature (a component taking `size`), so it drops into
// FORMATS beside the Lucide icons with no special case at the call site.
//
// The overlap is cut by a ring in the CARD's own background colour rather than a hardcoded
// white, so it stays clean on the selected (accent-soft) card too — see --chip-bg in
// globals.css, which .output-option sets and its aria-pressed state overrides.
import { XLogo } from './XLogo';
import { FacebookLogo } from './FacebookLogo';
import { InstagramLogo } from './InstagramLogo';

const MARKS = [XLogo, FacebookLogo, InstagramLogo];

export function SocialLogoStack({ size = 30 }: { size?: number }) {
  // The glyph is INSET inside its chip, and the ring is drawn around the chip. Sizing them
  // equally looked wrong: the ring is a circle, so the corners of a square-ish mark
  // (Instagram) poked straight through it and the overlap read as a smudge.
  const chip = Math.round(size * 0.95);
  const glyph = Math.round(size * 0.62);
  return (
    <span
      className="logo-stack"
      style={{
        ['--logo-chip' as string]: `${chip}px`,
        ['--logo-glyph' as string]: `${glyph}px`,
      }}
    >
      {MARKS.map((Mark, index) => (
        <span
          key={index}
          className="logo-stack-item"
          // Earlier marks sit on top, so the row reads left-to-right with X foremost.
          style={{ zIndex: MARKS.length - index }}
        >
          <Mark size={glyph} />
        </span>
      ))}
    </span>
  );
}
