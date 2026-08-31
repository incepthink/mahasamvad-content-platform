import './globals.css';

import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Mukta } from 'next/font/google';
import Script from 'next/script';
import { STR } from '../lib/strings';
import { TasksProvider } from '../lib/TasksProvider';
import { AppSidebar } from '../components/AppSidebar';
import { InstallAppPrompt } from '../components/InstallAppPrompt';
import { PwaRegistration } from '../components/PwaRegistration';

import RouteAwareLayout from '../components/navigation/RouteAwareLayout';

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
  // Exposed as a CSS variable as well as a class so Tailwind's `font-sans`
  // (mapped to it in app/globals.css) shapes Devanagari like the rest of the UI.
  variable: '--font-devanagari',
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
    title: 'Newsroom',
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
  // suppressHydrationWarning below is about the browser's TRANSLATOR, not about
  // anything this app renders. Chrome sees a Marathi page under an English UI
  // locale and translates it BEFORE React hydrates, stamping lang="en" +
  // class="translated-ltr" onto <html>; extensions do the same to <body>.
  // Without it the console opens on a hydration error no code change here can
  // resolve. It suppresses the ATTRIBUTE mismatch on these two elements only —
  // one level deep — so a genuine mismatch inside the app is still reported.
  // It does NOT make the app translation-safe on its own: that is the stable
  // keys + wrapped text nodes on the pages React mutates heavily.
  return (
    <html lang="mr" suppressHydrationWarning>
      <body
        className={`${devanagari.className} ${devanagari.variable}`}
        suppressHydrationWarning
      >
        <Script
          src="https://www.googletagmanager.com/gtag/js?id=G-QB1WJY706H"
          strategy="afterInteractive"
        />
        <Script id="google-analytics" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', 'G-QB1WJY706H');
          `}
        </Script>
        <PwaRegistration />
        <RouteAwareLayout>{children}</RouteAwareLayout>
      </body>
    </html>
  );
}
