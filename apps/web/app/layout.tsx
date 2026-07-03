import './globals.css';

import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { Noto_Sans_Devanagari } from 'next/font/google';
import { STR } from '../lib/strings';

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
        <header className="site-header">
          <div className="site-header-inner">
            <Link href="/" className="site-title">
              <span className="site-name">{STR.appName}</span>
              <span className="site-subtitle">{STR.appSubtitle}</span>
            </Link>
            <nav className="site-nav" aria-label="मुख्य">
              <Link href="/">{STR.navNew}</Link>
              <Link href="/generations">{STR.navHistory}</Link>
            </nav>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
