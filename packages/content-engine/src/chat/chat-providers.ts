// Which model providers /chat can offer, and what each one may be given.
//
// ONE table, and it is deliberately here rather than in the route. Two independent things
// read it and they must not be able to disagree:
//
//   * `GET /api/chat/providers`, which REPORTS the capabilities so the composer can grey out
//     a control the answering model could not use.
//   * the turn route, which ENFORCES them — a browser is never the last word on what reaches
//     a provider, and an old tab is exactly the client that would send a picture to a text
//     model. Deriving both from this table is what makes the report and the guard the same
//     statement rather than two statements that happen to agree today.
//
// It also keeps QWEN_BASE_URL read in the one package that owns it. A second read in the API
// would be a second literal of the variable's name, which is the drift the cost provider
// constant was made a single literal to avoid.
//
// Audio and YouTube are absent from the flags on purpose: both are reduced to plain text
// before any model is contacted, so they work on every provider and there is nothing to gate.

import type { ChatProvider, ChatProviderInfo } from '@dgipr/schemas';
import { isQwenConfigured } from './qwen-chat.js';

// The capability half — a property of what each lane's module actually implements, which is
// why it lives beside them. Labels are the providers' own names and stay in Latin, exactly as
// `Qwen` does in the Marathi failure messages: it is the word the officer sees in the picker.
const CHAT_PROVIDER_CAPABILITIES: Readonly<
  Record<ChatProvider, Omit<ChatProviderInfo, 'id'>>
> = {
  openai: {
    label: 'OpenAI',
    supportsImages: true,
    // DOCX and TXT, extracted before the turn is sent.
    supportsTextDocuments: true,
    // Read natively through File Search, which is what lifts the ceiling to 512 MB.
    supportsPdf: true,
  },
  qwen: {
    label: 'Qwen',
    // `Qwen/Qwen3.8-27B` is a text model, not a VL variant. A picture sent here would be
    // dropped silently by the transcript builder and the model would answer about nothing.
    supportsImages: false,
    // These arrive as extracted text like a transcript does, so they need nothing from the
    // provider at all.
    supportsTextDocuments: true,
    // There is no File Search equivalent behind vLLM, and no tool to hand a stored file to.
    supportsPdf: false,
  },
};

// Whether this deployment has what a provider needs to answer a turn.
//
// OpenAI is always listed. It is not merely the default here — the whole product needs
// OPENAI_API_KEY for every other surface, so a deployment without one is not a deployment
// with fewer chat providers, it is one that does not run.
function isConfigured(provider: ChatProvider): boolean {
  return provider === 'qwen' ? isQwenConfigured() : true;
}

/**
 * The providers this deployment can actually offer, in picker order.
 *
 * Never a base URL and never a key: ids, labels and capabilities only, so a self-hosted
 * endpoint stays server-side.
 */
export function chatProviders(): ChatProviderInfo[] {
  return (Object.keys(CHAT_PROVIDER_CAPABILITIES) as ChatProvider[])
    .filter(isConfigured)
    .map((id) => ({ id, ...CHAT_PROVIDER_CAPABILITIES[id] }));
}

/**
 * What one provider may be given, whether or not this deployment has set it up.
 *
 * Deliberately NOT nullable, and deliberately separate from the listing above. What a model
 * can read is a fact about the model; whether a box is switched on is a fact about the
 * deployment, and the turn route must not conflate them — a stale tab naming an unconfigured
 * provider is answered by the lane's own typed failure, which carries the one Marathi
 * sentence that names the operator's next move. A second "not configured" verdict here would
 * be a second copy of that judgement, reached with the officer's typed text not yet stored.
 */
export function chatProviderCapabilities(id: ChatProvider): ChatProviderInfo {
  return { id, ...CHAT_PROVIDER_CAPABILITIES[id] };
}
