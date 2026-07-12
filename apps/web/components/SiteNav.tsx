'use client';

// Site navigation. On desktop the links render inline; below the mobile breakpoint
// (~700px, see globals.css) they collapse behind a hamburger toggle and stack as a
// full-width dropdown. Rendered as a fragment so the toggle button and <nav> stay
// direct flex children of .site-header-inner (logo + toggle on row 1, opened nav on
// row 2 via the header's flex-wrap).

import { useState } from 'react';
import Link from 'next/link';
import { Menu, X } from 'lucide-react';
import { STR } from '../lib/strings';
import { TasksMenu } from './TasksMenu';

export function SiteNav() {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <>
      <button
        type="button"
        className="nav-toggle"
        aria-label={STR.navMenu}
        aria-expanded={open}
        aria-controls="site-nav"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? (
          <X size={24} aria-hidden="true" />
        ) : (
          <Menu size={24} aria-hidden="true" />
        )}
      </button>
      <nav
        id="site-nav"
        className={open ? 'site-nav open' : 'site-nav'}
        aria-label="मुख्य"
      >
        <Link href="/" onClick={close}>
          {STR.navNew}
        </Link>
        <Link href="/generations" onClick={close}>
          {STR.navHistory}
        </Link>
        <Link href="/translate" onClick={close}>
          {STR.navTranslate}
        </Link>
        <Link href="/glossary" onClick={close}>
          {STR.navGlossary}
        </Link>
        <Link href="/references" onClick={close}>
          {STR.navReferences}
        </Link>
        <TasksMenu />
      </nav>
    </>
  );
}
