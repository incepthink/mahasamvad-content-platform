import { FILE_NAME_MAX_CHARS, shortFileName } from '../lib/fileName';

/**
 * A file name, trimmed to fit and carrying the full one in a tooltip.
 *
 * Use this ANYWHERE a name that came off a file picker or a stored source is rendered — a
 * phone photograph arrives as 45 unbreakable characters, and every surface that printed one
 * whole pushed its page sideways on a mobile screen. See lib/fileName.ts for the trimming
 * rule; the CSS in globals.css handles the remaining case where even a trimmed name is wider
 * than the card it sits in.
 *
 * The tooltip is added ONLY when something was actually cut, so an untouched name does not
 * grow a pointless hover; and the full name stays in the DOM as `title`, so it can still be
 * read and is still what a screen reader announces for the surrounding control's aria-label.
 */
export function FileName({
  name,
  className,
  max = FILE_NAME_MAX_CHARS,
}: {
  name: string;
  className?: string | undefined;
  max?: number | undefined;
}) {
  const short = shortFileName(name, max);
  return (
    <span className={className} title={short === name ? undefined : name}>
      {short}
    </span>
  );
}
