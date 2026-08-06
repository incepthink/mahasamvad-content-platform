'use client';

import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';
import { STR } from '../lib/strings';

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

const DISMISSED_KEY = 'dgipr.install-prompt-dismissed';

export function InstallAppPrompt() {
  const [promptEvent, setPromptEvent] = useState<InstallPromptEvent | null>(
    null,
  );

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault();
      if (window.sessionStorage.getItem(DISMISSED_KEY) !== '1') {
        setPromptEvent(event as InstallPromptEvent);
      }
    };
    const onInstalled = () => setPromptEvent(null);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (!promptEvent) return null;

  const install = async () => {
    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    setPromptEvent(null);
    if (choice.outcome === 'dismissed') {
      window.sessionStorage.setItem(DISMISSED_KEY, '1');
    }
  };

  const dismiss = () => {
    window.sessionStorage.setItem(DISMISSED_KEY, '1');
    setPromptEvent(null);
  };

  return (
    <aside className="install-app-prompt" aria-label={STR.installAppTitle}>
      <Download size={22} aria-hidden="true" />
      <div className="install-app-copy">
        <strong>{STR.installAppTitle}</strong>
        <span>{STR.installAppHint}</span>
      </div>
      <button
        type="button"
        className="btn btn-small"
        onClick={() => void install()}
      >
        {STR.installAppAction}
      </button>
      <button
        type="button"
        className="install-app-dismiss"
        aria-label={STR.installAppDismiss}
        onClick={dismiss}
      >
        <X size={18} aria-hidden="true" />
      </button>
    </aside>
  );
}
