'use client';

// Which model answers this turn.
//
// *** CONVENIENCE ONLY. This is not authorization and must never become authorization. ***
//
// The LIST is a deployment-level fact — which providers are configured on the API box — so it
// is fetched ONCE per page load and, exactly as CanvaLink does, a failure degrades rather than
// blocking: no picker is rendered and the default provider answers, which is the behaviour
// this surface had before there was a second one.
//
// WHAT THE CAPABILITIES ARE FOR: the composer greys out a control the answering model could
// not use, so an officer does not attach a picture to a text-only model and get a confident
// answer about nothing. They are REPORTED by the API rather than restated here on purpose —
// one table, in the engine beside the lanes that implement it (chat/chat-providers.ts), read
// both by the endpoint that reports them and by the turn route that enforces them. A second
// copy in the browser is the drift that would let the picker and the refusal disagree.

import { useEffect, useState } from 'react';
import {
  type ChatProvider,
  type ChatProviderInfo,
} from '@dgipr/schemas';
import { listChatProviders } from './api';

// What a provider we have no report for may be given. Everything — which is what this surface
// allowed before capabilities existed, and the honest answer when the metadata request failed:
// gating on a guess would disable controls that work, and the API is the backstop either way.
const UNGATED: Omit<ChatProviderInfo, 'id' | 'label'> = {
  supportsImages: true,
  supportsTextDocuments: true,
  supportsPdf: true,
};

// Fetched once per page load however many composers mount. Never rejects — a failed request
// is an empty list, which renders no picker.
let pending: Promise<ChatProviderInfo[]> | null = null;
function loadProviders(): Promise<ChatProviderInfo[]> {
  if (!pending) pending = listChatProviders().catch(() => []);
  return pending;
}

export function useChatProvider(): {
  // Empty until the list lands, and empty for good if it failed.
  providers: ChatProviderInfo[];
  provider: ChatProvider;
  // What the fixed provider may be given. Ungated until its report is in hand.
  capabilities: Omit<ChatProviderInfo, 'id' | 'label'> & { label: string };
} {
  const [providers, setProviders] = useState<ChatProviderInfo[]>([]);
  // This surface is intentionally fixed to Qwen. Keep the explicit wire value here rather
  // than relying only on the shared fallback: the browser must name Qwen on every request,
  // including while API and web processes are being restarted during a rolling deploy.
  const provider: ChatProvider = 'qwen';

  useEffect(() => {
    let alive = true;
    void loadProviders().then((list) => {
      if (!alive) return;
      setProviders(list);
    });
    return () => {
      alive = false;
    };
  }, []);

  const reported = providers.find((entry) => entry.id === provider);

  return {
    providers,
    provider,
    capabilities: reported
      ? {
          label: reported.label,
          supportsImages: reported.supportsImages,
          supportsTextDocuments: reported.supportsTextDocuments,
          supportsPdf: reported.supportsPdf,
        }
      : { label: provider, ...UNGATED },
  };
}
