'use client';

// "Open this poster in Canva". A plain link when the deployment has one Canva integration
// — which is every deployment until a second one is configured — and a link preceded by a
// small account picker when it has several.
//
// WHY AN ACCOUNT PICKER AT ALL: a Canva integration that has not been released for public
// use is reachable only from inside the Canva team that owns it; anyone else is turned away
// at the authorize screen with "The client ID is invalid." A second team is therefore served
// by a second integration with its own client id/secret (see apps/api/src/routes/canva.ts),
// and this control is how the officer says which one to go through. It is NOT a choice of
// personal Canva account: within any integration, the officer signs in as themselves and the
// poster lands in their own Canva.

import { useEffect, useState } from 'react';
import {
  getCanvaAccounts,
  posterCanvaUrl,
  type CanvaAccount,
} from '../lib/api';
import { STR } from '../lib/strings';

// Which integration this browser used last. Ordering/convenience only, never authorization —
// the API validates the key on every request and the officer still authorizes in Canva.
const CHOICE_KEY = 'dgipr.canva.account';

// The list is a deployment-level fact, so it is fetched ONCE per page load however many
// posters are on screen, and a failure degrades to the single plain link rather than
// hiding the button.
let pending: Promise<CanvaAccount[]> | null = null;
function loadAccounts(): Promise<CanvaAccount[]> {
  if (!pending) pending = getCanvaAccounts().catch(() => []);
  return pending;
}

function remembered(): string | null {
  try {
    return window.localStorage.getItem(CHOICE_KEY);
  } catch {
    return null;
  }
}

export function CanvaLink({ generationId }: { generationId: string }) {
  const [accounts, setAccounts] = useState<CanvaAccount[]>([]);
  const [account, setAccount] = useState('');

  useEffect(() => {
    let alive = true;
    void loadAccounts().then((list) => {
      if (!alive) return;
      setAccounts(list);
      // With one account the link carries no key at all and the API uses its default, so a
      // single-integration deployment keeps exactly the URL it had before.
      if (list.length < 2) return;
      const [first] = list;
      if (!first) return;
      const saved = remembered();
      setAccount(
        list.some((entry) => entry.key === saved) && saved ? saved : first.key,
      );
    });
    return () => {
      alive = false;
    };
  }, []);

  const link = (
    <a
      className="icon-btn canva-link"
      href={posterCanvaUrl(generationId, account || undefined)}
      target="_blank"
      rel="noopener noreferrer"
      title={STR.iconOpenPosterInCanva}
      aria-label={STR.iconOpenPosterInCanva}
    >
      <img src="/canva.png" alt="" width={18} height={18} aria-hidden="true" />
      <span>Canva</span>
    </a>
  );

  if (accounts.length < 2) return link;

  return (
    <span className="canva-picker">
      {/* Native <select> rather than a custom popover, for the reason the history facets
          give: on a phone it opens as the platform's own full-height list. */}
      <select
        value={account}
        onChange={(event) => {
          const next = event.target.value;
          setAccount(next);
          try {
            window.localStorage.setItem(CHOICE_KEY, next);
          } catch {
            // A browser with site data blocked simply does not remember the choice.
          }
        }}
        title={STR.canvaAccountLabel}
        aria-label={STR.canvaAccountLabel}
      >
        {accounts.map((entry) => (
          <option key={entry.key} value={entry.key}>
            {entry.label}
          </option>
        ))}
      </select>
      {link}
    </span>
  );
}
