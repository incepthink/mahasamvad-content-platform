/**
 * PageShell — the shell every index route opens with.
 *
 * Eleven routes used to hand-copy the same eight lines of markup (`<main
 * className="page">` + a ground layer + `.page-head` > `.page-head-text` > title +
 * sub). That copy is why they drifted apart, and it is what made any change to the
 * head a twenty-four-file sweep. This owns the ASSEMBLY; dgipr.css and theme.css
 * stay the authority for the LOOK.
 *
 * IT EMITS EXACTLY THE OLD MARKUP — same class names, same order, same nesting —
 * so nothing about the existing CSS had to be renamed and a hand-written one-off
 * head elsewhere in the product keeps rendering identically. Adopting it is a
 * markup change with no visual change.
 *
 * NO 'use client'. It holds no state, so it works from a server component
 * (app/not-found.tsx) and from a client one alike.
 */

import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@/lib/utils';
import type { DoodleMark } from '../../lib/doodleMarks';
import { InfoHint } from './InfoHint';
import { PageBackdrop } from './PageBackdrop';
import { PageBackground } from './PageBackground';
import type { PageBackgroundKey } from '../../lib/pageBackgrounds';

export type PageShellProps = {
  /**
   * The photograph this route sits on, named in lib/pageBackgrounds.ts.
   * `null` means no ground at all — which is what a Suspense fallback wants,
   * being replaced within a frame.
   *
   * Required rather than defaulted: a new route must say which ground it is on,
   * and a silent default is how the registry would stop being read.
   */
  background: PageBackgroundKey | null;

  /**
   * Omit ALL FOUR of title/subtitle/actions/statusChip and no <header> is
   * emitted — which is how a loading or error shell gets the column and the
   * ground and nothing else.
   */
  title?: ReactNode;
  /**
   * The page's one-line description. NOT printed under the title: it is shown
   * only inside the ⓘ popover beside the title, so the head stays one line.
   */
  subtitle?: string;
  /** Right-aligned commands — a range picker, a `btn btn-primary` link. */
  actions?: ReactNode;
  /**
   * State, not a command — a StatusChip. It sits left of `actions` in the same
   * row, which is what turns video/[id]'s and generations/[id]'s one-off
   * title-plus-chip rows into the standard head with no new CSS.
   */
  statusChip?: ReactNode;

  /** Above the head and outside it: analytics/[feature]'s `.back-link`. */
  breadcrumb?: ReactNode;

  /**
   * The doodle wallpaper, off by default. A lane uses the photograph OR the
   * marks, never both — two grounds at once read as noise — so no route passes
   * this today. It exists so turning the marks back on for one lane is a prop
   * rather than a resurrection.
   */
  doodles?: { marks: readonly DoodleMark[]; seed?: number };

  /**
   * Opt out of the glass (adds `.page-plain`). No caller today; it exists so the
   * answer to "this surface must be opaque" is a prop rather than a new selector.
   */
  plain?: boolean;

  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
};

export function PageShell({
  background,
  title,
  subtitle,
  actions,
  statusChip,
  breadcrumb,
  doodles,
  plain,
  className,
  style,
  children,
}: PageShellProps) {
  const hasHead = Boolean(title || subtitle || actions || statusChip);

  return (
    <main
      className={cn('page', plain && 'page-plain', className)}
      style={style}
    >
      {background ? <PageBackground name={background} /> : null}
      {doodles ? (
        <PageBackdrop marks={doodles.marks} seed={doodles.seed} />
      ) : null}
      {breadcrumb}
      {hasHead ? (
        <header className="page-head">
          <div className="page-head-text">
            {title ? (
              <h1 className="page-title">
                {title}
                {subtitle ? (
                  <>
                    {' '}
                    <InfoHint text={subtitle} />
                  </>
                ) : null}
              </h1>
            ) : null}
          </div>
          {statusChip || actions ? (
            <div className="page-head-actions">
              {statusChip}
              {actions}
            </div>
          ) : null}
        </header>
      ) : null}
      {children}
    </main>
  );
}
