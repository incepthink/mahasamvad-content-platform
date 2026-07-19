'use client';

// App navigation: a left sidebar on desktop (collapsible to an icon-only rail,
// state kept in localStorage) that becomes an off-canvas drawer behind a slim
// sticky top bar below the 860px breakpoint (see globals.css). Rendered as a
// fragment so the topbar, backdrop, and <aside> stay direct flex children of
// <body> — desktop lays them out with body's row flex, mobile with fixed
// positioning.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BookOpen,
  History,
  Languages,
  LayoutTemplate,
  Menu,
  Mic,
  PanelLeftClose,
  PanelLeftOpen,
  SquarePen,
  X,
} from 'lucide-react';
import { STR } from '../lib/strings';
import { TasksMenu } from './TasksMenu';

const COLLAPSED_KEY = 'sidebar-collapsed';

const NAV_LINKS = [
  { href: '/', label: STR.navNew, Icon: SquarePen },
  { href: '/generations', label: STR.navHistory, Icon: History },
  { href: '/translate', label: STR.navTranslate, Icon: Languages },
  { href: '/glossary', label: STR.navGlossary, Icon: BookOpen },
  { href: '/references', label: STR.navReferences, Icon: LayoutTemplate },
  { href: '/dlo', label: STR.navDlo, Icon: Mic },
] as const;

export function AppSidebar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  // Default expanded; the stored preference is read post-hydration so the
  // server and first client render agree.
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (window.localStorage.getItem(COLLAPSED_KEY) === '1') setCollapsed(true);
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((v) => {
      window.localStorage.setItem(COLLAPSED_KEY, v ? '0' : '1');
      return !v;
    });
  };

  const closeMobile = () => setMobileOpen(false);

  // While the drawer is open: close on Escape and lock background scroll
  // (same pattern as the TasksMenu modal).
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileOpen(false);
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [mobileOpen]);

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href);

  return (
    <>
      <header className="mobile-topbar">
        <Link
          href="/"
          className="site-title"
          aria-label={STR.appName}
          onClick={closeMobile}
        >
          <img
            src="/mahasamvad-logo.png"
            alt={STR.appName}
            className="site-logo"
          />
        </Link>
        <button
          type="button"
          className="nav-toggle"
          aria-label={STR.navMenu}
          aria-expanded={mobileOpen}
          aria-controls="app-sidebar"
          onClick={() => setMobileOpen((v) => !v)}
        >
          {mobileOpen ? (
            <X size={24} aria-hidden="true" />
          ) : (
            <Menu size={24} aria-hidden="true" />
          )}
        </button>
      </header>

      {mobileOpen ? (
        <div className="sidebar-backdrop" onClick={closeMobile} />
      ) : null}

      <aside
        id="app-sidebar"
        className={[
          'sidebar',
          collapsed ? 'collapsed' : '',
          mobileOpen ? 'open' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <div className="sidebar-head">
          <Link
            href="/"
            className="site-title sidebar-logo"
            aria-label={STR.appName}
            onClick={closeMobile}
          >
            <img
              src="/mahasamvad-logo.png"
              alt={STR.appName}
              className="site-logo"
            />
          </Link>
          <button
            type="button"
            className="sidebar-collapse"
            aria-label={collapsed ? STR.navExpand : STR.navCollapse}
            title={collapsed ? STR.navExpand : STR.navCollapse}
            onClick={toggleCollapsed}
          >
            {collapsed ? (
              <PanelLeftOpen size={20} aria-hidden="true" />
            ) : (
              <PanelLeftClose size={20} aria-hidden="true" />
            )}
          </button>
        </div>

        <nav className="sidebar-nav" aria-label="मुख्य">
          {NAV_LINKS.map(({ href, label, Icon }) => (
            <Link
              key={href}
              href={href}
              className={isActive(href) ? 'sidebar-link active' : 'sidebar-link'}
              aria-current={isActive(href) ? 'page' : undefined}
              title={collapsed ? label : undefined}
              onClick={closeMobile}
            >
              <Icon size={20} aria-hidden="true" />
              <span className="sidebar-label">{label}</span>
            </Link>
          ))}
          <TasksMenu collapsed={collapsed} />
        </nav>
      </aside>
    </>
  );
}
