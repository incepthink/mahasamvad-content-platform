'use client';

// One video conversation. The id is in the URL and the rows are the state of record
// (migration 0050), so a reload, a closed tab or a different machine all pick the work back
// up — and it can be linked to. Before 0050 this page could not exist: the conversation lived
// in the API process and disappeared with it.

import { use } from 'react';
import { NewVideoWorkspace } from '../../../components/NewVideoWorkspace';

export default function NewVideoConversationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <NewVideoWorkspace conversationId={id} />;
}
