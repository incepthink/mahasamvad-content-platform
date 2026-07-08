import './globals.css';

import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { Noto_Sans_Devanagari } from 'next/font/google';
import { STR } from '../lib/strings';
import { TasksProvider } from '../lib/TasksProvider';
import { TasksMenu } from '../components/TasksMenu';
import HashcaseLogo from '../public/hashcase-text.svg';

// Same family the poster renderer typesets with, so the UI shapes Devanagari
// conjuncts exactly like the output it previews.
const devanagari = Noto_Sans_Devanagari({
  subsets: ['devanagari', 'latin'],
  weight: ['400', '600', '700'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: STR.appName,
  description: STR.appSubtitle,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="mr">
      <body className={devanagari.className}>
        <TasksProvider>
          <header className="site-header">
            <div className="site-header-inner">
              <Link href="/" className="site-title" aria-label={STR.appName}>
                {/* eslint-disable-next-line */}
                <img
                  src="/mahasamvad-logo.png"
                  alt={STR.appName}
                  className="site-logo"
                />
              </Link>
              <nav className="site-nav" aria-label="मुख्य">
                <Link href="/">{STR.navNew}</Link>
                <Link href="/generations">{STR.navHistory}</Link>
                <Link href="/glossary">{STR.navGlossary}</Link>
                <TasksMenu />
              </nav>
            </div>
          </header>
          {children}
        </TasksProvider>
        <footer className="site-footer">
          <a
            href="https://hashcase.co"
            target="_blank"
            rel="noopener noreferrer"
            className="powered-by"
          >
            <span
              style={{ color: '#fff', paddingRight: '4px', marginTop: '2px' }}
            >
              {STR.poweredBy}
            </span>
            <HashcaseLogo className="powered-logo" />
          </a>
        </footer>
      </body>
    </html>
  );
}
