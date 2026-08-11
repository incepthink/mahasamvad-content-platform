'use client';

// /chat — a new conversation.
//
// The thread row is NOT created here. It is created by the first message (see useChatThread),
// so opening this page and walking away leaves nothing behind, and the rail never fills with
// empty "नवीन चॅट" rows that everyone can see.

import { ChatWorkspace } from '../../components/ChatWorkspace';

export default function ChatPage() {
  return <ChatWorkspace threadId={null} />;
}
