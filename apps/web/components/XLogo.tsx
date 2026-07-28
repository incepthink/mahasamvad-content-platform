// X's current brand mark, as a filled glyph rather than a stroked Lucide icon.
// It uses currentColor, so selected/disabled/hover styles apply to it unchanged.
// Shared by the Creative and Social format picker and the cross-format links on a
// finished run — the same mark has to read identically in both places.
export function XLogo({ size = 24 }: { size?: number; strokeWidth?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      focusable="false"
      aria-hidden="true"
    >
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}
