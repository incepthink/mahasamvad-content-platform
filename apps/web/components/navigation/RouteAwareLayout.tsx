'use client';
import React from 'react';
import { TasksProvider } from '../../lib/TasksProvider';
import { usePathname } from 'next/dist/client/components/navigation';
import { AppSidebar } from '../AppSidebar';
import { InstallAppPrompt } from '../InstallAppPrompt';
import HashcaseLogo from '../../public/hashcase-text.svg';
import { STR } from '../../lib/strings';

const RouteAwareLayout = ({ children }: { children: React.ReactNode }) => {
  const path = usePathname();

  return (
    <TasksProvider>
      {path !== '/media-room' && path !== '/new-dlo' ? <AppSidebar /> : null}
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
  );
};

export default RouteAwareLayout;
