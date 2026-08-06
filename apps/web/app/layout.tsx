import './globals.css';

import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Mukta } from 'next/font/google';
import { STR } from '../lib/strings';
import { TasksProvider } from '../lib/TasksProvider';
import { AppSidebar } from '../components/AppSidebar';
import { InstallAppPrompt } from '../components/InstallAppPrompt';
import { PwaRegistration } from '../components/PwaRegistration';
import HashcaseLogo from '../public/hashcase-text.svg';

// Same family the poster renderer typesets with, so the UI shapes Devanagari
// conjuncts exactly like the output it previews.
//
// Mukta (Ek Type), NOT Noto Sans Devanagari, and the reason is a real defect an officer
// reported as "the site changes our spelling". It never changed a character — Noto Sans
// Devanagari simply fails to form the C+र conjuncts Marathi is full of: it leaves an
// explicit halant under the ट and sets र as a separate wide letter, so इलेक्ट्रॉनिक्स reads
// as broken to a Marathi eye. Nirmala UI, Mukta, Hind, Tiro, Baloo and Mangal all form the
// ligature correctly — Noto was the outlier, and since it is the only font this site ships,
// it was the only place the text looked wrong. Every other app the officers use (Word,
// Chrome on google.com, Notepad) falls back to Windows' Nirmala UI and therefore looked
// right. Verify with the free comparison in the font harness before ever swapping this back.
const devanagari = Mukta({
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
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    title: 'महासंवाद',
    statusBarStyle: 'default',
  },
};

export const viewport: Viewport = {
  themeColor: '#9f1d20',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="mr">
      <body className={devanagari.className}>
        <PwaRegistration />
        <TasksProvider>
          <AppSidebar />
          <div className="app-main">
            <InstallAppPrompt />
            {/* /dlo used to be mounted here permanently and hidden with CSS, so that
                navigating away did not destroy an in-flight intake. It no longer needs to be:
                each intake now lives at /dlo/[id] with the row as its state of record, which
                survives a reload and a closed tab as well as a tab switch — and, unlike the
                single mounted instance, lets several officers work at once. */}
            {children}
            <footer className="site-footer">
              <a
                href="https://hashcase.tech"
                target="_blank"
                rel="noopener noreferrer"
                className="powered-by"
              >
                <span>{STR.poweredBy}</span>
                <HashcaseLogo className="powered-logo" />
              </a>
            </footer>
          </div>
        </TasksProvider>
      </body>
    </html>
  );
}
