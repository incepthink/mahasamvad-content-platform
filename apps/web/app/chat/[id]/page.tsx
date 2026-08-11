'use client';

// One conversation. The id is in the URL and the rows are the state of record, so a reload, a
// closed tab or a different machine all pick the chat back up — and it can be linked to.

import { use } from 'react';
import { ChatWorkspace } from '../../../components/ChatWorkspace';

export default function ChatThreadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <ChatWorkspace threadId={id} />;
}
