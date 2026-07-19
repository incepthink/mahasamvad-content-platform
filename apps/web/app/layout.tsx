import './globals.css';

import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Noto_Sans_Devanagari } from 'next/font/google';
import { STR } from '../lib/strings';
import { TasksProvider } from '../lib/TasksProvider';
import { AppSidebar } from '../components/AppSidebar';
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
  icons: {
    icon: '/favicon.ico',
    shortcut: '/favicon.ico',
  },
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
          <AppSidebar />
          <div className="app-main">
            {children}
            <footer className="site-footer">
              <a
                href="https://hashcase.co"
                target="_blank"
                rel="noopener noreferrer"
                className="powered-by"
              >
                <span
                  style={{
                    color: '#fff',
                    paddingRight: '4px',
                    marginTop: '2px',
                  }}
                >
                  {STR.poweredBy}
                </span>
                <HashcaseLogo className="powered-logo" />
              </a>
            </footer>
          </div>
        </TasksProvider>
      </body>
    </html>
  );
}
